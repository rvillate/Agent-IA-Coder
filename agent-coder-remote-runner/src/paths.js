import fs from 'node:fs/promises'
import path from 'node:path'

export function createPathGuard(workspaceRoot) {
  const root = path.resolve(workspaceRoot)
  function resolveSafe(relativePath = '.') {
    const target = path.resolve(root, relativePath || '.')
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Ruta fuera del workspace bloqueada: ${relativePath}`)
    }
    return target
  }
  return { root, resolveSafe }
}

export async function ensureWorkspace(root) {
  await fs.mkdir(root, { recursive: true })
}
