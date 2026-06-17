import fs from 'node:fs/promises'
import path from 'node:path'

const now = () => Date.now()

function publicWorkspaceRoots(runner) {
  const roots = []
  if (Array.isArray(runner.workspaceRoots)) roots.push(...runner.workspaceRoots)
  if (runner.workspaceRoot) roots.unshift(runner.workspaceRoot)
  const seen = new Set()
  return roots
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function createInitialData() {
  return {
    meta: {
      schemaVersion: 1,
      createdAt: now(),
      updatedAt: now()
    },
    runners: {},
    jobs: {},
    audit: []
  }
}

export class JsonFileDb {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath)
    this.backupDir = options.backupDir ? path.resolve(options.backupDir) : null
    this.data = createInitialData()
    this.queue = Promise.resolve()
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    if (this.backupDir) await fs.mkdir(this.backupDir, { recursive: true })
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      this.data = JSON.parse(raw)
      this.data.meta ??= { schemaVersion: 1, createdAt: now(), updatedAt: now() }
      this.data.runners ??= {}
      this.data.jobs ??= {}
      this.data.audit ??= []
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const brokenPath = `${this.filePath}.broken-${Date.now()}`
        await fs.copyFile(this.filePath, brokenPath).catch(() => {})
        console.warn(`DB corrupta o no legible. Se guardó copia en ${brokenPath}`)
      }
      this.data = createInitialData()
      await this.save()
    }
  }

  async save() {
    this.data.meta.updatedAt = now()
    const tmpPath = `${this.filePath}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf8')
    await fs.rename(tmpPath, this.filePath)
  }

  async withWrite(fn) {
    const run = async () => {
      const result = await fn(this.data)
      await this.save()
      return result
    }
    this.queue = this.queue.then(run, run)
    return this.queue
  }

  snapshot() {
    return structuredClone(this.data)
  }

  async backup(reason = 'manual') {
    if (!this.backupDir) return null
    await fs.mkdir(this.backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = path.join(this.backupDir, `agent-coder-${stamp}-${reason}.json`)
    await fs.writeFile(target, JSON.stringify(this.data, null, 2), 'utf8')
    return target
  }
}

export function publicJob(job) {
  if (!job) return null
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    runnerTarget: job.runnerTarget,
    claimedBy: job.claimedBy ?? null,
    exitCode: job.exitCode ?? null,
    summary: job.summary ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    needsApprovalAt: job.needsApprovalAt ?? null,
    stdoutTail: job.stdoutTail ?? '',
    stderrTail: job.stderrTail ?? '',
    result: job.result ?? null,
    truncated: Boolean(job.truncated),
    localLogPath: job.localLogPath ?? null,
    payload: job.payload ?? null
  }
}

export function jobSummary(job) {
  if (!job) return null
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    runnerTarget: job.runnerTarget,
    claimedBy: job.claimedBy ?? null,
    exitCode: job.exitCode ?? null,
    summary: job.summary ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null
  }
}

export function runnerPublic(runner) {
  if (!runner) return null
  const ageMs = runner.lastSeen ? Date.now() - runner.lastSeen : Number.POSITIVE_INFINITY
  return {
    id: runner.id,
    status: ageMs < 30000 ? 'online' : 'offline',
    lastStatus: runner.status ?? 'unknown',
    lastSeen: runner.lastSeen ?? null,
    lastSeenAgeMs: Number.isFinite(ageMs) ? ageMs : null,
    workspaceRoot: runner.workspaceRoot ?? null,
    workspaceRoots: publicWorkspaceRoots(runner),
    platform: runner.platform ?? null,
    hostname: runner.hostname ?? null,
    version: runner.version ?? null,
    capabilities: runner.capabilities ?? []
  }
}
