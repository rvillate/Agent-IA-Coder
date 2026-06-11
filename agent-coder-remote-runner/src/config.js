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

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback
  return ['true', '1', 'yes', 'y', 'on', 'si', 'sí'].includes(String(value).trim().toLowerCase())
}

function parseList(value, fallback = []) {
  const raw = value == null || value === '' ? fallback.join(',') : String(value)
  return raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
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
  const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || 'C:/agent-workspace')
  const gatewayUrl = (process.env.GATEWAY_URL || 'http://localhost:8787/api').replace(/\/$/, '')
  const allowSensitiveCommands = parseBoolean(process.env.RUNNER_ALLOW_SENSITIVE_COMMANDS, true)
  const commandAllowlist = parseList(process.env.COMMAND_ALLOWLIST, DEVELOPMENT_COMMANDS)
  const sensitiveCommandAllowlist = parseList(process.env.SENSITIVE_COMMAND_ALLOWLIST, SENSITIVE_COMMANDS)
  const effectiveCommandAllowlist = allowSensitiveCommands
    ? [...new Set([...commandAllowlist, ...sensitiveCommandAllowlist])]
    : commandAllowlist

  return {
    gatewayUrl,
    runnerSharedKey: process.env.RUNNER_SHARED_KEY || '',
    runnerId: process.env.RUNNER_ID || 'local-runner-1',
    workspaceRoot,
    requireLocalApproval: parseBoolean(process.env.RUNNER_REQUIRE_LOCAL_APPROVAL, true),
    allowAllCommands: parseBoolean(process.env.RUNNER_ALLOW_ALL_COMMANDS, true),
    allowDangerousCommands: parseBoolean(process.env.RUNNER_ALLOW_DANGEROUS_COMMANDS, true),
    allowSensitiveCommands,
    allowDelete: parseBoolean(process.env.RUNNER_ALLOW_DELETE, true),
    pollIntervalMs: Number(process.env.RUNNER_POLL_INTERVAL_MS || 2500),
    heartbeatIntervalMs: Number(process.env.RUNNER_HEARTBEAT_INTERVAL_MS || 10000),
    maxOutputChars: Number(process.env.MAX_OUTPUT_CHARS || 24000),
    commandAllowlist: effectiveCommandAllowlist,
    sensitiveCommandAllowlist,
    logDir: path.resolve(process.env.RUNNER_LOG_DIR || 'logs')
  }
}
