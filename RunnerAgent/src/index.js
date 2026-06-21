import os from 'node:os'
import { getConfig } from './config.js'
import { GatewayClient } from './api.js'
import { createPathGuard, ensureWorkspace } from './paths.js'
import { askApproval } from './approval.js'
import {
  fileList,
  fileRead,
  fileWrite,
  fileDelete,
  fileMkdir,
  fileSearch,
  runCommand,
  gitStatus,
  gitDiff,
  classifyJob,
  jobWorkspaceKey,
  rotateLogs,
  runnerMetrics
} from './tools.js'
import {
  browserOpen,
  browserClick,
  browserType,
  browserDrag,
  browserScreenshot,
  browserEval,
  browserClose,
  listBrowserPreviews
} from './browser.js'

const config = getConfig()
const client = new GatewayClient(config)
const guard = createPathGuard(config.workspaceRoots)

const capabilities = [
  'shell.exec',
  'file.list',
  'file.read',
  'file.write',
  'file.delete',
  'file.mkdir',
  'file.search',
  'git.status',
  'git.diff',
  'browser.open',
  'browser.click',
  'browser.type',
  'browser.drag',
  'browser.screenshot',
  'browser.eval',
  'browser.close'
]

const activeJobs = new Map()
const pendingJobs = []
const jobHistory = []

function rememberJob(job, status, startedAt, finishedAt = Date.now()) {
  jobHistory.unshift({ id: job.id, type: job.type, weight: job.weight, workspaceKey: job.workspaceKey, status, durationMs: finishedAt - startedAt, finishedAt })
  if (jobHistory.length > 20) jobHistory.pop()
}

function describeJob(job) {
  return {
    id: job.id,
    type: job.type,
    weight: job.weight || classifyJob(job),
    workspaceKey: job.workspaceKey || jobWorkspaceKey(job, guard),
    startedAt: job.startedAt || null,
    queuedAt: job.queuedAt || null,
    ageMs: job.startedAt ? Date.now() - job.startedAt : null
  }
}

function activeJobDetails() {
  return Array.from(activeJobs.values()).map(({ job }) => describeJob(job))
}

function activeJobIds() {
  return Array.from(activeJobs.keys())
}

function queuedJobDetails() {
  return pendingJobs.map(describeJob)
}

function countActiveHeavy() {
  return activeJobDetails().filter((job) => job.weight === 'heavy').length
}

function hasActiveHeavyInWorkspace(workspaceKey) {
  return activeJobDetails().some((job) => job.weight === 'heavy' && job.workspaceKey === workspaceKey)
}

function canStartJob(job) {
  if (activeJobs.size >= config.maxConcurrentJobs) return false
  if (job.weight !== 'heavy') return true
  if (countActiveHeavy() >= config.maxHeavyJobs) return false
  if (hasActiveHeavyInWorkspace(job.workspaceKey)) return false
  return true
}

function prepareClaimedJob(job) {
  job.weight = classifyJob(job)
  job.workspaceKey = jobWorkspaceKey(job, guard)
  job.queuedAt = Date.now()
  return job
}

function enqueueJob(job) {
  const prepared = prepareClaimedJob(job)
  pendingJobs.push(prepared)
  update(prepared, {
    status: 'running',
    summary: `Job reclamado por ${config.runnerId}. En cola local inteligente (${prepared.weight}) esperando cupo seguro.`
  }).catch(() => {})
  return prepared
}

function startJob(job) {
  job.startedAt = Date.now()
  const promise = executeJob(job)
    .catch((error) => jobError(job, 'error no controlado', error.message))
    .finally(() => {
      activeJobs.delete(job.id)
      startPendingJobs().catch((error) => console.error(`[scheduler] ${error.message}`))
    })
  activeJobs.set(job.id, { job, promise })
}

async function startPendingJobs() {
  let startedAny = false
  for (let index = 0; index < pendingJobs.length;) {
    const job = pendingJobs[index]
    if (!canStartJob(job)) { index += 1; continue }
    pendingJobs.splice(index, 1)
    startJob(job)
    startedAny = true
  }
  return startedAny
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function timestamp() {
  return new Date().toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

function jobLog(job, message = '') {
  const suffix = message ? ` ${message}` : ''
  console.log(`[${timestamp()}] [JOB] ${job.id}${suffix}`)
}

function jobError(job, message, error) {
  const detail = error ? `: ${error}` : ''
  console.error(`[${timestamp()}] [JOB] ${job.id} ${message}${detail}`)
}

async function runnerPayload(status = 'online') {
  const browserPreviews = await listBrowserPreviews({ includeScreenshot: true })
  return {
    runnerId: config.runnerId,
    status,
    workspaceRoot: config.workspaceRoot,
    workspaceRoots: config.workspaceRoots,
    platform: `${process.platform}-${process.arch}`,
    hostname: os.hostname(),
    version: '1.1.0',
    maxConcurrentJobs: config.maxConcurrentJobs,
    maxHeavyJobs: config.maxHeavyJobs,
    activeJobs: activeJobIds(),
    activeJobDetails: activeJobDetails(),
    queuedJobDetails: queuedJobDetails(),
    capabilities,
    metrics: {
      ...(await runnerMetrics(config, activeJobDetails(), queuedJobDetails())),
      browserPreviews
    },
    browserPreviews,
    lastJobs: jobHistory
  }
}

async function update(job, data) {
  return client.updateJob(job.id, { runnerId: config.runnerId, ...data })
}

async function fetchJobStatus(jobId) {
  if (typeof client.getJob === 'function') {
    const data = await client.getJob(jobId)
    return data?.job?.status || data?.status || null
  }

  const base = String(config.gatewayUrl || '').replace(/\/$/, '')
  const url = `${base}/api/jobs/${jobId}`
  const headers = {
    'x-runner-key': config.runnerSharedKey,
    'x-agent-runner-key': config.runnerSharedKey,
    authorization: `Bearer ${config.runnerSharedKey}`
  }
  const response = await fetch(url, { headers })
  if (!response.ok) return null
  const data = await response.json()
  return data?.job?.status || data?.status || null
}

function cancelChecker(job) {
  return async () => {
    try {
      const status = await fetchJobStatus(job.id)
      return status === 'cancel_requested' || status === 'cancelled'
    } catch {
      return false
    }
  }
}

async function executeJob(job) {
  const payload = job.payload || {}
  console.log('')
  jobLog(job, `${job.type} (${job.weight || 'light'})`)
  const startedAt = Date.now()

  try {
    if (job.type === 'shell.exec' && config.requireLocalApproval) {
      await update(job, {
        status: 'needs_approval',
        summary: `Esperando aprobación local para ejecutar: ${payload.command} ${(payload.args || []).join(' ')}`
      })
      const approved = await askApproval(`Job ${job.id}\nRunner: ${config.runnerId}\nCWD: ${payload.cwd || '.'}\nComando: ${payload.command} ${(payload.args || []).join(' ')}`)
      if (!approved) {
        await update(job, { status: 'rejected', summary: 'Rechazado por el usuario en la terminal del runner.' })
        rememberJob(job, 'rejected', startedAt)
        jobLog(job, 'rechazado')
        return
      }
      await update(job, { status: 'running', summary: 'Aprobado localmente. Ejecutando...' })
    }

    const isCancelRequested = cancelChecker(job)
    let result
    switch (job.type) {
      case 'file.list':
        result = await fileList(payload, guard, config)
        await update(job, { status: 'success', result, summary: `Listado generado correctamente en ${result.durationMs ?? 0}ms`, truncated: result.truncated })
        break
      case 'file.read':
        result = await fileRead(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Archivo leído correctamente', truncated: result.truncated })
        break
      case 'file.write':
        result = await fileWrite(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Archivo escrito correctamente' })
        break
      case 'file.delete':
        result = await fileDelete(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Ruta eliminada correctamente' })
        break
      case 'file.mkdir':
        result = await fileMkdir(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Carpeta creada correctamente' })
        break
      case 'file.search':
        result = await fileSearch(payload, guard, config)
        await update(job, { status: 'success', result, summary: `Búsqueda ${result.engine || 'js'} finalizada con ${result.total} coincidencias en ${result.durationMs ?? 0}ms`, truncated: result.truncated })
        break
      case 'shell.exec': {
        result = await runCommand(payload, guard, config, job.id, isCancelRequested)
        await update(job, {
          status: result.status,
          exitCode: result.exitCode,
          stdoutTail: result.stdoutTail,
          stderrTail: result.stderrTail,
          summary: result.summary,
          error: result.error,
          localLogPath: result.localLogPath,
          truncated: result.truncated,
          result: { durationMs: result.durationMs, weight: job.weight, workspaceKey: job.workspaceKey }
        })
        break
      }
      case 'git.status': {
        result = await gitStatus(payload, guard, config, job.id, isCancelRequested)
        await update(job, {
          status: result.status,
          exitCode: result.exitCode,
          stdoutTail: result.stdoutTail,
          stderrTail: result.stderrTail,
          summary: result.summary,
          localLogPath: result.localLogPath,
          truncated: result.truncated,
          result: { durationMs: result.durationMs }
        })
        break
      }
      case 'git.diff': {
        result = await gitDiff(payload, guard, config, job.id, isCancelRequested)
        await update(job, {
          status: result.status,
          exitCode: result.exitCode,
          stdoutTail: result.stdoutTail,
          stderrTail: result.stderrTail,
          summary: result.summary,
          localLogPath: result.localLogPath,
          truncated: result.truncated,
          result: { durationMs: result.durationMs }
        })
        break
      }
      case 'browser.open':
        result = await browserOpen(payload, guard, config)
        await update(job, { status: 'success', result, summary: `Browser abierto: ${result.url}`, truncated: false })
        break
      case 'browser.click':
        result = await browserClick(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Click ejecutado en browser', truncated: false })
        break
      case 'browser.type':
        result = await browserType(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Texto escrito en browser', truncated: false })
        break
      case 'browser.drag':
        result = await browserDrag(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Drag ejecutado en browser', truncated: false })
        break
      case 'browser.screenshot':
        result = await browserScreenshot(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Captura tomada en browser', truncated: false })
        break
      case 'browser.eval':
        result = await browserEval(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Evaluación ejecutada en browser', truncated: false })
        break
      case 'browser.close':
        result = await browserClose(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Sesión browser cerrada', truncated: false })
        break
      default:
        throw new Error(`Tipo de job no soportado: ${job.type}`)
    }
    rememberJob(job, 'success', startedAt)
    jobLog(job, 'terminado')
  } catch (error) {
    rememberJob(job, 'error', startedAt)
    jobError(job, 'error', error.message)
    await update(job, {
      status: 'error',
      summary: 'Error ejecutando job',
      error: error.message,
      stderrTail: error.stack || error.message
    }).catch((updateError) => console.error('No se pudo actualizar error:', updateError.message))
  }
}

function claimBudget() {
  const localCount = activeJobs.size + pendingJobs.length
  return Math.max(config.maxConcurrentJobs - localCount, 0)
}

async function main() {
  if (!config.runnerSharedKey || config.runnerSharedKey === 'change-me-runner-key') {
    console.error('RUNNER_SHARED_KEY no está configurada. Edita .env antes de iniciar.')
    process.exit(1)
  }
  await ensureWorkspace(config.workspaceRoots)
  await rotateLogs(config).catch((error) => console.error(`[logs] ${error.message}`))
  setInterval(() => rotateLogs(config).catch((error) => console.error(`[logs] ${error.message}`)), 60 * 60 * 1000)

  console.log('Agent Coder Remote Runner')
  console.log(`Runner ID: ${config.runnerId}`)
  console.log(`Gateway: ${config.gatewayUrl}`)
  console.log(`Workspace principal: ${config.workspaceRoot}`)
  console.log(`Workspaces permitidos: ${config.workspaceRoots.join(', ')}`)
  console.log(`Aprobación local: ${config.requireLocalApproval}`)
  console.log(`Comandos peligrosos: ${config.allowDangerousCommands}`)
  console.log(`Concurrencia máxima: ${config.maxConcurrentJobs}`)
  console.log(`Jobs pesados máximos: ${config.maxHeavyJobs}`)
  console.log(`Motor búsqueda: ${config.searchEngine}`)
  console.log(`Ignores inteligentes: ${config.useSmartIgnores ? config.defaultIgnores.join(', ') : 'desactivados'}`)

  await client.register(await runnerPayload('online'))
  console.log('Registrado en gateway central.')

  setInterval(() => {
    runnerPayload('online')
      .then((payload) => client.heartbeat(payload))
      .catch((error) => console.error(`[heartbeat] ${error.message}`))
  }, config.heartbeatIntervalMs)

  while (true) {
    try {
      await startPendingJobs()
      const availableSlots = claimBudget()
      let claimedAny = false
      for (let slot = 0; slot < availableSlots; slot++) {
        const response = await client.claimNext(config.runnerId)
        if (!response.job) break
        claimedAny = true
        const job = enqueueJob(response.job)
        jobLog(job, `reclamado como ${job.weight}`)
      }
      await startPendingJobs()
      if (!claimedAny && pendingJobs.length === 0) await sleep(config.pollIntervalMs)
      else await sleep(Math.min(config.pollIntervalMs, 500))
    } catch (error) {
      console.error(`[poll] ${error.message}`)
      await sleep(Math.max(config.pollIntervalMs, 5000))
    }
  }
}

process.on('SIGINT', async () => {
  console.log('\nDeteniendo runner...')
  try { await client.heartbeat(await runnerPayload('offline')) } catch {}
  process.exit(0)
})

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
