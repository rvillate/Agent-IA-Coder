import express from 'express'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { authUsuario } from '../middleware/auth.js'

const execFileAsync = promisify(execFile)
export const serviciosAdminRouter = express.Router()

const raizApp = process.cwd()
const dataDir = path.join(raizApp, 'data')
const configPath = path.join(dataDir, 'servicios-admin-config.json')
const monitorStatePath = path.join(dataDir, 'servicios-admin-monitor-state.json')
const monitorScriptPath = path.join(raizApp, 'scripts', 'servicios-admin-monitor.js')
const monitorServiceName = 'controlagent-service-monitor.service'

const serviciosProtegidos = new Set(['runner-agent.service', 'server-agent.service', 'agent-coder-cloudflared.service', 'postgresql.service'])
const serviciosBase = [
  'runner-agent.service',
  'agent-coder-cloudflared.service',
  'agent-coder-disk-monitor.timer',
  'agent-coder-disk-monitor.service',
  'server-agent.service',
  'postgresql.service',
  monitorServiceName
]

function validarNombreServicio(nombre) {
  const service = String(nombre || '').trim()
  if (!/^[A-Za-z0-9_.@-]+\.(service|timer)$/.test(service)) throw new Error('Nombre de servicio inválido')
  return service
}
function shellQuote(valor) { return `'${String(valor || '').replace(/'/g, `'"'"'`)}'` }
async function run(cmd, args = [], options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: options.timeout || 15000, maxBuffer: 4 * 1024 * 1024 })
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (error) {
    return { ok: false, stdout: String(error.stdout || '').trim(), stderr: String(error.stderr || error.message || '').trim(), exitCode: error.code }
  }
}
async function valorSystemctl(args, fallback = 'unknown') {
  const salida = await run('systemctl', args)
  return (salida.stdout || fallback).trim()
}
function configDefault(name, enabled = 'disabled') {
  const gateway = name === 'agent-coder-gateway.service'
  const protegidoBase = serviciosProtegidos.has(name)
  return {
    mostrarSalida: gateway,
    archivoSalida: '',
    recuperarPorDetencion: gateway,
    recuperarAlReiniciarServidor: gateway || enabled === 'enabled',
    revisarCadaSegundos: gateway ? 60 : 120,
    correoEspecialGateway: gateway,
    proteccionActiva: protegidoBase
  }
}
async function leerConfigTodos() {
  try { return JSON.parse(await fs.readFile(configPath, 'utf8')) || {} } catch { return {} }
}
async function guardarConfigTodos(config) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}
async function configServicio(name, enabled = 'disabled') {
  const todos = await leerConfigTodos()
  const base = { ...configDefault(name, enabled), ...(todos[name] || {}) }
  if (name === 'agent-coder-gateway.service') {
    base.recuperarPorDetencion = true
    base.recuperarAlReiniciarServidor = true
    base.correoEspecialGateway = true
    base.revisarCadaSegundos = Math.max(30, Number(base.revisarCadaSegundos || 60))
  }
  return base
}
async function proteccionActivaServicio(name) {
  if (!serviciosProtegidos.has(name)) return false
  const todos = await leerConfigTodos()
  return todos[name]?.proteccionActiva !== false
}

async function guardarProteccionServicio(name, proteccionActiva) {
  if (!serviciosProtegidos.has(name)) throw new Error('Este servicio no tiene protección configurable')
  const todos = await leerConfigTodos()
  const actual = { ...configDefault(name), ...(todos[name] || {}) }
  todos[name] = { ...actual, proteccionActiva: Boolean(proteccionActiva) }
  await guardarConfigTodos(todos)
  return todos[name]
}
function validarArchivoSalida(archivo) {
  const f = String(archivo || '').trim()
  if (!f) return ''
  if (!path.isAbsolute(f)) throw new Error('El archivo de salida debe ser una ruta absoluta')
  if (['/', '/etc/passwd', '/etc/shadow'].includes(f)) throw new Error('Archivo de salida no permitido')
  const permitido = ['/home/pi/', '/var/log/', '/tmp/']
  if (!permitido.some((p) => f.startsWith(p))) throw new Error('Archivo de salida fuera de rutas permitidas: /home/pi, /var/log o /tmp')
  return f
}
async function escribirMonitorFiles() {
  await fs.mkdir(path.join(raizApp, 'scripts'), { recursive: true })
  await fs.mkdir(dataDir, { recursive: true })
  const monitor = `#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

const configPath = ${JSON.stringify(configPath)}
const statePath = ${JSON.stringify(monitorStatePath)}
const tickMs = 30000
function log(...args){ console.log(new Date().toISOString(), ...args) }
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')) } catch { return fallback } }
function writeJson(file, data){ fs.mkdirSync(requireDir(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(data,null,2)+'\\n') }
function requireDir(file){ return file.split('/').slice(0,-1).join('/') || '/' }
function run(cmd,args){ try { return execFileSync(cmd,args,{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']}).trim() } catch(e){ return String(e.stdout || e.stderr || e.message || '').trim() } }
function active(service){ return run('systemctl',['is-active',service]) }
function restart(service){ return run('systemctl',['restart',service]) }
function datosHost(){ return [
  'Host: '+os.hostname(),
  'Fecha: '+new Date().toISOString(),
  'IPs: '+Object.values(os.networkInterfaces()).flat().filter(Boolean).filter(x=>!x.internal).map(x=>x.address).join(', '),
  'Gateway status: '+run('systemctl',['status','agent-coder-gateway.service','--no-pager','-l']).slice(0,4000),
  'Puertos: '+run('bash',['-lc','ss -ltnp | grep -E ":(8787|8797) " || true'])
].join('\\n') }
function enviarCorreoGateway(motivo){
  const to = process.env.CONTROLAGENT_GATEWAY_ALERT_EMAIL || process.env.ALERT_EMAIL || process.env.MAIL_TO || ''
  if (!to) { log('gateway recuperado; correo no enviado: destinatario no configurado'); return }
  const subject = '[ControlAgent] Gateway recuperado en '+os.hostname()
  const body = 'Se detectó pérdida/detención del gateway y fue reiniciado.\\nMotivo: '+motivo+'\\n\\n'+datosHost()
  try {
    execFileSync('bash',['-lc', 'if command -v mail >/dev/null 2>&1; then mail -s '+JSON.stringify(subject)+' '+JSON.stringify(to)+'; elif command -v sendmail >/dev/null 2>&1; then sendmail -t; else exit 3; fi'], { input: body, encoding:'utf8', timeout:20000 })
    log('correo gateway enviado a', to)
  } catch(e){ log('no se pudo enviar correo gateway:', String(e.message||e)) }
}
async function ciclo(){
  const cfg = readJson(configPath,{})
  const st = readJson(statePath,{})
  const now = Date.now()
  for (const [service, c] of Object.entries(cfg)) {
    if (!c || !c.recuperarPorDetencion) continue
    const cada = Math.max(30, Number(c.revisarCadaSegundos || 120)) * 1000
    if (st[service]?.lastCheck && now - st[service].lastCheck < cada) continue
    st[service] = { ...(st[service] || {}), lastCheck: now }
    const estado = active(service)
    st[service].lastActive = estado
    if (!['active','activating'].includes(estado)) {
      log('servicio detenido, reiniciando', service, 'estado=', estado)
      const out = restart(service)
      st[service].lastRecovery = new Date().toISOString()
      st[service].lastRecoveryOutput = out.slice(0,2000)
      if (service === 'agent-coder-gateway.service' && c.correoEspecialGateway) enviarCorreoGateway('estado='+estado)
    }
  }
  writeJson(statePath, st)
}
setInterval(() => ciclo().catch(e=>log('error ciclo', e)), tickMs)
ciclo().catch(e=>log('error inicio', e))
`
  await fs.writeFile(monitorScriptPath, monitor, 'utf8')
  await run('chmod', ['755', monitorScriptPath])
}
async function asegurarMonitor() {
  await escribirMonitorFiles()
  const unit = `[Unit]\nDescription=ControlAgent Service Monitor\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${raizApp}\nEnvironmentFile=-${path.join(raizApp, '.env')}\nExecStart=/usr/bin/node ${monitorScriptPath}\nRestart=always\nRestartSec=10\n\n[Install]\nWantedBy=multi-user.target\n`
  const script = `cat > /tmp/controlagent-service-monitor.service <<'EOF'\n${unit}EOF\nsudo -n install -m 0644 /tmp/controlagent-service-monitor.service /etc/systemd/system/${monitorServiceName}\nrm -f /tmp/controlagent-service-monitor.service\nsudo -n systemctl daemon-reload\nsudo -n systemctl enable ${monitorServiceName} >/dev/null\nsudo -n systemctl restart ${monitorServiceName}`
  return run('bash', ['-lc', script], { timeout: 90000 })
}
async function aplicarRecuperacionReinicio(name, config) {
  if (name === 'agent-coder-gateway.service') return run('sudo', ['-n', 'systemctl', 'enable', name], { timeout: 30000 })
  const protegidoActivo = serviciosProtegidos.has(name) && config.proteccionActiva !== false
  if (protegidoActivo) return { ok: true, stdout: 'Servicio protegido: no se cambia enable/disable desde la UI', stderr: '' }
  return run('sudo', ['-n', 'systemctl', config.recuperarAlReiniciarServidor ? 'enable' : 'disable', name], { timeout: 30000 })
}
async function puertosServicio(name) {
  if (String(name || '').endsWith('.timer')) return []
  const controlGroup = await valorSystemctl(['show', name, '-p', 'ControlGroup', '--value'], '')
  const mainPid = await valorSystemctl(['show', name, '-p', 'MainPID', '--value'], '0')
  const script = `CG=${shellQuote(controlGroup)}\nMAIN=${shellQuote(mainPid)}\nTMP=$(mktemp)\nif [ -n "$CG" ] && [ -f "/sys/fs/cgroup$CG/cgroup.procs" ]; then cat "/sys/fs/cgroup$CG/cgroup.procs" >> "$TMP"; fi\nif [ "$MAIN" != "0" ]; then echo "$MAIN" >> "$TMP"; fi\nsort -u "$TMP" | awk 'NF{print}' > "$TMP.pids"\nif [ -s "$TMP.pids" ]; then\n  ss -H -tulpn 2>/dev/null | while IFS= read -r line; do\n    PIDS=$(printf '%s\\n' "$line" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)\n    for p in $PIDS; do\n      if grep -qx "$p" "$TMP.pids"; then echo "$line"; break; fi\n    done\n  done\nfi\nrm -f "$TMP" "$TMP.pids"`
  const salida = await run('bash', ['-lc', script], { timeout: 20000 })
  if (!salida.stdout) return []
  const vistos = new Set(); const puertos = []
  for (const line of salida.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue
    const proto = parts[0]; const state = parts[1]; const local = parts[4]
    const match = local.match(/:(\d+)$/)
    if (!match) continue
    const port = Number(match[1]); const key = `${proto}:${local}:${port}`
    if (vistos.has(key)) continue
    vistos.add(key); puertos.push({ proto, state, address: local, port })
  }
  return puertos.sort((a, b) => a.port - b.port || String(a.proto).localeCompare(String(b.proto)))
}
async function infoServicio(name) {
  const load = await valorSystemctl(['show', name, '-p', 'LoadState', '--value'], 'not-found')
  const active = await valorSystemctl(['is-active', name], 'unknown')
  const enabled = await valorSystemctl(['is-enabled', name], 'unknown')
  const description = await valorSystemctl(['show', name, '-p', 'Description', '--value'], name)
  const fragmentPath = await valorSystemctl(['show', name, '-p', 'FragmentPath', '--value'], '')
  const ports = await puertosServicio(name)
  const config = await configServicio(name, enabled)
  const protectedBase = serviciosProtegidos.has(name)
  const protectedService = protectedBase && config.proteccionActiva !== false
  return { name, type: name.endsWith('.timer') ? 'timer' : 'service', load, active, enabled, description, fragmentPath, ports, portText: ports.length ? ports.map((p) => `${p.port}/${p.proto}`).join(', ') : '—', protected: protectedService, protectedBase, protectionConfigurable: protectedBase, protectedReason: protectedService ? 'Servicio crítico protegido para evitar cortar la comunicación o tumbar ControlAgent' : '', editable: Boolean(fragmentPath) && !protectedService, config, host: os.hostname(), local: true }
}
async function salidaServicio(name) {
  const info = await infoServicio(name)
  const status = await run('systemctl', ['status', name, '--no-pager', '-l'], { timeout: 15000 })
  const journal = await run('journalctl', ['-u', name, '-n', '120', '--no-pager', '--output', 'short-iso'], { timeout: 20000 })
  let archivo = ''
  const archivoSalida = validarArchivoSalida(info.config?.archivoSalida || '')
  if (archivoSalida) {
    const tail = await run('tail', ['-c', '220000', archivoSalida], { timeout: 15000 })
    archivo = tail.stdout || tail.stderr || ''
  }
  return { service: info, config: info.config, outputFile: archivoSalida, fileOutput: archivo, status: status.stdout || status.stderr || '', journal: journal.stdout || journal.stderr || '', statusOk: status.ok, journalOk: journal.ok }
}
async function unitContent(name) {
  const info = await infoServicio(name)
  let contenido = ''
  if (info.fragmentPath) {
    const cat = await run('cat', [info.fragmentPath], { timeout: 15000 })
    if (cat.ok) contenido = cat.stdout
  }
  if (!contenido) {
    const cat = await run('systemctl', ['cat', name], { timeout: 15000 })
    contenido = cat.stdout.replace(/^# .*$/gm, '').trim()
  }
  return { info, contenido }
}
async function escribirUnit(name, contenido) {
  const safeName = validarNombreServicio(name)
  const texto = String(contenido || '').trimEnd() + '\n'
  if (!texto.includes('[Unit]')) throw new Error('El unit debe incluir sección [Unit]')
  if (safeName.endsWith('.service') && !texto.includes('[Service]')) throw new Error('El servicio debe incluir sección [Service]')
  if (safeName.endsWith('.timer') && !texto.includes('[Timer]')) throw new Error('El timer debe incluir sección [Timer]')
  const script = `cat > /tmp/controlagent-unit.tmp <<'EOF'\n${texto.replace(/EOF/g, 'EO_F')}EOF\nsudo -n install -m 0644 /tmp/controlagent-unit.tmp /etc/systemd/system/${safeName}\nrm -f /tmp/controlagent-unit.tmp\nsudo -n systemctl daemon-reload\nsudo -n systemctl enable ${safeName} >/dev/null 2>&1 || true`
  return run('bash', ['-lc', script], { timeout: 90000 })
}
function unitPorFormulario(body) {
  const name = validarNombreServicio(String(body?.nombre || '').trim().endsWith('.timer') || String(body?.nombre || '').trim().endsWith('.service') ? body.nombre : `${body?.nombre}.service`)
  const descripcion = String(body?.descripcion || name).trim()
  const comando = String(body?.comando || '').trim()
  const workingDirectory = String(body?.workingDirectory || '/home/pi/Agent-IA-Coder').trim()
  if (name.endsWith('.timer')) return { name, text: `[Unit]\nDescription=${descripcion}\n\n[Timer]\nOnBootSec=30s\nOnUnitActiveSec=5min\nUnit=${name.replace(/\.timer$/, '.service')}\n\n[Install]\nWantedBy=timers.target\n` }
  if (!comando) throw new Error('El comando es requerido')
  return { name, text: `[Unit]\nDescription=${descripcion}\nAfter=network.target\n\n[Service]\nType=simple\nWorkingDirectory=${workingDirectory}\nExecStart=${comando}\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n` }
}

serviciosAdminRouter.get('/', authUsuario, async (req, res, next) => {
  try { const items = []; for (const service of serviciosBase) items.push(await infoServicio(service)); res.json({ ok: true, host: os.hostname(), items, total: items.length }) } catch (error) { next(error) }
})
serviciosAdminRouter.get('/config', authUsuario, async (req, res, next) => {
  try { const service = validarNombreServicio(req.query.service); res.json({ ok: true, service: await infoServicio(service), config: await configServicio(service, await valorSystemctl(['is-enabled', service], 'disabled')) }) } catch (error) { next(error) }
})
serviciosAdminRouter.put('/config', authUsuario, async (req, res, next) => {
  try {
    const service = validarNombreServicio(req.body?.service)
    const actual = await configServicio(service, await valorSystemctl(['is-enabled', service], 'disabled'))
    const nuevo = {
      ...actual,
      mostrarSalida: Boolean(req.body?.mostrarSalida),
      archivoSalida: validarArchivoSalida(req.body?.archivoSalida || ''),
      recuperarPorDetencion: Boolean(req.body?.recuperarPorDetencion),
      recuperarAlReiniciarServidor: Boolean(req.body?.recuperarAlReiniciarServidor),
      revisarCadaSegundos: Math.max(30, Math.min(86400, Number(req.body?.revisarCadaSegundos || actual.revisarCadaSegundos || 120))),
      correoEspecialGateway: service === 'agent-coder-gateway.service' ? true : Boolean(req.body?.correoEspecialGateway),
      proteccionActiva: serviciosProtegidos.has(service) ? actual.proteccionActiva !== false : false
    }
    if (service === 'agent-coder-gateway.service') { nuevo.recuperarPorDetencion = true; nuevo.recuperarAlReiniciarServidor = true; nuevo.correoEspecialGateway = true }
    const todos = await leerConfigTodos(); todos[service] = nuevo; await guardarConfigTodos(todos)
    const boot = await aplicarRecuperacionReinicio(service, nuevo)
    const monitor = await asegurarMonitor()
    res.json({ ok: true, service: await infoServicio(service), config: nuevo, stdout: [boot.stdout, monitor.stdout].filter(Boolean).join('\n'), stderr: [boot.stderr, monitor.stderr].filter(Boolean).join('\n') })
  } catch (error) { next(error) }
})
serviciosAdminRouter.post('/proteccion', authUsuario, async (req, res, next) => {
  try {
    const service = validarNombreServicio(req.body?.service)
    const proteger = Boolean(req.body?.proteger)
    await guardarProteccionServicio(service, proteger)
    res.json({ ok: true, service: await infoServicio(service), protected: proteger })
  } catch (error) { next(error) }
})

serviciosAdminRouter.get('/salida', authUsuario, async (req, res, next) => {
  try { const service = validarNombreServicio(req.query.service); res.json({ ok: true, action: 'output', ...(await salidaServicio(service)) }) } catch (error) { next(error) }
})
serviciosAdminRouter.post('/salida/limpiar', authUsuario, async (req, res, next) => {
  try {
    const service = validarNombreServicio(req.body?.service)
    const cfg = await configServicio(service, await valorSystemctl(['is-enabled', service], 'disabled'))
    const archivo = validarArchivoSalida(cfg.archivoSalida || '')
    if (!archivo) return res.status(400).json({ ok: false, error: 'No hay archivo de salida configurado para limpiar', ...(await salidaServicio(service)) })
    await fs.mkdir(path.dirname(archivo), { recursive: true })
    await fs.writeFile(archivo, '', 'utf8')
    res.json({ ok: true, action: 'clear-output', ...(await salidaServicio(service)) })
  } catch (error) { next(error) }
})
serviciosAdminRouter.get('/unit', authUsuario, async (req, res, next) => {
  try { const service = validarNombreServicio(req.query.service); const { info, contenido } = await unitContent(service); res.json({ ok: true, service: info, contenido }) } catch (error) { next(error) }
})
serviciosAdminRouter.put('/unit', authUsuario, async (req, res, next) => {
  try {
    const service = validarNombreServicio(req.body?.service)
    if (await proteccionActivaServicio(service)) return res.status(403).json({ ok: false, error: 'Servicio crítico protegido. No se puede editar desde la UI.', service: await infoServicio(service) })
    const escrito = await escribirUnit(service, String(req.body?.contenido || ''))
    if (!escrito.ok) return res.status(400).json({ ok: false, error: escrito.stderr || escrito.stdout || 'No se pudo editar el servicio' })
    const restart = await run('sudo', ['-n', 'systemctl', 'restart', service], { timeout: 60000 })
    const info = await infoServicio(service)
    res.json({ ok: true, service: info, stdout: restart.stdout || escrito.stdout, stderr: restart.stderr || escrito.stderr })
  } catch (error) { next(error) }
})
serviciosAdminRouter.delete('/unit', authUsuario, async (req, res, next) => {
  try {
    const service = validarNombreServicio(req.query.service)
    if (await proteccionActivaServicio(service)) return res.status(403).json({ ok: false, error: 'Servicio crítico protegido. No se puede eliminar desde la UI.' })
    const script = `sudo -n systemctl disable --now ${shellQuote(service)} >/dev/null 2>&1 || true\nsudo -n rm -f /etc/systemd/system/${service}\nsudo -n systemctl daemon-reload\nsudo -n systemctl reset-failed ${shellQuote(service)} >/dev/null 2>&1 || true`
    const eliminado = await run('bash', ['-lc', script], { timeout: 90000 })
    if (!eliminado.ok) return res.status(400).json({ ok: false, error: eliminado.stderr || eliminado.stdout || 'No se pudo eliminar el servicio' })
    const idx = serviciosBase.indexOf(service); if (idx >= 0) serviciosBase.splice(idx, 1)
    res.json({ ok: true, service })
  } catch (error) { next(error) }
})
serviciosAdminRouter.post('/control', authUsuario, async (req, res, next) => {
  try {
    const service = validarNombreServicio(req.body?.service)
    const action = String(req.body?.action || '').trim()
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Acción inválida')
    if (await proteccionActivaServicio(service)) return res.status(403).json({ ok: false, error: 'Servicio crítico protegido. No se puede controlar desde la UI para evitar cortar la comunicación.', service: await infoServicio(service) })
    const control = await run('sudo', ['-n', 'systemctl', action, service], { timeout: 60000 })
    const salida = await salidaServicio(service)
    if (!control.ok) return res.status(400).json({ ok: false, action, error: control.stderr || control.stdout || `No se pudo ejecutar ${action}`, stdout: control.stdout, stderr: control.stderr, ...salida })
    res.json({ ok: true, action, stdout: control.stdout, stderr: control.stderr, ...salida })
  } catch (error) { next(error) }
})
serviciosAdminRouter.post('/', authUsuario, async (req, res, next) => {
  try {
    const { name, text } = unitPorFormulario(req.body)
    const creado = await escribirUnit(name, text)
    await run('sudo', ['-n', 'systemctl', 'stop', name], { timeout: 60000 })
    const salida = await salidaServicio(name)
    if (!creado.ok) return res.status(400).json({ ok: false, error: creado.stderr || creado.stdout || 'No se pudo crear el servicio', stdout: creado.stdout, stderr: creado.stderr, ...salida })
    if (!serviciosBase.includes(name)) serviciosBase.push(name)
    res.json({ ok: true, stdout: creado.stdout, stderr: creado.stderr, createdStopped: true, ...salida })
  } catch (error) { next(error) }
})
