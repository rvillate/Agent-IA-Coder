import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowUp, Download, ExternalLink, File, Folder, FolderOpen, MoreVertical, RotateCcw, Save, Upload, X, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tarjeta, IconBox, Estado } from '../componentes/UI.jsx'
import { TablaPaginada } from '../componentes/TablaPaginada.jsx'
import { api, token, apiKey, runnersDisponibles } from '../servicios/api.js'

const rutaRaiz = '/'

const extensionesTexto = new Set(['.txt','.md','.js','.jsx','.ts','.tsx','.json','.css','.html','.xml','.yml','.yaml','.env','.ini','.conf','.config','.sh','.bash','.py','.sql','.log','.csv','.toml','.service','.timer','.socket','.target','.c','.cpp','.h','.hpp','.java','.go','.rs','.php','.rb','.pl'])

function extension(nombre) {
  const n = String(nombre || '').toLowerCase()
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i) : ''
}

function esArchivoTexto(item) {
  if (!item?.isFile) return false
  const nombre = String(item.name || '')
  if (nombre.startsWith('.env')) return true
  return extensionesTexto.has(extension(nombre))
}


function esRutaLocal(ruta) {
  return String(ruta || '').startsWith('/')
}

function normalizarRuta(valor, fallback = rutaRaiz) {
  const texto = String(valor || '').trim()
  if (!texto || texto === '.') return fallback
  if (!esRutaLocal(texto)) return texto
  return texto.startsWith('/') ? texto : `/${texto}`
}

function rutaDentroWorkspace(ruta, workspace) {
  const r = String(ruta || '')
  const w = String(workspace || rutaRaiz).replace(/\/$/, '') || rutaRaiz
  if (w === rutaRaiz) return r.startsWith('/')
  return r === w || r.startsWith(`${w}/`)
}

function formatoTamano(bytes) {
  const n = Number(bytes || 0)
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

function formatoFecha(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString()
}

function formatoHora(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function authHeaders() {
  const headers = {}
  const t = token()
  const k = apiKey()
  if (t) headers.authorization = `Bearer ${t}`
  if (k) headers['x-agent-key'] = k
  return headers
}

async function crearDirectorios(baseHandle, partes) {
  let actual = baseHandle
  for (const parte of partes.filter(Boolean)) actual = await actual.getDirectoryHandle(parte, { create: true })
  return actual
}

async function escribirArchivo(destinoHandle, relativePath, blob) {
  const partes = String(relativePath || '').split('/').filter(Boolean)
  const nombre = partes.pop()
  const carpeta = await crearDirectorios(destinoHandle, partes)
  const archivo = await carpeta.getFileHandle(nombre || 'archivo', { create: true })
  const writable = await archivo.createWritable()
  await writable.write(blob)
  await writable.close()
}

function descargarBlobFallback(blob, nombre) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre || 'archivo'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function obtenerRaicesRunner(runner) {
  const roots = Array.isArray(runner?.workspaceRoots) ? runner.workspaceRoots : []
  const root = runner?.workspaceRoot
  return [...new Set([...(roots || []), root].filter(Boolean))]
}

export function FileExplorer() {
  const { t } = useTranslation()
  const runnerSeleccionado = localStorage.getItem('sa_runner') || 'master-server'
  const [workspaceRoots, setWorkspaceRoots] = useState([])
  const [workspace, setWorkspace] = useState('')
  const [path, setPath] = useState(rutaRaiz)
  const [items, setItems] = useState([])
  const [parent, setParent] = useState(rutaRaiz)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [modal, setModal] = useState(false)
  const [destino, setDestino] = useState(null)
  const [manifest, setManifest] = useState(null)
  const [progreso, setProgreso] = useState({ activo: false, total: 0, actual: 0, archivo: '', error: '' })
  const [editor, setEditor] = useState(null)
  const [advertenciaTexto, setAdvertenciaTexto] = useState(null)

  const seleccion = useMemo(() => items.filter((item) => seleccionados.has(item.path)), [items, seleccionados])
  const puedeDescargar = seleccion.length > 0 && !progreso.activo
  const workspaceActual = workspace || workspaceRoots[0] || rutaRaiz
  const puedeSubir = esRutaLocal(workspaceActual) && path !== workspaceActual && rutaDentroWorkspace(parent, workspaceActual)

  async function cargar(ruta = path, workspaceBase = workspaceActual) {
    const normalizada = normalizarRuta(ruta, workspaceBase || rutaRaiz)
    setCargando(true)
    setError('')
    try {
      if (!esRutaLocal(normalizada)) {
        setPath(normalizada)
        setParent(normalizada)
        setItems([])
        setSeleccionados(new Set())
        setError(t('explorer.workspaceRemoto'))
        return
      }
      if (!rutaDentroWorkspace(normalizada, workspaceBase)) {
        await cargar(workspaceBase, workspaceBase)
        return
      }
      const data = await api(`/explorer/list?path=${encodeURIComponent(normalizada)}`)
      setPath(data.path || workspaceBase)
      const nextParent = data.path === workspaceBase ? workspaceBase : (data.parent || workspaceBase)
      setParent(rutaDentroWorkspace(nextParent, workspaceBase) ? nextParent : workspaceBase)
      setItems(data.items || [])
      setSeleccionados(new Set())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  async function cargarWorkspaces() {
    setCargando(true)
    setError('')
    try {
      const data = await runnersDisponibles()
      const runner = (data.items || []).find((item) => item.id === runnerSeleccionado) || (data.items || [])[0]
      const roots = obtenerRaicesRunner(runner)
      const rootsFinales = roots.length ? roots : [rutaRaiz]
      const guardado = localStorage.getItem(`sa_workspace_${runnerSeleccionado}`)
      const inicial = guardado && rootsFinales.includes(guardado) ? guardado : rootsFinales[0]
      setWorkspaceRoots(rootsFinales)
      setWorkspace(inicial)
      await cargar(inicial, inicial)
    } catch (err) {
      setWorkspaceRoots([rutaRaiz])
      setWorkspace(rutaRaiz)
      await cargar(rutaRaiz, rutaRaiz)
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarWorkspaces() }, [runnerSeleccionado])

  function cambiarWorkspace(valor) {
    localStorage.setItem(`sa_workspace_${runnerSeleccionado}`, valor)
    setWorkspace(valor)
    cargar(valor, valor)
  }

  async function abrirArchivoTexto(item, force = false) {
    if (!esArchivoTexto(item)) return
    setError('')
    try {
      const data = await api(`/explorer/text?path=${encodeURIComponent(item.path)}${force ? '&force=1' : ''}`, { loadingMessage: t('explorer.cargandoArchivo') })
      if (data.tooLarge) {
        setAdvertenciaTexto({ ...data, item })
        return
      }
      setAdvertenciaTexto(null)
      setEditor({ path: data.path, name: data.name, size: data.size, mtime: data.mtime, content: data.content ?? '', original: data.content ?? '' })
    } catch (err) {
      setError(err.message)
    }
  }

  function abrirItem(item) {
    if (item.isDirectory) cargar(item.path, workspaceActual)
    else if (esArchivoTexto(item)) abrirArchivoTexto(item)
  }

  async function guardarTexto() {
    if (!editor?.path) return
    setError('')
    try {
      const data = await api('/explorer/text', { method: 'PUT', body: JSON.stringify({ path: editor.path, content: editor.content }), loadingMessage: t('explorer.guardandoArchivo') })
      setEditor(null)
      await cargar(path, workspaceActual)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  function irARaiz() { cargar(workspaceActual, workspaceActual) }
  function subirNivel() { if (puedeSubir) cargar(parent || workspaceActual, workspaceActual) }

  function toggle(pathItem) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(pathItem)) next.delete(pathItem)
      else next.add(pathItem)
      return next
    })
  }

  function toggleTodos() {
    setSeleccionados((prev) => prev.size === items.length ? new Set() : new Set(items.map((item) => item.path)))
  }

  async function abrirModalDescarga() {
    if (!puedeDescargar) return
    setModal(true)
    setDestino(null)
    setManifest(null)
    setProgreso({ activo: false, total: 0, actual: 0, archivo: '', error: '' })
    try {
      const data = await api('/explorer/manifest', { method: 'POST', body: JSON.stringify({ paths: seleccion.map((item) => item.path) }) })
      setManifest(data)
    } catch (err) {
      setProgreso({ activo: false, total: 0, actual: 0, archivo: '', error: err.message })
    }
  }

  async function seleccionarDestino() {
    if (!window.showDirectoryPicker) {
      setProgreso((p) => ({ ...p, error: t('explorer.sinSelectorCarpeta') }))
      return
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    setDestino(handle)
  }

  async function iniciarDescarga() {
    if (!manifest?.files?.length) return
    const usarDestino = Boolean(destino && window.showDirectoryPicker)
    setProgreso({ activo: true, total: manifest.files.length, actual: 0, archivo: '', error: '' })
    try {
      for (let i = 0; i < manifest.files.length; i += 1) {
        const file = manifest.files[i]
        setProgreso({ activo: true, total: manifest.files.length, actual: i, archivo: file.relativePath, error: '' })
        const res = await fetch(`/api/explorer/file?path=${encodeURIComponent(file.path)}`, { headers: authHeaders() })
        if (!res.ok) throw new Error(`${t('explorer.errorDescargando')} ${file.relativePath}`)
        const blob = await res.blob()
        if (usarDestino) await escribirArchivo(destino, file.relativePath, blob)
        else descargarBlobFallback(blob, file.relativePath.split('/').pop())
        setProgreso({ activo: true, total: manifest.files.length, actual: i + 1, archivo: file.relativePath, error: '' })
      }
      setProgreso((p) => ({ ...p, activo: false, archivo: t('explorer.descargaCompleta') }))
    } catch (err) {
      setProgreso((p) => ({ ...p, activo: false, error: err.message }))
    }
  }

  return <>
    <Tarjeta className="page-head explorer-head">
      <IconBox><FolderOpen/></IconBox>
      <div><h1>{t('explorer.titulo')}</h1><p>{t('explorer.subtituloWorkspace')} <b>{workspaceActual}</b>.</p></div>
    </Tarjeta>
    <Tarjeta>
      <div className="toolbar explorer-toolbar">
        <button><Zap size={16}/>{t('comun.acciones')}</button>
        <label className="path-label toolbar-path">{t('explorer.rutaActual')}<input value={path} onChange={(e)=>setPath(normalizarRuta(e.target.value, workspaceActual))} onKeyDown={(e)=>{ if(e.key === 'Enter') cargar(path, workspaceActual) }} /></label>
        <button onClick={subirNivel} disabled={!puedeSubir}><ArrowUp size={16}/>{t('explorer.subirNivel')}</button>
        <button onClick={irARaiz}><RotateCcw size={16}/>{t('explorer.raizWorkspace')}</button>
        <button className="primary" disabled={!puedeDescargar} onClick={abrirModalDescarga}><Download size={16}/>{t('comun.descargar')}</button>
        <button><Upload size={16}/>{t('comun.cargarArchivo')}</button>
        <label className="workspace-select"><span>{t('explorer.workspace')}</span><select value={workspaceActual} onChange={(e) => cambiarWorkspace(e.target.value)}>{workspaceRoots.map((root) => <option key={root} value={root}>{root}</option>)}</select></label>
        <span>{items.length} {t('comun.items')}</span><span>{seleccion.length} {t('comun.seleccionado')}</span>{cargando && <Estado>{t('comun.cargando')}</Estado>}
      </div>
      {error && <div className="alerta">{error}</div>}
      <TablaPaginada
        rows={items}
        pageSizeDefault={10}
        columns={[
          <input type="checkbox" checked={items.length > 0 && seleccionados.size === items.length} onChange={toggleTodos}/>,
          t('explorer.columnas.nombre'),
          t('explorer.columnas.tipo'),
          t('explorer.columnas.tamano'),
          t('explorer.columnas.permisos'),
          t('comun.read'),
          t('comun.write'),
          t('explorer.columnas.fecha'),
          t('explorer.columnas.hora'),
          t('explorer.columnas.acciones')
        ]}
        rowKey={(item) => item.path}
        renderRow={(item) => <tr key={item.path}>
          <td><input type="checkbox" checked={seleccionados.has(item.path)} onChange={() => toggle(item.path)} onClick={(e)=>e.stopPropagation()}/></td>
          <td className={`name-cell ${item.isDirectory || esArchivoTexto(item) ? 'clickable' : ''}`} onClick={() => abrirItem(item)}>{item.isDirectory?<Folder/>:<File/>}<b title={item.name}>{item.name}</b></td>
          <td><Estado tipo={item.isFile?'blue':'orange'}>{item.isFile?t('explorer.archivo'):item.isDirectory?t('explorer.directorio'):item.type}</Estado></td>
          <td>{item.isDirectory?'—':formatoTamano(item.size)}</td>
          <td><Estado tipo="green">{item.permissions}</Estado></td>
          <td><Estado tipo="green">{item.read?t('comun.si'):t('comun.no')}</Estado></td>
          <td><Estado tipo={item.write?'green':''}>{item.write?t('comun.si'):t('comun.no')}</Estado></td>
          <td>{formatoFecha(item.mtime)}</td>
          <td>{formatoHora(item.mtime)}</td>
          <td className="row-actions"><button onClick={() => item.isDirectory ? cargar(item.path, workspaceActual) : esArchivoTexto(item) ? abrirArchivoTexto(item) : toggle(item.path)}>{item.isDirectory?t('comun.abrir'):esArchivoTexto(item)?t('explorer.editarArchivo'):t('comun.seleccionar')} <ExternalLink size={14}/></button><MoreVertical size={16}/></td>
        </tr>}
      />
    </Tarjeta>


    {advertenciaTexto && <div className="modal-backdrop">
      <div className="modal-card text-warning-modal">
        <div className="modal-title-row"><h2><AlertTriangle size={20}/>{t('explorer.archivoPesadoTitulo')}</h2><button onClick={() => setAdvertenciaTexto(null)}><X size={16}/></button></div>
        <p>{t('explorer.archivoPesadoTexto')}</p>
        <div className="download-summary"><span>{advertenciaTexto.name}</span><span>{formatoTamano(advertenciaTexto.size)}</span></div>
        <div className="actions-row"><button className="primary" onClick={() => abrirArchivoTexto(advertenciaTexto.item, true)}>{t('explorer.abrirDeTodosModos')}</button><button onClick={() => setAdvertenciaTexto(null)}>{t('comun.cerrar')}</button></div>
      </div>
    </div>}

    {editor && <div className="modal-backdrop">
      <div className="modal-card text-editor-modal">
        <div className="modal-title-row"><h2>{t('explorer.editarArchivo')}: {editor.name}</h2><button onClick={() => setEditor(null)}><X size={16}/></button></div>
        <div className="download-summary"><span>{editor.path}</span><span>{formatoTamano(editor.size)}</span></div>
        <textarea className="file-text-editor" value={editor.content} onChange={(e) => setEditor({ ...editor, content: e.target.value })} spellCheck="false" />
        <div className="actions-row"><button className="primary" onClick={guardarTexto}><Save size={16}/>{t('comun.guardar')}</button><button onClick={() => setEditor(null)}>{t('comun.cerrar')}</button></div>
      </div>
    </div>}

    {modal && <div className="modal-backdrop">
      <div className="modal-card">
        <h2>{t('explorer.modalTitulo')}</h2>
        <p>{t('explorer.modalSubtitulo')}</p>
        <div className="download-summary"><span>{manifest?.totalFiles || 0} {t('explorer.archivos')}</span><span>{formatoTamano(manifest?.totalBytes || 0)}</span></div>
        <div className="actions-row">
          <button onClick={seleccionarDestino}><FolderOpen size={16}/>{destino ? destino.name : t('explorer.seleccionarDestino')}</button>
          <button className="primary" disabled={!manifest?.files?.length || progreso.activo || (window.showDirectoryPicker && !destino)} onClick={iniciarDescarga}><Download size={16}/>{t('explorer.iniciarDescarga')}</button>
          <button onClick={() => setModal(false)} disabled={progreso.activo}>{t('comun.cerrar')}</button>
        </div>
        {progreso.total > 0 && <div className="progress-box"><div className="progress-line"><span style={{ width: `${Math.round((progreso.actual / progreso.total) * 100)}%` }} /></div><strong>{progreso.actual} / {progreso.total}</strong><small>{progreso.archivo}</small></div>}
        {progreso.error && <div className="alerta">{progreso.error}</div>}
      </div>
    </div>}
  </>
}
