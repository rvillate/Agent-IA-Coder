import React, { useState } from 'react'
import { Activity, LogIn, Server, UserPlus } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { login, guardarSesion } from '../servicios/api.js'
import { navegar } from '../componentes/Layout.jsx'

export function Login() {
  const { t } = useTranslation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setError('')
    setCargando(true)
    try {
      const data = await login(form)
      guardarSesion(data)
      navegar('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  return <main className="auth-page">
    <motion.section className="auth-card" initial={{opacity:0, y:20}} animate={{opacity:1, y:0}}>
      <div className="auth-brand"><span>SA</span><div><strong>{t('marca.nombre')}</strong><small>{t('marca.raspberry')}</small></div></div>
      <p className="eyebrow">{t('auth.accesoSeguro')}</p>
      <h1>{t('auth.iniciarSesion')}</h1>
      <p className="auth-sub">{t('auth.loginSub')}</p>
      <form onSubmit={entrar} className="auth-form">
        <label>{t('comun.email')}<input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} required autoFocus /></label>
        <label>{t('comun.password')}<input type="password" value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} required /></label>
        {error && <div className="alerta">{error}</div>}
        <button className="primary" disabled={cargando}><LogIn size={18}/>{cargando ? t('auth.entrando') : t('comun.entrar')}</button>
      </form>
      <button className="link-button" onClick={() => navegar('/registro')}><UserPlus size={18}/>{t('auth.crearCuentaNueva')}</button>
    </motion.section>
    <motion.aside className="auth-visual" animate={{y:[0,-10,0]}} transition={{repeat:Infinity,duration:4}}>
      <Server size={110}/><Activity size={84}/>
      <h2>{t('auth.controlCentralizado')}</h2><p>{t('auth.controlSub')}</p>
    </motion.aside>
  </main>
}
