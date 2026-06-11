import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { JsonFileDb, jobSummary, publicJob, runnerPublic } from './db.js'
import { buildOpenApi } from './openapi.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const AGENT_API_KEY = process.env.AGENT_API_KEY || ''
const RUNNER_SHARED_KEY = process.env.RUNNER_SHARED_KEY || ''
const DB_FILE = path.resolve(rootDir, process.env.AGENT_DB_FILE || 'data/agent-coder.central.json')
const BACKUP_DIR = path.resolve(rootDir, process.env.AGENT_BACKUP_DIR || 'data/backups')
const MAX_TAIL_CHARS = Number(process.env.MAX_TAIL_CHARS || 24000)
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ''
const PUBLIC_HEALTH = String(process.env.PUBLIC_HEALTH || 'true').toLowerCase() === 'true'

const VALID_JOB_TYPES = new Set([
  'shell.exec',
  'file.list',
  'file.read',
  'file.write',
  'file.delete',
  'file.mkdir',
  'file.search',
  'git.status',
  'git.diff'
])

const now = () => Date.now()
const newId = (prefix = 'job') => `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`

function limitString(value, max = MAX_TAIL_CHARS) {
  const text = value == null ? '' : String(value)
  if (text.length <= max) return text
  return text.slice(-max)
}

function getBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '')
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`.replace(/\/$/, '')
}

function requireAgentKey(req, res, next) {
  if (!AGENT_API_KEY || AGENT_API_KEY === 'change-me-agent-key') {
    return res.status(500).json({ ok: false, error: 'AGENT_API_KEY no está configurada correctamente en .env' })
  }
  const provided = req.header('x-agent-key') || ''
  if (provided !== AGENT_API_KEY) return res.status(401).json({ ok: false, error: 'x-agent-key inválida o ausente' })
  next()
}

function requireRunnerKey(req, res, next) {
  if (!RUNNER_SHARED_KEY || RUNNER_SHARED_KEY === 'change-me-runner-key') {
    return res.status(500).json({ ok: false, error: 'RUNNER_SHARED_KEY no está configurada correctamente en .env' })
  }
  const provided = req.header('x-runner-key') || ''
  if (provided !== RUNNER_SHARED_KEY) return res.status(401).json({ ok: false, error: 'x-runner-key inválida o ausente' })
  next()
}

function validateCreateJob(input) {
  if (!input || typeof input !== 'object') throw new Error('Body JSON requerido')
  if (!VALID_JOB_TYPES.has(input.type)) throw new Error(`type inválido. Usa uno de: ${Array.from(VALID_JOB_TYPES).join(', ')}`)
  if (!input.runnerTarget || typeof input.runnerTarget !== 'string') throw new Error('runnerTarget es requerido')
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('payload debe ser un objeto JSON')
  return {
    id: newId('job'),
    type: input.type,
    status: 'queued',
    runnerTarget: input.runnerTarget.trim(),
    payload: input.payload,
    priority: Number(input.priority || 0),
    note: input.note ? String(input.note) : '',
    createdAt: now(),
    updatedAt: now()
  }
}

function sortJobs(a, b) {
  const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0)
  if (priorityDiff !== 0) return priorityDiff
  return Number(a.createdAt || 0) - Number(b.createdAt || 0)
}

const db = new JsonFileDb(DB_FILE, { backupDir: BACKUP_DIR })
await db.init()

const app = express()
app.set('trust proxy', true)
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(rootDir, 'public')))

app.get('/api/health', (req, res) => {
  if (!PUBLIC_HEALTH && req.header('x-agent-key') !== AGENT_API_KEY) {
    return res.status(401).json({ ok: false, error: 'x-agent-key requerida' })
  }
  const snap = db.snapshot()
  res.json({
    ok: true,
    service: 'agent-coder-raspberry-gateway',
    time: now(),
    uptimeSec: Math.round(process.uptime()),
    dbFile: DB_FILE,
    counts: {
      runners: Object.keys(snap.runners).length,
      jobs: Object.keys(snap.jobs).length
    }
  })
})

app.get('/api/openapi.json', (req, res) => res.json(buildOpenApi(getBaseUrl(req))))

// API para GPT / panel web
app.get('/api/runners', requireAgentKey, (req, res) => {
  const runners = Object.values(db.snapshot().runners).map(runnerPublic)
  runners.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  res.json({ items: runners, total: runners.length })
})

app.get('/api/jobs', requireAgentKey, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 20), 100)
  const status = req.query.status ? String(req.query.status) : ''
  const runnerTarget = req.query.runnerTarget ? String(req.query.runnerTarget) : ''
  let jobs = Object.values(db.snapshot().jobs)
  if (status) jobs = jobs.filter((job) => job.status === status)
  if (runnerTarget) jobs = jobs.filter((job) => job.runnerTarget === runnerTarget)
  jobs.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  const items = jobs.slice(0, limit).map(jobSummary)
  res.json({ items, total: jobs.length, returned: items.length })
})

app.post('/api/jobs', requireAgentKey, async (req, res) => {
  try {
    const job = validateCreateJob(req.body)
    await db.withWrite((data) => {
      data.jobs[job.id] = job
      data.audit.push({ at: now(), action: 'job.created', jobId: job.id, runnerTarget: job.runnerTarget, type: job.type })
      data.audit = data.audit.slice(-1000)
    })
    res.json({ ok: true, job: publicJob(job) })
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.post('/api/jobs/bulk', requireAgentKey, async (req, res) => {
  try {
    if (!Array.isArray(req.body?.jobs)) throw new Error('Body debe tener jobs: []')
    const jobs = req.body.jobs.map(validateCreateJob)
    await db.withWrite((data) => {
      for (const job of jobs) {
        data.jobs[job.id] = job
        data.audit.push({ at: now(), action: 'job.created', jobId: job.id, runnerTarget: job.runnerTarget, type: job.type })
      }
      data.audit = data.audit.slice(-1000)
    })
    res.json({ ok: true, items: jobs.map(publicJob), total: jobs.length })
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.get('/api/jobs/:id', requireAgentKey, (req, res) => {
  const job = db.snapshot().jobs[req.params.id]
  if (!job) return res.status(404).json({ ok: false, error: 'Job no encontrado' })
  res.json({ ok: true, job: publicJob(job) })
})

app.patch('/api/jobs/:id', requireAgentKey, async (req, res) => {
  let updated = null
  await db.withWrite((data) => {
    const job = data.jobs[req.params.id]
    if (!job) return
    if (!['queued', 'cancelled', 'error', 'timeout', 'rejected'].includes(job.status)) {
      throw new Error('Solo se puede editar un job queued/cancelled/error/timeout/rejected')
    }
    if (req.body.payload && typeof req.body.payload === 'object') job.payload = req.body.payload
    if (req.body.runnerTarget && typeof req.body.runnerTarget === 'string') job.runnerTarget = req.body.runnerTarget
    if (req.body.type && VALID_JOB_TYPES.has(req.body.type)) job.type = req.body.type
    job.updatedAt = now()
    updated = publicJob(job)
  }).catch((error) => {
    res.status(400).json({ ok: false, error: error.message })
  })
  if (res.headersSent) return
  if (!updated) return res.status(404).json({ ok: false, error: 'Job no encontrado' })
  res.json({ ok: true, job: updated })
})

app.post('/api/jobs/:id/cancel', requireAgentKey, async (req, res) => {
  let updated = null
  await db.withWrite((data) => {
    const job = data.jobs[req.params.id]
    if (!job) return
    if (job.status === 'running' || job.status === 'needs_approval') {
      job.status = 'cancel_requested'
      job.summary = 'Cancelación solicitada. El runner la aplicará antes o después del proceso actual.'
    } else if (!['success', 'error', 'timeout', 'rejected'].includes(job.status)) {
      job.status = 'cancelled'
      job.finishedAt = now()
      job.summary = 'Job cancelado.'
    }
    job.updatedAt = now()
    updated = publicJob(job)
  })
  if (!updated) return res.status(404).json({ ok: false, error: 'Job no encontrado' })
  res.json({ ok: true, job: updated })
})

app.post('/api/jobs/:id/requeue', requireAgentKey, async (req, res) => {
  let updated = null
  await db.withWrite((data) => {
    const job = data.jobs[req.params.id]
    if (!job) return
    job.status = 'queued'
    delete job.claimedBy
    delete job.startedAt
    delete job.finishedAt
    delete job.exitCode
    delete job.error
    job.summary = 'Reencolado manualmente.'
    job.updatedAt = now()
    updated = publicJob(job)
  })
  if (!updated) return res.status(404).json({ ok: false, error: 'Job no encontrado' })
  res.json({ ok: true, job: updated })
})

app.delete('/api/jobs/:id', requireAgentKey, async (req, res) => {
  let existed = false
  await db.withWrite((data) => {
    existed = Boolean(data.jobs[req.params.id])
    delete data.jobs[req.params.id]
  })
  res.json({ ok: true, deleted: existed })
})

app.post('/api/admin/cleanup', requireAgentKey, async (req, res) => {
  const olderThanHours = Math.max(Number(req.body?.olderThanHours || 24), 1)
  const cutoff = now() - olderThanHours * 60 * 60 * 1000
  const statuses = new Set(req.body?.statuses || ['success', 'error', 'timeout', 'cancelled', 'rejected'])
  let deleted = 0
  await db.withWrite((data) => {
    for (const [id, job] of Object.entries(data.jobs)) {
      if (statuses.has(job.status) && Number(job.updatedAt || 0) < cutoff) {
        delete data.jobs[id]
        deleted++
      }
    }
  })
  res.json({ ok: true, deleted })
})

// API privada para runners remotos
app.post('/api/runner/register', requireRunnerKey, async (req, res) => {
  const runnerId = String(req.body?.runnerId || '').trim()
  if (!runnerId) return res.status(400).json({ ok: false, error: 'runnerId requerido' })
  const runner = {
    id: runnerId,
    status: 'online',
    lastSeen: now(),
    workspaceRoot: req.body.workspaceRoot || null,
    platform: req.body.platform || null,
    hostname: req.body.hostname || null,
    version: req.body.version || null,
    capabilities: Array.isArray(req.body.capabilities) ? req.body.capabilities : []
  }
  await db.withWrite((data) => {
    data.runners[runnerId] = { ...(data.runners[runnerId] || {}), ...runner }
  })
  res.json({ ok: true, runner: runnerPublic(runner) })
})

app.post('/api/runner/heartbeat', requireRunnerKey, async (req, res) => {
  const runnerId = String(req.body?.runnerId || '').trim()
  if (!runnerId) return res.status(400).json({ ok: false, error: 'runnerId requerido' })
  let runner = null
  await db.withWrite((data) => {
    const current = data.runners[runnerId] || { id: runnerId }
    runner = {
      ...current,
      status: req.body.status || 'online',
      lastSeen: now(),
      workspaceRoot: req.body.workspaceRoot ?? current.workspaceRoot ?? null,
      platform: req.body.platform ?? current.platform ?? null,
      hostname: req.body.hostname ?? current.hostname ?? null,
      version: req.body.version ?? current.version ?? null,
      capabilities: Array.isArray(req.body.capabilities) ? req.body.capabilities : current.capabilities || []
    }
    data.runners[runnerId] = runner
  })
  res.json({ ok: true, runner: runnerPublic(runner) })
})

app.post('/api/runner/claim-next', requireRunnerKey, async (req, res) => {
  const runnerId = String(req.body?.runnerId || '').trim()
  if (!runnerId) return res.status(400).json({ ok: false, error: 'runnerId requerido' })
  let claimed = null
  await db.withWrite((data) => {
    const runner = data.runners[runnerId] || { id: runnerId }
    runner.status = 'online'
    runner.lastSeen = now()
    data.runners[runnerId] = runner

    const candidates = Object.values(data.jobs)
      .filter((job) => job.status === 'queued' && job.runnerTarget === runnerId)
      .sort(sortJobs)
    const job = candidates[0]
    if (!job) return
    job.status = 'running'
    job.claimedBy = runnerId
    job.startedAt = now()
    job.updatedAt = now()
    claimed = publicJob(job)
  })
  res.json({ ok: true, job: claimed })
})

app.post('/api/runner/jobs/:id/update', requireRunnerKey, async (req, res) => {
  const runnerId = String(req.body?.runnerId || '').trim()
  if (!runnerId) return res.status(400).json({ ok: false, error: 'runnerId requerido' })
  const allowedStatuses = new Set(['running', 'needs_approval', 'success', 'error', 'timeout', 'cancelled', 'rejected'])
  const status = String(req.body?.status || '').trim()
  if (!allowedStatuses.has(status)) return res.status(400).json({ ok: false, error: 'status inválido' })

  let updated = null
  await db.withWrite((data) => {
    const job = data.jobs[req.params.id]
    if (!job) return
    if (job.runnerTarget !== runnerId && job.claimedBy !== runnerId) throw new Error('Job no pertenece a este runner')

    job.status = status
    job.claimedBy = runnerId
    job.updatedAt = now()
    if (status === 'needs_approval') job.needsApprovalAt = now()
    if (['success', 'error', 'timeout', 'cancelled', 'rejected'].includes(status)) job.finishedAt = now()
    if ('exitCode' in req.body) job.exitCode = req.body.exitCode
    if ('summary' in req.body) job.summary = limitString(req.body.summary, 2000)
    if ('error' in req.body) job.error = limitString(req.body.error, 4000)
    if ('stdoutTail' in req.body) job.stdoutTail = limitString(req.body.stdoutTail)
    if ('stderrTail' in req.body) job.stderrTail = limitString(req.body.stderrTail)
    if ('result' in req.body) job.result = req.body.result
    if ('truncated' in req.body) job.truncated = Boolean(req.body.truncated)
    if ('localLogPath' in req.body) job.localLogPath = limitString(req.body.localLogPath, 1000)
    updated = publicJob(job)
  }).catch((error) => {
    res.status(400).json({ ok: false, error: error.message })
  })
  if (res.headersSent) return
  if (!updated) return res.status(404).json({ ok: false, error: 'Job no encontrado' })
  res.json({ ok: true, job: updated })
})

app.use((error, req, res, next) => {
  console.error(error)
  res.status(500).json({ ok: false, error: error.message || 'Error interno' })
})

app.listen(PORT, HOST, () => {
  console.log(`Agent Coder Raspberry Gateway listo en http://${HOST}:${PORT}`)
  console.log(`DB central: ${DB_FILE}`)
  console.log('OpenAPI: /api/openapi.json')
})
