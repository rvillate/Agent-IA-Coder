import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
export const crearIdGateway = () => `gw_${crypto.randomBytes(10).toString('hex')}`
export const crearClave = (p='sa') => `${p}_${crypto.randomBytes(24).toString('base64url')}`
export const hashSecreto = (v) => bcrypt.hash(v, 10)
export const compararSecreto = (v,h) => (!v || !h) ? false : bcrypt.compare(v,h)
export const firmarToken = (c) => jwt.sign({ sub:c.id, gatewayId:c.gateway_id, email:c.email, rol:c.rol }, env.jwtSecret, { expiresIn:'12h' })
export const verificarToken = (t) => jwt.verify(t, env.jwtSecret)
export const nuevoJobId = () => `job_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`
export const limitarTexto = (v,max) => { const s = v == null ? '' : String(v); return s.length <= max ? s : s.slice(-max) }
