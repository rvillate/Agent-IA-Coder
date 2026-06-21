#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

const configPath = "/home/pi/Proyectos/ControlAgent/ServerAgent/data/servicios-admin-config.json"
const statePath = "/home/pi/Proyectos/ControlAgent/ServerAgent/data/servicios-admin-monitor-state.json"
const tickMs = 30000
function log(...args){ console.log(new Date().toISOString(), ...args) }
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')) } catch { return fallback } }
function writeJson(file, data){ fs.mkdirSync(requireDir(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(data,null,2)+'\n') }
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
].join('\n') }
function enviarCorreoGateway(motivo){
  const to = process.env.CONTROLAGENT_GATEWAY_ALERT_EMAIL || process.env.ALERT_EMAIL || process.env.MAIL_TO || ''
  if (!to) { log('gateway recuperado; correo no enviado: destinatario no configurado'); return }
  const subject = '[ControlAgent] Gateway recuperado en '+os.hostname()
  const body = 'Se detectó pérdida/detención del gateway y fue reiniciado.\nMotivo: '+motivo+'\n\n'+datosHost()
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
