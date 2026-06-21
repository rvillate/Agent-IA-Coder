import express from 'express'
import { authRunner } from '../middleware/auth.js'
import { registrarOActualizarRunner } from '../servicios/runnersServicio.js'
import { actualizarJobDesdeRunner, obtenerJob, reclamarSiguiente } from '../servicios/jobsServicio.js'

export const runnerCompatRouter = express.Router()

runnerCompatRouter.post('/register', authRunner, async (req, res, next) => {
  try { res.json({ ok: true, runner: await registrarOActualizarRunner(req.cuenta.gateway_id, req.body) }) } catch (e) { next(e) }
})

runnerCompatRouter.post('/heartbeat', authRunner, async (req, res, next) => {
  try { res.json({ ok: true, runner: await registrarOActualizarRunner(req.cuenta.gateway_id, req.body) }) } catch (e) { next(e) }
})

runnerCompatRouter.post('/claim-next', authRunner, async (req, res, next) => {
  try {
    const runnerId = String(req.body?.runnerId || '').trim()
    if (!runnerId) throw new Error('runnerId requerido')
    res.json({ ok: true, job: await reclamarSiguiente(req.cuenta.gateway_id, runnerId) })
  } catch (e) { next(e) }
})

runnerCompatRouter.get('/jobs/:id/status', authRunner, async (req, res, next) => {
  try {
    const runnerId = String(req.query.runnerId || req.header('x-runner-id') || '').trim()
    const job = await obtenerJob(req.cuenta.gateway_id, req.params.id)
    if (!job) return res.status(404).json({ ok: false, error: 'Job no encontrado' })
    if (job.runnerTarget !== runnerId && job.claimedBy !== runnerId) return res.status(403).json({ ok: false, error: 'Job no pertenece a este runner' })
    res.json({ ok: true, job: { id: job.id, status: job.status, runnerTarget: job.runnerTarget, claimedBy: job.claimedBy, updatedAt: job.updatedAt } })
  } catch (e) { next(e) }
})

runnerCompatRouter.post('/jobs/:id/update', authRunner, async (req, res, next) => {
  try {
    const runnerId = String(req.body?.runnerId || '').trim()
    if (!runnerId) throw new Error('runnerId requerido')
    res.json({ ok: true, job: await actualizarJobDesdeRunner(req.cuenta.gateway_id, runnerId, req.params.id, req.body) })
  } catch (e) { next(e) }
})
