import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const sessions = new Map()

function sessionIdFrom(payload = {}) {
  return String(payload.sessionId || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'default'
}

function toNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function browserErrorMessage(error) {
  return [
    'Playwright no está disponible en el runner.',
    'Instala la dependencia en agent-coder-remote-runner con: npm install playwright',
    'Luego instala o configura un navegador: npx playwright install chromium, o define BROWSER_EXECUTABLE_PATH con Chromium/Chrome del sistema.',
    `Detalle: ${error?.message || error}`
  ].join(' ')
}

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch (error) {
    throw new Error(browserErrorMessage(error))
  }
}

function relativeToGuard(guard, fullPath) {
  const roots = Array.isArray(guard?.roots) ? guard.roots : [guard?.root].filter(Boolean)
  const resolved = path.resolve(fullPath)
  const root = roots.find((item) => resolved === item || resolved.startsWith(item.endsWith(path.sep) ? item : item + path.sep))
  return root ? path.relative(root, resolved) || '.' : resolved
}

function normalizeUrl(payload, guard) {
  if (typeof payload.file === 'string' && payload.file.trim()) {
    return pathToFileURL(guard.resolveSafe(payload.file)).href
  }

  const raw = String(payload.url || '').trim()
  if (!raw) return 'about:blank'
  if (raw === 'about:blank') return raw

  const parsed = new URL(raw)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Solo se permiten URLs http/https. Para archivos locales usa payload.file dentro del workspace.')
  }
  return parsed.href
}

function viewportFrom(payload, config) {
  return {
    width: toNumber(payload.width ?? payload.viewportWidth, 1365),
    height: toNumber(payload.height ?? payload.viewportHeight, 768)
  }
}

async function newSession(payload, guard, config) {
  const sessionId = sessionIdFrom(payload)
  const { chromium } = await loadPlaywright()
  const executablePath = String(payload.executablePath || config.browserExecutablePath || '').trim()
  const browser = await chromium.launch({
    headless: payload.headless ?? config.browserHeadless ?? true,
    executablePath: executablePath || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  const context = await browser.newContext({
    viewport: viewportFrom(payload, config),
    ignoreHTTPSErrors: payload.ignoreHTTPSErrors !== false
  })
  const page = await context.newPage()
  const session = { sessionId, browser, context, page, createdAt: Date.now(), lastUsedAt: Date.now() }
  sessions.set(sessionId, session)
  return session
}

async function getSession(payload, guard, config, options = {}) {
  const sessionId = sessionIdFrom(payload)
  const existing = sessions.get(sessionId)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing
  }
  if (options.create) return newSession(payload, guard, config)
  throw new Error(`Sesión browser no existe: ${sessionId}. Ejecuta browser.open primero.`)
}

async function pageInfo(session) {
  const page = session.page
  return {
    sessionId: session.sessionId,
    url: page.url(),
    title: await page.title().catch(() => ''),
    viewport: page.viewportSize?.() || null,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt
  }
}

async function captureIfRequested(page, payload, guard) {
  const outputPath = payload.path || payload.screenshotPath
  const includeBase64 = Boolean(payload.includeBase64)
  if (!outputPath && !includeBase64) return null

  const type = payload.type === 'jpeg' || payload.type === 'jpg' ? 'jpeg' : 'png'
  const buffer = await page.screenshot({
    fullPage: Boolean(payload.fullPage),
    type,
    quality: type === 'jpeg' ? toNumber(payload.quality, 85) : undefined
  })

  let savedPath = null
  if (outputPath) {
    const target = guard.resolveSafe(outputPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, buffer)
    savedPath = relativeToGuard(guard, target)
  }

  return {
    path: savedPath,
    bytes: buffer.length,
    mimeType: type === 'jpeg' ? 'image/jpeg' : 'image/png',
    base64: includeBase64 ? buffer.toString('base64') : undefined
  }
}

async function waitAfter(page, payload) {
  if (payload.waitForSelector) {
    await page.waitForSelector(String(payload.waitForSelector), { timeout: toNumber(payload.timeoutMs, 30000) })
  }
  if (payload.waitMs) await page.waitForTimeout(toNumber(payload.waitMs, 0))
}


export async function listBrowserPreviews(options = {}) {
  const includeScreenshot = options.includeScreenshot !== false
  const previews = []
  for (const [id, session] of sessions.entries()) {
    try {
      const info = await pageInfo(session)
      const preview = { ...info, active: true, capturedAt: Date.now() }
      if (includeScreenshot) {
        const type = options.type === 'png' ? 'png' : 'jpeg'
        const buffer = await session.page.screenshot({
          fullPage: false,
          type,
          quality: type === 'jpeg' ? toNumber(options.quality, 55) : undefined,
          timeout: toNumber(options.timeoutMs, 2500)
        })
        preview.screenshot = {
          mimeType: type === 'jpeg' ? 'image/jpeg' : 'image/png',
          base64: buffer.toString('base64'),
          bytes: buffer.length
        }
      }
      previews.push(preview)
    } catch (error) {
      previews.push({
        sessionId: id,
        active: false,
        error: error?.message || String(error),
        capturedAt: Date.now(),
        createdAt: session?.createdAt || null,
        lastUsedAt: session?.lastUsedAt || null
      })
    }
  }
  return previews
}

export async function browserOpen(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config, { create: true })
  const url = normalizeUrl(payload, guard)
  await session.page.goto(url, {
    waitUntil: payload.waitUntil || 'domcontentloaded',
    timeout: toNumber(payload.timeoutMs, 30000)
  })
  await waitAfter(session.page, payload)
  return { ...(await pageInfo(session)), screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserClick(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  const timeout = toNumber(payload.timeoutMs, 30000)
  if (payload.selector) {
    await session.page.click(String(payload.selector), {
      timeout,
      button: payload.button || 'left',
      clickCount: toNumber(payload.clickCount, 1)
    })
  } else if (payload.x != null && payload.y != null) {
    await session.page.mouse.click(toNumber(payload.x, 0), toNumber(payload.y, 0), {
      button: payload.button || 'left',
      clickCount: toNumber(payload.clickCount, 1)
    })
  } else {
    throw new Error('browser.click requiere payload.selector o coordenadas payload.x/payload.y')
  }
  await waitAfter(session.page, payload)
  return { ...(await pageInfo(session)), screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserType(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  if (!payload.selector) throw new Error('browser.type requiere payload.selector')
  const text = String(payload.text ?? payload.value ?? '')
  const locator = session.page.locator(String(payload.selector)).first()
  if (payload.replace === false) await locator.type(text, { delay: toNumber(payload.delayMs, 0) })
  else await locator.fill(text, { timeout: toNumber(payload.timeoutMs, 30000) })
  await waitAfter(session.page, payload)
  return { ...(await pageInfo(session)), screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserDrag(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  if (payload.source && payload.target) {
    await session.page.dragAndDrop(String(payload.source), String(payload.target), { timeout: toNumber(payload.timeoutMs, 30000) })
  } else if (payload.from && payload.to) {
    const from = payload.from
    const to = payload.to
    await session.page.mouse.move(toNumber(from.x, 0), toNumber(from.y, 0))
    await session.page.mouse.down()
    await session.page.mouse.move(toNumber(to.x, 0), toNumber(to.y, 0), { steps: toNumber(payload.steps, 12) })
    await session.page.mouse.up()
  } else {
    throw new Error('browser.drag requiere source/target CSS o from/to con coordenadas')
  }
  await waitAfter(session.page, payload)
  return { ...(await pageInfo(session)), screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserScreenshot(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  const screenshot = await captureIfRequested(session.page, { ...payload, includeBase64: payload.includeBase64 ?? !payload.path }, guard)
  return { ...(await pageInfo(session)), screenshot }
}

export async function browserEval(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  const expression = String(payload.expression ?? payload.script ?? '')
  if (!expression.trim()) throw new Error('browser.eval requiere payload.expression o payload.script')
  const value = await session.page.evaluate(expression)
  await waitAfter(session.page, payload)
  return { ...(await pageInfo(session)), value, screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserClose(payload = {}, guard, config = {}) {
  const sessionId = sessionIdFrom(payload)
  if (payload.sessionId === 'all') {
    const closed = []
    for (const [id, session] of sessions.entries()) {
      await session.browser.close().catch(() => {})
      sessions.delete(id)
      closed.push(id)
    }
    return { closed }
  }
  const session = sessions.get(sessionId)
  if (!session) return { sessionId, closed: false, message: 'La sesión no existía' }
  await session.browser.close().catch(() => {})
  sessions.delete(sessionId)
  return { sessionId, closed: true }
}
