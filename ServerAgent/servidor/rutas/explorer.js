import express from 'express'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import { authUsuario } from '../middleware/auth.js'

export const explorerRouter = express.Router()

const TEXT_WARN_BYTES = 1024 * 1024
const TEXT_MAX_BYTES = 8 * 1024 * 1024

function normalizarRuta(valor) {
  const raw = String(valor || '/').trim() || '/'
  const resuelta = path.resolve('/', raw)
  return resuelta.startsWith('/') ? resuelta : '/'
}

function tipoDesdeStats(stats) {
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'
  if (stats.isSymbolicLink()) return 'symlink'
  return 'other'
}

function permisos(stats) {
  return (stats.mode & 0o777).toString(8)
}

function itemPublico(rutaAbs, nombre, stats) {
  const tipo = tipoDesdeStats(stats)
  return {
    name: nombre,
    path: rutaAbs,
    type: tipo,
    size: stats.size,
    permissions: permisos(stats),
    read: Boolean(stats.mode & 0o444),
    write: Boolean(stats.mode & 0o222),
    uid: stats.uid,
    gid: stats.gid,
    mtime: stats.mtimeMs,
    isDirectory: tipo === 'directory',
    isFile: tipo === 'file'
  }
}

async function statSeguro(rutaAbs) {
  try { return await fs.lstat(rutaAbs) } catch { return null }
}

explorerRouter.get('/list', authUsuario, async (req, res, next) => {
  try {
    const ruta = normalizarRuta(req.query.path)
    const stats = await statSeguro(ruta)
    if (!stats) return res.status(404).json({ ok: false, error: 'Ruta no encontrada' })
    if (!stats.isDirectory()) return res.status(400).json({ ok: false, error: 'La ruta no es un directorio' })
    const nombres = await fs.readdir(ruta)
    const items = []
    for (const nombre of nombres) {
      const rutaItem = path.join(ruta, nombre)
      const st = await statSeguro(rutaItem)
      if (!st) continue
      items.push(itemPublico(rutaItem, nombre, st))
    }
    items.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
    res.json({ ok: true, path: ruta, parent: ruta === '/' ? '/' : path.dirname(ruta), items, total: items.length })
  } catch (error) { next(error) }
})

async function caminar(rutaAbs, base, salida, limites) {
  if (salida.length >= limites.maxFiles) return
  const st = await statSeguro(rutaAbs)
  if (!st) return
  if (st.isSymbolicLink()) return
  if (st.isFile()) {
    salida.push({ path: rutaAbs, relativePath: path.relative(base, rutaAbs).split(path.sep).join('/'), size: st.size })
    return
  }
  if (!st.isDirectory()) return
  const nombres = await fs.readdir(rutaAbs)
  for (const nombre of nombres) {
    await caminar(path.join(rutaAbs, nombre), base, salida, limites)
    if (salida.length >= limites.maxFiles) return
  }
}

explorerRouter.post('/manifest', authUsuario, async (req, res, next) => {
  try {
    const seleccion = Array.isArray(req.body?.paths) ? req.body.paths : []
    if (!seleccion.length) return res.status(400).json({ ok: false, error: 'Debe seleccionar mínimo un archivo o carpeta' })
    const files = []
    const dirs = []
    for (const entrada of seleccion) {
      const ruta = normalizarRuta(entrada)
      const st = await statSeguro(ruta)
      if (!st) continue
      if (st.isFile()) files.push({ path: ruta, relativePath: path.basename(ruta), size: st.size })
      else if (st.isDirectory()) {
        dirs.push({ path: ruta, relativePath: path.basename(ruta) })
        const base = path.dirname(ruta)
        await caminar(ruta, base, files, { maxFiles: Number(req.body?.maxFiles || 20000) })
      }
    }
    const totalBytes = files.reduce((acc, f) => acc + Number(f.size || 0), 0)
    res.json({ ok: true, files, dirs, totalFiles: files.length, totalBytes })
  } catch (error) { next(error) }
})


explorerRouter.get('/text', authUsuario, async (req, res, next) => {
  try {
    const ruta = normalizarRuta(req.query.path)
    const force = String(req.query.force || '') === '1'
    const st = await statSeguro(ruta)
    if (!st || !st.isFile()) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' })
    if (st.size > TEXT_WARN_BYTES && !force) return res.json({ ok: true, warning: true, tooLarge: true, path: ruta, name: path.basename(ruta), size: st.size, warnBytes: TEXT_WARN_BYTES, maxBytes: TEXT_MAX_BYTES })
    if (st.size > TEXT_MAX_BYTES) return res.status(413).json({ ok: false, error: `Archivo demasiado grande para editar. Máximo ${TEXT_MAX_BYTES} bytes`, size: st.size, maxBytes: TEXT_MAX_BYTES })
    const content = await fs.readFile(ruta, 'utf8')
    res.json({ ok: true, path: ruta, name: path.basename(ruta), size: st.size, mtime: st.mtimeMs, content })
  } catch (error) { next(error) }
})

explorerRouter.put('/text', authUsuario, async (req, res, next) => {
  try {
    const ruta = normalizarRuta(req.body?.path)
    const content = String(req.body?.content ?? '')
    const st = await statSeguro(ruta)
    if (!st || !st.isFile()) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' })
    if (Buffer.byteLength(content, 'utf8') > TEXT_MAX_BYTES) return res.status(413).json({ ok: false, error: `Contenido demasiado grande para guardar. Máximo ${TEXT_MAX_BYTES} bytes` })
    await fs.writeFile(ruta, content, 'utf8')
    const nuevo = await statSeguro(ruta)
    res.json({ ok: true, path: ruta, name: path.basename(ruta), size: nuevo?.size || Buffer.byteLength(content, 'utf8'), mtime: nuevo?.mtimeMs || Date.now() })
  } catch (error) { next(error) }
})

explorerRouter.get('/file', authUsuario, async (req, res, next) => {
  try {
    const ruta = normalizarRuta(req.query.path)
    const st = await statSeguro(ruta)
    if (!st || !st.isFile()) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' })
    res.setHeader('Content-Length', st.size)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(ruta))}`)
    fssync.createReadStream(ruta).on('error', next).pipe(res)
  } catch (error) { next(error) }
})
