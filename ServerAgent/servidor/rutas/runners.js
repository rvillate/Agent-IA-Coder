import express from 'express'
import { authUsuario, authRunner } from '../middleware/auth.js'
import { env } from '../config/env.js'
import { listarRunners, registrarOActualizarRunner } from '../servicios/runnersServicio.js'

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
    capabilities: runner.capabilities || runner.capacidades || []
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
