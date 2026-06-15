const $ = (id) => document.getElementById(id)
const output = $('output')
const dot = $('status-dot')
const statusText = $('status-text')

const saved = JSON.parse(localStorage.getItem('agent-coder-gateway-config') || '{}')
if (saved.apiBase) $('apiBase').value = saved.apiBase
if (saved.apiKey) $('apiKey').value = saved.apiKey
if (saved.runnerTarget) $('runnerTarget').value = saved.runnerTarget

function config() {
  return {
    apiBase: $('apiBase').value.replace(/\/$/, ''),
    apiKey: $('apiKey').value,
    runnerTarget: $('runnerTarget').value
  }
}

function print(data) {
  output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
}

function setStatus(ok, text) {
  dot.className = `dot ${ok ? 'ok' : 'bad'}`
  statusText.textContent = text
}

async function api(path, options = {}) {
  const cfg = config()
  const headers = { ...(options.headers || {}) }
  if (cfg.apiKey) headers['x-agent-key'] = cfg.apiKey
  if (options.body) headers['content-type'] = 'application/json'
  const response = await fetch(`${cfg.apiBase}${path}`, { ...options, headers })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!response.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data, null, 2) : data)
  return data
}

$('saveConfig').onclick = () => {
  localStorage.setItem('agent-coder-gateway-config', JSON.stringify(config()))
  setStatus(true, 'Guardado')
}

$('healthBtn').onclick = async () => {
  try {
    const data = await api('/health')
    setStatus(true, 'API OK')
    print(data)
  } catch (e) {
    setStatus(false, 'Error')
    print(e.message)
  }
}

$('runnersBtn').onclick = async () => {
  try { print(await api('/runners')) } catch (e) { print(e.message) }
}

$('jobsBtn').onclick = async () => {
  try { print(await api('/jobs?limit=30')) } catch (e) { print(e.message) }
}

$('createJobBtn').onclick = async () => {
  try {
    const body = {
      type: $('jobType').value,
      runnerTarget: config().runnerTarget,
      note: $('jobNote').value,
      payload: JSON.parse($('payload').value)
    }
    print(await api('/jobs', { method: 'POST', body: JSON.stringify(body) }))
  } catch (e) { print(e.message) }
}

$('sampleListBtn').onclick = () => {
  $('jobType').value = 'file.list'
  $('payload').value = JSON.stringify({ path: '.', maxDepth: 2, maxEntries: 200 }, null, 2)
}
$('sampleNodeBtn').onclick = () => {
  $('jobType').value = 'shell.exec'
  $('payload').value = JSON.stringify({ path: '.', command: 'node --version', timeoutMs: 30000 }, null, 2)
}
$('sampleWriteBtn').onclick = () => {
  $('jobType').value = 'shell.exec'
  $('payload').value = JSON.stringify({ path: '.', command: 'git status --short && node --version', timeoutMs: 30000 }, null, 2)
}
