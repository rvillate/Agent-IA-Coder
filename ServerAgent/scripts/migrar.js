import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../servidor/db/pool.js'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const raiz = path.resolve(__dirname, '..')
const dir = path.join(raiz, 'db', 'migrations')
await pool.query('CREATE SCHEMA IF NOT EXISTS aplicacion')
await pool.query('CREATE TABLE IF NOT EXISTS aplicacion.migraciones (nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())')
for (const archivo of (await fs.readdir(dir)).filter(x=>x.endsWith('.sql')).sort()) {
  const existe = await pool.query('SELECT 1 FROM aplicacion.migraciones WHERE nombre=$1', [archivo])
  if (existe.rowCount) continue
  const sql = await fs.readFile(path.join(dir, archivo), 'utf8')
  await pool.query('BEGIN')
  try { await pool.query(sql); await pool.query('INSERT INTO aplicacion.migraciones(nombre) VALUES($1)', [archivo]); await pool.query('COMMIT'); console.log(`Migración aplicada: ${archivo}`) }
  catch (e) { await pool.query('ROLLBACK'); throw e }
}
await pool.end()
