import React, { useEffect, useMemo, useState } from 'react'
import { Activity, Cpu, HardDrive, MemoryStick, RefreshCw, Server } from 'lucide-react'
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useTranslation } from 'react-i18next'
import { Tarjeta, IconBox, Estado } from '../componentes/UI.jsx'
import { api } from '../servicios/api.js'

const MAX_HISTORIAL = 28

function clampPct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function formatoBytes(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const decimals = index === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(decimals)} ${units[index]}`
}

function formatoGb(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n <= 0) return '0 GB'
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function Sparkline({ data, dataKey = 'value' }) {
  return <div className="server-sparkline">
    <ResponsiveContainer width="100%" height={42}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <YAxis hide domain={[0, 100]} />
        <Area type="monotone" dataKey={dataKey} stroke="#2563eb" fill="#dbeafe" strokeWidth={2} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
}

function UsoBar({ value }) {
  const pct = clampPct(value)
  return <div className="server-usage-bar" aria-label={`Uso ${pct}%`}>
    <span style={{ width: `${pct}%` }} />
  </div>
}

function MetricCard({ icon, title, percent, main, detail, estado, tipo = 'green', history = [], children }) {
  const pct = clampPct(percent)
  return <Tarjeta className="mini server-metric-card">
    <IconBox>{icon}</IconBox>
    <div className="server-metric-body">
      <div className="server-metric-head"><span>{title}</span><strong>{pct}%</strong></div>
      <strong className="server-metric-main">{main}</strong>
      <small>{detail}</small>
      <Sparkline data={history} />
      {children}
      <Estado tipo={tipo}>{estado}</Estado>
    </div>
  </Tarjeta>
}

function JobsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const jobs = payload.find((item) => item.dataKey === 'jobs')?.value || 0
  const bytes = payload.find((item) => item.dataKey === 'bytes')?.value || 0
  return <div className="server-chart-tooltip">
    <strong>{label}</strong>
    <span>Jobs: {jobs}</span>
    <span>Transferencia: {formatoBytes(bytes)}</span>
  </div>
}

export function Servidor() {
  const { t } = useTranslation()
  const [metricas, setMetricas] = useState(null)
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  async function cargarMetricas(silencioso = false) {
    if (!silencioso) setCargando(true)
    try {
      const data = await api('/servidor/metricas?minutes=60', { silentLoading: true })
      setMetricas(data)
      setHistorial((actual) => {
        const muestra = {
          t: new Date(data.capturedAt || Date.now()).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
          cpu: clampPct(data.cpu?.usedPercent),
          memory: clampPct(data.memory?.usedPercent),
          disk: clampPct(data.disk?.usedPercent)
        }
        return [...actual, muestra].slice(-MAX_HISTORIAL)
      })
      setError('')
    } catch (e) {
      setError(e.message || 'Error cargando métricas del servidor')
    } finally {
      if (!silencioso) setCargando(false)
    }
  }

  useEffect(() => {
    cargarMetricas()
    const timer = setInterval(() => cargarMetricas(true), 5000)
    return () => clearInterval(timer)
  }, [])

  const cpuHistory = useMemo(() => historial.map((item) => ({ label: item.t, value: item.cpu })), [historial])
  const memoryHistory = useMemo(() => historial.map((item) => ({ label: item.t, value: item.memory })), [historial])
  const diskHistory = useMemo(() => historial.map((item) => ({ label: item.t, value: item.disk })), [historial])
  const jobsActivity = metricas?.jobsActivity || []
  const cpu = metricas?.cpu || {}
  const memory = metricas?.memory || {}
  const disk = metricas?.disk || {}

  return <>
    <Tarjeta className="page-head">
      <IconBox><Server /></IconBox>
      <div>
        <h1>{t('servidor.titulo')}</h1>
        <p>{t('servidor.subtitulo')}</p>
      </div>
      <button onClick={() => cargarMetricas()} disabled={cargando}><RefreshCw size={18}/>{t('comun.refrescar')}</button>
    </Tarjeta>

    {error && <Tarjeta className="alerta">{error}</Tarjeta>}

    <div className="stats-grid server-stats-grid">
      <MetricCard
        icon={<Cpu/>}
        title={t('servidor.cpu')}
        percent={cpu.usedPercent}
        main={`${cpu.cores || '—'} cores`}
        detail={`Load: ${Number.isFinite(Number(cpu.loadavg?.[0])) ? Number(cpu.loadavg[0]).toFixed(2) : '—'} · uso actual`}
        estado={t('servidor.loadEstable')}
        history={cpuHistory}
      />
      <MetricCard
        icon={<MemoryStick/>}
        title={t('servidor.memoria')}
        percent={memory.usedPercent}
        main={`${formatoGb(memory.usedBytes)} / ${formatoGb(memory.totalBytes)}`}
        detail={`${formatoGb(memory.freeBytes)} libres`}
        estado={t('servidor.disponible')}
        history={memoryHistory}
      />
      <MetricCard
        icon={<HardDrive/>}
        title={t('servidor.disco')}
        percent={disk.usedPercent}
        main={`${formatoGb(disk.usedBytes)} / ${formatoGb(disk.totalBytes)}`}
        detail={`${formatoGb(disk.freeBytes)} libres en ${disk.path || '/'}`}
        estado={`${clampPct(disk.usedPercent)}% ${t('servidor.usado')}`}
        tipo="yellow"
        history={diskHistory}
      >
        <div className="server-disk-progress-row"><span>0</span><UsoBar value={disk.usedPercent}/><span>100</span></div>
      </MetricCard>
      <MetricCard
        icon={<Activity/>}
        title={t('servidor.red')}
        percent={100}
        main={t('servidor.online')}
        detail={`Última muestra: ${historial.at(-1)?.t || '—'}`}
        estado={t('servidor.sshActivo')}
        tipo="purple"
        history={historial.map((item) => ({ label: item.t, value: 100 }))}
      />
    </div>

    <Tarjeta>
      <div className="server-chart-title">
        <div>
          <h2>{t('servidor.actividad')}</h2>
          <p>Jobs agrupados cada 60 segundos. La barra muestra cantidad de jobs y la línea superpuesta suma los bytes transferidos por minuto.</p>
        </div>
        <Estado tipo="blue">{jobsActivity.reduce((acc, item) => acc + Number(item.jobs || 0), 0)} jobs / 60 min</Estado>
      </div>
      <div className="chart server-activity-chart">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={jobsActivity} margin={{ top: 12, right: 24, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" minTickGap={24} />
            <YAxis yAxisId="jobs" allowDecimals={false} label={{ value: 'Jobs', angle: -90, position: 'insideLeft' }} />
            <YAxis yAxisId="bytes" orientation="right" tickFormatter={formatoBytes} width={78} label={{ value: 'Bytes', angle: 90, position: 'insideRight' }} />
            <Tooltip content={<JobsTooltip />} />
            <Bar yAxisId="jobs" dataKey="jobs" name="Jobs" barSize={14} fill="#2563eb" radius={[6, 6, 0, 0]} />
            <Line yAxisId="bytes" type="monotone" dataKey="bytes" name="Bytes" stroke="#7c3aed" strokeWidth={3} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Tarjeta>
  </>
}
