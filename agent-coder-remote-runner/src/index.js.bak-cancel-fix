import os from 'node:os'
import path from 'node:path'
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
  gitDiff
} from './tools.js'

const config = getConfig()
const client = new GatewayClient(config)
const guard = createPathGuard(config.workspaceRoot)

const capabilities = [
  'shell.exec',
  'file.list',
  'file.read',
  'file.write',
  'file.delete',
  'file.mkdir',
  'file.search',
  'git.status',
  'git.diff'
]

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

function runnerPayload(status = 'online') {
  return {
    runnerId: config.runnerId,
    status,
    workspaceRoot: config.workspaceRoot,
    platform: `${process.platform}-${process.arch}`,
    hostname: os.hostname(),
    version: '1.0.0',
    capabilities
  }
}

async function update(job, data) {
  return client.updateJob(job.id, { runnerId: config.runnerId, ...data })
}

async function executeJob(job) {
  const payload = job.payload || {}
  console.log('')
  jobLog(job, job.type)

  try {
    if (job.type === 'shell.exec' && config.requireLocalApproval) {
      await update(job, {
        status: 'needs_approval',
        summary: `Esperando aprobación local para ejecutar: ${payload.command} ${(payload.args || []).join(' ')}`
      })
      const approved = await askApproval(`Job ${job.id}\nRunner: ${config.runnerId}\nCWD: ${payload.cwd || '.'}\nComando: ${payload.command} ${(payload.args || []).join(' ')}`)
      if (!approved) {
        await update(job, { status: 'rejected', summary: 'Rechazado por el usuario en la terminal del runner.' })
        jobLog(job, 'rechazado')
        return
      }
      await update(job, { status: 'running', summary: 'Aprobado localmente. Ejecutando...' })
    }

    let result
    switch (job.type) {
      case 'file.list':
        result = await fileList(payload, guard, config)
        await update(job, { status: 'success', result, summary: 'Listado generado correctamente' })
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
        await update(job, { status: 'success', result, summary: `Búsqueda finalizada con ${result.total} coincidencias`, truncated: result.truncated })
        break
      case 'shell.exec': {
        result = await runCommand(payload, guard, config, job.id)
        await update(job, {
          status: result.status,
          exitCode: result.exitCode,
          stdoutTail: result.stdoutTail,
          stderrTail: result.stderrTail,
          summary: result.summary,
          error: result.error,
          localLogPath: result.localLogPath,
          truncated: result.truncated,
          result: { durationMs: result.durationMs }
        })
        break
      }
      case 'git.status': {
        result = await gitStatus(payload, guard, config, job.id)
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
        result = await gitDiff(payload, guard, config, job.id)
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
      default:
        throw new Error(`Tipo de job no soportado: ${job.type}`)
    }
    jobLog(job, 'terminado')
  } catch (error) {
    jobError(job, 'error', error.message)
    await update(job, {
      status: 'error',
      summary: 'Error ejecutando job',
      error: error.message,
      stderrTail: error.stack || error.message
    }).catch((updateError) => console.error('No se pudo actualizar error:', updateError.message))
  }
}

async function main() {
  if (!config.runnerSharedKey || config.runnerSharedKey === 'change-me-runner-key') {
    console.error('RUNNER_SHARED_KEY no está configurada. Edita .env antes de iniciar.')
    process.exit(1)
  }
  await ensureWorkspace(config.workspaceRoot)
  console.log('Agent Coder Remote Runner')
  console.log(`Runner ID: ${config.runnerId}`)
  console.log(`Gateway: ${config.gatewayUrl}`)
  console.log(`Workspace: ${config.workspaceRoot}`)
  console.log(`Aprobación local: ${config.requireLocalApproval}`)
  console.log(`Comandos peligrosos: ${config.allowDangerousCommands}`)

  await client.register(runnerPayload('online'))
  console.log('Registrado en gateway central.')

  setInterval(() => {
    client.heartbeat(runnerPayload('online')).catch((error) => console.error(`[heartbeat] ${error.message}`))
  }, config.heartbeatIntervalMs)

  while (true) {
    try {
      const response = await client.claimNext(config.runnerId)
      if (response.job) {
        await executeJob(response.job)
      } else {
        await sleep(config.pollIntervalMs)
      }
    } catch (error) {
      console.error(`[poll] ${error.message}`)
      await sleep(Math.max(config.pollIntervalMs, 5000))
    }
  }
}

process.on('SIGINT', async () => {
  console.log('\nDeteniendo runner...')
  try { await client.heartbeat(runnerPayload('offline')) } catch {}
  process.exit(0)
})

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
