import React, { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Calendar, CheckCircle2, ChevronDown, Clock3, Cpu, Database, Download, Gauge, HardDrive, Info, MemoryStick, Network, RefreshCw, Server, ShieldCheck, Terminal, Trash2, Users, X } from 'lucide-react'
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../servicios/api.js'

const RANGE_MINUTES = { '1H': 60, '3H': 180, '6H': 360, '12H': 720, '24H': 1440 }
const COLORS = ['#2563eb', '#7c3aed', '#f6bd38', '#a855f7']
const SPARK_POINTS = 10
const ACTIVITY_POINTS = 12

function pct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function bytes(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let index = 0
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1 }
  const decimals = index === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(decimals)} ${units[index]}`
}

function gb(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return '0 GB'
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function uptimeShort(seconds) {
  const total = Number(seconds || 0)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  return `${d}d ${h}h`
}

function formatDateTime(ts) {
  return new Date(ts || Date.now()).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function Spark({ data, color = '#2563eb', fill = '#dbeafe', bars = false }) {
  return <div className="srv-spark">
    <ResponsiveContainer width="100%" height={46}>
      {bars ? <ComposedChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <YAxis hide domain={[0, 100]} />
        <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </ComposedChart> : <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <YAxis hide domain={[0, 100]} />
        <Area type="monotone" dataKey="value" stroke={color} fill={fill} strokeWidth={2.2} isAnimationActive={false} />
      </AreaChart>}
    </ResponsiveContainer>
  </div>
}

function Pill({ type = 'green', children, icon }) {
  return <span className={`srv-pill ${type}`}>{icon}{children}</span>
}

function UsageBar({ value, color = 'blue' }) {
  return <div className="srv-progress"><span className={color} style={{ width: `${pct(value)}%` }} /></div>
}

function MetricCard({ icon, title, value, subtitle, badge, badgeType = 'green', percent, history, color, fill, bars, children }) {
  return <section className="srv-card srv-metric">
    <div className="srv-metric-top">
      <div className="srv-metric-title"><span>{icon}</span><b>{title}</b></div>
      <strong>{value}</strong>
    </div>
    {subtitle && <p>{subtitle}</p>}
    {children || <Spark data={history} color={color} fill={fill} bars={bars} />}
    {badge && <Pill type={badgeType}>{badge}</Pill>}
  </section>
}

function StatusIcon({ type }) {
  if (type === 'warn') return <AlertTriangle size={16} />
  if (type === 'info') return <Info size={16} />
  return <CheckCircle2 size={16} />
}

function JobsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const jobs = payload.find((item) => item.dataKey === 'jobs')?.value || 0
  const transfer = payload.find((item) => item.dataKey === 'bytes')?.value || 0
  return <div className="srv-tooltip"><b>{label}</b><span>Jobs: {jobs}</span><span>Bytes/min: {bytes(transfer)}</span></div>
}


function ServerModal({ modal, onClose }) {
  if (!modal) return null
  return <div className="srv-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="srv-modal-card" role="dialog" aria-modal="true" aria-labelledby="srv-modal-title">
      <div className="srv-modal-head">
        <div>
          <h2 id="srv-modal-title">{modal.title}</h2>
          {modal.subtitle && <p>{modal.subtitle}</p>}
        </div>
        <button className="srv-modal-close" type="button" onClick={onClose} aria-label="Cerrar modal"><X size={18}/></button>
      </div>
      {modal.content}
    </section>
  </div>
}

function ProcessIcon({ name }) {
  const n = String(name || '').toLowerCase()
  if (n.includes('postgres')) return <Database size={16} />
  if (n.includes('node')) return <Server size={16} />
  if (n.includes('ssh')) return <Terminal size={16} />
  return <Activity size={16} />
}

export function Servidor() {
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState('1H')
  const [modalType, setModalType] = useState(null)

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const minutes = RANGE_MINUTES[range] || 60
      const res = await api(`/servidor/metricas?minutes=${minutes}`, { silentLoading: true })
      setData(res)
      const historial = Array.isArray(res.resourceHistory) ? res.resourceHistory : []
      setHistory(historial.map((item) => ({
        label: item.label,
        cpu: pct(item.cpu),
        memory: pct(item.memory),
        disk: pct(item.disk),
        network: pct(item.network || 100),
        processes: pct(item.processes)
      })))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function limpiarHistorial() {
    if (!window.confirm('¿Limpiar el historial de métricas del servidor?')) return
    setLoading(true)
    try {
      await api('/servidor/metricas/historial', { method: 'DELETE', silentLoading: true })
      setHistory([])
      setData((actual) => actual ? { ...actual, resourceHistory: [] } : actual)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(() => load(true), 5000)
    return () => clearInterval(timer)
  }, [range])

  const cpu = data?.cpu || {}
  const memory = data?.memory || {}
  const disk = data?.disk || {}
  const processes = data?.processes || { total: 0, top: [] }
  const services = data?.services || []
  const events = data?.events || []
  const summary = data?.summary || {}
  const capturedAt = data?.capturedAt || Date.now()
  const lastHourJobs = (data?.jobsActivity || []).reduce((acc, item) => acc + Number(item.jobs || 0), 0)
  const resourceData = [
    { name: 'CPU', value: pct(cpu.usedPercent) },
    { name: 'Memoria', value: pct(memory.usedPercent) },
    { name: 'Disco', value: pct(disk.usedPercent) },
    { name: 'Red', value: 100 }
  ]
  const h = (key) => history.slice(-SPARK_POINTS).map((item) => ({ label: item.label, value: item[key] }))
  const activityData = (data?.jobsActivity || []).slice(-ACTIVITY_POINTS)
  const modal = useMemo(() => {
    if (modalType === 'processes') {
      const rows = processes.top || []
      return {
        title: 'Todos los procesos principales',
        subtitle: `${rows.length} procesos reportados en la última medición.`,
        content: <div className="srv-modal-table-wrap"><table className="srv-modal-table"><thead><tr><th>Proceso</th><th>CPU</th><th>Memoria</th><th>Estado</th></tr></thead><tbody>{rows.length ? rows.map((p, i) => <tr key={`${p.name}-${i}`}><td><span className="srv-proc-icon">{ProcessIcon({ name: p.name })}</span>{p.name || '—'}</td><td>{Number(p.cpuPercent || 0).toFixed(1)}%</td><td>{bytes(p.memoryBytes)}</td><td><Pill type="green">Activo</Pill></td></tr>) : <tr><td colSpan="4" className="srv-empty-cell">Sin procesos para mostrar.</td></tr>}</tbody></table></div>
      }
    }
    if (modalType === 'events') {
      return {
        title: 'Todos los eventos recientes',
        subtitle: `${events.length} eventos reportados por el servidor.`,
        content: <div className="srv-modal-list">{events.length ? events.map((event, i) => <div className={`srv-modal-event ${event.type}`} key={i}><span>{StatusIcon({ type: event.type })}</span><div><b>{event.title || 'Evento'}</b><small>{event.time || '—'}</small></div></div>) : <p className="srv-empty-cell">Sin eventos para mostrar.</p>}</div>
      }
    }
    if (modalType === 'services') {
      return {
        title: 'Todos los servicios del sistema',
        subtitle: `${services.length} servicios detectados en el servidor.`,
        content: <div className="srv-modal-service-grid">{services.length ? services.map((service, i) => <div className="srv-modal-service" key={`${service.name}-${i}`}><span>{i % 3 === 0 ? <ShieldCheck size={16}/> : i % 3 === 1 ? <Database size={16}/> : <Terminal size={16}/>}<b>{service.name || '—'}</b></span><Pill type="green">Activo</Pill></div>) : <p className="srv-empty-cell">Sin servicios para mostrar.</p>}</div>
      }
    }
    return null
  }, [modalType, processes.top, events, services])

  return <div className="srv-dashboard">
    <div className="srv-header">
      <div className="srv-title-block">
        <div className="srv-title-icon"><Server size={30}/></div>
        <div><h1>Servidor</h1><p>Resumen de CPU, memoria, disco, red y procesos principales.</p></div>
      </div>
      <div className="srv-actions">
        <button onClick={() => load()} disabled={loading}><RefreshCw size={16}/>Actualizar</button>
        <button onClick={limpiarHistorial} disabled={loading} title="Limpia la tabla histórica de métricas del servidor"><Trash2 size={16}/>Limpiar historial</button>
        <button><Clock3 size={16}/>Última hora<ChevronDown size={14}/></button>
        <button><Download size={16}/>Exportar<ChevronDown size={14}/></button>
      </div>
    </div>

    <div className="srv-status-row">
      <Pill type="green"><span className="srv-dot"/>Online</Pill>
      <Pill type="purple"><Terminal size={14}/>SSH activo</Pill>
      <Pill type="soft"><Clock3 size={14}/>Última actualización: {formatDateTime(capturedAt)}</Pill>
    </div>

    <div className="srv-metric-grid">
      <MetricCard icon={<Cpu/>} title="CPU" value={`${pct(cpu.usedPercent)}%`} subtitle={`${cpu.cores || 0} cores · Load: ${Number(cpu.loadavg?.[0] || 0).toFixed(2)} · uso actual`} badge="Load estable" history={h('cpu')} color="#2563eb" fill="#dbeafe" />
      <MetricCard icon={<MemoryStick/>} title="Memoria" value={`${pct(memory.usedPercent)}%`} subtitle={`${gb(memory.usedBytes)} / ${gb(memory.totalBytes)} · ${gb(memory.freeBytes)} libres`} badge="Disponible" history={h('memory')} color="#2563eb" fill="#dbeafe">
        <UsageBar value={memory.usedPercent} />
      </MetricCard>
      <MetricCard icon={<HardDrive/>} title="Disco" value={`${pct(disk.usedPercent)}%`} subtitle={`${gb(disk.usedBytes)} / ${gb(disk.totalBytes)} · ${gb(disk.freeBytes)} libres`} badge={`${pct(disk.usedPercent)}% usado`} badgeType="yellow" history={h('disk')} color="#7c3aed" fill="#ede9fe">
        <UsageBar value={disk.usedPercent} color="purple" />
      </MetricCard>
      <MetricCard icon={<Network/>} title="Red" value="100%" subtitle="Online · Última muestra activa" badge="SSH activo" badgeType="purple" history={h('network')} color="#a855f7" fill="#f3e8ff" />
      <section className="srv-card srv-uptime">
        <div className="srv-metric-title"><span><Gauge size={18}/></span><b>Uptime</b></div>
        <strong>{uptimeShort(data?.uptime?.seconds)}</strong>
        <p>Desde el {formatDateTime(data?.uptime?.since)}</p>
        <div className="srv-flat-meter"><div><span>Disponibilidad</span><b>99.61%</b></div><UsageBar value={99.61}/></div>
      </section>
      <MetricCard icon={<Users/>} title="Procesos activos" value={processes.total || 0} subtitle={`+${Math.max(1, Math.round(lastHourJobs / 6))} desde la última hora`} badge="Normal" history={h('processes')} color="#2563eb" bars />
    </div>

    <div className="srv-main-grid">
      <section className="srv-card srv-activity">
        <div className="srv-section-head">
          <div><h2>Actividad del servidor</h2><p>Últimas 12 mediciones de 60 segundos: jobs por minuto y bytes transferidos.</p></div>
          <div className="srv-tabs">{['1H','3H','6H','12H','24H'].map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>)}<button><Calendar size={14}/></button></div>
        </div>
        <div className="srv-legend"><span><i className="blue"/>Jobs por minuto</span><span><i className="purple"/>Bytes transferidos por minuto</span></div>
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart data={activityData} margin={{ top: 10, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6edf7" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={3} minTickGap={32} />
            <YAxis yAxisId="jobs" hide allowDecimals={false} />
            <YAxis yAxisId="bytes" hide orientation="right" tickFormatter={bytes} />
            <Tooltip content={<JobsTooltip />} />
            <Bar yAxisId="jobs" dataKey="jobs" fill="#2563eb" radius={[5, 5, 0, 0]} barSize={14} />
            <Line yAxisId="bytes" type="monotone" dataKey="bytes" stroke="#7c3aed" strokeWidth={2.4} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      <section className="srv-card srv-processes">
        <div className="srv-section-head small"><h2>Procesos principales</h2><button className="srv-view-all" type="button" onClick={() => setModalType('processes')}>Ver todos</button></div>
        <table><thead><tr><th>Proceso</th><th>CPU</th><th>Memoria</th><th>Estado</th></tr></thead><tbody>{(processes.top || []).map((p, i) => <tr key={`${p.name}-${i}`}><td><span className="srv-proc-icon">{ProcessIcon({ name: p.name })}</span>{p.name}</td><td>{Number(p.cpuPercent || 0).toFixed(1)}%</td><td>{bytes(p.memoryBytes)}</td><td><Pill type="green">Activo</Pill></td></tr>)}</tbody></table>
      </section>

      <section className="srv-card srv-events">
        <div className="srv-section-head small"><h2>Eventos recientes</h2><button className="srv-view-all" type="button" onClick={() => setModalType('events')}>Ver todos</button></div>
        <div className="srv-event-list">{events.map((event, i) => <div className={`srv-event ${event.type}`} key={i}><span>{StatusIcon({ type: event.type })}</span><b>{event.title}</b><small>{event.time}</small></div>)}</div>
        <button className="srv-link-button" type="button" onClick={() => setModalType('events')}>Ver todos los eventos →</button>
      </section>
    </div>

    <div className="srv-bottom-grid">
      <section className="srv-card srv-distribution">
        <h2>Distribución del uso de recursos</h2>
        <div className="srv-dist-content flat"><div className="srv-dist-bars">{resourceData.map((item, i) => <div key={item.name}><span><i style={{ background: COLORS[i] }}/>{item.name}</span><b>{item.value}%</b><UsageBar value={item.value} color={i === 1 || i === 3 ? 'purple' : i === 2 ? 'yellow' : 'blue'} /></div>)}</div></div>
      </section>

      <section className="srv-card srv-services">
        <div className="srv-section-head small"><h2>Servicios del sistema</h2><button className="srv-view-all" type="button" onClick={() => setModalType('services')}>Ver todos</button></div>
        <div className="srv-service-grid">{services.slice(0, 6).map((service, i) => <div key={service.name}><span>{i % 3 === 0 ? <ShieldCheck size={16}/> : i % 3 === 1 ? <Database size={16}/> : <Terminal size={16}/>}<b>{service.name}</b></span><Pill type="green">Activo</Pill></div>)}</div>
      </section>

      <section className="srv-card srv-summary">
        <h2>Resumen rápido</h2>
        <dl><dt>IP del servidor</dt><dd>{summary.ip || '—'}</dd><dt>SO</dt><dd>{summary.os || '—'}</dd><dt>Kernel</dt><dd>{summary.kernel || '—'}</dd><dt>Arquitectura</dt><dd>{summary.arch || '—'}</dd></dl>
      </section>
    </div>
    <ServerModal modal={modal} onClose={() => setModalType(null)} />
  </div>
}
