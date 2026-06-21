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

function normalizeRoots(workspaceRoots) {
  const values = Array.isArray(workspaceRoots) ? workspaceRoots : [workspaceRoots || '.']
  const seen = new Set()
  const roots = []
  for (const value of values) {
    const root = path.resolve(value || '.')
    const key = process.platform === 'win32' ? root.toLowerCase() : root
    if (seen.has(key)) continue
    seen.add(key)
    roots.push(root)
  }
  return roots.length ? roots : [path.resolve('.')]
}

function findAllowedRoot(roots, target) {
  return roots.find((root) => isInside(root, target)) || null
}

export function createPathGuard(workspaceRoots) {
  const roots = normalizeRoots(workspaceRoots)
  const root = roots[0]

  function resolveSafe(relativePath = '.') {
    const input = relativePath == null || relativePath === '' ? '.' : String(relativePath)
    const candidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input)
    const allowedRoot = findAllowedRoot(roots, candidate)
    if (!allowedRoot) {
      throw new Error(`Ruta fuera de los workspaces bloqueada: ${input}`)
    }
    return candidate
  }

  function relativeSafe(targetPath) {
    const target = path.resolve(targetPath)
    const allowedRoot = findAllowedRoot(roots, target)
    if (!allowedRoot) {
      throw new Error(`Ruta fuera de los workspaces bloqueada: ${targetPath}`)
    }
    return path.relative(allowedRoot, target).replaceAll(path.sep, '/') || '.'
  }

  return { root, roots, resolveSafe, relativeSafe }
}

export async function ensureWorkspace(workspaceRoots) {
  const roots = normalizeRoots(workspaceRoots)
  await Promise.all(roots.map((root) => fs.mkdir(root, { recursive: true })))
}
