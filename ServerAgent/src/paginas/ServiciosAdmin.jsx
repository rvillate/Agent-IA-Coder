import React, { useEffect, useState } from 'react'
import { AlertTriangle, Edit3, Eraser, Info, Lock, Play, Plus, RefreshCw, RotateCw, Save, ShieldCheck, SlidersHorizontal, Square, TerminalSquare, Trash2, Unlock, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tarjeta, IconBox, Estado } from '../componentes/UI.jsx'
import { TablaPaginada } from '../componentes/TablaPaginada.jsx'
import { api } from '../servicios/api.js'

function estadoTipo(estado) {
  if (['active', 'activating', 'running'].includes(String(estado))) return 'green'
  if (['waiting', 'inactive'].includes(String(estado))) return 'yellow'
  return ''
}

function normalizarServicio(nombre) {
  let n = String(nombre || '').trim()
  if (!n) return ''
  if (!n.endsWith('.service') && !n.endsWith('.timer')) n += '.service'
  return n
}

const ayudaCamposServicio = {
  description: 'Texto descriptivo mostrado por systemd. Puede quedar vacío; si queda vacío, se usa el nombre del unit como referencia.',
  wantedBy: 'Define en qué target se instala al habilitar. En servicios suele ser multi-user.target; en timers suele ser timers.target. Si queda vacío, el formulario genera el valor recomendado según el tipo.',
  after: 'Ordena el arranque después de otros targets o servicios, por ejemplo network-online.target. Puede quedar vacío; systemd no añadirá dependencia de orden.',
  wants: 'Declara dependencias débiles que systemd intentará iniciar junto con este unit. Puede quedar vacío; no se solicitarán unidades adicionales.',
  serviceType: 'Tipo de servicio systemd. simple sirve para procesos en primer plano; oneshot para tareas cortas; forking para procesos que se envían al background; notify para apps que notifican readiness. No debe quedar vacío; si queda vacío se usa simple.',
  restart: 'Política de reinicio. always reinicia casi siempre; on-failure solo si falla; no desactiva reinicios automáticos. Puede quedar vacío, pero se recomienda definirlo; si queda vacío no se escribe Restart.',
  workingDirectory: 'Directorio desde donde se ejecuta el comando. Puede quedar vacío; el proceso arrancará desde el directorio por defecto de systemd, normalmente /.',
  restartSec: 'Tiempo de espera antes de reiniciar. Puede quedar vacío; systemd usará su valor por defecto. Puedes usar segundos o formatos como 5s, 1min.',
  user: 'Usuario Linux que ejecutará el proceso. Puede quedar vacío; el servicio correrá como root, lo cual puede no ser recomendable.',
  group: 'Grupo Linux para ejecutar el proceso. Puede quedar vacío; systemd usará el grupo principal del usuario configurado o root.',
  environment: 'Variables de entorno en formato CLAVE=valor. Puede quedar vacío; no se agregan variables. Para varias variables puedes separarlas con espacios respetando comillas si aplica.',
  execStart: 'Comando principal que inicia el servicio. En .service normalmente es obligatorio. Si queda vacío, systemd no podrá iniciar correctamente el servicio.',
  execStop: 'Comando opcional para detener el servicio de forma personalizada. Puede quedar vacío; systemd detendrá el proceso principal con la señal estándar.',
  timerUnit: 'Servicio que dispara este timer. Puede quedar vacío; se usa el mismo nombre del timer cambiando .timer por .service.',
  persistent: 'Si es true, systemd ejecuta eventos omitidos mientras el equipo estaba apagado. Puede quedar vacío; se omitirá la directiva y systemd usará su comportamiento por defecto.',
  onCalendar: 'Programación tipo calendario, por ejemplo *-*-* 03:00:00. Puede quedar vacío si usas OnBootSec u OnUnitActiveSec; si todos quedan vacíos, el timer no tendrá cuándo ejecutarse.',
  onBootSec: 'Ejecuta el timer cierto tiempo después de arrancar, por ejemplo 5min. Puede quedar vacío si usas otra regla de tiempo.',
  onUnitActiveSec: 'Ejecuta el timer cierto tiempo después de la última activación, por ejemplo 1h. Puede quedar vacío si usas otra regla de tiempo.'
}

function EtiquetaAyuda({ children, ayuda }) {
  return <span className="field-label-with-help"><span>{children}</span><span className="help-dot" tabIndex={0} role="img" aria-label={ayuda} data-tooltip={ayuda}>i</span></span>
}

function limpiarUnitText(texto) {
  return String(texto || '')
    .split('\n')
    .filter((linea) => !linea.startsWith('# /'))
    .join('\n')
    .trim()
}

function leerSeccion(unitText, seccion) {
  const lineas = String(unitText || '').split('\n')
  const valores = {}
  let activa = ''
  for (const linea of lineas) {
    const t = linea.trim()
    const m = t.match(/^\[([^\]]+)\]$/)
    if (m) { activa = m[1]; continue }
    if (activa !== seccion || !t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) valores[t.slice(0, i)] = t.slice(i + 1)
  }
  return valores
}

function unitAFormulario(nombre, unitText) {
  const unit = leerSeccion(unitText, 'Unit')
  const service = leerSeccion(unitText, 'Service')
  const timer = leerSeccion(unitText, 'Timer')
  const install = leerSeccion(unitText, 'Install')
  const tipo = String(nombre || '').endsWith('.timer') ? 'timer' : 'service'
  return {
    tipo,
    description: unit.Description || '',
    after: unit.After || '',
    wants: unit.Wants || '',
    serviceType: service.Type || 'simple',
    user: service.User || '',
    group: service.Group || '',
    workingDirectory: service.WorkingDirectory || '',
    environment: service.Environment || '',
    execStart: service.ExecStart || '',
    execStop: service.ExecStop || '',
    restart: service.Restart || 'always',
    restartSec: service.RestartSec || '5',
    wantedBy: install.WantedBy || (tipo === 'timer' ? 'timers.target' : 'multi-user.target'),
    onCalendar: timer.OnCalendar || '',
    onBootSec: timer.OnBootSec || '',
    onUnitActiveSec: timer.OnUnitActiveSec || '',
    persistent: timer.Persistent || 'true',
    timerUnit: timer.Unit || String(nombre || '').replace(/\.timer$/, '.service')
  }
}

function linea(key, value) {
  const v = String(value || '').trim()
  return v ? `${key}=${v}` : ''
}

function formularioAUnit(nombre, f) {
  const tipo = String(nombre || '').endsWith('.timer') ? 'timer' : 'service'
  const unitLines = ['[Unit]', linea('Description', f.description || nombre), linea('Wants', f.wants), linea('After', f.after)].filter(Boolean)
  if (tipo === 'timer') {
    const timerLines = ['[Timer]', linea('OnCalendar', f.onCalendar), linea('OnBootSec', f.onBootSec), linea('OnUnitActiveSec', f.onUnitActiveSec), linea('Persistent', f.persistent), linea('Unit', f.timerUnit)].filter(Boolean)
    const installLines = ['[Install]', linea('WantedBy', f.wantedBy || 'timers.target')].filter(Boolean)
    return [...unitLines, '', ...timerLines, '', ...installLines, ''].join('\n')
  }
  const serviceLines = ['[Service]', linea('Type', f.serviceType || 'simple'), linea('User', f.user), linea('Group', f.group), linea('WorkingDirectory', f.workingDirectory), linea('Environment', f.environment), linea('ExecStart', f.execStart), linea('ExecStop', f.execStop), linea('Restart', f.restart), linea('RestartSec', f.restartSec)].filter(Boolean)
  const installLines = ['[Install]', linea('WantedBy', f.wantedBy || 'multi-user.target')].filter(Boolean)
  return [...unitLines, '', ...serviceLines, '', ...installLines, ''].join('\n')
}

export function ServiciosAdmin() {
  const { t } = useTranslation()
  const [servicios, setServicios] = useState([])
  const [host, setHost] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const [modal, setModal] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [editando, setEditando] = useState(null)
  const [salidaAccion, setSalidaAccion] = useState(null)
  const [ajustesServicio, setAjustesServicio] = useState(null)
  const [formAjustes, setFormAjustes] = useState({})
  const [proteccionPendiente, setProteccionPendiente] = useState(null)
  const [tabEditor, setTabEditor] = useState('form')
  const [formUnit, setFormUnit] = useState({})
  const [form, setForm] = useState({ nombre: '', descripcion: '', comando: '', workingDirectory: '' })

  async function refrescar() {
    setError('')
    setMensaje('')
    try {
      const data = await api('/servicios-admin', { loadingMessage: t('comun.cargando') })
      setHost(data.host || '')
      setServicios(data.items || [])
      setMensaje(t('servicios.refrescado'))
    } catch (err) {
      setError(err.message)
    }
  }

  function abrirSalidaAccion(data, fallback = {}) {
    const service = data?.service?.name || fallback.service || ''
    const action = data?.action || fallback.action || ''
    setSalidaAccion({
      ok: Boolean(data?.ok),
      action,
      service,
      active: data?.service?.active || '',
      enabled: data?.service?.enabled || '',
      stdout: data?.stdout || '',
      stderr: data?.stderr || data?.error || '',
      status: data?.status || '',
      journal: data?.journal || '',
      fileOutput: data?.fileOutput || '',
      outputFile: data?.outputFile || data?.config?.archivoSalida || '',
      config: data?.config || data?.service?.config || {}
    })
  }

  async function controlarServicio(nombre, action) {
    const service = normalizarServicio(nombre)
    if (!service) return setError(t('servicios.seleccionaServicio'))
    setError('')
    setMensaje('')
    try {
      const data = await api('/servicios-admin/control', {
        method: 'POST',
        body: JSON.stringify({ service, action }),
        loadingMessage: `${t('servicios.procesando')} ${service}`
      })
      abrirSalidaAccion(data, { service, action })
      setMensaje(`${data.service?.name || service}: ${data.service?.active || t('servicios.accionCompletada')}`)
      await refrescar()
    } catch (err) {
      setError(err.message)
      abrirSalidaAccion({ ok: false, stderr: err.message }, { service, action })
      await refrescar()
    }
  }

  function verDetalleServicio(servicio) {
    setDetalle(servicio)
  }


  async function verSalidaServicio(servicio) {
    const service = normalizarServicio(servicio?.name || servicio)
    if (!service) return
    setError('')
    try {
      const data = await api(`/servicios-admin/salida?service=${encodeURIComponent(service)}`, { loadingMessage: `${t('servicios.cargandoSalida')} ${service}` })
      abrirSalidaAccion(data, { service, action: 'output' })
    } catch (err) {
      setError(err.message)
      abrirSalidaAccion({ ok: false, stderr: err.message }, { service, action: 'output' })
    }
  }

  async function limpiarSalidaServicio() {
    if (!salidaAccion?.service) return
    setError('')
    try {
      const data = await api('/servicios-admin/salida/limpiar', {
        method: 'POST',
        body: JSON.stringify({ service: salidaAccion.service }),
        loadingMessage: `${t('servicios.limpiandoSalida')} ${salidaAccion.service}`
      })
      abrirSalidaAccion(data, { service: salidaAccion.service, action: 'clear-output' })
      setMensaje(`${salidaAccion.service}: ${t('servicios.salidaLimpiada')}`)
    } catch (err) {
      setError(err.message)
      abrirSalidaAccion({ ...salidaAccion, ok: false, stderr: err.message }, { service: salidaAccion.service, action: 'clear-output' })
    }
  }

  async function abrirAjustesServicio(servicio) {
    const service = normalizarServicio(servicio?.name)
    if (!service) return
    setError('')
    try {
      const data = await api(`/servicios-admin/config?service=${encodeURIComponent(service)}`, { loadingMessage: `${t('servicios.cargandoAjustes')} ${service}` })
      setAjustesServicio(data.service || servicio)
      setFormAjustes({ ...(data.config || data.service?.config || {}) })
    } catch (err) {
      setError(err.message)
    }
  }

  async function guardarAjustesServicio() {
    if (!ajustesServicio?.name) return
    setError('')
    try {
      const data = await api('/servicios-admin/config', {
        method: 'PUT',
        body: JSON.stringify({ service: ajustesServicio.name, ...formAjustes }),
        loadingMessage: `${t('servicios.guardandoAjustes')} ${ajustesServicio.name}`
      })
      setMensaje(`${ajustesServicio.name}: ${t('servicios.ajustesGuardados')}`)
      setAjustesServicio(null)
      setFormAjustes({})
      await refrescar()
    } catch (err) {
      setError(err.message)
    }
  }

  async function cambiarProteccionServicio(servicio, proteger) {
    const service = normalizarServicio(servicio?.name || servicio)
    if (!service) return
    setError('')
    setMensaje('')
    try {
      const data = await api('/servicios-admin/proteccion', {
        method: 'POST',
        body: JSON.stringify({ service, proteger }),
        loadingMessage: `${t('servicios.cambiandoProteccion')} ${service}`
      })
      setMensaje(`${service}: ${proteger ? t('servicios.proteccionBloqueada') : t('servicios.proteccionDesbloqueada')}`)
      setProteccionPendiente(null)
      await refrescar()
    } catch (err) {
      setError(err.message)
    }
  }

  function abrirProteccionServicio(servicio) {
    if (!servicio?.protectionConfigurable) return
    if (servicio.protected) {
      setProteccionPendiente(servicio)
      return
    }
    cambiarProteccionServicio(servicio, true)
  }

  async function abrirEditar(servicio) {
    setError('')
    try {
      const data = await api(`/servicios-admin/unit?service=${encodeURIComponent(servicio.name)}`, { loadingMessage: t('servicios.cargandoServicio') })
      const s = data.service || servicio
      {
        const unitText = limpiarUnitText(data.contenido ?? s.unitText ?? '')
        setFormUnit(unitAFormulario(s.name, unitText))
        setTabEditor('form')
        setEditando({ ...s, unitText })
      }
    } catch (err) {
      setError(err.message)
    }
  }

  function actualizarFormUnit(campo, valor) {
    setFormUnit((actual) => {
      const nuevo = { ...actual, [campo]: valor }
      if (editando?.name) setEditando((e) => e ? { ...e, unitText: formularioAUnit(e.name, nuevo) } : e)
      return nuevo
    })
  }

  async function guardarEdicion() {
    if (!editando?.name) return
    setError('')
    setMensaje('')
    try {
      const data = await api('/servicios-admin/unit', {
        method: 'PUT',
        body: JSON.stringify({ service: editando.name, contenido: editando.unitText, habilitar: true, reiniciar: editando.type === 'service' }),
        loadingMessage: `${t('servicios.guardandoServicio')} ${editando.name}`
      })
      setMensaje(`${data.service?.name || editando.name}: ${t('servicios.editado')}`)
      setEditando(null)
      await refrescar()
    } catch (err) {
      setError(err.message)
    }
  }

  async function eliminarServicio(servicio) {
    const service = normalizarServicio(servicio?.name)
    if (!service) return
    if (!window.confirm(`${t('servicios.confirmarEliminar')} ${service}?`)) return
    setError('')
    setMensaje('')
    try {
      await api(`/servicios-admin/unit?service=${encodeURIComponent(service)}`, { method: 'DELETE', loadingMessage: `${t('servicios.eliminandoServicio')} ${service}` })
      setMensaje(`${service}: ${t('servicios.eliminado')}`)
      await refrescar()
    } catch (err) {
      setError(err.message)
    }
  }

  async function crearServicio() {
    const nombre = normalizarServicio(form.nombre)
    const descripcion = String(form.descripcion || nombre).trim()
    const comando = String(form.comando || '').trim()
    const workingDirectory = String(form.workingDirectory || '/home/pi/Agent-IA-Coder').trim()
    if (!nombre || !/^[A-Za-z0-9_.@-]+\.(service|timer)$/.test(nombre)) return setError(t('servicios.nombreInvalido'))
    if (nombre.endsWith('.service') && !comando) return setError(t('servicios.comandoRequerido'))
    setError('')
    setMensaje('')
    try {
      const data = await api('/servicios-admin', {
        method: 'POST',
        body: JSON.stringify({ nombre, descripcion, comando, workingDirectory }),
        loadingMessage: t('servicios.creandoServicio')
      })
      abrirSalidaAccion(data, { service: nombre, action: 'create' })
      setMensaje(`${data.service?.name || nombre}: ${t('servicios.creadoDetenido')}`)
      setModal(false)
      setForm({ nombre: '', descripcion: '', comando: '', workingDirectory: '' })
      await refrescar()
    } catch (err) {
      setError(err.message)
      await refrescar()
    }
  }

  useEffect(() => { refrescar() }, [])

  return <>
    <Tarjeta className="page-head">
      <IconBox><ShieldCheck/></IconBox>
      <div><h1>{t('servicios.titulo')}</h1><p>{t('servicios.subtituloLocal')}</p></div>
      <button onClick={refrescar}><RefreshCw size={18}/>{t('comun.refrescar')}</button>
      <button className="primary" onClick={() => setModal(true)}><Plus size={18}/>{t('servicios.crearServicioManual')}</button>
    </Tarjeta>
    <Tarjeta>
      <div className="toolbar"><span>{t('servicios.servidorLocal')}: {host || 'localhost'}</span><span>{servicios.length} {t('comun.items')}</span></div>
      {mensaje && <div className="alerta ok-alert">{mensaje}</div>}
      {error && <div className="alerta">{error}</div>}
      <TablaPaginada
        rows={servicios}
        pageSizeDefault={10}
        columns={['', t('comun.servicio').toUpperCase(), t('comun.tipo').toUpperCase(), t('comun.estado').toUpperCase(), t('servicios.puerto').toUpperCase(), t('comun.detalle').toUpperCase(), t('servicios.controles').toUpperCase()]}
        rowKey={(s) => s.name}
        renderRow={(s) => <tr key={s.name}>
          <td className="lock-cell">{s.protectionConfigurable && <button className={`icon-only lock-toggle ${s.protected ? 'locked' : 'unlocked'}`} title={s.protected ? t('servicios.desbloquearProteccion') : t('servicios.bloquearProteccion')} aria-label={s.protected ? t('servicios.desbloquearProteccion') : t('servicios.bloquearProteccion')} onClick={() => abrirProteccionServicio(s)}>{s.protected ? <Lock size={15}/> : <Unlock size={15}/>}</button>}</td>
          <td><b>{s.name}</b><br/><small>{s.description}</small></td>
          <td>{s.type === 'timer' ? t('servicios.timer') : t('servicios.systemd')}</td>
          <td><Estado tipo={estadoTipo(s.active)}>{s.active}</Estado>{s.protected && <Estado>{t('servicios.protegido')}</Estado>}</td>
          <td className="ports-cell">{s.ports?.length ? s.ports.map((p) => <span key={`${p.proto}-${p.address}-${p.port}`} title={p.address}>{p.port}<small>/{p.proto}</small></span>) : '—'}</td>
          <td>{s.enabled} / {s.load}<br/><small>{s.host}</small></td>
          <td className="row-actions">
            {s.config?.mostrarSalida && <button className="icon-only" title={t('servicios.verSalida')} aria-label={t('servicios.verSalida')} onClick={() => verSalidaServicio(s)}><TerminalSquare size={14}/></button>}
            <button className="icon-only" title={t('servicios.ajustes')} aria-label={t('servicios.ajustes')} onClick={() => abrirAjustesServicio(s)}><SlidersHorizontal size={14}/></button>
            <button className="icon-only" title={t('comun.detalle')} aria-label={t('comun.detalle')} onClick={() => verDetalleServicio(s)}><Info size={14}/></button>
            {!s.protected && <>
              <button className="icon-only" title={t('servicios.editar')} aria-label={t('servicios.editar')} onClick={() => abrirEditar(s)}><Edit3 size={14}/></button>
              <button className="icon-only" title={t('servicios.iniciar')} aria-label={t('servicios.iniciar')} onClick={() => controlarServicio(s.name, 'start')}><Play size={14}/></button>
              <button className="icon-only" title={t('servicios.reiniciar')} aria-label={t('servicios.reiniciar')} onClick={() => controlarServicio(s.name, 'restart')}><RotateCw size={14}/></button>
              <button className="icon-only" title={t('servicios.detener')} aria-label={t('servicios.detener')} onClick={() => controlarServicio(s.name, 'stop')}><Square size={14}/></button>
              <button className="icon-only danger-inline" title={t('servicios.eliminar')} aria-label={t('servicios.eliminar')} onClick={() => eliminarServicio(s)}><Trash2 size={14}/></button>
            </>}
          </td>
        </tr>}
      />
    </Tarjeta>

    {proteccionPendiente && <div className="modal-backdrop"><div className="modal-card service-modal danger-modal">
      <div className="modal-title-row"><h2><AlertTriangle size={20}/>{t('servicios.proteccionPeligroTitulo')}</h2><button onClick={() => setProteccionPendiente(null)}><X size={16}/></button></div>
      <div className="alerta danger-alert">{t('servicios.proteccionPeligroTexto')}</div>
      <div className="service-detail-grid">
        <span>{t('comun.servicio')}</span><strong>{proteccionPendiente.name}</strong>
        <span>{t('comun.estado')}</span><strong>{proteccionPendiente.active}</strong>
        <span>{t('servicios.puerto')}</span><strong>{proteccionPendiente.portText || '—'}</strong>
      </div>
      <div className="actions-row"><button className="danger-inline" onClick={() => cambiarProteccionServicio(proteccionPendiente, false)}><Unlock size={16}/>{t('servicios.entiendoRiesgoDesbloquear')}</button><button onClick={() => setProteccionPendiente(null)}>{t('comun.cancelar')}</button></div>
    </div></div>}

    {detalle && <div className="modal-backdrop"><div className="modal-card service-modal">
      <div className="modal-title-row"><h2>{detalle.name}</h2><button onClick={() => setDetalle(null)}><X size={16}/></button></div>
      <div className="service-detail-grid">
        <span>{t('comun.estado')}</span><strong>{detalle.active}</strong>
        <span>{t('comun.tipo')}</span><strong>{detalle.type}</strong>
        <span>{t('comun.detalle')}</span><strong>{detalle.enabled} / {detalle.load}</strong>
        <span>{t('servicios.servidorLocal')}</span><strong>{detalle.host}</strong>
        <span>{t('servicios.puerto')}</span><strong>{detalle.ports?.length ? detalle.ports.map((p) => `${p.port}/${p.proto} ${p.address}`).join(', ') : '—'}</strong>
        <span>{t('servicios.descripcion')}</span><strong>{detalle.description}</strong>
        <span>Fragment</span><strong>{detalle.fragmentPath || '—'}</strong>
        <span>{t('servicios.proteccion')}</span><strong>{detalle.protected ? detalle.protectedReason : t('comun.no')}</strong>
      </div>
      <div className="actions-row"><button onClick={() => setDetalle(null)}>{t('comun.cerrar')}</button></div>
    </div></div>}

    {editando && <div className="modal-backdrop"><div className="modal-card service-modal edit-service-modal">
      <div className="modal-title-row"><h2>{t('servicios.editarServicio')}: {editando.name}</h2><button onClick={() => setEditando(null)}><X size={16}/></button></div>
      <div className="editor-tabs">
        <button className={tabEditor === 'form' ? 'active' : ''} onClick={() => setTabEditor('form')}>{t('servicios.tabConfigurar')}</button>
        <button className={tabEditor === 'unit' ? 'active' : ''} onClick={() => setTabEditor('unit')}>{t('servicios.tabUnitFile')}</button>
      </div>
      {tabEditor === 'form' && <div className="service-config-form">
        <div className="form-section-title">{t('servicios.seccionGeneral')}</div>
        <div className="form-grid two">
          <label><EtiquetaAyuda ayuda={ayudaCamposServicio.description}>{t('servicios.descripcion')}</EtiquetaAyuda><input value={formUnit.description || ''} onChange={(e) => actualizarFormUnit('description', e.target.value)} placeholder="Descripción del servicio" /></label>
          <label><EtiquetaAyuda ayuda={ayudaCamposServicio.wantedBy}>{t('servicios.wantedBy')}</EtiquetaAyuda><input value={formUnit.wantedBy || ''} onChange={(e) => actualizarFormUnit('wantedBy', e.target.value)} placeholder={editando.type === 'timer' ? 'timers.target' : 'multi-user.target'} /></label>
          <label><EtiquetaAyuda ayuda={ayudaCamposServicio.after}>{t('servicios.after')}</EtiquetaAyuda><input value={formUnit.after || ''} onChange={(e) => actualizarFormUnit('after', e.target.value)} placeholder="network-online.target" /></label>
          <label><EtiquetaAyuda ayuda={ayudaCamposServicio.wants}>{t('servicios.wants')}</EtiquetaAyuda><input value={formUnit.wants || ''} onChange={(e) => actualizarFormUnit('wants', e.target.value)} placeholder="network-online.target" /></label>
        </div>

        {editando.type === 'timer' ? <>
          <div className="form-section-title">{t('servicios.seccionTimer')}</div>
          <div className="form-grid two">
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.timerUnit}>{t('servicios.timerUnit')}</EtiquetaAyuda><input value={formUnit.timerUnit || ''} onChange={(e) => actualizarFormUnit('timerUnit', e.target.value)} placeholder="mi-servicio.service" /></label>
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.persistent}>{t('servicios.persistent')}</EtiquetaAyuda><select value={formUnit.persistent || 'true'} onChange={(e) => actualizarFormUnit('persistent', e.target.value)}><option value="true">true</option><option value="false">false</option></select></label>
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.onCalendar}>{t('servicios.onCalendar')}</EtiquetaAyuda><input value={formUnit.onCalendar || ''} onChange={(e) => actualizarFormUnit('onCalendar', e.target.value)} placeholder="*-*-* 03:00:00" /></label>
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.onBootSec}>{t('servicios.onBootSec')}</EtiquetaAyuda><input value={formUnit.onBootSec || ''} onChange={(e) => actualizarFormUnit('onBootSec', e.target.value)} placeholder="5min" /></label>
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.onUnitActiveSec}>{t('servicios.onUnitActiveSec')}</EtiquetaAyuda><input value={formUnit.onUnitActiveSec || ''} onChange={(e) => actualizarFormUnit('onUnitActiveSec', e.target.value)} placeholder="1h" /></label>
          </div>
        </> : <>
          <div className="form-section-title">{t('servicios.seccionEjecucion')}</div>
          <div className="form-grid two">
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.serviceType}>{t('servicios.tipoServicio')}</EtiquetaAyuda><select value={formUnit.serviceType || 'simple'} onChange={(e) => actualizarFormUnit('serviceType', e.target.value)}><option value="simple">simple</option><option value="exec">exec</option><option value="forking">forking</option><option value="oneshot">oneshot</option><option value="notify">notify</option></select></label>
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.restart}>{t('servicios.restart')}</EtiquetaAyuda><select value={formUnit.restart || 'always'} onChange={(e) => actualizarFormUnit('restart', e.target.value)}><option value="no">no</option><option value="always">always</option><option value="on-failure">on-failure</option><option value="on-abnormal">on-abnormal</option><option value="on-success">on-success</option></select></label>
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.workingDirectory}>{t('servicios.workingDirectory')}</EtiquetaAyuda><input value={formUnit.workingDirectory || ''} onChange={(e) => actualizarFormUnit('workingDirectory', e.target.value)} placeholder="/home/pi/Proyectos/app" /></label>
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.restartSec}>{t('servicios.restartSec')}</EtiquetaAyuda><input value={formUnit.restartSec || ''} onChange={(e) => actualizarFormUnit('restartSec', e.target.value)} placeholder="5" /></label>
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.user}>{t('servicios.usuario')}</EtiquetaAyuda><input value={formUnit.user || ''} onChange={(e) => actualizarFormUnit('user', e.target.value)} placeholder="pi" /></label>
            <label><EtiquetaAyuda ayuda={ayudaCamposServicio.group}>{t('servicios.grupo')}</EtiquetaAyuda><input value={formUnit.group || ''} onChange={(e) => actualizarFormUnit('group', e.target.value)} placeholder="pi" /></label>
          </div>
          <label><EtiquetaAyuda ayuda={ayudaCamposServicio.environment}>{t('servicios.environment')}</EtiquetaAyuda><input value={formUnit.environment || ''} onChange={(e) => actualizarFormUnit('environment', e.target.value)} placeholder="NODE_ENV=production PORT=8797" /></label>
          <label><EtiquetaAyuda ayuda={ayudaCamposServicio.execStart}>{t('servicios.execStart')}</EtiquetaAyuda><textarea className="service-command-textarea" value={formUnit.execStart || ''} onChange={(e) => actualizarFormUnit('execStart', e.target.value)} placeholder="/usr/bin/node servidor/index.js" /></label>
          <label><EtiquetaAyuda ayuda={ayudaCamposServicio.execStop}>{t('servicios.execStop')}</EtiquetaAyuda><input value={formUnit.execStop || ''} onChange={(e) => actualizarFormUnit('execStop', e.target.value)} placeholder="/bin/kill -TERM $MAINPID" /></label>
        </>}
      </div>}
      {tabEditor === 'unit' && <>
        <p>{t('servicios.editarServicioDesc')}</p>
        <label className="unit-editor-label">{t('servicios.unitFile')}<textarea className="unit-editor" value={editando.unitText || ''} onChange={(e) => { const unitText = e.target.value; setEditando({ ...editando, unitText }); setFormUnit(unitAFormulario(editando.name, unitText)) }}/></label>
      </>}
      <div className="actions-row"><button className="primary" onClick={guardarEdicion}><Save size={16}/>{t('servicios.guardarCambios')}</button><button onClick={() => setEditando(null)}>{t('comun.cerrar')}</button></div>
    </div></div>}

    {ajustesServicio && <div className="modal-backdrop"><div className="modal-card service-modal service-settings-modal">
      <div className="modal-title-row"><h2><SlidersHorizontal size={20}/>{t('servicios.ajustes')}: {ajustesServicio.name}</h2><button onClick={() => setAjustesServicio(null)}><X size={16}/></button></div>
      <div className="service-settings-form">
        <label className="check-label"><input type="checkbox" checked={Boolean(formAjustes.mostrarSalida)} onChange={(e) => setFormAjustes({ ...formAjustes, mostrarSalida: e.target.checked })}/><span>{t('servicios.mostrarSalida')}</span></label>
        <label>{t('servicios.archivoSalida')}<input value={formAjustes.archivoSalida || ''} onChange={(e) => setFormAjustes({ ...formAjustes, archivoSalida: e.target.value })} placeholder="/home/pi/Proyectos/mi-servicio/logs/out.log" /></label>
        <small>{t('servicios.archivoSalidaAyuda')}</small>
        <div className="form-section-title">{t('servicios.recuperacion')}</div>
        {ajustesServicio.name !== 'agent-coder-gateway.service' && <>
          <label className="check-label"><input type="checkbox" checked={Boolean(formAjustes.recuperarPorDetencion)} onChange={(e) => setFormAjustes({ ...formAjustes, recuperarPorDetencion: e.target.checked })}/><span>{t('servicios.recuperarPorDetencion')}</span></label>
          <label className="check-label"><input type="checkbox" checked={Boolean(formAjustes.recuperarAlReiniciarServidor)} onChange={(e) => setFormAjustes({ ...formAjustes, recuperarAlReiniciarServidor: e.target.checked })}/><span>{t('servicios.recuperarAlReiniciarServidor')}</span></label>
        </>}
        <label>{t('servicios.revisarCadaSegundos')}<input type="number" min="30" max="86400" value={formAjustes.revisarCadaSegundos || 120} onChange={(e) => setFormAjustes({ ...formAjustes, revisarCadaSegundos: Number(e.target.value) })}/></label>
        {ajustesServicio.name === 'agent-coder-gateway.service' && <div className="alerta ok-alert">{t('servicios.gatewayEspecialCorreo')}</div>}
      </div>
      <div className="actions-row"><button className="primary" onClick={guardarAjustesServicio}><Save size={16}/>{t('comun.guardar')}</button><button onClick={() => setAjustesServicio(null)}>{t('comun.cerrar')}</button></div>
    </div></div>}

    {salidaAccion && <div className="modal-backdrop"><div className="modal-card service-modal service-output-modal">
      <div className="modal-title-row"><h2><TerminalSquare size={20}/>{t('servicios.salidaServicio')}: {salidaAccion.service}</h2><button onClick={() => setSalidaAccion(null)}><X size={16}/></button></div>
      <div className="service-detail-grid">
        <span>{t('comun.accion')}</span><strong>{salidaAccion.action}</strong>
        <span>{t('comun.estado')}</span><strong>{salidaAccion.active || '—'}</strong>
        <span>{t('servicios.enabled')}</span><strong>{salidaAccion.enabled || '—'}</strong>
        <span>{t('comun.resultado')}</span><strong>{salidaAccion.ok ? 'OK' : 'ERROR'}</strong>
      </div>
      <div className="service-output-tabs">
        <h3>stdout</h3><pre>{salidaAccion.stdout || '—'}</pre>
        <h3>stderr</h3><pre>{salidaAccion.stderr || '—'}</pre>
        <h3>systemctl status</h3><pre>{salidaAccion.status || '—'}</pre>
        <h3>{t('servicios.archivoSalida')} {salidaAccion.outputFile ? `(${salidaAccion.outputFile})` : ''}</h3><pre>{salidaAccion.fileOutput || '—'}</pre>
        <h3>journalctl</h3><pre>{salidaAccion.journal || '—'}</pre>
      </div>
      <div className="actions-row"><button onClick={() => verSalidaServicio(salidaAccion.service)}><RefreshCw size={16}/>{t('comun.refrescar')}</button>{salidaAccion.outputFile && <button onClick={limpiarSalidaServicio}><Eraser size={16}/>{t('servicios.limpiarSalida')}</button>}<button onClick={() => setSalidaAccion(null)}>{t('comun.cerrar')}</button></div>
    </div></div>}

    {modal && <div className="modal-backdrop"><div className="modal-card service-modal">
      <div className="modal-title-row"><h2>{t('servicios.crearServicioManual')}</h2><button onClick={() => setModal(false)}><X size={16}/></button></div>
      <p>{t('servicios.crearServicioDescLocal')}</p>
      <div className="service-form">
        <label>{t('servicios.nombreServicio')}<input value={form.nombre} onChange={(e)=>setForm({...form,nombre:e.target.value})} placeholder="mi-servicio.service" /></label>
        <label>{t('servicios.descripcion')}<input value={form.descripcion} onChange={(e)=>setForm({...form,descripcion:e.target.value})} placeholder="Mi servicio" /></label>
        <label>{t('servicios.comando')}<input value={form.comando} onChange={(e)=>setForm({...form,comando:e.target.value})} placeholder="/usr/bin/node /ruta/app.js" /></label>
        <label>{t('servicios.workingDirectory')}<input value={form.workingDirectory} onChange={(e)=>setForm({...form,workingDirectory:e.target.value})} placeholder="/home/pi/Agent-IA-Coder" /></label>
      </div>
      <div className="actions-row"><button className="primary" onClick={crearServicio}><Save size={16}/>{t('comun.guardar')}</button><button onClick={() => setModal(false)}>{t('comun.cerrar')}</button></div>
    </div></div>}
  </>
}
