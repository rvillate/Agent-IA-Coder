import React, { useEffect, useState } from 'react'
import { Activity, Clock3, Code2, FolderOpen, KeyRound, Server, ShieldCheck } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Tarjeta, IconBox, Estado } from '../componentes/UI.jsx'
import { navegar } from '../componentes/Layout.jsx'
import { cuentaActual, runnersDisponibles } from '../servicios/api.js'

function Mini({icon, title, value, tipo='green', estado}) { return <Tarjeta className="mini"><IconBox>{icon}</IconBox><div><span>{title}</span><strong>{value}</strong><Estado tipo={tipo}>{estado}</Estado></div></Tarjeta> }

export function Inicio() {
  const { t } = useTranslation()
  const cuenta = cuentaActual()
  const runnerSeleccionado = localStorage.getItem('sa_runner') || 'master-server'
  const [runnerInfo, setRunnerInfo] = useState(null)
  const [totalRunners, setTotalRunners] = useState(0)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      try {
        const data = await runnersDisponibles()
        const items = data.items || []
        if (!cancelado) {
          setTotalRunners(items.length)
          setRunnerInfo(items.find((r) => r.id === runnerSeleccionado) || null)
        }
      } catch {
        if (!cancelado) {
          setRunnerInfo(null)
          setTotalRunners(0)
        }
      }
    }
    cargar()
    return () => { cancelado = true }
  }, [runnerSeleccionado])

  const estadoRunner = runnerInfo?.status === 'online' ? t('menu.online') : t('menu.offline')
  const tipoRunner = runnerInfo?.status === 'online' ? 'green' : ''

  return <motion.div key="home" initial={{opacity:0,y:18}} animate={{opacity:1,y:0}}>
    <Tarjeta className="hero">
      <div><p className="eyebrow">{t('inicio.eyebrow')}</p><h1>{t('inicio.titulo')}</h1><p>{t('inicio.subtitulo')}</p></div>
      <motion.div className="hero-art" animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 4 }}><Server size={96}/><ShieldCheck size={82}/></motion.div>
    </Tarjeta>
    <div className="stats-grid">
      <Mini icon={<Server/>} title={t('inicio.runnerSeleccionado')} value={runnerSeleccionado} estado={estadoRunner} tipo={tipoRunner} />
      <Mini icon={<KeyRound/>} title={t('inicio.gatewayId')} value={cuenta?.gateway_id || '—'} estado={t('inicio.configurada')} />
      <Mini icon={<Activity/>} title={t('inicio.estadoApi')} value={`${totalRunners} runners`} estado={totalRunners ? t('comun.disponible') || 'Disponible' : t('comun.sinDatos') || 'Sin datos'} tipo={totalRunners ? 'green' : 'purple'} />
      <Mini icon={<Clock3/>} title={t('inicio.ultimaActividad')} value={runnerInfo?.lastSeen ? new Date(runnerInfo.lastSeen).toLocaleString() : '—'} estado={runnerInfo?.hostname || t('inicio.sinActividad')} tipo="yellow" />
    </div>
    <Tarjeta><h2>{t('inicio.accionesRapidas')}</h2><div className="quick-grid">
      <button className="quick" onClick={() => navegar('/test-apis')}><Code2/><span><strong>{t('inicio.probarApi')}</strong><small>{t('inicio.probarApiDesc')}</small></span><i>→</i></button>
      <button className="quick" onClick={() => navegar('/file-explorer')}><FolderOpen/><span><strong>{t('inicio.abrirExplorer')}</strong><small>{t('inicio.abrirExplorerDesc')}</small></span><i>→</i></button>
      <button className="quick" onClick={() => navegar('/servidor')}><Server/><span><strong>{t('inicio.verServidor')}</strong><small>{t('inicio.verServidorDesc')}</small></span><i>→</i></button>
      <button className="quick" onClick={() => navegar('/servicios-admin')}><ShieldCheck/><span><strong>{t('inicio.serviciosAdmin')}</strong><small>{t('inicio.serviciosAdminDesc')}</small></span><i>→</i></button>
    </div></Tarjeta>
  </motion.div>
}
