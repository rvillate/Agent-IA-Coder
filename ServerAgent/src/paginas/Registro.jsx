import React, { useState } from 'react'
import { Copy, LogIn, Server, ShieldCheck, UserPlus } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { guardarSesion, registrar } from '../servicios/api.js'
import { navegar } from '../componentes/Layout.jsx'

export function Registro() {
  const { t } = useTranslation()
  const [form, setForm] = useState({ nombre: '', email: '', password: '' })
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function crear(e) {
    e.preventDefault()
    setError('')
    setCargando(true)
    try {
      const data = await registrar(form)
      guardarSesion(data)
      setResultado(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }
  const copiar = (texto) => navigator.clipboard?.writeText(texto)

  return <main className="auth-page">
    <motion.section className="auth-card wide-auth" initial={{opacity:0, y:20}} animate={{opacity:1, y:0}}>
      <div className="auth-brand"><span>SA</span><div><strong>{t('marca.nombre')}</strong><small>{t('marca.consola')}</small></div></div>
      <p className="eyebrow">{t('auth.nuevoGateway')}</p>
      <h1>{t('auth.crearCuenta')}</h1>
      <p className="auth-sub">{t('auth.registroSub')}</p>
      {!resultado ? <form onSubmit={crear} className="auth-form">
        <label>{t('comun.nombre')}<input value={form.nombre} onChange={(e) => setForm({...form, nombre: e.target.value})} required autoFocus /></label>
        <label>{t('comun.email')}<input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} required /></label>
        <label>{t('comun.password')}<input type="password" value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} required minLength={6} /></label>
        {error && <div className="alerta">{error}</div>}
        <button className="primary" disabled={cargando}><UserPlus size={18}/>{cargando ? t('auth.creando') : t('auth.crearCuenta')}</button>
      </form> : <div className="credenciales">
        <h2>{t('auth.cuentaCreada')}</h2>
        {[[t('menu.gatewayId'), resultado.gatewayId], [t('auth.apiKey'), resultado.apiKey], [t('auth.runnerKey'), resultado.runnerKey]].map(([k, v]) => <div className="secret-row" key={k}><span><small>{k}</small><code>{v}</code></span><button onClick={() => copiar(v)}><Copy size={16}/>{t('comun.copiar')}</button></div>)}
        <button className="primary" onClick={() => navegar('/')}><LogIn size={18}/>{t('auth.entrarConsola')}</button>
      </div>}
      <button className="link-button" onClick={() => navegar('/login')}>{t('auth.yaTengoCuenta')}</button>
    </motion.section>
    <motion.aside className="auth-visual" animate={{y:[0,-10,0]}} transition={{repeat:Infinity,duration:4}}>
      <Server size={110}/><ShieldCheck size={84}/><h2>{t('auth.idUnicoGateway')}</h2><p>{t('auth.idUnicoSub')}</p>
    </motion.aside>
  </main>
}
