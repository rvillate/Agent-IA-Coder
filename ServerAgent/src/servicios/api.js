const base = '/api'
let loadingCount = 0

function emitirLoading(message = 'Cargando...') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('sa-global-loading', { detail: { active: loadingCount > 0, count: loadingCount, message } }))
}

function iniciarLoading(message) {
  loadingCount += 1
  emitirLoading(message)
}

function terminarLoading(message) {
  loadingCount = Math.max(0, loadingCount - 1)
  emitirLoading(message)
}

export function token() { return localStorage.getItem('sa_token') || '' }
export function apiKey() { return localStorage.getItem('sa_api_key') || '' }
export function cuentaActual() {
  try { return JSON.parse(localStorage.getItem('sa_cuenta') || 'null') } catch { return null }
}
export function guardarSesion({ token: t, cuenta, apiKey: k, runnerKey, gatewayId }) {
  if (t) localStorage.setItem('sa_token', t)
  if (k) localStorage.setItem('sa_api_key', k)
  if (runnerKey) localStorage.setItem('sa_runner_key', runnerKey)
  if (gatewayId) localStorage.setItem('sa_gateway_id', gatewayId)
  if (cuenta) localStorage.setItem('sa_cuenta', JSON.stringify(cuenta))
}
export function cerrarSesion() {
  localStorage.removeItem('sa_token')
  localStorage.removeItem('sa_api_key')
  localStorage.removeItem('sa_runner_key')
  localStorage.removeItem('sa_gateway_id')
  localStorage.removeItem('sa_cuenta')
}
function headers(body = false) {
  const h = {}
  const t = token()
  const k = apiKey()
  if (t) h.authorization = `Bearer ${t}`
  if (k) h['x-agent-key'] = k
  if (body) h['content-type'] = 'application/json'
  return h
}
export async function api(path, options = {}) {
  const { loadingMessage = 'Cargando...', silentLoading = false, ...fetchOptions } = options
  if (!silentLoading) iniciarLoading(loadingMessage)
  try {
    const r = await fetch(`${base}${path}`, { ...fetchOptions, headers: { ...headers(Boolean(fetchOptions.body)), ...(fetchOptions.headers || {}) } })
    const text = await r.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }
    if (!r.ok) throw new Error(typeof data === 'object' ? (data.error || JSON.stringify(data, null, 2)) : String(data))
    return data
  } finally {
    if (!silentLoading) terminarLoading(loadingMessage)
  }
}
export const registrar = (payload) => api('/auth/registro', { method: 'POST', body: JSON.stringify(payload), loadingMessage: 'Creando cuenta...' })
export const login = (payload) => api('/auth/login', { method: 'POST', body: JSON.stringify(payload), loadingMessage: 'Iniciando sesión...' })
export const perfil = () => api('/auth/perfil')
export const health = () => api('/health')
export const runners = () => api('/runners')
export const runnersDisponibles = (options = {}) => api('/runners/disponibles', options)
export const jobs = () => api('/jobs?limit=30')
export const jobsPorRunner = (runnerId, limit = 80) => api(`/jobs?limit=${encodeURIComponent(limit)}&runnerTarget=${encodeURIComponent(runnerId)}`, { silentLoading: true })
export const obtenerJob = (id) => api(`/jobs/${encodeURIComponent(id)}`, { silentLoading: true })
export const cancelarJob = (id) => api(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', silentLoading: true })
export const crearJob = (payload) => api('/jobs', { method: 'POST', body: JSON.stringify(payload), loadingMessage: 'Creando job...' })
export const crearJobEspera = (payload) => api('/jobs-espera', { method: 'POST', body: JSON.stringify(payload), loadingMessage: 'Ejecutando tarea...' })
