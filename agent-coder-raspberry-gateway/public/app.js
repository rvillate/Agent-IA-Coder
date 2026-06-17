const $ = (id) => document.getElementById(id)
const $$ = (selector) => Array.from(document.querySelectorAll(selector))

const storeKey = 'agent-coder-gateway-v3'
const textExtensions = new Set(['md', 'markdown', 'txt', 'log', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'env', 'ini', 'conf', 'config', 'sh', 'bash', 'py', 'java', 'cs', 'go', 'rs', 'sql', 'csv'])
let state = {
  apiBase: '/api',
  apiKey: '',
  runnerTarget: 'master-server',
  route: 'home',
  currentPath: '.',
  files: [],
  selected: new Set(),
  editingPath: '',
  pendingTextPath: '',
  showHidden: false,
  services: [],
  pendingServiceAction: null
}

try { state = { ...state, ...JSON.parse(localStorage.getItem(storeKey) || '{}') } } catch {}
state.selected = new Set()

function saveState() {
  localStorage.setItem(storeKey, JSON.stringify({
    apiBase: state.apiBase,
    apiKey: state.apiKey,
    runnerTarget: state.runnerTarget,
    currentPath: state.currentPath,
    showHidden: state.showHidden
  }))
  syncHeader()
}

function setValue(id, value) {
  const el = $(id)
  if (el) el.value = value
}

function syncHeader() {
  setValue('apiBase', state.apiBase)
  setValue('apiKey', state.apiKey)
  setValue('runnerTarget', state.runnerTarget)
  setValue('runnerTargetMobile', state.runnerTarget)
  setValue('currentPath', state.currentPath)
  if ($('showHidden')) $('showHidden').checked = Boolean(state.showHidden)
  $('homeRunner').textContent = state.runnerTarget || '-'
  $('homeKey').textContent = state.apiKey ? 'Configurada' : 'No configurada'
}

function toast(message) {
  const el = $('toast')
  el.textContent = message
  el.hidden = false
  clearTimeout(window.__toastTimer)
  window.__toastTimer = setTimeout(() => { el.hidden = true }, 3200)
}

function print(data) {
  $('output').textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
}

function setStatus(ok, text) {
  $('status-dot').className = `dot ${ok ? 'ok' : 'bad'}`
  $('status-text').textContent = text
  $('homeHealth').textContent = text
}

function closeMobileMenu() {
  $('navMenu').classList.remove('open')
  $('hamburgerBtn').setAttribute('aria-expanded', 'false')
}

function setRoute(route) {
  state.route = route
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${route}`))
  $$('.nav-btn').forEach((el) => el.classList.toggle('active', el.dataset.route === route))
  closeMobileMenu()
  if (route === 'explorer' && state.files.length === 0) loadFiles().catch((error) => toast(error.message))
  if (route === 'server') loadServerStats().catch((error) => toast(error.message))
  if (route === 'services') loadServices().catch((error) => toast(error.message))
}

function apiHeaders(hasBody = false) {
  const headers = {}
  if (state.apiKey) headers['x-agent-key'] = state.apiKey
  if (hasBody) headers['content-type'] = 'application/json'
  return headers
}

async function api(path, options = {}) {
  const base = String(state.apiBase || '/api').replace(/\/$/, '')
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...apiHeaders(Boolean(options.body)), ...(options.headers || {}) } })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!response.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data))
  return data
}

async function createJob(type, payload, note = '') {
  return api('/jobs', { method: 'POST', body: JSON.stringify({ type, runnerTarget: state.runnerTarget, payload, note }) })
}

function createJobWithUploadProgress(type, payload, note = '', onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const base = String(state.apiBase || '/api').replace(/\/$/, '')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${base}/jobs`)
    xhr.setRequestHeader('content-type', 'application/json')
    if (state.apiKey) xhr.setRequestHeader('x-agent-key', state.apiKey)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      let data
      try { data = JSON.parse(xhr.responseText || '{}') } catch { data = xhr.responseText }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data)))
    }
    xhr.onerror = () => reject(new Error('Error de red creando job'))
    xhr.send(JSON.stringify({ type, runnerTarget: state.runnerTarget, payload, note }))
  })
}

async function waitJob(jobId, timeoutMs = 120000) {
  const terminal = new Set(['success', 'error', 'timeout', 'cancelled', 'rejected'])
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const data = await api(`/jobs/${encodeURIComponent(jobId)}`)
    if (terminal.has(data.job.status)) return data.job
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  throw new Error(`Timeout esperando job ${jobId}`)
}

async function runJob(type, payload, note) {
  const created = await createJob(type, payload, note)
  return waitJob(created.job.id)
}

function joinPath(base, name) {
  if (!base || base === '.') return name
  return `${base.replace(/\/$/, '')}/${name}`.replace(/\/+/g, '/')
}

function parentPath(path) {
  const clean = String(path || '.').replace(/\/$/, '')
  if (!clean || clean === '.' || clean === '/') return '.'
  const parts = clean.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? parts.join('/') : '.'
}

function formatSize(size) {
  if (size == null) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = Number(size)
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1 }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`
}

function extOf(path) {
  const name = String(path || '').split('/').pop() || ''
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function isTextFile(itemOrPath) {
  const path = typeof itemOrPath === 'string' ? itemOrPath : itemOrPath?.name || itemOrPath?.path || ''
  return textExtensions.has(extOf(path))
}

function fileIcon(item) {
  if (item.type === 'directory') return '📁'
  const ext = extOf(item.name)
  if (textExtensions.has(ext)) return '📝'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️'
  if (['zip', 'gz', 'tar', 'rar'].includes(ext)) return '🗜️'
  return '📄'
}

function canRead(perms) { return String(perms || '').length === 3 ? String(perms)[0] >= '4' : '-' }
function canWrite(perms) { return String(perms || '').length === 3 ? ['2','3','6','7'].includes(String(perms)[0]) : '-' }
function dateParts(ms) {
  if (!ms) return ['-', '-']
  const d = new Date(ms)
  return [d.toLocaleDateString(), d.toLocaleTimeString()]
}

function updateCounts() {
  $('fileCount').textContent = `${state.files.length} item(s)`
  $('selectedCount').textContent = `${state.selected.size} seleccionado(s)`
}

function renderFiles() {
  const body = $('filesBody')
  const files = state.files || []
  updateCounts()
  $('selectAll').checked = files.length > 0 && files.every((f) => state.selected.has(f.path))
  if (!files.length) {
    body.innerHTML = '<tr><td colspan="12" class="empty">Sin archivos para mostrar.</td></tr>'
    return
  }
  body.innerHTML = ''
  for (const item of files) {
    const [date, time] = dateParts(item.modifiedAt)
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td><input class="row-check" type="checkbox" ${state.selected.has(item.path) ? 'checked' : ''}></td>
      <td class="name-cell"><button class="linkish open-item"><span class="file-icon ${item.isHidden ? 'hidden-icon' : ''}">${fileIcon(item)}</span> <span class="file-name">${item.name}</span></button></td>
      <td>${item.type}</td><td>${formatSize(item.size)}</td><td>${item.permissions || '-'}</td>
      <td>${canRead(item.permissions) === true ? 'Sí' : canRead(item.permissions) === false ? 'No' : '-'}</td>
      <td>${canWrite(item.permissions) === true ? 'Sí' : canWrite(item.permissions) === false ? 'No' : '-'}</td>
      <td>${item.uid ?? '-'}</td><td>${item.gid ?? '-'}</td><td>${date}</td><td>${time}</td>
      <td class="row-actions"></td>`
    tr.querySelector('.row-check').onchange = (event) => {
      if (event.target.checked) state.selected.add(item.path); else state.selected.delete(item.path)
      renderFiles()
    }
    tr.querySelector('.open-item').onclick = () => {
      if (item.type === 'directory') return openDir(item.path)
      if (isTextFile(item)) return askOpenText(item.path)
      return editFile(item.path)
    }
    const actions = tr.querySelector('.row-actions')
    const dl = document.createElement('button'); dl.textContent = 'Descargar'; dl.className = 'mini'; dl.disabled = item.type !== 'file'; dl.onclick = () => downloadPath(item.path)
    const ed = document.createElement('button'); ed.textContent = isTextFile(item) ? 'Abrir' : 'Editar'; ed.className = 'mini secondary'; ed.disabled = item.type !== 'file'; ed.onclick = () => isTextFile(item) ? askOpenText(item.path) : editFile(item.path)
    actions.append(dl, ed)
    body.appendChild(tr)
  }
}

async function loadFiles() {
  state.currentPath = $('currentPath').value || state.currentPath || '.'
  state.showHidden = Boolean($('showHidden')?.checked)
  saveState()
  $('filesBody').innerHTML = '<tr><td colspan="12" class="empty">Cargando...</td></tr>'
  const job = await runJob('file.list', { path: state.currentPath, maxDepth: 0, maxEntries: 1000, showHidden: state.showHidden }, 'Listar workspace desde web')
  if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || 'Error listando archivos')
  state.files = job.result.items || []
  state.selected.clear()
  renderFiles()
}

function openDir(path) {
  state.currentPath = path || '.'
  $('currentPath').value = state.currentPath
  loadFiles().catch((error) => toast(error.message))
}

function base64ToBytes(base64) {
  const bin = atob(base64 || '')
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function readRemote(path, encoding = 'base64', maxBytes = 25 * 1024 * 1024) {
  const job = await runJob('file.read', { path, encoding, maxBytes, maxBytesLimit: maxBytes }, `Leer ${path}`)
  if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || `No se pudo leer ${path}`)
  return job.result
}

async function downloadPath(path) {
  const data = await readRemote(path, 'base64')
  saveBlob(new Blob([base64ToBytes(data.content)]), path.split('/').pop() || 'download')
}

async function downloadSelected() {
  const selected = Array.from(state.selected)
  if (!selected.length) return toast('Selecciona archivos primero')
  for (const path of selected) {
    const item = state.files.find((f) => f.path === path)
    if (item?.type === 'file') await downloadPath(path)
  }
  $('actionsModal').close()
}

async function editFile(path) {
  const data = await readRemote(path, 'utf8')
  state.editingPath = path
  $('editorTitle').textContent = `Editar ${path}`
  $('editorText').value = data.content
  $('editorModal').showModal()
}

function askOpenText(path) {
  state.pendingTextPath = path
  $('textOpenPath').textContent = path
  $('textLineLimit').value = '1000'
  $('textOpenModal').showModal()
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function openTextTab(path, content, lines, truncated) {
  const limited = content.split(/\r?\n/).slice(0, lines).join('\n')
  const doc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(path)}</title><style>
    body{margin:0;background:#0f172a;color:#e2e8f0;font:13px/1.45 Consolas,monospace}
    header{position:sticky;top:0;background:#111827;padding:10px 12px;border-bottom:1px solid #334155;font-family:system-ui,sans-serif}
    strong{display:block;color:#fff}small{color:#94a3b8}
    pre{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word}
  </style></head><body><header><strong>${escapeHtml(path)}</strong><small>Mostrando ${lines} línea(s)${truncated ? ' · archivo truncado por límite de lectura' : ''}</small></header><pre>${escapeHtml(limited)}</pre></body></html>`
  const win = window.open('', '_blank')
  if (!win) return toast('El navegador bloqueó la pestaña nueva')
  win.document.open()
  win.document.write(doc)
  win.document.close()
}

async function openPendingText(event) {
  event.preventDefault()
  const path = state.pendingTextPath
  const lines = Math.max(1, Math.min(20000, Number($('textLineLimit').value || 1000)))
  if (!path) return
  const data = await readRemote(path, 'utf8', 25 * 1024 * 1024)
  openTextTab(path, data.content, lines, data.truncated)
  $('textOpenModal').close()
}

async function saveEditor(event) {
  event.preventDefault()
  const path = state.editingPath
  if (!path) return
  const job = await runJob('file.write', { path, content: $('editorText').value, backup: true, atomic: true }, `Editar ${path}`)
  if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || 'No se pudo guardar')
  $('editorModal').close()
  toast('Archivo guardado')
  await loadFiles()
}

function closeActionsModal() {
  if ($('actionsModal')?.open) $('actionsModal').close()
}

function showCreateFolderModal() {
  closeActionsModal()
  $('newFolderName').value = ''
  $('createFolderPath').textContent = `Ruta actual: ${state.currentPath || '.'}`
  $('createFolderModal').showModal()
  setTimeout(() => $('newFolderName').focus(), 50)
}

function setUploadProgress(percent, text, detail = '') {
  const safe = Math.max(0, Math.min(100, Math.round(percent)))
  $('uploadProgressBar').value = safe
  $('uploadProgressText').textContent = `${text} · ${safe}%`
  $('uploadProgressDetail').textContent = detail || `${safe}%`
}

async function createFolder(event) {
  event.preventDefault()
  const input = $('newFolderName')
  const name = String(input.value || '').trim().replace(/^\/+|\/+$/g, '')
  if (!name) return toast('Escribe el nombre de la carpeta')
  if (name.includes('..') || name.includes('\\')) return toast('Nombre de carpeta inválido')
  const target = joinPath(state.currentPath, name)
  const job = await runJob('file.mkdir', { path: target }, `Crear carpeta ${target}`)
  if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || `No se pudo crear ${target}`)
  input.value = ''
  $('createFolderModal').close()
  toast(`Carpeta creada: ${target}`)
  await loadFiles()
}

async function uploadFiles(event) {
  const files = Array.from(event.target.files || [])
  closeActionsModal()
  if (!files.length) return
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || files.length
  let completedBytes = 0
  $('uploadProgressModal').showModal()
  setUploadProgress(0, `Preparando ${files.length} archivo(s)...`)
  try {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      const basePercent = (completedBytes / totalBytes) * 100
      setUploadProgress(basePercent, `Leyendo ${file.name}`, `Archivo ${i + 1} de ${files.length}`)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const target = joinPath(state.currentPath, file.name)
      const payload = { path: target, contentBase64: bytesToBase64(bytes), backup: true, atomic: true }
      const created = await createJobWithUploadProgress('file.write', payload, `Subir ${file.name}`, (ratio) => {
        const current = file.size || 1
        const percent = ((completedBytes + current * Math.min(0.95, ratio * 0.95)) / totalBytes) * 100
        setUploadProgress(percent, `Subiendo ${file.name}`, `${Math.round(percent)}% · Archivo ${i + 1} de ${files.length}`)
      })
      const job = await waitJob(created.job.id)
      if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || `No se pudo subir ${file.name}`)
      completedBytes += file.size || 1
      setUploadProgress((completedBytes / totalBytes) * 100, `Completado ${file.name}`, `Archivo ${i + 1} de ${files.length}`)
    }
    event.target.value = ''
    setUploadProgress(100, 'Upload completado', '100%')
    toast(`${files.length} archivo(s) subido(s)`)
    await loadFiles()
    setTimeout(() => { if ($('uploadProgressModal')?.open) $('uploadProgressModal').close() }, 700)
  } catch (error) {
    setUploadProgress($('uploadProgressBar').value || 0, 'Error subiendo archivos', error.message)
    throw error
  }
}

async function deleteSelected() {
  const selected = Array.from(state.selected)
  if (!selected.length) return toast('Selecciona archivos primero')
  const names = selected.slice(0, 5).join('\n')
  const extra = selected.length > 5 ? `\n... y ${selected.length - 5} más` : ''
  if (!confirm(`Vas a eliminar ${selected.length} item(s):\n${names}${extra}\n\nEsta acción no se puede deshacer. ¿Continuar?`)) return
  for (const path of selected) {
    const job = await runJob('file.delete', { path }, `Eliminar ${path}`)
    if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || `No se pudo eliminar ${path}`)
  }
  $('actionsModal').close()
  toast(`${selected.length} item(s) eliminado(s)`)
  await loadFiles()
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function u16(n) { return [n & 255, (n >>> 8) & 255] }
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255] }
function dosTimeDate(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: d }
}
function makeZip(entries) {
  const encoder = new TextEncoder()
  const chunks = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = entry.data
    const crc = crc32(data)
    const dt = dosTimeDate()
    const local = new Uint8Array([0x50,0x4b,0x03,0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(dt.time), ...u16(dt.date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)])
    chunks.push(local, name, data)
    central.push(new Uint8Array([0x50,0x4b,0x01,0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(dt.time), ...u16(dt.date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name)
    offset += local.length + name.length + data.length
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0)
  const end = new Uint8Array([0x50,0x4b,0x05,0x06, ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(centralSize), ...u32(offset), ...u16(0)])
  return new Blob([...chunks, ...central, end], { type: 'application/zip' })
}

async function zipSelected() {
  const selected = Array.from(state.selected)
  if (!selected.length) return toast('Selecciona archivos primero')
  const entries = []
  for (const path of selected) {
    const item = state.files.find((f) => f.path === path)
    if (item?.type !== 'file') continue
    const data = await readRemote(path, 'base64')
    entries.push({ name: path.replace(/^\.?\//, ''), data: base64ToBytes(data.content) })
  }
  if (!entries.length) return toast('No hay archivos seleccionados')
  saveBlob(makeZip(entries), `agent-coder-${Date.now()}.zip`)
  $('actionsModal').close()
}

async function testHealth() {
  try {
    const data = await api('/health')
    setStatus(true, 'API OK')
    print(data)
  } catch (error) {
    setStatus(false, 'Error')
    print(error.message)
  }
}

function setRunner(value) {
  state.runnerTarget = String(value || '').trim()
  saveState()
}


const serverStatsPython = String.raw`
import json, os, platform, socket, subprocess, shutil, time

def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=8).stdout.strip()
    except Exception as exc:
        return f"ERROR: {exc}"

def read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    except Exception:
        return ""

def meminfo():
    data = {}
    for line in read("/proc/meminfo").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            parts = v.strip().split()
            if parts and parts[0].isdigit():
                data[k] = int(parts[0])
    total = data.get("MemTotal", 0)
    avail = data.get("MemAvailable", 0)
    used = max(0, total - avail)
    swap_total = data.get("SwapTotal", 0)
    swap_free = data.get("SwapFree", 0)
    return total, used, avail, swap_total, max(0, swap_total - swap_free), swap_free

def gb(kb):
    return round(kb / 1024 / 1024, 2)

def disk(path):
    d = shutil.disk_usage(path)
    return {"total_gb": round(d.total/1024**3,2), "used_gb": round(d.used/1024**3,2), "free_gb": round(d.free/1024**3,2), "used_pct": round((d.used/d.total)*100,1) if d.total else 0}

def temp():
    vals=[]
    base="/sys/class/thermal"
    if os.path.isdir(base):
        for name in os.listdir(base):
            t=read(os.path.join(base,name,"temp"))
            typ=read(os.path.join(base,name,"type")) or name
            if t.lstrip("-").isdigit():
                c=float(t)/1000 if abs(int(t))>200 else float(t)
                vals.append(f"{typ}: {c:.1f}°C")
    return "; ".join(vals) or "No detectada"

def services():
    names=["agent-coder-gateway.service","agent-coder-runner.service","agent-coder-cloudflared.service","agent-coder-disk-monitor.timer"]
    out=[]
    for n in names:
        active=run(["systemctl","is-active",n]) or "unknown"
        enabled=run(["systemctl","is-enabled",n]) or "unknown"
        out.append({"name":n,"state":f"{active} / {enabled}"})
    return out

def processes():
    raw=run(["ps","-eo","pid,pcpu,pmem,comm","--sort=-pcpu"])
    rows=[]
    for line in raw.splitlines()[1:13]:
        parts=line.split(None,3)
        if len(parts)==4:
            rows.append({"pid":parts[0],"cpu":parts[1],"mem":parts[2],"cmd":parts[3]})
    return rows

mt,mu,ma,st,su,sf=meminfo()
root=disk("/")
load=os.getloadavg() if hasattr(os,"getloadavg") else (0,0,0)
ips=run(["hostname","-I"])
route=run(["ip","route","get","1.1.1.1"])
primary=""
if " src " in route:
    primary=route.split(" src ",1)[1].split()[0]
metrics=[]
def add(cat, metric, value): metrics.append({"cat":cat,"metric":metric,"value":str(value)})
add("Sistema","Hostname",socket.gethostname())
add("Sistema","Fecha servidor",time.strftime("%Y-%m-%d %H:%M:%S %Z"))
add("Sistema","Uptime",run(["uptime","-p"]))
add("Sistema","Kernel",platform.release())
add("Sistema","Arquitectura",platform.machine())
os_pretty=""
for _line in read("/etc/os-release").splitlines():
    if _line.startswith("PRETTY_NAME="):
        os_pretty=_line.split("=",1)[1].strip().strip("\"")
        break
add("Sistema","OS",os_pretty or platform.system())
add("CPU","Modelo",run(["bash","-lc","lscpu | awk -F: '/Model name|Hardware|Model/ {gsub(/^[ \\t]+/,\"\",$2); print $2; exit}'"]))
add("CPU","Cores lógicos",os.cpu_count())
add("CPU","Load avg",f"{load[0]:.2f}, {load[1]:.2f}, {load[2]:.2f}")
add("CPU","Temperatura",temp())
add("Memoria","RAM total",f"{gb(mt)} GB")
add("Memoria","RAM usada",f"{gb(mu)} GB")
add("Memoria","RAM disponible",f"{gb(ma)} GB")
add("Memoria","Swap total",f"{gb(st)} GB")
add("Memoria","Swap usada",f"{gb(su)} GB")
add("Disco","/ total",f"{root['total_gb']} GB")
add("Disco","/ usado",f"{root['used_gb']} GB ({root['used_pct']}%)")
add("Disco","/ libre",f"{root['free_gb']} GB")
add("Disco","df -h",run(["df","-h","/"]).replace("\n"," | "))
add("Disco","Inodos",run(["df","-ih","/"]).replace("\n"," | "))
add("Red","IP principal",primary or "No detectada")
add("Red","IPs",ips)
add("Red","Ruta default",run(["ip","route","show","default"]))
add("Red","Puertos escuchando",run(["bash","-lc","ss -tulpen 2>/dev/null | head -n 20"]).replace("\n"," | "))
for svc in services(): add("Servicios",svc["name"],svc["state"])
add("Procesos","Total",run(["bash","-lc","ps -e --no-headers | wc -l"]))
print(json.dumps({"metrics":metrics,"processes":processes(),"host":socket.gethostname(),"load":f"{load[0]:.2f}, {load[1]:.2f}, {load[2]:.2f}","stamp":time.strftime("%Y-%m-%d %H:%M:%S %Z")}, ensure_ascii=False))
`

function renderServerStats(data) {
  const body = $('serverStatsBody')
  const procBody = $('serverProcessesBody')
  $('serverStamp').textContent = `Actualizado: ${data.stamp || '-'}`
  $('serverHost').textContent = `Host: ${data.host || '-'}`
  $('serverLoad').textContent = `Load: ${data.load || '-'}`
  body.innerHTML = ''
  for (const row of data.metrics || []) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${escapeHtml(row.cat)}</td><td>${escapeHtml(row.metric)}</td><td>${escapeHtml(row.value)}</td>`
    body.appendChild(tr)
  }
  if (!body.children.length) body.innerHTML = '<tr><td colspan="3" class="empty">Sin datos.</td></tr>'
  procBody.innerHTML = ''
  for (const row of data.processes || []) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${escapeHtml(row.pid)}</td><td>${escapeHtml(row.cpu)}</td><td>${escapeHtml(row.mem)}</td><td>${escapeHtml(row.cmd)}</td>`
    procBody.appendChild(tr)
  }
  if (!procBody.children.length) procBody.innerHTML = '<tr><td colspan="4" class="empty">Sin procesos.</td></tr>'
}

async function loadServerStats() {
  if (!$('serverStatsBody')) return
  $('serverStatsBody').innerHTML = '<tr><td colspan="3" class="empty">Cargando estadísticas...</td></tr>'
  $('serverProcessesBody').innerHTML = '<tr><td colspan="4" class="empty">Cargando procesos...</td></tr>'
  const job = await runJob('shell.exec', { command: 'python3', args: ['-c', serverStatsPython], cwd: '/', timeoutMs: 30000 }, 'Estadísticas del servidor desde gateway')
  if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || 'No se pudieron cargar estadísticas')
  const raw = job.stdoutTail || ''
  renderServerStats(JSON.parse(raw))
}


const servicesAdminPython = String.raw`
import json, os, re, subprocess, time
CONFIG='/home/pi/Agent-IA-Coder/agent-coder-runs/services.json'
RUN_DIR='/home/pi/Agent-IA-Coder/agent-coder-runs'
os.makedirs(RUN_DIR, exist_ok=True)
SYSTEMD=[
  {'id':'systemd:agent-coder-gateway.service','name':'agent-coder-gateway.service','kind':'systemd','critical':True,'description':'Gateway web/API central. Detenerlo corta esta consola.'},
  {'id':'systemd:agent-coder-runner.service','name':'agent-coder-runner.service','kind':'systemd','critical':True,'description':'Runner remoto usado para ejecutar jobs. Detenerlo corta acciones remotas.'},
  {'id':'systemd:agent-coder-cloudflared.service','name':'agent-coder-cloudflared.service','kind':'systemd','critical':False,'description':'Túnel Cloudflare del gateway.'},
  {'id':'systemd:agent-coder-disk-monitor.timer','name':'agent-coder-disk-monitor.timer','kind':'systemd','critical':False,'description':'Timer de monitoreo de disco.'},
  {'id':'systemd:agent-coder-disk-monitor.service','name':'agent-coder-disk-monitor.service','kind':'systemd','critical':False,'description':'Servicio de monitoreo de disco.'},
]
def run(cmd, timeout=8):
    p=subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return p.stdout.strip(), p.stderr.strip(), p.returncode

def slug(s):
    s=re.sub(r'[^a-zA-Z0-9_.-]+','-',s.strip()).strip('-').lower()
    return s or 'manual-service'

def load_manual():
    try:
        with open(CONFIG,'r',encoding='utf-8') as f: data=json.load(f)
        manual=data.get('services',[]) if isinstance(data,dict) else []
        deleted_defaults=set(data.get('deletedDefaultIds',[]) if isinstance(data,dict) else [])
    except Exception:
        manual=[]
        deleted_defaults=set()
    defaults=[]
    kit_pid='/home/pi/Proyectos/KITs/vite-server.pid'
    if os.path.exists('/home/pi/Proyectos/KITs/package.json'):
        defaults.append({'id':'manual:kits-vite-local','name':'KITs Vite local','kind':'manual','cwd':'/home/pi/Proyectos/KITs','command':'node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173','pidFile':kit_pid,'outLog':'/home/pi/Proyectos/KITs/vite-server.out.log','errLog':'/home/pi/Proyectos/KITs/vite-server.err.log','critical':False,'isDefault':True,'description':'Proyecto KITs extraído y levantado en local.'})
    ids={x.get('id') for x in manual}
    for d in defaults:
        if d['id'] not in ids and d['id'] not in deleted_defaults:
            manual.append(d)
    return manual

def manual_status(s):
    pid=None
    pid_file=s.get('pidFile') or os.path.join(RUN_DIR, s.get('id','manual').replace(':','-')+'.pid')
    try:
        pid=int(open(pid_file).read().strip())
    except Exception:
        pid=None
    active=False
    detail='Sin PID'
    if pid:
        active=os.path.exists(f'/proc/{pid}')
        detail=f'PID {pid}' if active else f'PID {pid} detenido'
    return 'active' if active else 'inactive', detail

def systemd_status(s):
    name=s['name']
    active,_,_=run(['systemctl','is-active',name])
    enabled,_,_=run(['systemctl','is-enabled',name])
    sub,_,_=run(['systemctl','show',name,'--property=SubState','--value'])
    return active or 'unknown', f'{enabled or "unknown"} / {sub or "unknown"}'

services=[]
for s in SYSTEMD:
    active, detail=systemd_status(s)
    services.append({**s,'status':active,'detail':detail})
for s in load_manual():
    active, detail=manual_status(s)
    services.append({**s,'status':active,'detail':detail})
print(json.dumps({'services':services,'stamp':time.strftime('%Y-%m-%d %H:%M:%S %Z'),'configPath':CONFIG}, ensure_ascii=False))
`

function serviceStatusLabel(status) {
  if (status === 'active') return 'Activo'
  if (status === 'inactive') return 'Detenido'
  if (status === 'failed') return 'Fallido'
  return status || '-'
}

function serviceStatusClass(status) {
  if (status === 'active') return 'ok'
  if (status === 'failed') return 'bad'
  return ''
}

function closeServiceMenus(except = null) {
  $$('.service-actions-menu.open').forEach((menu) => {
    if (menu !== except) {
      menu.classList.remove('open')
      menu.style.top = ''
      menu.style.left = ''
      menu.style.right = ''
    }
  })
}

function positionServiceMenu(menu, button) {
  const rect = button.getBoundingClientRect()
  menu.classList.add('open')
  const menuWidth = Math.max(menu.offsetWidth || 0, 138)
  const gap = 4
  let left = rect.left
  if (left + menuWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuWidth - 8)
  let top = rect.bottom + gap
  const menuHeight = menu.offsetHeight || 132
  if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - gap)
  menu.style.left = `${Math.round(left)}px`
  menu.style.top = `${Math.round(top)}px`
  menu.style.right = 'auto'
}

function renderServices(data) {
  state.services = data.services || []
  const body = $('servicesBody')
  $('servicesStamp').textContent = `Actualizado: ${data.stamp || '-'}`
  $('servicesInfo').textContent = `Servicios: ${state.services.length}`
  body.innerHTML = ''
  if (!state.services.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">Sin servicios.</td></tr>'
    return
  }
  for (const svc of state.services) {
    const tr = document.createElement('tr')
    const critical = svc.critical ? '<span class="service-badge danger-badge">Crítico</span>' : ''
    const meta = svc.kind === 'manual' ? `${escapeHtml(svc.cwd || '-')}<br><code>${escapeHtml(svc.command || '')}</code>` : escapeHtml(svc.description || '')
    tr.innerHTML = `
      <td class="service-actions-cell">
        <div class="service-actions-wrap">
          <button class="service-menu-btn" type="button" aria-label="Abrir acciones de ${escapeHtml(svc.name)}" aria-expanded="false">
            <span></span><span></span><span></span>
          </button>
          <div class="service-actions-menu" role="menu"></div>
        </div>
      </td>
      <td><strong>${escapeHtml(svc.name)}</strong> ${critical}<br><span class="muted">${escapeHtml(svc.id)}</span></td>
      <td>${svc.kind === 'manual' ? 'Manual' : 'Systemd'}</td>
      <td><span class="dot ${serviceStatusClass(svc.status)}"></span> ${serviceStatusLabel(svc.status)}</td>
      <td>${escapeHtml(svc.detail || '-')}<br><span class="muted">${meta}</span></td>`
    const menuBtn = tr.querySelector('.service-menu-btn')
    const menu = tr.querySelector('.service-actions-menu')
    const addAction = (label, action, className = '', disabled = false) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = label
      btn.className = className
      btn.disabled = disabled
      btn.onclick = (event) => {
        event.stopPropagation()
        closeServiceMenus()
        requestServiceAction(action, svc.id)
      }
      menu.appendChild(btn)
    }
    addAction('Iniciar', 'start', '', svc.status === 'active')
    addAction('Detener', 'stop', 'danger-menu-item', svc.status !== 'active')
    addAction('Reiniciar', 'restart')
    if (svc.kind === 'manual') addAction('Eliminar', 'delete', 'danger-menu-item')
    menuBtn.onclick = (event) => {
      event.stopPropagation()
      const willOpen = !menu.classList.contains('open')
      closeServiceMenus(menu)
      if (willOpen) positionServiceMenu(menu, menuBtn)
      else menu.classList.remove('open')
      menuBtn.setAttribute('aria-expanded', String(willOpen))
    }
    body.appendChild(tr)
  }
}

async function loadServices() {
  if (!$('servicesBody')) return
  $('servicesBody').innerHTML = '<tr><td colspan="5" class="empty">Cargando servicios...</td></tr>'
  const job = await runJob('shell.exec', { command: 'python3', args: ['-c', servicesAdminPython], cwd: '/', timeoutMs: 30000 }, 'Listar servicios admin')
  if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || 'No se pudieron listar servicios')
  renderServices(JSON.parse(job.stdoutTail || '{}'))
}

function selectedService(id) {
  return state.services.find((svc) => svc.id === id)
}

function openStartServiceModal() {
  const options = state.services.filter((svc) => svc.status !== 'active')
  const select = $('startServiceSelect')
  select.innerHTML = ''
  for (const svc of options) {
    const opt = document.createElement('option')
    opt.value = svc.id
    opt.textContent = `${svc.name} · ${svc.kind === 'manual' ? 'manual' : 'systemd'} · ${serviceStatusLabel(svc.status)}`
    select.appendChild(opt)
  }
  if (!options.length) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'No hay servicios detenidos disponibles'
    select.appendChild(opt)
  }
  $('startServiceModal').showModal()
}

function requestServiceAction(action, serviceId) {
  const svc = selectedService(serviceId)
  if (!svc) return toast('Servicio no encontrado')
  const labels = { start: 'iniciar', stop: 'detener', restart: 'reiniciar', delete: 'eliminar' }
  state.pendingServiceAction = { action, serviceId }
  $('confirmServiceTitle').textContent = `Confirmar ${labels[action] || action}`
  $('confirmServiceText').textContent = `Vas a ${labels[action] || action} ${svc.name}.`
  const critical = $('confirmServiceCritical')
  critical.hidden = !svc.critical
  critical.textContent = svc.critical ? 'CUIDADO: este servicio es crítico para la comunicación actual. Detener o reiniciar Gateway/Runner puede cortar esta sesión.' : ''
  $('confirmServiceActionBtn').textContent = labels[action] ? labels[action].toUpperCase() : 'CONFIRMAR'
  $('confirmServiceModal').showModal()
}

function actionCommandForService(action, svc) {
  if (svc.kind === 'systemd') {
    return `systemctl ${action} ${svc.name}`
  }
  const safeJson = JSON.stringify(svc)
  if (action === 'start') return `python3 - <<'PY'\nimport json, os, subprocess\ns=json.loads(r'''${safeJson}''')\nos.makedirs(os.path.dirname(s.get('pidFile') or '/home/pi/Agent-IA-Coder/agent-coder-runs/x.pid'), exist_ok=True)\nout=s.get('outLog') or ('/home/pi/Agent-IA-Coder/agent-coder-runs/'+s['id'].replace(':','-')+'.out.log')\nerr=s.get('errLog') or ('/home/pi/Agent-IA-Coder/agent-coder-runs/'+s['id'].replace(':','-')+'.err.log')\npidfile=s.get('pidFile') or ('/home/pi/Agent-IA-Coder/agent-coder-runs/'+s['id'].replace(':','-')+'.pid')\ntry:\n    pid=int(open(pidfile).read().strip())\n    os.kill(pid,0)\n    print('Ya estaba activo PID', pid)\n    raise SystemExit(0)\nexcept Exception:\n    pass\ncmd=s['command']; cwd=s.get('cwd') or '/'\np=subprocess.Popen(['bash','-lc',cmd], cwd=cwd, stdout=open(out,'a'), stderr=open(err,'a'), start_new_session=True)\nopen(pidfile,'w').write(str(p.pid))\nprint('Iniciado', s['name'], 'PID', p.pid)\nPY`
  if (action === 'stop') return `python3 - <<'PY'\nimport json, os, signal, time\ns=json.loads(r'''${safeJson}''')\npidfile=s.get('pidFile') or ('/home/pi/Agent-IA-Coder/agent-coder-runs/'+s['id'].replace(':','-')+'.pid')\ntry:\n    pid=int(open(pidfile).read().strip())\nexcept Exception:\n    print('Sin PID activo'); raise SystemExit(0)\ntry:\n    os.kill(pid, signal.SIGTERM)\n    time.sleep(1)\n    if os.path.exists(f'/proc/{pid}'):\n        os.kill(pid, signal.SIGKILL)\n    print('Detenido PID', pid)\nexcept ProcessLookupError:\n    print('PID no existe', pid)\nPY`
  if (action === 'restart') return actionCommandForService('stop', svc) + '\n' + actionCommandForService('start', svc)
  if (action === 'delete') return `python3 - <<'PY'\nimport json, os\nCONFIG='/home/pi/Agent-IA-Coder/agent-coder-runs/services.json'\ns=json.loads(r'''${safeJson}''')\ntry:\n    data=json.load(open(CONFIG,'r',encoding='utf-8'))\nexcept Exception:\n    data={'services':[]}\ndata['services']=[x for x in data.get('services',[]) if x.get('id') != s.get('id')]\nif s.get('isDefault'):\n    deleted=set(data.get('deletedDefaultIds',[]))\n    deleted.add(s.get('id'))\n    data['deletedDefaultIds']=sorted(x for x in deleted if x)\nos.makedirs(os.path.dirname(CONFIG), exist_ok=True)\njson.dump(data, open(CONFIG,'w',encoding='utf-8'), ensure_ascii=False, indent=2)\nprint('Eliminado', s.get('name'))\nPY`
  throw new Error(`Acción no soportada: ${action}`)
}

async function executeServiceAction(action, serviceId) {
  const svc = selectedService(serviceId)
  if (!svc) throw new Error('Servicio no encontrado')
  const cmd = actionCommandForService(action, svc)
  const job = await runJob('shell.exec', { command: 'bash', args: ['-lc', cmd], cwd: '/', timeoutMs: 30000 }, `Servicios admin ${action} ${svc.name}`)
  if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || `No se pudo ejecutar ${action}`)
  toast(job.stdoutTail || `Acción completada: ${action}`)
  await loadServices()
}

async function confirmPendingServiceAction(event) {
  event.preventDefault()
  const pending = state.pendingServiceAction
  if (!pending) return
  $('confirmServiceModal').close()
  await executeServiceAction(pending.action, pending.serviceId)
  state.pendingServiceAction = null
}

async function saveManualService(event) {
  event.preventDefault()
  const name = String($('manualServiceName').value || '').trim()
  const cwd = String($('manualServiceCwd').value || '').trim()
  const command = String($('manualServiceCommand').value || '').trim()
  if (!name || !cwd || !command) return toast('Completa nombre, ruta y comando')
  const startNow = $('manualServiceStartNow').checked
  const py = `import json, os, re\nCONFIG='/home/pi/Agent-IA-Coder/agent-coder-runs/services.json'\nRUN_DIR='/home/pi/Agent-IA-Coder/agent-coder-runs'\nos.makedirs(RUN_DIR, exist_ok=True)\ndef slug(s): return re.sub(r'[^a-zA-Z0-9_.-]+','-',s.strip()).strip('-').lower() or 'manual-service'\ntry:\n    data=json.load(open(CONFIG,'r',encoding='utf-8'))\nexcept Exception:\n    data={'services':[]}\nname=${JSON.stringify(name)}; cwd=${JSON.stringify(cwd)}; command=${JSON.stringify(command)}\nid='manual:'+slug(name)\nbase=os.path.join(RUN_DIR,id.replace(':','-'))\nsvc={'id':id,'name':name,'kind':'manual','cwd':cwd,'command':command,'pidFile':base+'.pid','outLog':base+'.out.log','errLog':base+'.err.log','critical':False,'description':'Servicio manual creado desde Gateway'}\ndata['services']=[x for x in data.get('services',[]) if x.get('id') != id]+[svc]\njson.dump(data, open(CONFIG,'w',encoding='utf-8'), ensure_ascii=False, indent=2)\nprint(json.dumps(svc, ensure_ascii=False))`
  const job = await runJob('shell.exec', { command: 'python3', args: ['-c', py], cwd: '/', timeoutMs: 30000 }, `Crear servicio manual ${name}`)
  if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || 'No se pudo guardar servicio')
  $('createServiceModal').close()
  $('manualServiceName').value = ''; $('manualServiceCwd').value = ''; $('manualServiceCommand').value = ''
  await loadServices()
  if (startNow) {
    const svc = JSON.parse(job.stdoutTail || '{}')
    await executeServiceAction('start', svc.id)
  } else {
    toast('Servicio manual guardado')
  }
}

function wire() {
  syncHeader()
  setRoute(state.route || 'home')
  $$('.nav-btn, .route-shortcut, .brand').forEach((el) => { el.onclick = () => setRoute(el.dataset.route) })
  $('hamburgerBtn').onclick = () => {
    const open = !$('navMenu').classList.contains('open')
    $('navMenu').classList.toggle('open', open)
    $('hamburgerBtn').setAttribute('aria-expanded', String(open))
  }
  $('runnerTarget').oninput = (e) => setRunner(e.target.value)
  $('runnerTargetMobile').oninput = (e) => setRunner(e.target.value)
  $('apiBase').oninput = (e) => { state.apiBase = e.target.value.trim() || '/api'; saveState() }
  $('keyBtn').onclick = () => { $('apiKey').value = state.apiKey; $('keyModal').showModal() }
  $('keyBtnMobile').onclick = () => { $('apiKey').value = state.apiKey; $('keyModal').showModal() }
  $('acceptKeyBtn').onclick = (e) => { e.preventDefault(); state.apiKey = $('apiKey').value; saveState(); $('keyModal').close(); toast('Key guardada') }
  $('saveConfig').onclick = () => { state.apiBase = $('apiBase').value; state.apiKey = $('apiKey').value; saveState(); toast('Configuración guardada') }
  $('healthBtn').onclick = testHealth
  $('homeHealthBtn').onclick = testHealth
  $('runnersBtn').onclick = async () => { try { print(await api('/runners')) } catch (e) { print(e.message) } }
  $('jobsBtn').onclick = async () => { try { print(await api('/jobs?limit=30')) } catch (e) { print(e.message) } }
  $('createJobBtn').onclick = async () => {
    try { print(await createJob($('jobType').value, JSON.parse($('payload').value), $('jobNote').value)) } catch (e) { print(e.message) }
  }
  $('sampleListBtn').onclick = () => { $('jobType').value = 'file.list'; $('payload').value = JSON.stringify({ path: '.', maxDepth: 1, maxEntries: 200, showHidden: false }, null, 2) }
  $('sampleNodeBtn').onclick = () => { $('jobType').value = 'shell.exec'; $('payload').value = JSON.stringify({ command: 'node', args: ['--version'], cwd: '.', timeoutMs: 30000 }, null, 2) }
  $('sampleStatusBtn').onclick = () => { $('jobType').value = 'git.status'; $('payload').value = JSON.stringify({ path: '.', timeoutMs: 30000 }, null, 2) }
  $('goPathBtn').onclick = () => loadFiles().catch((e) => toast(e.message))
  $('refreshServerBtn').onclick = () => loadServerStats().catch((e) => toast(e.message))
  $('refreshServicesBtn').onclick = () => loadServices().catch((e) => toast(e.message))
  $('openStartServiceBtn').onclick = () => openStartServiceModal()
  $('confirmStartServiceBtn').onclick = (e) => { e.preventDefault(); const id = $('startServiceSelect').value; $('startServiceModal').close(); if (id) requestServiceAction('start', id) }
  $('openCreateServiceBtn').onclick = () => $('createServiceModal').showModal()
  $('confirmServiceActionBtn').onclick = (e) => confirmPendingServiceAction(e).catch((error) => toast(error.message))
  $('saveManualServiceBtn').onclick = (e) => saveManualService(e).catch((error) => toast(error.message))
  document.addEventListener('click', () => closeServiceMenus())
  window.addEventListener('scroll', () => closeServiceMenus(), true)
  window.addEventListener('resize', () => closeServiceMenus())
  $('upBtn').onclick = () => openDir(parentPath(state.currentPath))
  $('actionsBtn').onclick = () => $('actionsModal').showModal()
  $('refreshFilesBtn').onclick = (e) => { e.preventDefault(); closeActionsModal(); loadFiles().catch((err) => toast(err.message)) }
  $('showHidden').onchange = () => { state.showHidden = $('showHidden').checked; saveState(); loadFiles().catch((e) => toast(e.message)) }
  $('selectAll').onchange = (e) => { state.selected = new Set(e.target.checked ? state.files.map((f) => f.path) : []); renderFiles() }
  $('downloadSelectedBtn').onclick = (e) => { e.preventDefault(); closeActionsModal(); downloadSelected().catch((err) => toast(err.message)) }
  $('zipSelectedBtn').onclick = (e) => { e.preventDefault(); closeActionsModal(); zipSelected().catch((err) => toast(err.message)) }
  $('deleteSelectedBtn').onclick = (e) => { e.preventDefault(); closeActionsModal(); deleteSelected().catch((err) => toast(err.message)) }
  $('showCreateFolderBtn').onclick = (e) => { e.preventDefault(); showCreateFolderModal() }
  $('createFolderBtn').onclick = (e) => createFolder(e).catch((error) => toast(error.message))
  $('newFolderName').onkeydown = (e) => { if (e.key === 'Enter') createFolder(e).catch((error) => toast(error.message)) }
  $('uploadFiles').onchange = (e) => uploadFiles(e).catch((error) => toast(error.message))
  $('saveEditorBtn').onclick = (e) => saveEditor(e).catch((error) => toast(error.message))
  $('openTextBtn').onclick = (e) => openPendingText(e).catch((error) => toast(error.message))
}

wire()
