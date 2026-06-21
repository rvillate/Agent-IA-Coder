import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Layout, navegar } from './componentes/Layout.jsx'
import { rutaActual } from './rutas/rutas.js'
import { Login } from './paginas/Login.jsx'
import { Registro } from './paginas/Registro.jsx'
import { token } from './servicios/api.js'

function LoadingGlobal({ loading }) {
  if (!loading.active) return null
  return <div className="global-loading-backdrop" aria-live="polite" aria-busy="true">
    <div className="global-loading-card">
      <span className="global-spinner"></span>
      <strong>{loading.message || 'Cargando...'}</strong>
      <small>Por favor espera</small>
    </div>
  </div>
}

export function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [loading, setLoading] = useState({ active: false, message: 'Cargando...' })
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    const onLoading = (event) => setLoading({ active: Boolean(event.detail?.active), message: event.detail?.message || 'Cargando...' })
    window.addEventListener('sa-global-loading', onLoading)
    return () => window.removeEventListener('sa-global-loading', onLoading)
  }, [])
  const autenticado = Boolean(token())
  useEffect(() => {
    if (!autenticado && !['/login','/registro'].includes(path)) navegar('/login')
    if (autenticado && ['/login','/registro'].includes(path)) navegar('/')
  }, [autenticado, path])

  if (!autenticado) {
    return <><AnimatePresence mode="wait"><motion.div key={path}>{path === '/registro' ? <Registro/> : <Login/>}</motion.div></AnimatePresence><LoadingGlobal loading={loading}/></>
  }
  const ruta = rutaActual(path)
  const Pantalla = ruta.componente
  return <><Layout ruta={ruta}><AnimatePresence mode="wait"><motion.div key={ruta.path} initial={{opacity:0,y:14}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} transition={{duration:.25}}><Pantalla/></motion.div></AnimatePresence></Layout><LoadingGlobal loading={loading}/></>
}
