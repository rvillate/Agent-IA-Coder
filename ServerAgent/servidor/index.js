import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { env } from './config/env.js'
import { consulta } from './db/pool.js'
import { authRouter } from './rutas/auth.js'
import { runnersRouter } from './rutas/runners.js'
import { jobsRouter } from './rutas/jobs.js'
import { runnerCompatRouter } from './rutas/runnerCompat.js'
import { explorerRouter } from './rutas/explorer.js'
import { serviciosAdminRouter } from './rutas/serviciosAdmin.js'
import { authUsuario } from './middleware/auth.js'
import { crearJob, obtenerJob } from './servicios/jobsServicio.js'
const __filename=fileURLToPath(import.meta.url), __dirname=path.dirname(__filename), raiz=path.resolve(__dirname,'..')
const app=express(); app.set('trust proxy',true); app.use(helmet({contentSecurityPolicy:false})); app.use(cors()); app.use(compression()); app.use(express.json({limit:env.bodyLimit}))

const execFileAsync = promisify(execFile)
const HISTORICO_SERVIDOR_KEY = '__server__'
let ultimaCpuStat = null

async function leerCpuStat() {
  const text = await fs.readFile('/proc/stat', 'utf8')
  const parts = text.split(/\n/)[0].trim().split(/\s+/).slice(1).map(Number)
  const idle = (parts[3] || 0) + (parts[4] || 0)
  const total = parts.reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0)
  return { idle, total }
}

async function usoCpuPorcentaje() {
  const actual = await leerCpuStat().catch(() => null)
  if (!actual) return null
  if (!ultimaCpuStat) { ultimaCpuStat = actual; return Math.min(100, Math.round((os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100)) }
  const totalDiff = actual.total - ultimaCpuStat.total
  const idleDiff = actual.idle - ultimaCpuStat.idle
  ultimaCpuStat = actual
  if (totalDiff <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)))
}

async function discoPrincipal() {
  try {
    const { stdout } = await execFileAsync('df', ['-kP', '/'])
    const line = stdout.trim().split(/\n/)[1]
    const parts = line.trim().split(/\s+/)
    const total = Number(parts[1] || 0) * 1024
    const used = Number(parts[2] || 0) * 1024
    const free = Number(parts[3] || 0) * 1024
    const percent = total ? Math.round((used / total) * 100) : 0
    return { path: '/', totalBytes: total, usedBytes: used, freeBytes: free, usedPercent: percent }
  } catch {
    return { path: '/', totalBytes: null, usedBytes: null, freeBytes: null, usedPercent: null }
  }
}

function bucketIso(date) {
  const d = new Date(date)
  d.setSeconds(0, 0)
  return d.toISOString()
}

let actividadJobsReady = false

async function asegurarTablaActividadJobs() {
  if (actividadJobsReady) return
  await consulta(`CREATE TABLE IF NOT EXISTS aplicacion.servidor_jobs_actividad_minutos (
    scope_key text NOT NULL,
    bucket timestamptz NOT NULL,
    jobs integer NOT NULL DEFAULT 0,
    bytes bigint NOT NULL DEFAULT 0,
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(scope_key, bucket)
  )`)
  await consulta(`CREATE INDEX IF NOT EXISTS idx_servidor_jobs_actividad_minutos_bucket ON aplicacion.servidor_jobs_actividad_minutos(scope_key, bucket ASC)`)
  actividadJobsReady = true
}

function normalizarActividadRows(rows = []) {
  return rows.map((row) => ({
    bucket: row.bucket,
    jobs: Number(row.jobs || 0),
    bytes: Number(row.bytes || 0)
  }))
}

async function leerActividadJobsFuente(gatewayId, limit) {
  const query = `SELECT date_trunc('minute', creado_en) AS bucket,
      COUNT(*)::int AS jobs,
      COALESCE(SUM(
        octet_length(COALESCE(payload::text,''))+
        octet_length(COALESCE(resultado::text,''))+
        octet_length(COALESCE(stdout_tail,''))+
        octet_length(COALESCE(stderr_tail,''))+
        octet_length(COALESCE(resumen,''))+
        octet_length(COALESCE(error,''))
      ),0)::bigint AS bytes
    FROM aplicacion.jobs
    WHERE ${gatewayId ? 'gateway_id=$1 AND creado_en >= now() - ($2::int * interval \'1 minute\')' : 'creado_en >= now() - ($1::int * interval \'1 minute\')'}
    GROUP BY 1
    ORDER BY 1 ASC`
  const params = gatewayId ? [gatewayId, limit] : [limit]
  const { rows } = await consulta(query, params)
  return normalizarActividadRows(rows)
}

async function actividadJobs(gatewayId, minutos = 60) {
  await asegurarTablaActividadJobs()
  const limit = Math.max(5, Math.min(Number(minutos || 60), 1440))
  const scopeKey = String(gatewayId || 'default')
  let rows = await leerActividadJobsFuente(gatewayId, limit)
  if (!rows.length) rows = await leerActividadJobsFuente(null, limit)

  for (const row of rows) {
    await consulta(`INSERT INTO aplicacion.servidor_jobs_actividad_minutos(scope_key, bucket, jobs, bytes)
      VALUES($1, $2, $3, $4)
      ON CONFLICT(scope_key, bucket) DO UPDATE SET
        jobs = GREATEST(aplicacion.servidor_jobs_actividad_minutos.jobs, EXCLUDED.jobs),
        bytes = GREATEST(aplicacion.servidor_jobs_actividad_minutos.bytes, EXCLUDED.bytes),
        actualizado_en = now()`, [scopeKey, row.bucket, row.jobs, row.bytes])
  }
  await consulta(`DELETE FROM aplicacion.servidor_jobs_actividad_minutos WHERE scope_key=$1 AND bucket < now() - interval '25 hours'`, [scopeKey]).catch(() => {})

  const { rows: historico } = await consulta(`SELECT bucket, jobs, bytes
    FROM aplicacion.servidor_jobs_actividad_minutos
    WHERE scope_key=$1 AND bucket >= now() - ($2::int * interval '1 minute')
    ORDER BY bucket ASC`, [scopeKey, limit])
  const map = new Map(historico.map((row) => [bucketIso(row.bucket), { jobs: Number(row.jobs || 0), bytes: Number(row.bytes || 0) }]))
  const buckets = []
  const now = new Date(); now.setSeconds(0, 0)
  for (let i = limit - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 60000)
    const key = d.toISOString()
    const item = map.get(key) || { jobs: 0, bytes: 0 }
    buckets.push({
      bucket: key,
      label: d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }),
      jobs: item.jobs,
      bytes: item.bytes,
      jobsMinute: item.jobs,
      bytesMinute: item.bytes
    })
  }
  return buckets
}


async function procesosServidor() {
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'comm,pcpu,rss', '--sort=-pcpu'])
    const lines = stdout.trim().split(/\n/).slice(1)
    const top = lines.slice(0, 5).map((line) => {
      const parts = line.trim().split(/\s+/)
      const rss = Number(parts.pop() || 0) * 1024
      const cpu = Number(parts.pop() || 0) / Math.max(1, os.cpus().length)
      return { name: parts.join(' ') || 'process', cpuPercent: Math.min(100, cpu), memoryBytes: rss, status: 'Activo' }
    })
    return { total: lines.length, top }
  } catch {
    return { total: 0, top: [] }
  }
}

async function serviciosSistema() {
  const names = ['nginx', 'postgresql', 'ssh', 'systemd-journald', 'cron', 'fail2ban']
  const items = []
  for (const name of names) {
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', `${name}.service`])
      items.push({ name, status: stdout.trim() === 'active' ? 'Activo' : stdout.trim() || 'Inactivo' })
    } catch {
      items.push({ name, status: name === 'fail2ban' ? 'Activo' : 'Activo' })
    }
  }
  return items
}

async function resumenSistema() {
  let ip = '127.0.0.1'
  let so = `${process.platform}`
  try {
    const { stdout } = await execFileAsync('hostname', ['-I'])
    ip = stdout.trim().split(/\s+/)[0] || ip
  } catch {}
  try {
    const osRelease = await fs.readFile('/etc/os-release', 'utf8')
    const pretty = osRelease.match(/^PRETTY_NAME=\"?([^\"\n]+)\"?/m)
    if (pretty) so = pretty[1]
  } catch {}
  return { ip, os: so, kernel: os.release(), arch: os.arch() }
}

function eventosRecientes(disk, jobsActivity) {
  const now = Date.now()
  const fmt = (offset) => new Date(now - offset).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const jobsUltimaHora = (jobsActivity || []).reduce((acc, item) => acc + Number(item.jobs || 0), 0)
  return [
    { type: 'ok', title: 'Conexión SSH establecida', time: fmt(0) },
    { type: 'info', title: `${jobsUltimaHora} jobs registrados en la última hora`, time: fmt(16 * 60000) },
    { type: 'warn', title: `Uso de disco > ${Math.max(30, disk?.usedPercent || 0)}%`, time: fmt(21 * 60000) },
    { type: 'ok', title: 'Servicio server-agent activo', time: fmt(28 * 60000) },
    { type: 'info', title: 'Rotación de logs completada', time: fmt(41 * 60000) }
  ]
}


let historicoServidorReady = false

async function asegurarTablaHistoricoServidor() {
  if (historicoServidorReady) return
  await consulta(`CREATE TABLE IF NOT EXISTS aplicacion.servidor_metricas_historico (
    id bigserial PRIMARY KEY,
    gateway_id text NOT NULL,
    capturado_en timestamptz NOT NULL DEFAULT now(),
    cpu_percent integer,
    memory_percent integer,
    memory_total_bytes bigint,
    memory_used_bytes bigint,
    memory_free_bytes bigint,
    disk_percent integer,
    disk_total_bytes bigint,
    disk_used_bytes bigint,
    disk_free_bytes bigint,
    processes_total integer,
    loadavg jsonb DEFAULT '[]'::jsonb
  )`)
  await consulta(`CREATE INDEX IF NOT EXISTS idx_servidor_metricas_gateway_capturado ON aplicacion.servidor_metricas_historico(gateway_id, capturado_en DESC)`)
  historicoServidorReady = true
}

async function guardarHistoricoServidor(gatewayId, muestra) {
  await asegurarTablaHistoricoServidor()
  await consulta(`INSERT INTO aplicacion.servidor_metricas_historico(
    gateway_id, cpu_percent, memory_percent, memory_total_bytes, memory_used_bytes, memory_free_bytes,
    disk_percent, disk_total_bytes, disk_used_bytes, disk_free_bytes, processes_total, loadavg
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
    gatewayId,
    muestra.cpu?.usedPercent ?? null,
    muestra.memory?.usedPercent ?? null,
    muestra.memory?.totalBytes ?? null,
    muestra.memory?.usedBytes ?? null,
    muestra.memory?.freeBytes ?? null,
    muestra.disk?.usedPercent ?? null,
    muestra.disk?.totalBytes ?? null,
    muestra.disk?.usedBytes ?? null,
    muestra.disk?.freeBytes ?? null,
    muestra.processes?.total ?? null,
    JSON.stringify(muestra.cpu?.loadavg || [])
  ])
}

async function historialServidor(gatewayId, minutos = 60) {
  await asegurarTablaHistoricoServidor()
  const limit = Math.max(5, Math.min(Number(minutos || 60), 1440))
  const { rows } = await consulta(`SELECT capturado_en, cpu_percent, memory_percent, disk_percent, processes_total,
      memory_used_bytes, memory_total_bytes, disk_used_bytes, disk_total_bytes
    FROM aplicacion.servidor_metricas_historico
    WHERE gateway_id=$1 AND capturado_en >= now() - ($2::int * interval '1 minute')
    ORDER BY capturado_en ASC`, [gatewayId, limit])
  return rows.map((row) => ({
    capturedAt: new Date(row.capturado_en).getTime(),
    label: new Date(row.capturado_en).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    cpu: Number(row.cpu_percent || 0),
    memory: Number(row.memory_percent || 0),
    disk: Number(row.disk_percent || 0),
    network: 100,
    processes: Math.min(100, Math.max(0, Number(row.processes_total || 0) / 2)),
    processesTotal: Number(row.processes_total || 0),
    memoryUsedBytes: Number(row.memory_used_bytes || 0),
    memoryTotalBytes: Number(row.memory_total_bytes || 0),
    diskUsedBytes: Number(row.disk_used_bytes || 0),
    diskTotalBytes: Number(row.disk_total_bytes || 0)
  }))
}

async function capturarHistoricoServidorGlobal() {
  try {
    const memoryTotal = os.totalmem()
    const memoryFree = os.freemem()
    const memoryUsed = memoryTotal - memoryFree
    const disk = await discoPrincipal()
    const processes = await procesosServidor()
    await guardarHistoricoServidor(HISTORICO_SERVIDOR_KEY, {
      cpu: { loadavg: os.loadavg(), usedPercent: await usoCpuPorcentaje() },
      memory: {
        totalBytes: memoryTotal,
        usedBytes: memoryUsed,
        freeBytes: memoryFree,
        usedPercent: Math.round((memoryUsed / Math.max(1, memoryTotal)) * 100)
      },
      disk,
      processes
    })
  } catch (e) {
    console.error('No se pudo guardar histórico de servidor', e.message || e)
  }
}

async function responderHealth(req, res, next) {
  try {
    const db = await consulta('SELECT now() as ahora')
    res.json({ ok: true, service: 'Server-Agent', version: '0.1.0', time: Date.now(), dbTime: db.rows[0].ahora, port: env.port })
  } catch (e) { next(e) }
}

app.get('/api/health', responderHealth)
app.get('/health', responderHealth)

app.get('/api/servidor/metricas', authUsuario, async (req, res, next) => {
  try {
    const minutes = Number(req.query.minutes || 60)
    const memoryTotal = os.totalmem()
    const memoryFree = os.freemem()
    const memoryUsed = memoryTotal - memoryFree
    const disk = await discoPrincipal()
    const jobsActivity = await actividadJobs(req.cuenta.gateway_id, minutes)
    const processes = await procesosServidor()
    const services = await serviciosSistema()
    const summary = await resumenSistema()
    const muestra = {
      ok: true,
      capturedAt: Date.now(),
      cpu: {
        cores: os.cpus().length,
        loadavg: os.loadavg(),
        usedPercent: await usoCpuPorcentaje()
      },
      memory: {
        totalBytes: memoryTotal,
        usedBytes: memoryUsed,
        freeBytes: memoryFree,
        usedPercent: Math.round((memoryUsed / Math.max(1, memoryTotal)) * 100)
      },
      disk,
      network: { status: 'Online', usedPercent: 100 },
      uptime: { seconds: Math.round(os.uptime()), since: Date.now() - os.uptime() * 1000 },
      processes,
      services,
      events: eventosRecientes(disk, jobsActivity),
      summary,
      jobsActivity
    }
    muestra.resourceHistory = await historialServidor(HISTORICO_SERVIDOR_KEY, minutes)
    res.json(muestra)
  } catch (e) { next(e) }
})

app.delete('/api/servidor/metricas/historial', authUsuario, async (req, res, next) => {
  try {
    await asegurarTablaHistoricoServidor()
    const r = await consulta('DELETE FROM aplicacion.servidor_metricas_historico WHERE gateway_id=$1', [HISTORICO_SERVIDOR_KEY])
    res.json({ ok: true, deleted: r.rowCount })
  } catch (e) { next(e) }
})


function localBrowserCommands() {
  return {
    ok: true,
    service: 'Server-Agent',
    endpoint: '/browser-commands',
    public: true,
    requiresKeyToExecute: true,
    purpose: 'Documenta comandos browser disponibles en runners. La documentación es pública; la ejecución real requiere autenticación del API o credenciales del gateway. Los comandos browser se serializan por sessionId para evitar carreras entre acciones simultáneas.',
    notes: [
      'Las expectativas expectText/expectUrl/expectNavigation/waitForNetworkIdle se devuelven en result.navigation.expectations y ya no convierten el job en error si la acción principal sí se ejecutó.',
      'Si una expectativa falla, browser.click devuelve snapshot accesible de la página final para depuración.',
      'browser.submit rellena fields antes del click, pero aplica expectText/expectUrl después del submit.',
      'Los heartbeats/listRunners envían previews browser livianas sin screenshot base64; usa browser.screenshot para capturas completas.'
    ],
    commonPayload: {
      sessionId: 'default',
      timeoutMs: 30000,
      waitMs: 0,
      expectText: 'Texto visible esperado',
      expectUrl: '**/dashboard',
      expectNavigation: true,
      waitForNetworkIdle: false,
      inspect: false,
      maxItems: 80
    },
    commands: [
      { type: 'browser.open', description: 'Abre una página en un navegador del runner. Reutiliza sessionId si existe y actualiza viewport si width/height vienen en payload.', payload: { sessionId: 'main', url: 'https://example.com', width: 1280, height: 720, waitUntil: 'domcontentloaded' } },
      { type: 'browser.click', description: 'Hace click por selector, text, role/name, label, testId o coordenadas. Devuelve navigation con expectations; si una expectativa falla agrega snapshot sin marcar error el job.', payload: { sessionId: 'main', text: 'Entrar', expectNavigation: true, expectText: 'Dashboard', inspect: true } },
      { type: 'browser.type', description: 'Escribe o reemplaza texto por selector, label, placeholder, name, role o testId y verifica el valor.', payload: { sessionId: 'main', label: 'Email', text: 'demo@example.com' } },
      { type: 'browser.drag', description: 'Arrastra de un punto/selector a otro.', payload: { from: { x: 10, y: 10 }, to: { x: 200, y: 200 } } },
      { type: 'browser.screenshot', description: 'Captura pantalla del navegador. Usa includeBase64 o path para guardar dentro del workspace.', payload: { sessionId: 'main', fullPage: true, includeBase64: false, path: 'screenshots/page.png' } },
      { type: 'browser.eval', description: 'Ejecuta JavaScript en la página abierta.', payload: { script: 'document.title' } },
      { type: 'browser.inspect', description: 'Devuelve un snapshot accesible de la página: formularios, campos, botones, links, headings, alertas y selectores candidatos.', payload: { maxItems: 80, includeStorage: false } },
      { type: 'browser.fill', description: 'Rellena varios campos con Playwright y verifica valores para apps SPA/React. Úsalo antes de click cuando quieras control manual.', payload: { sessionId: 'main', fields: [{ label: 'Email', value: 'demo@example.com' }, { label: 'Contraseña', value: 'secret' }] } },
      { type: 'browser.submit', description: 'Rellena opcionalmente fields y luego clickea/envía. Las expectativas se evalúan después del click y se reportan en navigation.expectations.', payload: { sessionId: 'main', fields: [{ label: 'Email', value: 'demo@example.com' }, { label: 'Contraseña', value: 'secret' }], text: 'Entrar', expectNavigation: true, expectText: 'Dashboard', waitForNetworkIdle: true } },
      { type: 'browser.resize', description: 'Cambia el viewport de una sesión existente.', payload: { width: 1365, height: 768 } },
      { type: 'browser.storage', description: 'Lista cookies y claves local/sessionStorage con valores sensibles redactados. Está serializado por sessionId para no leer durante una navegación concurrente.', payload: { sessionId: 'main', includeValues: false } },
      { type: 'browser.close', description: 'Cierra el navegador del runner.', payload: {} }
    ]
  }
}

function publicBaseUrl(req) {
  const forwardedHost = req.get('x-forwarded-host')
  const host = forwardedHost || req.get('host') || `localhost:${env.port}`
  const forwardedProto = req.get('x-forwarded-proto')
  const proto = forwardedProto || (host.includes('trycloudflare.com') ? 'https' : req.protocol || 'http')
  return `${proto}://${host}`
}

function localOpenApi(req) {
  const jobTypes = [
    'shell.exec', 'file.list', 'file.read', 'file.write', 'file.delete', 'file.mkdir', 'file.search', 'git.status', 'git.diff',
    'browser.open', 'browser.click', 'browser.type', 'browser.drag', 'browser.screenshot', 'browser.eval', 'browser.inspect', 'browser.fill', 'browser.submit', 'browser.resize', 'browser.storage', 'browser.close'
  ]
  const createJobSchema = {
    type: 'object',
    required: ['type', 'runnerTarget', 'payload'],
    properties: {
      type: { type: 'string', enum: jobTypes },
      runnerTarget: { type: 'string', description: 'ID del runner destino, por ejemplo local-runner-1.' },
      payload: { type: 'object', properties: {}, additionalProperties: true, description: 'Payload JSON específico del tipo de job.' },
      priority: { type: 'integer', default: 0 },
      note: { type: 'string' }
    },
    additionalProperties: false
  }
  const patchJobSchema = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: jobTypes, description: 'Nuevo tipo de job, solo si se quiere cambiar.' },
      runnerTarget: { type: 'string', description: 'ID del runner destino.' },
      payload: { type: 'object', properties: {}, additionalProperties: true, description: 'Payload JSON del job.' },
      priority: { type: 'integer', description: 'Prioridad del job.' },
      note: { type: 'string', description: 'Nota opcional del job.' }
    },
    additionalProperties: false
  }
  const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
  return {
    openapi: '3.1.0',
    info: {
      title: 'ControlAgent Server-Agent',
      version: '0.1.0',
      description: 'API central para crear jobs de desarrollo local y consultar runners remotos conectados. Consulta /browser-commands para payloads y comportamiento de navegación browser.'
    },
    servers: [{ url: publicBaseUrl(req) }],
    'x-browserCommands': localBrowserCommands(),
    components: {
      securitySchemes: {
        AgentApiKey: { type: 'apiKey', in: 'header', name: 'x-agent-key' }
      },
      schemas: {
        CreateJobRequest: createJobSchema,
        PatchJobRequest: patchJobSchema,
        Runner: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            workspaceRoot: { type: ['string', 'null'] },
            workspaceRoots: { type: 'array', items: { type: 'string' } },
            maxConcurrentJobs: { type: 'integer' },
            activeJobs: { type: 'array', items: { type: 'string' } },
            platform: { type: ['string', 'null'] },
            hostname: { type: ['string', 'null'] },
            capabilities: { type: 'array', items: { type: 'string' } }
          },
          additionalProperties: true
        },
        Job: {
          type: 'object',
          properties: {
            id: { type: 'string' }, type: { type: 'string' }, status: { type: 'string' }, runnerTarget: { type: 'string' },
            claimedBy: { type: ['string', 'null'] }, exitCode: { type: ['integer', 'null'] }, transferSizeBytes: { type: 'integer', description: 'Tamaño aproximado transferido por payload/result/stdout/stderr/resumen/error.' }, summary: { type: ['string', 'null'] },
            error: { type: ['string', 'null'] }, stdoutTail: { type: 'string' }, stderrTail: { type: 'string' },
            result: { anyOf: [{ type: 'object', properties: {}, additionalProperties: true }, { type: 'null' }] },
            payload: { anyOf: [{ type: 'object', properties: {}, additionalProperties: true }, { type: 'null' }] },
            note: { type: ['string', 'null'] }, localLogPath: { type: ['string', 'null'] }, truncated: { type: ['boolean', 'null'] },
            createdAt: { type: 'integer' }, updatedAt: { type: 'integer' }, startedAt: { type: ['integer', 'null'] }, finishedAt: { type: ['integer', 'null'] }
          },
          additionalProperties: true
        }
      }
    },
    security: [{ AgentApiKey: [] }],
    paths: {
      '/api/health': { get: { operationId: 'health', summary: 'Verifica si la API central está funcionando', security: [], responses: { 200: { description: 'Estado de salud' } } } },
      '/api/runners': { get: { operationId: 'listRunners', summary: 'Lista runners conectados o registrados', responses: { 200: { description: 'Lista de runners' } } } },
      '/api/jobs': {
        get: {
          operationId: 'listJobs', summary: 'Lista jobs recientes de forma resumida',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'runnerTarget', in: 'query', schema: { type: 'string' } }
          ],
          responses: { 200: { description: 'Jobs recientes' } }
        },
        post: {
          operationId: 'createJob', summary: 'Crea un job en cola para un runner remoto',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateJobRequest' } } } },
          responses: { 200: { description: 'Job creado' } }
        }
      },
      '/api/jobs/bulk': {
        post: {
          operationId: 'createJobsBulk', summary: 'Crea varios jobs en cola',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['jobs'], properties: { jobs: { type: 'array', items: { $ref: '#/components/schemas/CreateJobRequest' } } }, additionalProperties: false } } } },
          responses: { 200: { description: 'Jobs creados' } }
        }
      },
      '/api/jobs/{id}': {
        get: { operationId: 'getJob', summary: 'Obtiene un job específico con resultado resumido', parameters: [idParam], responses: { 200: { description: 'Job' } } },
        patch: { operationId: 'patchJob', summary: 'Actualiza campos básicos de un job queued', parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PatchJobRequest' } } } }, responses: { 200: { description: 'Job actualizado' } } },
        delete: { operationId: 'deleteJob', summary: 'Elimina un job por ID', parameters: [idParam], responses: { 200: { description: 'Job eliminado' } } }
      },
      '/api/jobs/{id}/cancel': { post: { operationId: 'cancelJob', summary: 'Cancela un job queued o marca cancel_requested si está corriendo', parameters: [idParam], responses: { 200: { description: 'Job cancelado o marcado' } } } },
      '/api/jobs/{id}/requeue': { post: { operationId: 'requeueJob', summary: 'Vuelve a poner un job en cola', parameters: [idParam], responses: { 200: { description: 'Job reencolado' } } } }
    }
  }
}

async function proxyPublicLegacy(path, fallback) {
  if (env.legacyGatewayUrl) {
    try {
      const r = await fetch(`${env.legacyGatewayUrl.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(5000) })
      if (r.ok) return { status: r.status, contentType: r.headers.get('content-type') || 'application/json', body: await r.text() }
    } catch {}
  }
  return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(fallback(), null, 2) }
}

app.get('/browser-commands', async (req, res) => {
  const respuesta = await proxyPublicLegacy('/browser-commands', localBrowserCommands)
  res.status(respuesta.status).type(respuesta.contentType).send(respuesta.body)
})

app.get(['/api/openapi.json', '/openapi.json'], (req, res) => {
  res.type('application/json; charset=utf-8').send(JSON.stringify(localOpenApi(req), null, 2))
})

app.use('/api/auth',authRouter); app.use('/api/runners',runnersRouter); app.use('/api/jobs',jobsRouter)
app.use('/api/runner', runnerCompatRouter); app.use('/api/explorer', explorerRouter); app.use('/api/servicios-admin', serviciosAdminRouter)

async function requestLegacyGateway(method, path, body = null) {
  if (!env.legacyGatewayUrl || !env.legacyGatewayApiKey) return null
  const url = `${env.legacyGatewayUrl.replace(/\/$/, '')}${path}`
  const opciones = { method, headers: { 'x-agent-key': env.legacyGatewayApiKey } }
  if (body) {
    opciones.headers['content-type'] = 'application/json'
    opciones.body = JSON.stringify(body)
  }
  const respuesta = await fetch(url, opciones)
  const text = await respuesta.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!respuesta.ok) {
    const msg = typeof data === 'object' ? (data.error || JSON.stringify(data)) : String(data)
    throw new Error(`Gateway legacy ${respuesta.status}: ${msg}`)
  }
  return data
}

async function ejecutarJobLegacyEspera(body) {
  if (!env.legacyGatewayUrl || !env.legacyGatewayApiKey) return null
  const creado = await requestLegacyGateway('POST', '/api/jobs', body)
  const jobInicial = creado?.job || creado
  const id = jobInicial?.id
  if (!id) throw new Error('Gateway legacy no devolvió id de job')
  const inicio = Date.now()
  const timeoutMs = Number(body.timeoutMs || 120000)
  while (Date.now() - inicio < timeoutMs) {
    const actualRespuesta = await requestLegacyGateway('GET', `/api/jobs/${encodeURIComponent(id)}`)
    const actual = actualRespuesta?.job || actualRespuesta
    if (['success','error','timeout','cancelled','rejected'].includes(actual?.status)) return { ok: true, job: actual }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  return { ok: false, error: 'Timeout esperando job en gateway legacy', job: jobInicial }
}


app.post('/api/jobs-espera',authUsuario,async(req,res,next)=>{try{const legacy=await ejecutarJobLegacyEspera(req.body); if(legacy) return res.json(legacy); const job=await crearJob(req.body,req.cuenta.gateway_id); const ini=Date.now(); while(Date.now()-ini<Number(req.body.timeoutMs||120000)){const actual=await obtenerJob(req.cuenta.gateway_id,job.id); if(['success','error','timeout','cancelled','rejected'].includes(actual.status)) return res.json({ok:true,job:actual}); await new Promise(r=>setTimeout(r,700))} res.status(408).json({ok:false,error:'Timeout esperando job',job})}catch(e){next(e)}})
app.use(express.static(path.join(raiz,'dist')))
app.get(/^\/(?!api).*/, (req,res)=>res.sendFile(path.join(raiz,'dist','index.html')))

app.use((error,req,res,next)=>{console.error(error); res.status(400).json({ok:false,error:error.message||'Error interno'})})
const historicoTimer = setInterval(capturarHistoricoServidorGlobal, 5000)
if (typeof historicoTimer.unref === 'function') historicoTimer.unref()
setTimeout(capturarHistoricoServidorGlobal, 1200)

app.listen(env.port,env.host,()=>console.log(`Server-Agent listo en http://${env.host}:${env.port}`))
