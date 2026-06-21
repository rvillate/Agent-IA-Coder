import express from 'express'
import { authUsuario } from '../middleware/auth.js'
import { login, registrarCuenta } from '../servicios/usuariosServicio.js'
export const authRouter=express.Router()
authRouter.post('/registro',async(req,res,next)=>{try{res.json({ok:true,...await registrarCuenta(req.body)})}catch(e){next(e)}})
authRouter.post('/login',async(req,res,next)=>{try{res.json({ok:true,...await login(req.body)})}catch(e){next(e)}})
authRouter.get('/perfil',authUsuario,(req,res)=>{const c=req.cuenta; res.json({ok:true,cuenta:{id:c.id,gateway_id:c.gateway_id,nombre:c.nombre,email:c.email,rol:c.rol,idioma:c.idioma}})})
