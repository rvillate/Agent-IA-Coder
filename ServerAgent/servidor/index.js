import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import path from 'node:path'
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
async function responderHealth(req, res, next) {
  try {
    const db = await consulta('SELECT now() as ahora')
    res.json({ ok: true, service: 'Server-Agent', version: '0.1.0', time: Date.now(), dbTime: db.rows[0].ahora, port: env.port })
  } catch (e) { next(e) }
}

app.get('/api/health', responderHealth)
app.get('/health', responderHealth)

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
app.listen(env.port,env.host,()=>console.log(`Server-Agent listo en http://${env.host}:${env.port}`))
