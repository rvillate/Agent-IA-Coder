import fs from 'node:fs'
import path from 'node:path'

const DEVELOPMENT_COMMANDS = [
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'corepack',
  'git', 'where', 'cmd',
  'rg', 'grep', 'findstr', 'find',
  'ls', 'dir', 'tree', 'type', 'cat',
  'java', 'mvn', 'gradle',
  'dotnet',
  'python', 'py', 'pip', 'pytest',
  'go', 'gofmt', 'goimports',
  'rustc', 'cargo',
  'tsc', 'eslint', 'prettier',
  'vite', 'next',
  'jest', 'vitest', 'playwright',
  'whoami', 'echo'
]

const SENSITIVE_COMMANDS = [
  'powershell', 'pwsh', 'bash', 'sh',
  'curl', 'wget', 'scp', 'ssh',
  'docker', 'docker-compose', 'kubectl'
]

const DEFAULT_IGNORES = [
  'node_modules', '.git', 'dist', 'build', '.next', '.angular', 'target',
  'coverage', '.idea', '.vscode', '.cache', '.turbo', 'logs'
]

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback
  return ['true', '1', 'yes', 'y', 'on', 'si', 'sí'].includes(String(value).trim().toLowerCase())
}

function parsePositiveInteger(value, fallback = 1) {
  if (value == null || value === '') return fallback
  const parsed = Number.parseInt(String(value).trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseNonNegativeInteger(value, fallback = 0) {
  if (value == null || value === '') return fallback
  const parsed = Number.parseInt(String(value).trim(), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function parseList(value, fallback = []) {
  const raw = value == null || value === '' ? fallback.join(',') : String(value)
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function parseLowerList(value, fallback = []) {
  return parseList(value, fallback).map((x) => x.toLowerCase())
}

function parsePathList(value, fallback = []) {
  const raw = value == null || value === '' ? fallback.join(',') : String(value)
  return raw
    .split(/[|,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function uniqueResolvedPaths(paths) {
  const seen = new Set()
  const result = []
  for (const item of paths) {
    const resolved = path.resolve(item)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) continue
    seen.add(key)
    result.push(resolved)
  }
  return result
}

export function loadDotEnv(file = '.env') {
  const target = path.resolve(process.cwd(), file)
  if (!fs.existsSync(target)) return
  const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

export function getConfig() {
  loadDotEnv()
  const workspaceRoots = uniqueResolvedPaths(
    parsePathList(process.env.WORKSPACE_ROOTS, [process.env.WORKSPACE_ROOT || 'C:/agent-workspace'])
  )
  const workspaceRoot = workspaceRoots[0]
  const gatewayUrl = (process.env.GATEWAY_URL || 'http://localhost:8787/api').replace(/\/$/, '')
  const allowSensitiveCommands = parseBoolean(process.env.RUNNER_ALLOW_SENSITIVE_COMMANDS, true)
  const commandAllowlist = parseLowerList(process.env.COMMAND_ALLOWLIST, DEVELOPMENT_COMMANDS)
  const sensitiveCommandAllowlist = parseLowerList(process.env.SENSITIVE_COMMAND_ALLOWLIST, SENSITIVE_COMMANDS)
  const effectiveCommandAllowlist = allowSensitiveCommands
    ? [...new Set([...commandAllowlist, ...sensitiveCommandAllowlist])]
    : commandAllowlist
  const maxConcurrentJobs = parsePositiveInteger(process.env.RUNNER_MAX_CONCURRENT_JOBS, 1)

  return {
    gatewayUrl,
    runnerSharedKey: process.env.RUNNER_SHARED_KEY || '',
    gatewayId: process.env.GATEWAY_ID || process.env.AGENT_GATEWAY_ID || '',
    runnerId: process.env.RUNNER_ID || 'local-runner-1',
    workspaceRoot,
    workspaceRoots,
    requireLocalApproval: parseBoolean(process.env.RUNNER_REQUIRE_LOCAL_APPROVAL, true),
    allowAllCommands: parseBoolean(process.env.RUNNER_ALLOW_ALL_COMMANDS, true),
    allowDangerousCommands: parseBoolean(process.env.RUNNER_ALLOW_DANGEROUS_COMMANDS, true),
    allowSensitiveCommands,
    allowDelete: parseBoolean(process.env.RUNNER_ALLOW_DELETE, true),
    pollIntervalMs: Number(process.env.RUNNER_POLL_INTERVAL_MS || 2500),
    heartbeatIntervalMs: Number(process.env.RUNNER_HEARTBEAT_INTERVAL_MS || 10000),
    maxConcurrentJobs,
    maxHeavyJobs: Math.min(parsePositiveInteger(process.env.RUNNER_MAX_HEAVY_JOBS, 1), maxConcurrentJobs),
    maxOutputChars: Number(process.env.MAX_OUTPUT_CHARS || 24000),
    commandAllowlist: effectiveCommandAllowlist,
    sensitiveCommandAllowlist,
    logDir: path.resolve(process.env.RUNNER_LOG_DIR || 'logs'),
    defaultIgnores: parseList(process.env.RUNNER_DEFAULT_IGNORES, DEFAULT_IGNORES),
    useSmartIgnores: parseBoolean(process.env.RUNNER_USE_SMART_IGNORES, true),
    searchEngine: String(process.env.RUNNER_SEARCH_ENGINE || 'auto').trim().toLowerCase(),
    searchTimeoutMs: parsePositiveInteger(process.env.RUNNER_SEARCH_TIMEOUT_MS, 30000),
    searchMaxFiles: parsePositiveInteger(process.env.RUNNER_SEARCH_MAX_FILES, 20000),
    searchMaxDepth: parsePositiveInteger(process.env.RUNNER_SEARCH_MAX_DEPTH, 12),
    searchHardTimeoutMs: parseNonNegativeInteger(process.env.RUNNER_SEARCH_HARD_TIMEOUT_MS, 0),
    searchHardMaxFiles: parseNonNegativeInteger(process.env.RUNNER_SEARCH_HARD_MAX_FILES, 0),
    searchHardMaxDepth: parseNonNegativeInteger(process.env.RUNNER_SEARCH_HARD_MAX_DEPTH, 0),
    fileListFastByDefault: parseBoolean(process.env.RUNNER_FILE_LIST_FAST_BY_DEFAULT, true),
    browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH || '',
    browserHeadless: parseBoolean(process.env.BROWSER_HEADLESS, true),
    logMaxFiles: parseNonNegativeInteger(process.env.RUNNER_LOG_MAX_FILES, 500),
    logMaxAgeDays: parseNonNegativeInteger(process.env.RUNNER_LOG_MAX_AGE_DAYS, 14),
    logMaxSizeMb: parseNonNegativeInteger(process.env.RUNNER_LOG_MAX_SIZE_MB, 25)
  }
}
