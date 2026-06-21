import React, { useState } from 'react'
import { Activity, Code2, Database, Rocket, Save, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tarjeta, IconBox, Estado } from '../componentes/UI.jsx'
import { api, crearJob, health, runners } from '../servicios/api.js'

export function TestApis() {
  const { t } = useTranslation()
  const [out, setOut] = useState(t('test.listo'))
  const [status, setStatus] = useState(t('inicio.sinProbar'))
  const [payload, setPayload] = useState(JSON.stringify({ path: '/', maxDepth: 1, maxEntries: 200 }, null, 2))
  async function probar() { try { const r = await health(); setStatus(t('test.apiOk')); setOut(JSON.stringify(r, null, 2)) } catch (e) { setStatus(t('test.error')); setOut(e.message) } }
  return <div className="test-grid">
    <Tarjeta><div className="split-title"><IconBox><Code2/></IconBox><div><p className="eyebrow">{t('test.configuracionApi')}</p><label>{t('test.apiBaseUrl')}<input value="/api" readOnly /></label></div></div><div className="actions-row"><button className="primary"><Save size={18}/>{t('comun.guardar')}</button><button onClick={probar}><Activity size={18}/>{t('test.probarHealth')}</button><button onClick={async()=>setOut(JSON.stringify(await runners(), null, 2))}><Server size={18}/>{t('test.verRunners')}</button><button onClick={async()=>setOut(JSON.stringify(await api('/jobs?limit=20'), null, 2))}><Database size={18}/>{t('test.verJobs')}</button></div></Tarjeta>
    <Tarjeta className="status-card"><Activity size={42}/><p>{t('test.estadoActual')}</p><h2>{status}</h2><Estado>{t('inicio.noEjecutada')}</Estado></Tarjeta>
    <Tarjeta className="wide"><h2>{t('test.crearJob')}</h2><div className="grid2"><label>{t('comun.tipo')}<select><option>file.list</option><option>shell.exec</option><option>git.status</option></select></label><label>{t('comun.notaOpcional')}<input defaultValue={t('test.pruebaDesdePanel')}/></label></div><label>{t('test.payloadJson')}<textarea value={payload} onChange={(e)=>setPayload(e.target.value)} /></label><div className="actions-row"><button className="primary" onClick={async()=>{try{setOut(JSON.stringify(await crearJob({type:'file.list', runnerTarget:localStorage.getItem('sa_runner')||'master-server', payload:JSON.parse(payload)}), null, 2))}catch(e){setOut(e.message)}}}><Rocket size={18}/>{t('test.crearJob')}</button></div><pre>{out}</pre></Tarjeta>
  </div>
}
