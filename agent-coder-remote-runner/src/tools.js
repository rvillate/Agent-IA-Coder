import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'

const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.css', '.scss', '.html', '.htm', '.xml', '.yml', '.yaml', '.py', '.java', '.cs', '.sql', '.env', '.sh', '.bat', '.ps1', '.properties', '.ini', '.gradle', '.kt', '.kts', '.go', '.rs', '.php', '.rb'])
const SHELL_OPERATOR_PATTERN = /&&|\|\||[|<>;]/
const DANGEROUS_PATTERN = /(rm\s+-rf|format\s|shutdown|reboot|del\s+\/s|reg\s+delete|diskpart|mkfs|powershell\s+-enc)/i
const HEAVY_COMMANDS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'mvn', 'gradle', 'docker', 'docker-compose', 'kubectl', 'dotnet', 'cargo', 'go', 'pytest', 'jest', 'vitest', 'playwright'])
const HEAVY_WORDS = /\b(build|serve|start|dev|deploy|package|install|ci|test|e2e|compose|up|down|apply|rollout|publish|release)\b/i
const WRITE_JOB_TYPES = new Set(['file.write', 'file.delete', 'file.mkdir'])

function tail(text, max) {
  const value = text == null ? '' : String(text)
  return value.length <= max ? value : value.slice(-max)
}

async function exists(target) {
  try { await fs.access(target); return true } catch { return false }
}

function nowMs() { return Date.now() }

function relativePath(guard, target) {
  if (guard.relativeSafe) return guard.relativeSafe(target)
  return (path.relative(guard.root, target).replaceAll(path.sep, '/') || '.')
}

function permissions(stat) {
  return (stat.mode & 0o777).toString(8).padStart(3, '0')
}

function shouldIgnoreName(name, rel, options) {
  if (options.showIgnored) return false
  const normalizedRel = String(rel || name).replaceAll('\\', '/')
  for (const raw of options.ignore || []) {
    const item = String(raw || '').trim()
    if (!item) continue
    if (name === item || normalizedRel === item || normalizedRel.includes(`/${item}/`) || normalizedRel.endsWith(`/${item}`)) return true
    if (item.startsWith('*.') && name.endsWith(item.slice(1))) return true
  }
  return false
}

function metadata(guard, full, entry, stat = null) {
  return {
    path: relativePath(guard, full),
    name: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
    size: stat ? stat.size : null,
    modifiedAt: stat ? Math.round(stat.mtimeMs) : null,
    createdAt: stat ? Math.round(stat.birthtimeMs) : null,
    accessedAt: stat ? Math.round(stat.atimeMs) : null,
    mode: stat ? stat.mode : null,
    permissions: stat ? permissions(stat) : null,
    uid: stat && Number.isInteger(stat.uid) ? stat.uid : null,
    gid: stat && Number.isInteger(stat.gid) ? stat.gid : null,
    isHidden: entry.name.startsWith('.')
  }
}

function buildIgnoreSet(payload, config, showHidden = false) {
  const defaults = config?.useSmartIgnores === false ? [] : (config?.defaultIgnores || [])
  return new Set([...(payload.ignore || []), ...defaults]
    .map(String)
    .filter((name) => !(showHidden && name.startsWith('.') && payload.showIgnored)))
}

async function walk(guard, dir, options, depth = 0, acc = [], stats = { dirsVisited: 0, filesVisited: 0, skipped: 0 }) {
  if (depth > options.maxDepth || acc.length >= options.maxEntries) return acc
  stats.dirsVisited += 1
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (acc.length >= options.maxEntries) break
    const full = path.join(dir, entry.name)
    const rel = relativePath(guard, full)
    if (shouldIgnoreName(entry.name, rel, options)) { stats.skipped += 1; continue }
    if (!options.showHidden && entry.name.startsWith('.')) { stats.skipped += 1; continue }
    let stat = null
    if (!options.fast || !entry.isDirectory()) stat = await fs.stat(full).catch(() => null)
    if (!options.fast && !stat) continue
    if (!entry.isDirectory()) stats.filesVisited += 1
    acc.push(metadata(guard, full, entry, stat))
    if (entry.isDirectory()) await walk(guard, full, options, depth + 1, acc, stats)
  }
  return acc
}

export async function fileList(payload, guard, config = {}) {
  const started = nowMs()
  const target = guard.resolveSafe(payload.path || '.')
  const showHidden = Boolean(payload.showHidden)
  const options = {
    maxDepth: Math.min(Number(payload.maxDepth ?? 3), 12),
    maxEntries: Math.min(Number(payload.maxEntries ?? 500), 10000),
    showHidden,
    showIgnored: Boolean(payload.showIgnored),
    fast: payload.fast == null ? Boolean(config.fileListFastByDefault) : Boolean(payload.fast),
    ignore: buildIgnoreSet(payload, config, showHidden)
  }
  const stats = { dirsVisited: 0, filesVisited: 0, skipped: 0 }
  const items = await walk(guard, target, options, 0, [], stats)
  return { path: relativePath(guard, target), items, total: items.length, truncated: items.length >= options.maxEntries, durationMs: nowMs() - started, stats }
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
  if (payload.append) await fs.appendFile(target, buffer)
  else if (payload.atomic !== false) {
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`)
    await fs.writeFile(tmp, buffer)
    await fs.rename(tmp, target)
  } else await fs.writeFile(target, buffer)
  const mode = parseMode(payload.mode)
  if (mode != null && Number.isFinite(mode)) await fs.chmod(target, mode)
  const stat = await fs.stat(target)
  return { path: relativePath(guard, target), size: stat.size, bytesWritten: buffer.length, encoding, append: Boolean(payload.append), atomic: payload.atomic !== false && !payload.append, backupPath: backupPath ? relativePath(guard, backupPath) : null, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), permissions: permissions(stat), modifiedAt: Math.round(stat.mtimeMs), message: 'Archivo escrito correctamente' }
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

function fileSearchQuery(payload) {
  const query = payload.query ?? payload.pattern ?? payload.text
  if (query == null || String(query) === '') throw new Error('payload.query requerido; también se acepta pattern o text')
  return String(query)
}

function isRgAvailable() {
  const result = spawnSync('rg', ['--version'], { encoding: 'utf8', timeout: 3000 })
  return result.status === 0
}

function rgArgs(payload, query, root, guard, config, options) {
  const args = ['--line-number', '--column', '--with-filename', '--no-heading', '--color', 'never', '--max-count', String(options.maxMatches)]
  if (!options.caseSensitive) args.push('--ignore-case')
  if (payload.showHidden) args.push('--hidden')
  if (!payload.showIgnored) for (const item of options.ignore) args.push('--glob', `!${item}`)
  if (options.maxFileBytes) args.push('--max-filesize', String(options.maxFileBytes))
  if (Array.isArray(payload.extensions)) for (const ext of payload.extensions) args.push('--glob', `*.${String(ext).replace(/^\./, '')}`)
  args.push('--', query, root)
  return args
}

async function runRgSearch(payload, guard, config, query, root, options) {
  const args = rgArgs(payload, query, root, guard, config, options)
  const started = nowMs()
  return await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn('rg', args, { shell: false, windowsHide: true })
    const timeout = setTimeout(() => { timedOut = true; child.kill(process.platform === 'win32' ? undefined : 'SIGTERM') }, options.timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); stdout = tail(stdout, 5 * 1024 * 1024) })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); stderr = tail(stderr, 256000) })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (timedOut) return resolve({ query, matches: [], total: 0, truncated: true, engine: 'rg', durationMs: nowMs() - started, stats: { timedOut: true, stderr } })
      if (code > 1) return reject(new Error(stderr || `rg terminó con código ${code}`))
      const lines = stdout.split(/\r?\n/).filter(Boolean)
      const matches = []
      for (const line of lines) {
        if (matches.length >= options.maxMatches) break
        const match = line.match(/^(.+?):(\d+):(\d+):(.*)$/)
        if (!match) continue
        const fullPath = path.resolve(match[1])
        matches.push({ path: relativePath(guard, fullPath), line: Number(match[2]), column: Number(match[3]), preview: match[4] })
      }
      resolve({ query, matches, total: matches.length, truncated: lines.length >= options.maxMatches, engine: 'rg', durationMs: nowMs() - started, stats: { filesVisited: null, dirsVisited: null, skipped: null, timedOut: false } })
    })
  })
}

export async function fileSearch(payload, guard, config = {}) {
  const started = nowMs()
  const root = guard.resolveSafe(payload.path || '.')
  const query = fileSearchQuery(payload)
  const maxMatches = Math.min(Number(payload.maxMatches ?? 100), 1000)
  const maxFileBytes = Math.min(Number(payload.maxFileBytes ?? 512000), 5 * 1024 * 1024)
  const maxDepth = Math.min(Number(payload.maxDepth ?? 12), 30)
  const maxFiles = Math.min(Number(payload.maxFiles ?? config.searchMaxFiles ?? 20000), 200000)
  const timeoutMs = Math.min(Number(payload.timeoutMs ?? config.searchTimeoutMs ?? 30000), 5 * 60 * 1000)
  const caseSensitive = Boolean(payload.caseSensitive)
  const needle = caseSensitive ? query : query.toLowerCase()
  const ignore = buildIgnoreSet(payload, config, Boolean(payload.showHidden))
  const options = { maxMatches, maxFileBytes, maxDepth, maxFiles, timeoutMs, caseSensitive, ignore, showIgnored: Boolean(payload.showIgnored) }

  const wantsRg = !payload.forceJs && ['auto', 'rg', 'ripgrep'].includes(config.searchEngine || 'auto')
  if (wantsRg && isRgAvailable()) {
    try { return await runRgSearch(payload, guard, config, query, root, options) } catch (error) { if ((config.searchEngine || 'auto') !== 'auto') throw error }
  }

  const matches = []
  const stats = { dirsVisited: 0, filesVisited: 0, skipped: 0, timedOut: false }
  async function scan(dir, depth = 0) {
    if (depth > maxDepth || matches.length >= maxMatches || stats.filesVisited >= maxFiles) return
    if (nowMs() - started > timeoutMs) { stats.timedOut = true; return }
    stats.dirsVisited += 1
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (matches.length >= maxMatches || stats.filesVisited >= maxFiles || stats.timedOut) break
      const full = path.join(dir, entry.name)
      const rel = relativePath(guard, full)
      if (shouldIgnoreName(entry.name, rel, { ignore, showIgnored: Boolean(payload.showIgnored) })) { stats.skipped += 1; continue }
      if (!payload.showHidden && entry.name.startsWith('.')) { stats.skipped += 1; continue }
      if (entry.isDirectory()) { await scan(full, depth + 1); continue }
      const ext = path.extname(entry.name).toLowerCase()
      if (Array.isArray(payload.extensions) && !payload.extensions.map((x) => `.${String(x).replace(/^\./, '').toLowerCase()}`).includes(ext)) { stats.skipped += 1; continue }
      if (!TEXT_EXTENSIONS.has(ext) && !payload.includeAllTextLike) { stats.skipped += 1; continue }
      const stat = await fs.stat(full).catch(() => null)
      if (!stat || stat.size > maxFileBytes) { stats.skipped += 1; continue }
      stats.filesVisited += 1
      const content = await fs.readFile(full, 'utf8').catch(() => '')
      const haystack = caseSensitive ? content : content.toLowerCase()
      const index = haystack.indexOf(needle)
      if (index >= 0) {
        const before = content.slice(0, index)
        const line = before.split(/\r?\n/).length
        const column = before.length - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'))
        matches.push({ path: rel, line, column, preview: content.slice(Math.max(0, index - 120), Math.min(content.length, index + query.length + 120)), index })
      }
      if (nowMs() - started > timeoutMs) stats.timedOut = true
    }
  }
  await scan(root)
  return { query, matches, total: matches.length, truncated: matches.length >= maxMatches || stats.filesVisited >= maxFiles || stats.timedOut, engine: 'js', durationMs: nowMs() - started, stats }
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
    if (delimiter) { if (line.trim() === delimiter) { delimiter = null; output.push(line) }; continue }
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

export function normalizeCommandPayload(payload) {
  const rawCommand = String(payload.command || '').trim()
  if (!rawCommand) throw new Error('payload.command requerido')
  if (payload.shell || SHELL_OPERATOR_PATTERN.test(rawCommand)) return { command: rawCommand, args: [], cwdInput: payload.cwd ?? payload.path ?? '.', shell: true }
  if (Array.isArray(payload.args)) return { command: rawCommand, args: payload.args.map(String), cwdInput: payload.cwd ?? payload.path ?? '.', shell: false }
  const tokens = splitCommandLine(rawCommand)
  return { command: tokens[0], args: tokens.slice(1), cwdInput: payload.cwd ?? payload.path ?? '.', shell: false }
}

async function killProcessTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      killer.on('close', resolve)
      killer.on('error', resolve)
    })
    return
  }
  child.kill('SIGTERM')
  setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 3000).unref?.()
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
    const started = nowMs()
    const child = spawn(normalized.command, normalized.args, { cwd, shell: normalized.shell, windowsHide: false })
    const finish = (result) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      clearInterval(cancelTimer)
      logStream.end()
      resolve({ ...result, durationMs: nowMs() - started })
    }
    const timeout = setTimeout(async () => {
      await killProcessTree(child)
      logStream.write(`\n[TIMEOUT after ${timeoutMs}ms]\n`)
      finish({ status: 'timeout', exitCode: null, stdoutTail: tail(stdout, config.maxOutputChars), stderrTail: tail(stderr, config.maxOutputChars), summary: `Comando superó timeout de ${timeoutMs}ms`, localLogPath: logPath, truncated: stdout.length > config.maxOutputChars || stderr.length > config.maxOutputChars })
    }, timeoutMs)
    const cancelTimer = setInterval(async () => {
      try {
        if (!(await isCancelRequested())) return
        await killProcessTree(child)
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

export function classifyJob(job) {
  const payload = job.payload || {}
  if (WRITE_JOB_TYPES.has(job.type)) return 'heavy'
  if (job.type === 'shell.exec') {
    try {
      const normalized = normalizeCommandPayload(payload)
      const text = [normalized.command, ...(normalized.args || [])].join(' ')
      const base = commandBase(normalized.shell ? splitCommandLine(shellSegments(normalized.command)[0] || '')[0] : normalized.command)
      if (HEAVY_COMMANDS.has(base) && HEAVY_WORDS.test(text)) return 'heavy'
      if (DANGEROUS_PATTERN.test(text)) return 'heavy'
    } catch { return 'heavy' }
  }
  return 'light'
}

export function jobWorkspaceKey(job, guard) {
  const payload = job.payload || {}
  const input = payload.cwd ?? payload.path ?? payload.diffPath ?? payload.file ?? payload.targetPath ?? '.'
  try {
    const target = guard.resolveSafe(input)
    const root = guard.roots?.find((item) => target === item || target.startsWith(item.endsWith(path.sep) ? item : item + path.sep)) || guard.root
    return process.platform === 'win32' ? root.toLowerCase() : root
  } catch {
    return 'unknown'
  }
}

export async function rotateLogs(config) {
  await fs.mkdir(config.logDir, { recursive: true })
  const entries = await fs.readdir(config.logDir, { withFileTypes: true }).catch(() => [])
  const now = nowMs()
  const maxAgeMs = Number(config.logMaxAgeDays || 0) * 24 * 60 * 60 * 1000
  const maxSize = Number(config.logMaxSizeMb || 0) * 1024 * 1024
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const full = path.join(config.logDir, entry.name)
    const stat = await fs.stat(full).catch(() => null)
    if (!stat) continue
    files.push({ full, mtimeMs: stat.mtimeMs, size: stat.size })
  }
  for (const file of files) {
    if ((maxAgeMs && now - file.mtimeMs > maxAgeMs) || (maxSize && file.size > maxSize)) {
      await fs.unlink(file.full).catch(() => {})
    }
  }
  const remaining = files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const maxFiles = Number(config.logMaxFiles || 0)
  if (maxFiles > 0 && remaining.length > maxFiles) {
    for (const file of remaining.slice(maxFiles)) await fs.unlink(file.full).catch(() => {})
  }
}

export async function runnerMetrics(config, activeJobs = [], queuedJobs = []) {
  const memory = { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() }
  const loadavg = os.loadavg?.() || []
  const disks = []
  for (const root of config.workspaceRoots || []) {
    disks.push({ root, available: null, free: null, total: null })
  }
  return { memory, loadavg, uptimeSeconds: Math.round(os.uptime()), activeJobs, queuedJobs, disks }
}
