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
  showHidden: false
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

async function uploadFiles(event) {
  const files = Array.from(event.target.files || [])
  if (!files.length) return
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const target = joinPath(state.currentPath, file.name)
    const job = await runJob('file.write', { path: target, contentBase64: bytesToBase64(bytes), backup: true, atomic: true }, `Subir ${file.name}`)
    if (job.status !== 'success') throw new Error(job.stderrTail || job.error || job.summary || `No se pudo subir ${file.name}`)
  }
  event.target.value = ''
  $('actionsModal').close()
  toast(`${files.length} archivo(s) subido(s)`)
  await loadFiles()
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
  $('upBtn').onclick = () => openDir(parentPath(state.currentPath))
  $('actionsBtn').onclick = () => $('actionsModal').showModal()
  $('refreshFilesBtn').onclick = (e) => { e.preventDefault(); loadFiles().catch((err) => toast(err.message)) }
  $('showHidden').onchange = () => { state.showHidden = $('showHidden').checked; saveState(); loadFiles().catch((e) => toast(e.message)) }
  $('selectAll').onchange = (e) => { state.selected = new Set(e.target.checked ? state.files.map((f) => f.path) : []); renderFiles() }
  $('downloadSelectedBtn').onclick = (e) => { e.preventDefault(); downloadSelected().catch((err) => toast(err.message)) }
  $('zipSelectedBtn').onclick = (e) => { e.preventDefault(); zipSelected().catch((err) => toast(err.message)) }
  $('deleteSelectedBtn').onclick = (e) => { e.preventDefault(); deleteSelected().catch((err) => toast(err.message)) }
  $('uploadFiles').onchange = (e) => uploadFiles(e).catch((error) => toast(error.message))
  $('saveEditorBtn').onclick = (e) => saveEditor(e).catch((error) => toast(error.message))
  $('openTextBtn').onclick = (e) => openPendingText(e).catch((error) => toast(error.message))
}

wire()
