import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const DEFAULT_IGNORES = new Set([])
const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.css', '.scss', '.html', '.htm', '.xml', '.yml', '.yaml', '.py', '.java', '.cs', '.sql', '.env', '.sh', '.bat', '.ps1'])
const SHELL_OPERATOR_PATTERN = /&&|\|\||[|<>;]/
const DANGEROUS_PATTERN = /(rm\s+-rf|format\s|shutdown|reboot|del\s+\/s|reg\s+delete|diskpart|mkfs|powershell\s+-enc)/i

function tail(text, max) {
  const value = text == null ? '' : String(text)
  return value.length <= max ? value : value.slice(-max)
}

async function exists(target) {
  try { await fs.access(target); return true } catch { return false }
}

function relativePath(guard, target) {
  if (guard.relativeSafe) return guard.relativeSafe(target)
  return (path.relative(guard.root, target).replaceAll(path.sep, '/') || '.')
}

function permissions(stat) {
  return (stat.mode & 0o777).toString(8).padStart(3, '0')
}

function metadata(guard, full, entry, stat) {
  return {
    path: relativePath(guard, full),
    name: entry.name,
    type: stat.isDirectory() ? 'directory' : 'file',
    size: stat.size,
    modifiedAt: Math.round(stat.mtimeMs),
    createdAt: Math.round(stat.birthtimeMs),
    accessedAt: Math.round(stat.atimeMs),
    mode: stat.mode,
    permissions: permissions(stat),
    uid: Number.isInteger(stat.uid) ? stat.uid : null,
    gid: Number.isInteger(stat.gid) ? stat.gid : null,
    isHidden: entry.name.startsWith('.')
  }
}

async function walk(guard, dir, options, depth = 0, acc = []) {
  if (depth > options.maxDepth || acc.length >= options.maxEntries) return acc
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (acc.length >= options.maxEntries) break
    if (!options.showIgnored && options.ignore.has(entry.name)) continue
    if (!options.showHidden && entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    const stat = await fs.stat(full).catch(() => null)
    if (!stat) continue
    acc.push(metadata(guard, full, entry, stat))
    if (entry.isDirectory()) await walk(guard, full, options, depth + 1, acc)
  }
  return acc
}

export async function fileList(payload, guard) {
  const target = guard.resolveSafe(payload.path || '.')
  const showHidden = Boolean(payload.showHidden)
  const defaultIgnores = Array.from(DEFAULT_IGNORES).filter((name) => !(showHidden && name.startsWith('.')))
  const options = {
    maxDepth: Math.min(Number(payload.maxDepth ?? 3), 12),
    maxEntries: Math.min(Number(payload.maxEntries ?? 500), 10000),
    showHidden,
    showIgnored: Boolean(payload.showIgnored),
    ignore: new Set([...(payload.ignore || []), ...defaultIgnores].map(String))
  }
  const items = await walk(guard, target, options)
  return { path: relativePath(guard, target), items, total: items.length, truncated: items.length >= options.maxEntries }
}

export async function fileRead(payload, guard) {
  if (typeof payload.path !== 'string') throw new Error('payload.path requerido')
  const target = guard.resolveSafe(payload.path)
  const maxBytes = Math.min(Number(payload.maxBytes ?? 128000), Number(payload.maxBytesLimit ?? 20 * 1024 * 1024))
  const stat = await fs.stat(target)
  if (!stat.isFile()) throw new Error('La ruta no es un archivo')
  const buffer = await fs.readFile(target)
  const slice = buffer.subarray(0, Math.min(buffer.length, maxBytes))
  const encoding = String(payload.encoding || 'utf8').toLowerCase()
  return {
    path: relativePath(guard, target),
    content: encoding === 'base64' ? slice.toString('base64') : slice.toString(encoding),
    encoding,
    size: stat.size,
    bytesRead: slice.length,
    sha256: crypto.createHash('sha256').update(slice).digest('hex'),
    truncated: stat.size > maxBytes,
    modifiedAt: Math.round(stat.mtimeMs),
    permissions: permissions(stat)
  }
}

function contentBuffer(payload) {
  if (typeof payload.contentBase64 === 'string') return { buffer: Buffer.from(payload.contentBase64, 'base64'), encoding: 'base64' }
  if (typeof payload.base64 === 'string') return { buffer: Buffer.from(payload.base64, 'base64'), encoding: 'base64' }
  if (typeof payload.content === 'string') return { buffer: Buffer.from(payload.content, payload.encoding || 'utf8'), encoding: payload.encoding || 'utf8' }
  throw new Error('payload.content, payload.contentBase64 o payload.base64 requerido')
}

function parseMode(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number.parseInt(value, 8)
  return null
}

export async function fileWrite(payload, guard) {
  if (typeof payload.path !== 'string' || !payload.path.trim()) throw new Error('payload.path requerido')
  const target = guard.resolveSafe(payload.path)
  const { buffer, encoding } = contentBuffer(payload)
  if (payload.createDirs !== false) await fs.mkdir(path.dirname(target), { recursive: true })
  const existed = await exists(target)
  if (existed && payload.overwrite === false && !payload.append) throw new Error(`Archivo ya existe y overwrite=false: ${payload.path}`)
  let backupPath = null
  if (existed && payload.backup) {
    const suffix = typeof payload.backup === 'string' ? payload.backup : `.bak-${Date.now()}`
    backupPath = target + suffix
    await fs.copyFile(target, backupPath)
  }
  if (payload.append) {
    await fs.appendFile(target, buffer)
  } else if (payload.atomic !== false) {
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`)
    await fs.writeFile(tmp, buffer)
    await fs.rename(tmp, target)
  } else {
    await fs.writeFile(target, buffer)
  }
  const mode = parseMode(payload.mode)
  if (mode != null && Number.isFinite(mode)) await fs.chmod(target, mode)
  const stat = await fs.stat(target)
  return {
    path: relativePath(guard, target),
    size: stat.size,
    bytesWritten: buffer.length,
    encoding,
    append: Boolean(payload.append),
    atomic: payload.atomic !== false && !payload.append,
    backupPath: backupPath ? relativePath(guard, backupPath) : null,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    permissions: permissions(stat),
    modifiedAt: Math.round(stat.mtimeMs),
    message: 'Archivo escrito correctamente'
  }
}

export async function fileMkdir(payload, guard) {
  if (typeof payload.path !== 'string') throw new Error('payload.path requerido')
  const target = guard.resolveSafe(payload.path)
  await fs.mkdir(target, { recursive: true })
  return { path: relativePath(guard, target), message: 'Carpeta creada correctamente' }
}

export async function fileDelete(payload, guard, config) {
  if (!config.allowDelete) throw new Error('file.delete bloqueado. Activa RUNNER_ALLOW_DELETE=true para permitirlo.')
  if (typeof payload.path !== 'string') throw new Error('payload.path requerido')
  const target = guard.resolveSafe(payload.path)
  const stat = await fs.stat(target)
  if (stat.isDirectory()) await fs.rm(target, { recursive: true, force: true })
  else await fs.unlink(target)
  return { path: relativePath(guard, target), message: 'Ruta eliminada correctamente' }
}

export async function fileSearch(payload, guard) {
  const root = guard.resolveSafe(payload.path || '.')
  const query = String(payload.query || '')
  if (!query) throw new Error('payload.query requerido')
  const maxMatches = Math.min(Number(payload.maxMatches ?? 100), 1000)
  const maxFileBytes = Math.min(Number(payload.maxFileBytes ?? 512000), 5 * 1024 * 1024)
  const caseSensitive = Boolean(payload.caseSensitive)
  const needle = caseSensitive ? query : query.toLowerCase()
  const matches = []
  async function scan(dir, depth = 0) {
    if (depth > 12 || matches.length >= maxMatches) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (matches.length >= maxMatches) break
      if (DEFAULT_IGNORES.has(entry.name)) continue
      if (!payload.showHidden && entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { await scan(full, depth + 1); continue }
      const ext = path.extname(entry.name).toLowerCase()
      if (!TEXT_EXTENSIONS.has(ext) && !payload.includeAllTextLike) continue
      const stat = await fs.stat(full).catch(() => null)
      if (!stat || stat.size > maxFileBytes) continue
      const content = await fs.readFile(full, 'utf8').catch(() => '')
      const haystack = caseSensitive ? content : content.toLowerCase()
      const index = haystack.indexOf(needle)
      if (index >= 0) matches.push({ path: relativePath(guard, full), preview: content.slice(Math.max(0, index - 120), Math.min(content.length, index + query.length + 120)), index })
    }
  }
  await scan(root)
  return { query, matches, total: matches.length, truncated: matches.length >= maxMatches }
}

function commandBase(command) {
  return path.basename(String(command || '').trim()).toLowerCase().replace(/\.exe$/, '')
}

function splitCommandLine(commandLine) {
  const input = String(commandLine || '').trim()
  const tokens = []
  let current = ''
  let quote = null
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    const next = input[i + 1]
    if (char === '\\' && quote && (next === quote || next === '\\')) { current += next; i += 1; continue }
    if (quote) { if (char === quote) quote = null; else current += char; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (/\s/.test(char)) { if (current) { tokens.push(current); current = '' } continue }
    current += char
  }
  if (quote) throw new Error(`Comando con comillas sin cerrar: ${input}`)
  if (current) tokens.push(current)
  return tokens
}

function stripHeredocs(command) {
  const lines = String(command || '').split(/\r?\n/)
  const output = []
  let delimiter = null
  for (const line of lines) {
    if (delimiter) {
      if (line.trim() === delimiter) { delimiter = null; output.push(line) }
      continue
    }
    output.push(line)
    const match = line.match(/<<-?\s*['"]?([A-Za-z0-9_.-]+)['"]?/)
    if (match) delimiter = match[1]
  }
  return output.join('\n')
}

function shellSegments(command) {
  const input = stripHeredocs(command)
  const segments = []
  let current = ''
  let quote = null
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    const next = input[i + 1]
    if (char === '\\' && quote && (next === quote || next === '\\')) { current += char + next; i += 1; continue }
    if (quote) { current += char; if (char === quote) quote = null; continue }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    const two = char + next
    if (two === '&&' || two === '||') { if (current.trim()) segments.push(current.trim()); current = ''; i += 1; continue }
    if (char === '|' || char === ';') { if (current.trim()) segments.push(current.trim()); current = ''; continue }
    current += char
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

function assertExecutableAllowed(command, config) {
  const base = commandBase(command)
  if (!base) throw new Error('payload.command requerido')
  if (config.allowAllCommands) return
  if (!config.commandAllowlist.includes(base)) throw new Error(`Comando bloqueado por allowlist: ${command}. Permitidos: ${config.commandAllowlist.join(', ')}`)
}

function assertCommandAllowed(command, args, config, useShell) {
  if (!command) throw new Error('payload.command requerido')
  if (!config.allowDangerousCommands && DANGEROUS_PATTERN.test([command, ...args].join(' '))) throw new Error(`Comando potencialmente peligroso bloqueado: ${command}`)
  if (useShell) {
    const executables = shellSegments(command).map((segment) => splitCommandLine(segment)[0]).filter(Boolean)
    if (executables.length === 0) throw new Error('payload.command requerido')
    for (const executable of executables) assertExecutableAllowed(executable, config)
    return
  }
  assertExecutableAllowed(command, config)
}

function normalizeCommandPayload(payload) {
  const rawCommand = String(payload.command || '').trim()
  if (!rawCommand) throw new Error('payload.command requerido')
  if (payload.shell || SHELL_OPERATOR_PATTERN.test(rawCommand)) return { command: rawCommand, args: [], cwdInput: payload.cwd ?? payload.path ?? '.', shell: true }
  if (Array.isArray(payload.args)) return { command: rawCommand, args: payload.args.map(String), cwdInput: payload.cwd ?? payload.path ?? '.', shell: false }
  const tokens = splitCommandLine(rawCommand)
  return { command: tokens[0], args: tokens.slice(1), cwdInput: payload.cwd ?? payload.path ?? '.', shell: false }
}

export async function runCommand(payload, guard, config, jobId, isCancelRequested = async () => false) {
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
    const finish = (result) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      clearInterval(cancelTimer)
      logStream.end()
      resolve({ ...result, durationMs: Date.now() - started })
    }
    const timeout = setTimeout(() => {
      child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
      logStream.write(`\n[TIMEOUT after ${timeoutMs}ms]\n`)
      finish({ status: 'timeout', exitCode: null, stdoutTail: tail(stdout, config.maxOutputChars), stderrTail: tail(stderr, config.maxOutputChars), summary: `Comando superó timeout de ${timeoutMs}ms`, localLogPath: logPath, truncated: stdout.length > config.maxOutputChars || stderr.length > config.maxOutputChars })
    }, timeoutMs)
    const cancelTimer = setInterval(async () => {
      try {
        if (!(await isCancelRequested())) return
        child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
        logStream.write('\n[CANCELLED by request]\n')
        finish({ status: 'cancelled', exitCode: null, stdoutTail: tail(stdout, config.maxOutputChars), stderrTail: tail(stderr, config.maxOutputChars), summary: 'Cancelado por solicitud del usuario', localLogPath: logPath, truncated: stdout.length > config.maxOutputChars || stderr.length > config.maxOutputChars })
      } catch {}
    }, Math.max(500, Number(payload.cancelPollMs ?? 1000)))
    child.stdout?.on('data', (chunk) => { const text = chunk.toString(); stdout += text; stdout = tail(stdout, config.maxOutputChars * 2); logStream.write(text) })
    child.stderr?.on('data', (chunk) => { const text = chunk.toString(); stderr += text; stderr = tail(stderr, config.maxOutputChars * 2); logStream.write(text) })
    child.on('error', (error) => finish({ status: 'error', exitCode: null, stdoutTail: tail(stdout, config.maxOutputChars), stderrTail: tail(`${stderr}\n${error.message}`, config.maxOutputChars), summary: 'Error iniciando comando', error: error.message, localLogPath: logPath, truncated: stdout.length > config.maxOutputChars || stderr.length > config.maxOutputChars }))
    child.on('close', (code) => {
      const status = code === 0 ? 'success' : 'error'
      finish({ status, exitCode: code, stdoutTail: tail(stdout, config.maxOutputChars), stderrTail: tail(stderr, config.maxOutputChars), summary: status === 'success' ? 'Comando ejecutado correctamente' : `Comando terminó con exitCode ${code}`, localLogPath: logPath, truncated: stdout.length > config.maxOutputChars || stderr.length > config.maxOutputChars })
    })
  })
}

export async function gitStatus(payload, guard, config, jobId, isCancelRequested) {
  return runCommand({ command: 'git', args: ['status', '--short'], cwd: payload.cwd || payload.path || '.', timeoutMs: payload.timeoutMs || 60000, shell: false }, guard, config, jobId, isCancelRequested)
}

export async function gitDiff(payload, guard, config, jobId, isCancelRequested) {
  const args = ['diff']
  const diffPath = payload.diffPath ?? payload.file ?? payload.targetPath
  if (diffPath) args.push('--', String(diffPath))
  return runCommand({ command: 'git', args, cwd: payload.cwd || payload.path || '.', timeoutMs: payload.timeoutMs || 60000, shell: false }, guard, config, jobId, isCancelRequested)
}
