import fs from 'node:fs/promises'
import path from 'node:path'

function normalizeForCompare(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isInside(root, target) {
  const rootCmp = normalizeForCompare(root)
  const targetCmp = normalizeForCompare(target)
  if (targetCmp === rootCmp) return true
  const parsedRoot = path.parse(rootCmp).root
  if (rootCmp === parsedRoot) return targetCmp.startsWith(rootCmp)
  return targetCmp.startsWith(rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep)
}

export function createPathGuard(workspaceRoot) {
  const root = path.resolve(workspaceRoot || '.')
  function resolveSafe(relativePath = '.') {
    const input = relativePath == null || relativePath === '' ? '.' : String(relativePath)
    const target = path.resolve(root, input)
    if (!isInside(root, target)) {
      throw new Error(`Ruta fuera del workspace bloqueada: ${input}`)
    }
    return target
  }
  function relativeSafe(targetPath) {
    const target = path.resolve(targetPath)
    if (!isInside(root, target)) {
      throw new Error(`Ruta fuera del workspace bloqueada: ${targetPath}`)
    }
    return path.relative(root, target).replaceAll(path.sep, '/') || '.'
  }
  return { root, resolveSafe, relativeSafe }
}

export async function ensureWorkspace(root) {
  await fs.mkdir(root, { recursive: true })
}
