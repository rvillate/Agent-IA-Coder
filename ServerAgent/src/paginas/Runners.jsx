import React, { useEffect, useMemo, useState } from 'react'
import { Activity, Ban, ChevronLeft, ChevronRight, Clock3, Eye, Globe2, RefreshCw, Search, Server, X } from 'lucide-react'
import { cancelarJob, jobsPorRunner, obtenerJob, runnersDisponibles } from '../servicios/api.js'

const PAGE_SIZE = 15
const JOBS_PAGE_SIZE_DEFAULT = 15
const JOBS_PAGE_SIZE_OPTIONS = [15, 30, 50, 100]
const TERMINALES = new Set(['success', 'error', 'timeout', 'cancelled', 'rejected'])

function estadoClase(estado = '') {
  if (estado === 'online' || estado === 'success') return 'green'
  if (estado === 'running' || estado === 'queued' || estado === 'needs_approval' || estado === 'cancel_requested') return 'yellow'
  if (estado === 'error' || estado === 'timeout' || estado === 'cancelled' || estado === 'rejected' || estado === 'offline') return 'orange'
  return 'blue'
}

function normalizarRunners(items = []) {
  const mapa = new Map()
  for (const item of items) {
    const id = String(item?.id || item?.runnerId || item?.runner_id || '').trim()
    if (!id) continue
    mapa.set(id, { ...item, id, status: item.status || item.estado || item.lastStatus || 'offline' })
  }
  return [...mapa.values()].sort((a, b) => {
    const ao = a.status === 'online' ? 0 : 1
    const bo = b.status === 'online' ? 0 : 1
    return ao - bo || a.id.localeCompare(b.id)
  })
}

function formatoFecha(valor) {
  if (!valor) return '—'
  const n = Number(valor)
  const fecha = Number.isFinite(n) ? new Date(n) : new Date(valor)
  return Number.isNaN(fecha.getTime()) ? '—' : fecha.toLocaleString()
}


function formatoBytes(valor) {
  const n = Number(valor || 0)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const unidades = ['B', 'KB', 'MB', 'GB']
  let size = n
  let i = 0
  while (size >= 1024 && i < unidades.length - 1) {
    size /= 1024
    i += 1
  }
  const decimales = i === 0 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(decimales)} ${unidades[i]}`
}

function formatoDuracion(job = {}) {
  const inicio = Number(job.startedAt || job.iniciado_en || 0)
  const fin = Number(job.finishedAt || job.terminado_en || 0)
  if (!inicio) return '—'
  const ms = Math.max(0, (fin || Date.now()) - inicio)
  const s = Math.floor(ms / 1000)
  const min = Math.floor(s / 60)
  const rem = s % 60
  return min ? `${min}m ${rem}s` : `${rem}s`
}

function JsonBlock({ value }) {
  if (value === undefined || value === null || value === '') return <pre>—</pre>
  const texto = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return <pre>{texto}</pre>
}

function Stat({ label, value }) {
  return <div className="runner-stat"><small>{label}</small><strong title={String(value ?? '—')}>{value ?? '—'}</strong></div>
}

function browserPreviewsDeRunner(runner) {
  const directas = runner?.browserPreviews
  const metricas = runner?.metrics?.browserPreviews
  const lista = Array.isArray(directas) ? directas : Array.isArray(metricas) ? metricas : []
  return lista.filter(Boolean)
}

function BrowserPreviewCard({ preview }) {
  const img = preview?.screenshot?.base64
    ? `data:${preview.screenshot.mimeType || 'image/jpeg'};base64,${preview.screenshot.base64}`
    : ''
  return <article className="browser-preview-card">
    <div className="browser-preview-head">
      <div>
        <strong title={preview.title || preview.url || preview.sessionId}>{preview.title || 'Página sin título'}</strong>
        <small title={preview.url || ''}><Globe2 size={12}/> {preview.url || 'about:blank'}</small>
      </div>
      <span className={`pill ${preview.active === false ? 'orange' : 'green'}`}>{preview.active === false ? 'Sin captura' : 'Live'}</span>
    </div>
    <div className="browser-preview-frame">
      {img ? <img src={img} alt={`Preview browser ${preview.sessionId}`} /> : <div className="browser-preview-empty"><Eye size={28}/><span>{preview.error || 'Sin imagen disponible todavía'}</span></div>}
    </div>
    <div className="browser-preview-meta">
      <span>Sesión: <code>{preview.sessionId || 'default'}</code></span>
      <span>Captura: {formatoFecha(preview.capturedAt)}</span>
    </div>
  </article>
}


export function Runners() {
  const [runners, setRunners] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [runnerSeleccionado, setRunnerSeleccionado] = useState('')
  const [jobs, setJobs] = useState([])
  const [jobsPagina, setJobsPagina] = useState(1)
  const [jobsPageSize, setJobsPageSize] = useState(JOBS_PAGE_SIZE_DEFAULT)
  const [jobDetalle, setJobDetalle] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [cargandoJobs, setCargandoJobs] = useState(false)
  const [error, setError] = useState('')
  const [actualizado, setActualizado] = useState(null)

  async function cargarRunners(silencioso = false) {
    if (!silencioso) setCargando(true)
    try {
      const data = await runnersDisponibles({ silentLoading: true })
      const lista = normalizarRunners(data.items || [])
      setRunners(lista)
      setError('')
      setRunnerSeleccionado((actual) => actual || lista[0]?.id || '')
      setActualizado(Date.now())
    } catch (e) {
      setError(e.message || 'Error cargando runners')
    } finally {
      if (!silencioso) setCargando(false)
    }
  }

  async function cargarJobs(runnerId = runnerSeleccionado) {
    if (!runnerId) return
    setCargandoJobs(true)
    try {
      const data = await jobsPorRunner(runnerId, 200)
      setJobs(data.items || [])
      setActualizado(Date.now())
      if (jobDetalle?.id) {
        const detalle = await obtenerJob(jobDetalle.id)
        setJobDetalle(detalle.job || detalle)
      }
    } catch (e) {
      setError(e.message || 'Error cargando jobs')
    } finally {
      setCargandoJobs(false)
    }
  }

  useEffect(() => { cargarRunners() }, [])

  useEffect(() => {
    if (!runnerSeleccionado) return
    cargarJobs(runnerSeleccionado)
    const timer = setInterval(() => {
      cargarRunners(true)
      cargarJobs(runnerSeleccionado)
    }, 2000)
    return () => clearInterval(timer)
  }, [runnerSeleccionado])

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return runners.filter((runner) => !texto || [runner.id, runner.status].join(' ').toLowerCase().includes(texto))
  }, [runners, busqueda])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE))
  const paginaSegura = Math.min(pagina, totalPaginas)
  const visibles = filtrados.slice((paginaSegura - 1) * PAGE_SIZE, paginaSegura * PAGE_SIZE)
  const runner = runners.find((item) => item.id === runnerSeleccionado) || null
  const totalJobsPaginas = Math.max(1, Math.ceil(jobs.length / jobsPageSize))
  const jobsPaginaSegura = Math.min(jobsPagina, totalJobsPaginas)
  const jobsVisibles = jobs.slice((jobsPaginaSegura - 1) * jobsPageSize, jobsPaginaSegura * jobsPageSize)
  const browserPreviews = useMemo(() => browserPreviewsDeRunner(runner), [runner])

  useEffect(() => { setPagina(1) }, [busqueda])
  useEffect(() => { setJobsPagina(1) }, [runnerSeleccionado, jobsPageSize])

  async function abrirJob(job) {
    try {
      const data = await obtenerJob(job.id)
      setJobDetalle(data.job || data)
    } catch (e) {
      setError(e.message || 'Error obteniendo job')
    }
  }

  async function cancelar(jobId) {
    if (!jobId) return
    try {
      const data = await cancelarJob(jobId)
      setJobDetalle(data.job || data)
      await cargarJobs(runnerSeleccionado)
    } catch (e) {
      setError(e.message || 'Error cancelando job')
    }
  }

  return <div className="runners-page">
    <section className="card page-head runners-head">
      <div className="icon-box"><Server/></div>
      <div>
        <p className="eyebrow">RUNNERS</p>
        <h1>Runners disponibles</h1>
        <p>Tarjetas de runners ordenadas con los online primero. Al seleccionar uno se muestran sus jobs en tiempo real.</p>
      </div>
      <div className="runner-head-actions">
        <label className="runner-search-main"><Search size={15}/><input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar runners..." /></label>
        <button onClick={() => { cargarRunners(); cargarJobs() }} disabled={cargando}><RefreshCw size={15}/> Refrescar</button>
      </div>
    </section>

    {error && <div className="card alerta runners-error">{error}</div>}

    <section className="card runners-card-wrap">
      <div className="runners-meta"><span>{filtrados.length} runner(s)</span><span>Última actualización: {formatoFecha(actualizado)}</span>{cargando && <span className="inline-refresh"><RefreshCw size={12}/> Actualizando</span>}</div>
      <div className="runner-card-grid">
        {visibles.map((item) => <button key={item.id} className={`runner-card ${item.id === runnerSeleccionado ? 'selected' : ''}`} onClick={() => { setRunnerSeleccionado(item.id); setJobDetalle(null); localStorage.setItem('sa_runner', item.id) }}>
          {item.id === runnerSeleccionado && (cargando || cargandoJobs) && <span className="runner-card-loading"><RefreshCw size={11}/> Live</span>}
          <strong title={item.id}>{item.id}</strong>
          <span className={`pill ${estadoClase(item.status)}`}>{item.status === 'online' ? 'Online' : item.status || 'Offline'}</span>
        </button>)}
        {!visibles.length && <div className="runner-empty-card">No hay runners para esta búsqueda.</div>}
      </div>
      <div className="runners-pagination">
        <button disabled={paginaSegura <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}><ChevronLeft size={15}/> Anterior</button>
        <span>Página {paginaSegura} de {totalPaginas}</span>
        <button disabled={paginaSegura >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>Siguiente <ChevronRight size={15}/></button>
      </div>
    </section>

    {runner && <section className="card runner-detail-card">
      <div className="runner-detail-title">
        <div><p className="eyebrow">RUNNER SELECCIONADO</p><h2>{runner.id}</h2></div>
        <span className={`pill ${estadoClase(runner.status)}`}>{runner.status || 'offline'}</span>
      </div>
      <div className="runner-stats-grid">
        <Stat label="Hostname" value={runner.hostname}/>
        <Stat label="Plataforma" value={runner.platform}/>
        <Stat label="Versión" value={runner.version}/>
        <Stat label="Última vez visto" value={formatoFecha(runner.lastSeen)}/>
        <Stat label="Max jobs" value={runner.maxConcurrentJobs}/>
        <Stat label="Jobs activos" value={Array.isArray(runner.activeJobs) ? runner.activeJobs.length : (runner.activeJobs || 0)}/>
        <Stat label="Workspace" value={runner.workspaceRoot}/>
        <Stat label="Capacidades" value={Array.isArray(runner.capabilities) ? runner.capabilities.length : 0}/>
      </div>
    </section>}

    {runner && browserPreviews.length > 0 && <section className="card browser-previews-card">
      <div className="runner-detail-title">
        <div><p className="eyebrow">BROWSER PREVIEW</p><h2>Vista en vivo del navegador</h2></div>
        <span className="pill blue"><Eye size={13}/> {browserPreviews.length} página(s)</span>
      </div>
      <p className="browser-preview-help">Estas capturas se actualizan con el heartbeat del runner mientras haya sesiones browser activas. Cada sesión abierta se muestra como una preview independiente.</p>
      <div className="browser-preview-grid">
        {browserPreviews.map((preview) => <BrowserPreviewCard key={preview.sessionId || preview.url || preview.capturedAt} preview={preview} />)}
      </div>
    </section>}

    {runner && <section className="card runner-jobs-card">
      <div className="runner-detail-title">
        <div><p className="eyebrow">JOBS EN TIEMPO REAL</p><h2>Jobs de {runner.id}</h2></div>
        <div className="runner-jobs-controls">
          {(cargandoJobs || cargando) && <span className="inline-refresh"><RefreshCw size={12}/> Actualizando</span>}
          <label>Mostrar <select value={jobsPageSize} onChange={(e) => setJobsPageSize(Number(e.target.value))}>{JOBS_PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <span className="pill blue"><Activity size={13}/> Actualiza cada 2s</span>
        </div>
      </div>
      <div className="runner-jobs-table-wrap">
        <table className="runner-jobs-table">
          <thead><tr><th>Fecha</th><th>ID</th><th>Tipo</th><th>Estado</th><th>Tiempo ejecución</th><th>Size</th><th>Exit</th><th>Resumen</th><th>Acciones</th></tr></thead>
          <tbody>
            {jobsVisibles.map((job) => <tr key={job.id} className={jobDetalle?.id === job.id ? 'selected-row' : ''} onClick={() => abrirJob(job)}>
              <td>{formatoFecha(job.createdAt)}</td>
              <td><code>{job.id}</code></td>
              <td>{job.type}</td>
              <td><span className={`pill ${estadoClase(job.status)}`}>{job.status}</span></td>
              <td><Clock3 size={13}/> {formatoDuracion(job)}</td>
              <td title={`${Number(job.transferSizeBytes || 0).toLocaleString()} bytes transferidos`}><strong>{formatoBytes(job.transferSizeBytes)}</strong></td>
              <td>{job.exitCode ?? '—'}</td>
              <td className="job-summary" title={job.summary || job.error || ''}>{job.summary || job.error || job.note || '—'}</td>
              <td><button className="danger-inline" disabled={TERMINALES.has(job.status)} onClick={(e) => { e.stopPropagation(); cancelar(job.id) }}><Ban size={13}/> Cancelar</button></td>
            </tr>)}
            {!jobs.length && <tr><td colSpan="9" className="table-empty">{cargandoJobs ? 'Actualizando jobs...' : 'Sin jobs para este runner'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="jobs-pagination">
        <span>Mostrando {jobs.length ? ((jobsPaginaSegura - 1) * jobsPageSize) + 1 : 0}-{Math.min(jobsPaginaSegura * jobsPageSize, jobs.length)} de {jobs.length}</span>
        <div>
          <button disabled={jobsPaginaSegura <= 1} onClick={() => setJobsPagina((p) => Math.max(1, p - 1))}><ChevronLeft size={15}/> Anterior</button>
          <strong>Página {jobsPaginaSegura} de {totalJobsPaginas}</strong>
          <button disabled={jobsPaginaSegura >= totalJobsPaginas} onClick={() => setJobsPagina((p) => Math.min(totalJobsPaginas, p + 1))}>Siguiente <ChevronRight size={15}/></button>
        </div>
      </div>
    </section>}

    {jobDetalle && <section className="card job-detail-card">
      <div className="runner-detail-title">
        <div><p className="eyebrow">DETALLE DEL JOB</p><h2>{jobDetalle.id}</h2></div>
        <div className="actions-row">
          <button className="danger-inline" disabled={TERMINALES.has(jobDetalle.status)} onClick={() => cancelar(jobDetalle.id)}><Ban size={14}/> Cancelar por admin</button>
          <button onClick={() => setJobDetalle(null)}><X size={14}/> Cerrar</button>
        </div>
      </div>
      <div className="runner-stats-grid compact">
        <Stat label="Estado" value={jobDetalle.status}/><Stat label="Tipo" value={jobDetalle.type}/><Stat label="Size transferencia" value={formatoBytes(jobDetalle.transferSizeBytes)}/><Stat label="Runner target" value={jobDetalle.runnerTarget}/><Stat label="Claimed by" value={jobDetalle.claimedBy}/>
        <Stat label="Creado" value={formatoFecha(jobDetalle.createdAt)}/><Stat label="Actualizado" value={formatoFecha(jobDetalle.updatedAt)}/><Stat label="Iniciado" value={formatoFecha(jobDetalle.startedAt)}/><Stat label="Terminado" value={formatoFecha(jobDetalle.finishedAt)}/>
      </div>
      <div className="job-json-grid">
        <div><h3>Payload</h3><JsonBlock value={jobDetalle.payload}/></div>
        <div><h3>Respuesta / Result</h3><JsonBlock value={jobDetalle.result}/></div>
        <div><h3>stdoutTail</h3><JsonBlock value={jobDetalle.stdoutTail}/></div>
        <div><h3>stderrTail / error</h3><JsonBlock value={jobDetalle.stderrTail || jobDetalle.error}/></div>
      </div>
    </section>}
  </div>
}
