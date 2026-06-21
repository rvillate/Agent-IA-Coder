import { consulta } from '../db/pool.js'
import { jobPublico, TIPOS_JOB_VALIDOS } from '../util/normalizadores.js'
import { limitarTexto, nuevoJobId } from '../util/seguridad.js'
import { env } from '../config/env.js'

const ESTADOS_TERMINALES = ['success','error','timeout','cancelled','rejected']

export async function reconciliarJobsStale(gatewayId){
  await consulta(`UPDATE aplicacion.jobs
    SET estado=CASE WHEN error IS NOT NULL OR COALESCE(exit_code,0)<>0 THEN 'error' ELSE 'success' END,
        resumen=COALESCE(resumen,'Reconciliado automáticamente: job terminado con estado running'),
        actualizado_en=now()
    WHERE gateway_id=$1
      AND estado='running'
      AND terminado_en IS NOT NULL`, [gatewayId])

  await consulta(`UPDATE aplicacion.jobs j
    SET estado='timeout',
        error=COALESCE(error,'Job running huérfano: runner no lo reporta activo'),
        resumen=COALESCE(resumen,'Reconciliado automáticamente: job huérfano'),
        terminado_en=now(),
        actualizado_en=now()
    WHERE j.gateway_id=$1
      AND j.estado='running'
      AND j.iniciado_en IS NOT NULL
      AND j.actualizado_en < now() - interval '2 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM aplicacion.runners r
        WHERE r.gateway_id=j.gateway_id
          AND r.id=j.claimed_by
          AND r.ultima_vez > now() - interval '2 minutes'
          AND r.trabajos_activos ? j.id
      )`, [gatewayId])
}

export function validarJob(input,gatewayId){ if(!input||typeof input!=='object') throw new Error('Body JSON requerido'); if(!TIPOS_JOB_VALIDOS.has(input.type)) throw new Error(`type inválido: ${input.type}`); if(!input.runnerTarget||typeof input.runnerTarget!=='string') throw new Error('runnerTarget es requerido'); if(!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload)) throw new Error('payload debe ser objeto JSON'); return {id:nuevoJobId(),gatewayId,tipo:input.type,estado:'queued',runnerTarget:input.runnerTarget.trim(),payload:input.payload,prioridad:Number(input.priority||0),nota:input.note?String(input.note):''} }
export async function crearJob(input,gatewayId){ const j=validarJob(input,gatewayId); const {rows}=await consulta(`INSERT INTO aplicacion.jobs(id,gateway_id,tipo,estado,runner_target,payload,prioridad,nota) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [j.id,j.gatewayId,j.tipo,j.estado,j.runnerTarget,j.payload,j.prioridad,j.nota]); return jobPublico(rows[0]) }
export async function listarJobs(gatewayId,{limit=20,status='',runnerTarget=''}={}){ await reconciliarJobsStale(gatewayId); const params=[gatewayId]; const where=['gateway_id=$1']; if(status){params.push(status); where.push(`estado=$${params.length}`)} if(runnerTarget){params.push(runnerTarget); where.push(`runner_target=$${params.length}`)} params.push(Math.min(Number(limit||20),100)); const {rows}=await consulta(`SELECT * FROM aplicacion.jobs WHERE ${where.join(' AND ')} ORDER BY actualizado_en DESC LIMIT $${params.length}`,params); return rows.map(r=>jobPublico(r,false)) }
export async function obtenerJob(gatewayId,id){ await reconciliarJobsStale(gatewayId); const {rows}=await consulta('SELECT * FROM aplicacion.jobs WHERE gateway_id=$1 AND id=$2',[gatewayId,id]); return jobPublico(rows[0]) }
export async function reclamarSiguiente(gatewayId,runnerId){ const {rows}=await consulta(`UPDATE aplicacion.jobs SET estado='running', claimed_by=$2, iniciado_en=now(), actualizado_en=now() WHERE id=(SELECT id FROM aplicacion.jobs WHERE gateway_id=$1 AND runner_target=$2 AND estado='queued' ORDER BY prioridad DESC, creado_en ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,[gatewayId,runnerId]); return jobPublico(rows[0]) }
export async function actualizarJobDesdeRunner(gatewayId,runnerId,jobId,body){ const estado=String(body.status||''); const permitidos=new Set(['running','needs_approval','success','error','timeout','cancelled','rejected']); if(!permitidos.has(estado)) throw new Error('status inválido'); const terminal=ESTADOS_TERMINALES.includes(estado); const {rows}=await consulta(`UPDATE aplicacion.jobs SET estado=$4, claimed_by=$2, actualizado_en=now(), exit_code=COALESCE($5, exit_code), resumen=COALESCE($6, resumen), error=COALESCE($7, error), stdout_tail=COALESCE($8, stdout_tail), stderr_tail=COALESCE($9, stderr_tail), resultado=COALESCE($10, resultado), truncado=COALESCE($11, truncado), local_log_path=COALESCE($12, local_log_path), needs_approval_at=CASE WHEN $4='needs_approval' THEN now() ELSE needs_approval_at END, terminado_en=CASE WHEN $13 THEN now() ELSE terminado_en END WHERE gateway_id=$1 AND id=$3 AND (runner_target=$2 OR claimed_by=$2) AND NOT (estado IN ('success','error','timeout','cancelled','rejected') AND NOT $13) RETURNING *`, [gatewayId,runnerId,jobId,estado,body.exitCode??null,body.summary?limitarTexto(body.summary,2000):null,body.error?limitarTexto(body.error,4000):null,'stdoutTail'in body?limitarTexto(body.stdoutTail,env.maxTailChars):null,'stderrTail'in body?limitarTexto(body.stderrTail,env.maxTailChars):null,'result'in body?body.result:null,'truncated'in body?Boolean(body.truncated):null,body.localLogPath?limitarTexto(body.localLogPath,1000):null,terminal]); if(!rows[0]){ const actual=await obtenerJob(gatewayId,jobId); if(actual) return actual; throw new Error('Job no encontrado o no pertenece al runner') } return jobPublico(rows[0]) }
