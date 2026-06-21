import express from 'express'
import { authUsuario, authRunner } from '../middleware/auth.js'
import { env } from '../config/env.js'
import { listarRunners, registrarOActualizarRunner } from '../servicios/runnersServicio.js'
import { crearJob, obtenerJob } from '../servicios/jobsServicio.js'
import { consulta } from '../db/pool.js'

export const runnersRouter = express.Router()

function normalizarRunner(runner = {}) {
  const id = String(runner.id || runner.runnerId || runner.runner_id || '').trim()
  if (!id) return null
  return {
    id,
    status: runner.status || runner.estado || runner.lastStatus || runner.ultimo_estado || 'offline',
    lastStatus: runner.lastStatus || runner.ultimo_estado || runner.status || runner.estado || 'offline',
    lastSeen: runner.lastSeen || runner.ultima_vez || runner.last_seen || null,
    lastSeenAgeMs: runner.lastSeenAgeMs ?? runner.last_seen_age_ms ?? null,
    workspaceRoot: runner.workspaceRoot || runner.workspace_root || null,
    workspaceRoots: runner.workspaceRoots || runner.workspace_roots || [],
    platform: runner.platform || runner.plataforma || null,
    hostname: runner.hostname || null,
    version: runner.version || null,
    maxConcurrentJobs: runner.maxConcurrentJobs || runner.max_concurrent_jobs || 1,
    activeJobs: runner.activeJobs || runner.trabajos_activos || [],
    capabilities: runner.capabilities || runner.capacidades || [],
    metrics: runner.metrics || runner.metricas || {},
    browserPreviews: runner.browserPreviews || runner.metrics?.browserPreviews || runner.metricas?.browserPreviews || []
  }
}

async function runnersLegacy() {
  if (!env.legacyGatewayUrl || !env.legacyGatewayApiKey) return []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3500)
  try {
    const respuesta = await fetch(`${env.legacyGatewayUrl.replace(/\/$/, '')}/api/runners`, {
      headers: { 'x-agent-key': env.legacyGatewayApiKey },
      signal: controller.signal
    })
    if (!respuesta.ok) return []
    const data = await respuesta.json()
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
    return items.map(normalizarRunner).filter(Boolean)
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

async function listarRunnersDisponibles(gatewayId) {
  const dbItems = (await listarRunners(gatewayId)).map(normalizarRunner).filter(Boolean)
  const legacyItems = await runnersLegacy()
  const mapa = new Map()
  for (const item of dbItems) mapa.set(item.id, { ...item, source: 'control-agent' })
  for (const item of legacyItems) mapa.set(item.id, { ...(mapa.get(item.id) || {}), ...item, source: 'gateway' })
  return [...mapa.values()].sort((a, b) => {
    const ao = a.status === 'online' ? 0 : 1
    const bo = b.status === 'online' ? 0 : 1
    return ao - bo || a.id.localeCompare(b.id)
  })
}


function sleep(ms){ return new Promise((resolve)=>setTimeout(resolve, ms)) }

runnersRouter.get('/:runnerId/browser-previews/:sessionId/screenshot', authUsuario, async (req, res, next) => {
  const runnerId = String(req.params.runnerId || '').trim()
  const sessionId = String(req.params.sessionId || 'default').trim()
  let job = null
  try {
    const runners = await listarRunnersDisponibles(req.cuenta.gateway_id)
    const runner = runners.find((item) => item.id === runnerId)
    if (!runner) return res.status(404).json({ ok: false, error: 'Runner no encontrado' })
    const preview = (runner.browserPreviews || runner.metrics?.browserPreviews || []).find((item) => String(item.sessionId || 'default') === sessionId)
    if (!preview) return res.status(404).json({ ok: false, error: 'Sesión browser no encontrada' })
    job = await crearJob({
      type: 'browser.screenshot',
      runnerTarget: runnerId,
      payload: {
        sessionId,
        fullPage: false,
        type: 'jpeg',
        quality: 55,
        includeBase64: true,
        waitMs: 0,
        timeoutMs: 5000
      },
      priority: 5,
      note: 'Preview browser en vivo para pantalla Runners'
    }, req.cuenta.gateway_id)
    const deadline = Date.now() + 8000
    let actual = job
    while (Date.now() < deadline) {
      actual = await obtenerJob(req.cuenta.gateway_id, job.id)
      if (['success','error','timeout','cancelled','rejected'].includes(actual?.status)) break
      await sleep(250)
    }
    if (actual?.status !== 'success') return res.status(202).json({ ok: false, pending: true, status: actual?.status || 'queued' })
    const screenshot = actual?.result?.screenshot || actual?.result?.image || actual?.result
    const base64 = screenshot?.base64 || actual?.result?.base64
    const mimeType = screenshot?.mimeType || actual?.result?.mimeType || 'image/jpeg'
    if (!base64) return res.status(204).end()
    const buffer = Buffer.from(base64, 'base64')
    res.setHeader('content-type', mimeType)
    res.setHeader('cache-control', 'no-store, max-age=0')
    res.setHeader('x-browser-session-id', sessionId)
    res.end(buffer)
  } catch (e) { next(e) }
  finally {
    if (job?.id) consulta('DELETE FROM aplicacion.jobs WHERE gateway_id=$1 AND id=$2', [req.cuenta.gateway_id, job.id]).catch(()=>{})
  }
})

runnersRouter.get('/', authUsuario, async (req, res, next) => {
  try {
    const items = await listarRunnersDisponibles(req.cuenta.gateway_id)
    res.json({ ok: true, items, total: items.length })
  } catch (e) { next(e) }
})

runnersRouter.get('/disponibles', authUsuario, async (req, res, next) => {
  try {
    const items = await listarRunnersDisponibles(req.cuenta.gateway_id)
    res.json({ ok: true, items, total: items.length })
  } catch (e) { next(e) }
})

runnersRouter.get('/registrados', authUsuario, async (req, res, next) => {
  try {
    const items = await listarRunners(req.cuenta.gateway_id)
    res.json({ ok: true, items, total: items.length })
  } catch (e) { next(e) }
})

runnersRouter.post('/register', authRunner, async (req, res, next) => {
  try { res.json({ ok: true, runner: await registrarOActualizarRunner(req.cuenta.gateway_id, req.body) }) } catch (e) { next(e) }
})

runnersRouter.post('/heartbeat', authRunner, async (req, res, next) => {
  try { res.json({ ok: true, runner: await registrarOActualizarRunner(req.cuenta.gateway_id, req.body) }) } catch (e) { next(e) }
})
