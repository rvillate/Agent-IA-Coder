import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Clock3, Globe2, KeyRound, LogOut, Search, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { rutasPrivadas } from '../rutas/rutas.js'
import { cerrarSesion, cuentaActual, runnersDisponibles } from '../servicios/api.js'


function leerUsoRunners() {
  try { return JSON.parse(localStorage.getItem('sa_runner_uso') || '{}') } catch { return {} }
}

function registrarUsoRunner(runnerId) {
  const id = String(runnerId || '').trim()
  if (!id) return
  const uso = leerUsoRunners()
  uso[id] = Date.now()
  localStorage.setItem('sa_runner_uso', JSON.stringify(uso))
}

function normalizarListaRunners(items = []) {
  const mapa = new Map()
  for (const item of items) {
    const id = String(item?.id || item?.runnerId || '').trim()
    if (!id) continue
    mapa.set(id, { ...item, id, status: item.status || item.estado || 'offline' })
  }
  return [...mapa.values()]
}

function idiomaCorto(valor) {
  return String(valor || 'es').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'es'
}

export function navegar(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function Layout({ ruta, children }) {
  const { t, i18n } = useTranslation()
  const [runner, setRunner] = useState(localStorage.getItem('sa_runner') || 'master-server')
  const [listaRunners, setListaRunners] = useState([])
  const [busquedaRunner, setBusquedaRunner] = useState('')
  const [cargandoRunners, setCargandoRunners] = useState(false)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [idioma, setIdioma] = useState(idiomaCorto(i18n.language || localStorage.getItem('sa_idioma') || 'es'))
  const menuRef = useRef(null)
  const cuenta = cuentaActual()
  const gatewayId = cuenta?.gateway_id || localStorage.getItem('sa_gateway_id') || 'sin-id'

  useEffect(() => {
    localStorage.setItem('sa_runner', runner)
    registrarUsoRunner(runner)
  }, [runner])

  useEffect(() => {
    const handler = (lng) => setIdioma(idiomaCorto(lng))
    i18n.on('languageChanged', handler)
    return () => i18n.off('languageChanged', handler)
  }, [i18n])


  useEffect(() => {
    if (!menuAbierto) return
    let cancelado = false
    async function cargarRunners() {
      setCargandoRunners(true)
      try {
        const data = await runnersDisponibles()
        if (!cancelado) setListaRunners(normalizarListaRunners(data.items || []))
      } catch {
        if (!cancelado) setListaRunners((actual) => normalizarListaRunners(actual.length ? actual : [{ id: runner, status: 'offline' }]))
      } finally {
        if (!cancelado) setCargandoRunners(false)
      }
    }
    cargarRunners()
    return () => { cancelado = true }
  }, [menuAbierto, runner])

  const runnersOrdenados = useMemo(() => {
    const uso = leerUsoRunners()
    const texto = busquedaRunner.trim().toLowerCase()
    return normalizarListaRunners(listaRunners.length ? listaRunners : [{ id: runner, status: 'offline' }])
      .filter((item) => !texto || [item.id, item.hostname, item.platform, item.workspaceRoot].filter(Boolean).join(' ').toLowerCase().includes(texto))
      .sort((a, b) => {
        const ao = a.status === 'online' ? 0 : 1
        const bo = b.status === 'online' ? 0 : 1
        return ao - bo || Number(uso[b.id] || 0) - Number(uso[a.id] || 0) || a.id.localeCompare(b.id)
      })
  }, [listaRunners, busquedaRunner, runner])

  function seleccionarRunner(runnerId) {
    setRunner(runnerId)
    registrarUsoRunner(runnerId)
  }

  useEffect(() => {
    function cerrarPorClick(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuAbierto(false)
    }
    function cerrarPorEscape(event) {
      if (event.key === 'Escape') setMenuAbierto(false)
    }
    document.addEventListener('mousedown', cerrarPorClick)
    document.addEventListener('keydown', cerrarPorEscape)
    return () => {
      document.removeEventListener('mousedown', cerrarPorClick)
      document.removeEventListener('keydown', cerrarPorEscape)
    }
  }, [])

  function salir() {
    cerrarSesion()
    setMenuAbierto(false)
    navegar('/login')
  }

  async function cambiarIdioma() {
    const siguiente = idioma === 'es' ? 'en' : 'es'
    localStorage.setItem('sa_idioma', siguiente)
    await i18n.changeLanguage(siguiente)
    setIdioma(siguiente)
  }

  return <div>
    <nav className="topbar">
      <button className="brand" onClick={() => navegar('/')}>
        <span>SA</span>
        <div><strong>{t('marca.nombre')}</strong><small>{t('marca.consola')}</small></div>
      </button>
      <div className="navlinks">
        {rutasPrivadas.map(({ path, id, icon: Icon }) => <button key={path} onClick={() => navegar(path)} className={ruta.path === path ? 'active' : ''}><Icon size={16}/>{t(`nav.${id}`)}</button>)}
      </div>
      <div className="user-menu" ref={menuRef}>
        <button className="avatar-button" onClick={() => setMenuAbierto((v) => !v)} aria-expanded={menuAbierto} aria-haspopup="menu">
          <span className="avatar">{idioma.toUpperCase()}</span>
          <ChevronDown size={13} className={menuAbierto ? 'rotate' : ''}/>
        </button>
        {menuAbierto && <div className="avatar-menu" role="menu">
          <div className="menu-section-title">{t('comun.configuracionActual')}</div>
          <label className="menu-field"><KeyRound size={16}/><span><small>{t('menu.gatewayId')}</small><input value={gatewayId} readOnly title={gatewayId}/></span></label>
          <div className="menu-field runner-select-field">
            <Server size={16}/>
            <span>
              <small>{t('menu.runner')}</small>
              <div className="runner-selected" title={runner}>{runner}</div>
              <div className="runner-search"><Search size={13}/><input value={busquedaRunner} onChange={(e) => setBusquedaRunner(e.target.value)} placeholder={t('menu.buscarRunner')} /></div>
              <div className="runner-options" role="listbox">
                {cargandoRunners && <div className="runner-empty">{t('comun.cargando')}</div>}
                {!cargandoRunners && runnersOrdenados.length === 0 && <div className="runner-empty">{t('menu.sinRunners')}</div>}
                {runnersOrdenados.map((item) => <button key={item.id} type="button" className={`runner-option ${item.id === runner ? 'selected' : ''}`} onClick={() => seleccionarRunner(item.id)}>
                  <span className={`runner-dot ${item.status === 'online' ? 'online' : 'offline'}`}></span>
                  <span className="runner-main"><strong>{item.id}</strong><small>{item.hostname || item.platform || item.workspaceRoot || item.source || '—'}</small></span>
                  <em>{item.status === 'online' ? t('menu.online') : t('menu.offline')}</em>
                </button>)}
              </div>
            </span>
          </div>
          <button className="menu-action" onClick={cambiarIdioma}><Globe2 size={16}/><span>{t('comun.idioma')}</span><strong>{idioma.toUpperCase()}</strong></button>
          <button className="menu-action" disabled><Check size={16}/><span>{t('comun.conexion')}</span><strong>{t('comun.estable')}</strong></button>
          <div className="menu-separator" />
          <button className="menu-action danger" onClick={salir}><LogOut size={16}/><span>{t('comun.salir')}</span></button>
        </div>}
      </div>
    </nav>
    <main className="shell">{children}</main>
    <footer><span>{t('marca.consola')}</span><span>·</span><span>{t('comun.version')} 0.1.0</span><b></b><span className="ok-dot"></span><span>{t('menu.conexionEstable')}</span><span>·</span><Clock3 size={14}/><span>{new Date().toLocaleString()}</span></footer>
  </div>
}
