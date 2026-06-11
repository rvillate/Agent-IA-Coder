import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.css', '.scss', '.html', '.xml', '.yml', '.yaml', '.java', '.kt', '.py', '.cs', '.csproj', '.sln', '.sql', '.properties', '.env', '.gitignore'
])

const DEFAULT_IGNORES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.angular', 'target', 'coverage', '.idea', '.vscode'])
const SHELL_OPERATOR_PATTERN = /&&|\|\||[|<>;]/
const SHELL_SEGMENT_SPLIT_PATTERN = /&&|\|\||[|;]/g
const DANGEROUS_PATTERN = /(rm\s+-rf|format\s|shutdown|reboot|del\s+\/s|reg\s+delete|diskpart|mkfs|:(){:|powershell\s+-enc)/i

function tail(text, max) {
  const value = text == null ? '' : String(text)
  return value.length <= max ? value : value.slice(-max)
}

async function exists(target) {
  try { await fs.access(target); return true } catch { return false }
}

async function walk(dir, options, base = dir, depth = 0, acc = []) {
  if (depth > options.maxDepth || acc.length >= options.maxEntries) return acc
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (acc.length >= options.maxEntries) break
    if (options.ignore.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    const rel = path.relative(base, full) || '.'
    const stat = await fs.stat(full).catch(() => null)
    acc.push({
      path: rel.replaceAll(path.sep, '/'),
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: stat?.size ?? null,
      modifiedAt: stat?.mtimeMs ? Math.round(stat.mtimeMs) : null
    })
    if (entry.isDirectory()) await walk(full, options, base, depth + 1, acc)
  }
  return acc
}

export async function fileList(payload, guard) {
  const target = guard.resolveSafe(payload.path || '.')
  const maxDepth = Math.min(Number(payload.maxDepth ?? 3), 8)
  const maxEntries = Math.min(Number(payload.maxEntries ?? 500), 2000)
  const items = await walk(target, { maxDepth, maxEntries, ignore: DEFAULT_IGNORES })
  return { path: path.relative(guard.root, target) || '.', items, total: items.length }
}

export async function fileRead(payload, guard, config) {
  const target = guard.resolveSafe(payload.path)
  const maxBytes = Math.min(Number(payload.maxBytes ?? 128000), 1024 * 1024)
  const stat = await fs.stat(target)
  if (!stat.isFile()) throw new Error('La ruta no es un archivo')
  const handle = await fs.open(target, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes))
    await handle.read(buffer, 0, buffer.length, 0)
    return {
      path: payload.path,
      content: buffer.toString('utf8'),
      size: stat.size,
      truncated: stat.size > maxBytes
    }
  } finally {
    await handle.close()
  }
}

export async function fileWrite(payload, guard) {
  if (typeof payload.path !== 'string') throw new Error('payload.path requerido')
  if (typeof payload.content !== 'string') throw new Error('payload.content requerido como string')
  const target = guard.resolveSafe(payload.path)
  if (payload.createDirs !== false) await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, payload.content, 'utf8')
  const stat = await fs.stat(target)
  return { path: payload.path, size: stat.size, message: 'Archivo escrito correctamente' }
}

export async function fileMkdir(payload, guard) {
  if (typeof payload.path !== 'string') throw new Error('payload.path requerido')
  const target = guard.resolveSafe(payload.path)
  await fs.mkdir(target, { recursive: true })
  return { path: payload.path, message: 'Carpeta creada correctamente' }
}

export async function fileDelete(payload, guard, config) {
  if (!config.allowDelete) throw new Error('file.delete bloqueado. Activa RUNNER_ALLOW_DELETE=true para permitirlo.')
  if (typeof payload.path !== 'string') throw new Error('payload.path requerido')
  const target = guard.resolveSafe(payload.path)
  const stat = await fs.stat(target)
  if (stat.isDirectory()) {
    await fs.rm(target, { recursive: true, force: true })
  } else {
    await fs.unlink(target)
  }
  return { path: payload.path, message: 'Ruta eliminada correctamente' }
}

export async function fileSearch(payload, guard, config) {
  const root = guard.resolveSafe(payload.path || '.')
  const query = String(payload.query || '')
  if (!query) throw new Error('payload.query requerido')
  const maxMatches = Math.min(Number(payload.maxMatches ?? 100), 500)
  const maxFileBytes = Math.min(Number(payload.maxFileBytes ?? 512000), 2 * 1024 * 1024)
  const caseSensitive = Boolean(payload.caseSensitive)
  const needle = caseSensitive ? query : query.toLowerCase()
  const results = []

  async function scan(dir, depth = 0) {
    if (depth > 8 || results.length >= maxMatches) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (results.length >= maxMatches) break
      if (DEFAULT_IGNORES.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await scan(full, depth + 1)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (!TEXT_EXTENSIONS.has(ext)) continue
      const stat = await fs.stat(full).catch(() => null)
      if (!stat || stat.size > maxFileBytes) continue
      const content = await fs.readFile(full, 'utf8').catch(() => '')
      const haystack = caseSensitive ? content : content.toLowerCase()
      const idx = haystack.indexOf(needle)
      if (idx >= 0) {
        const before = Math.max(0, idx - 120)
        const after = Math.min(content.length, idx + query.length + 120)
        results.push({
          path: path.relative(guard.root, full).replaceAll(path.sep, '/'),
          preview: content.slice(before, after),
          index: idx
        })
      }
    }
  }

  await scan(root)
  return { query, matches: results, total: results.length, truncated: results.length >= maxMatches }
}

function commandBase(command) {
  const value = String(command || '').trim()
  if (!value) return ''
  return path.basename(value).toLowerCase().replace(/\.exe$/, '')
}

function splitCommandLine(commandLine) {
  const input = String(commandLine || '').trim()
  const tokens = []
  let current = ''
  let quote = null

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]

    if (char === '\\' && quote && (next === quote || next === '\\')) {
      current += next
      index += 1
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (quote) throw new Error(`Comando con comillas sin cerrar: ${input}`)
  if (current) tokens.push(current)
  return tokens
}

function getShellSegmentExecutables(commandLine) {
  return String(commandLine || '')
    .split(SHELL_SEGMENT_SPLIT_PATTERN)
    .map((segment) => splitCommandLine(segment)[0])
    .filter(Boolean)
}

function assertExecutableAllowed(command, config) {
  const base = commandBase(command)
  if (!base) throw new Error('payload.command requerido')
  if (config.allowAllCommands) return
  if (!config.commandAllowlist.includes(base)) {
    throw new Error(`Comando bloqueado por allowlist: ${command}. Permitidos: ${config.commandAllowlist.join(', ')}`)
  }
}

function assertCommandAllowed(command, args, config, useShell) {
  const cmd = String(command || '').trim()
  if (!cmd) throw new Error('payload.command requerido')
  if (!config.allowDangerousCommands && DANGEROUS_PATTERN.test([cmd, ...args].join(' '))) {
    throw new Error(`Comando potencialmente peligroso bloqueado: ${cmd}`)
  }

  if (useShell) {
    const executables = getShellSegmentExecutables(cmd)
    if (executables.length === 0) throw new Error('payload.command requerido')
    for (const executable of executables) assertExecutableAllowed(executable, config)
    return
  }

  assertExecutableAllowed(cmd, config)
}

function normalizeCommandPayload(payload) {
  const rawCommand = String(payload.command || '').trim()
  const explicitArgs = Array.isArray(payload.args)
  const hasShellSyntax = SHELL_OPERATOR_PATTERN.test(rawCommand)

  if (!rawCommand) throw new Error('payload.command requerido')

  if (payload.shell || hasShellSyntax) {
    return {
      command: rawCommand,
      args: [],
      cwdInput: payload.cwd ?? payload.path ?? '.',
      shell: true
    }
  }

  if (explicitArgs) {
    return {
      command: rawCommand,
      args: payload.args.map(String),
      cwdInput: payload.cwd ?? payload.path ?? '.',
      shell: false
    }
  }

  const tokens = splitCommandLine(rawCommand)
  return {
    command: tokens[0],
    args: tokens.slice(1),
    cwdInput: payload.cwd ?? payload.path ?? '.',
    shell: false
  }
}

export async function runCommand(payload, guard, config, jobId) {
  const normalized = normalizeCommandPayload(payload)
  assertCommandAllowed(normalized.command, normalized.args, config, normalized.shell)
  const cwd = guard.resolveSafe(normalized.cwdInput)
  const timeoutMs = Math.min(Number(payload.timeoutMs ?? 120000), 30 * 60 * 1000)
  await fs.mkdir(config.logDir, { recursive: true })
  const logPath = path.join(config.logDir, `${jobId}.log`)
  const logStream = fsSync.createWriteStream(logPath, { flags: 'a' })

  return await new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let finished = false
    const started = Date.now()
    const child = spawn(normalized.command, normalized.args, { cwd, shell: normalized.shell, windowsHide: false })

    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      child.kill('SIGTERM')
      logStream.write(`\n[TIMEOUT after ${timeoutMs}ms]\n`)
      logStream.end()
      resolve({
        status: 'timeout',
        exitCode: null,
        stdoutTail: tail(stdout, config.maxOutputChars),
        stderrTail: tail(stderr, config.maxOutputChars),
        summary: `Comando superó timeout de ${timeoutMs}ms`,
        localLogPath: logPath,
        truncated: stdout.length > config.maxOutputChars || stderr.length > config.maxOutputChars,
        durationMs: Date.now() - started
      })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      stdout = tail(stdout, config.maxOutputChars * 2)
      logStream.write(text)
    })
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      stderr = tail(stderr, config.maxOutputChars * 2)
      logStream.write(text)
    })
    child.on('error', (error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      logStream.write(`\n[PROCESS ERROR] ${error.message}\n`)
      logStream.end()
      resolve({
        status: 'error',
        exitCode: null,
        stdoutTail: tail(stdout, config.maxOutputChars),
        stderrTail: tail(`${stderr}\n${error.message}`, config.maxOutputChars),
        summary: 'Error iniciando comando',
        error: error.message,
        localLogPath: logPath,
        truncated: stdout.length > config.maxOutputChars || stderr.length > config.maxOutputChars,
        durationMs: Date.now() - started
      })
    })
    child.on('close', (code) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      logStream.end()
      const status = code === 0 ? 'success' : 'error'
      resolve({
        status,
        exitCode: code,
        stdoutTail: tail(stdout, config.maxOutputChars),
        stderrTail: tail(stderr, config.maxOutputChars),
        summary: status === 'success' ? 'Comando ejecutado correctamente' : `Comando terminó con exitCode ${code}`,
        localLogPath: logPath,
        truncated: stdout.length > config.maxOutputChars || stderr.length > config.maxOutputChars,
        durationMs: Date.now() - started
      })
    })
  })
}

export async function gitStatus(payload, guard, config, jobId) {
  return runCommand({ command: 'git', args: ['status', '--short'], cwd: payload.cwd || payload.path || '.', timeoutMs: payload.timeoutMs || 60000, shell: false }, guard, config, jobId)
}

export async function gitDiff(payload, guard, config, jobId) {
  const args = ['diff']
  const diffPath = payload.diffPath ?? payload.file ?? payload.targetPath
  if (diffPath) args.push('--', String(diffPath))
  return runCommand({ command: 'git', args, cwd: payload.cwd || payload.path || '.', timeoutMs: payload.timeoutMs || 60000, shell: false }, guard, config, jobId)
}
