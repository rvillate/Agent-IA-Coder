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


function safeString(value, max = 200) {
  const text = value == null ? '' : String(value)
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function browserActionError(action, error, context = {}) {
  const parts = [`${action} falló`]
  if (context.selector) parts.push(`selector=${context.selector}`)
  if (context.url) parts.push(`url=${context.url}`)
  parts.push(error?.message || String(error))
  return new Error(parts.join(' | '))
}

async function applyViewportIfRequested(session, payload) {
  if (payload.width == null && payload.height == null && payload.viewportWidth == null && payload.viewportHeight == null) return null
  const current = session.page.viewportSize?.() || viewportFrom(payload, {})
  const viewport = {
    width: toNumber(payload.width ?? payload.viewportWidth, current?.width || 1365),
    height: toNumber(payload.height ?? payload.viewportHeight, current?.height || 768)
  }
  await session.page.setViewportSize(viewport)
  return viewport
}

async function waitForNavigationOrIdle(page, payload, previousUrl = null) {
  const timeout = toNumber(payload.timeoutMs, 30000)
  const waitUntil = payload.waitUntil || 'domcontentloaded'
  const expectsNavigation = payload.expectNavigation || payload.expectUrl || payload.waitForUrl
  if (expectsNavigation) {
    if (payload.expectUrl || payload.waitForUrl) {
      await page.waitForURL(String(payload.expectUrl || payload.waitForUrl), { timeout, waitUntil }).catch(() => {})
    } else {
      await page.waitForLoadState(waitUntil, { timeout }).catch(() => {})
    }
  }
  if (payload.waitForNetworkIdle) await page.waitForLoadState('networkidle', { timeout }).catch(() => {})
  await waitAfter(page, payload)
  if (payload.expectText) {
    await page.getByText(String(payload.expectText), { exact: false }).first().waitFor({ timeout })
  }
  return { previousUrl, urlChanged: previousUrl ? page.url() !== previousUrl : false }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value) !== '')
}

function locatorFromTarget(page, target = {}) {
  if (typeof target === 'string') return page.locator(target).first()
  if (target.selector) return page.locator(String(target.selector)).first()
  if (target.label) return page.getByLabel(String(target.label), { exact: Boolean(target.exact) }).first()
  if (target.placeholder) return page.getByPlaceholder(String(target.placeholder), { exact: Boolean(target.exact) }).first()
  if (target.role) return page.getByRole(String(target.role), { name: target.name ? String(target.name) : undefined, exact: Boolean(target.exact) }).first()
  if (target.text) return page.getByText(String(target.text), { exact: Boolean(target.exact) }).first()
  if (target.name) return page.locator(`[name="${String(target.name).replaceAll('"', '\\"')}"]`).first()
  if (target.testId) return page.getByTestId(String(target.testId)).first()
  throw new Error('Target requiere selector, label, placeholder, role/name, text, name o testId')
}

async function describeLocator(locator, timeout = 30000) {
  await locator.waitFor({ state: 'attached', timeout })
  return await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    const label = (() => {
      if (el.id) {
        const direct = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (direct) return direct.innerText.trim()
      }
      const parent = el.closest('label')
      if (parent) return parent.innerText.trim()
      return ''
    })()
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      label,
      text: (el.innerText || el.textContent || '').trim().slice(0, 200),
      value: el instanceof HTMLInputElement && el.type === 'password' ? '***' : ('value' in el ? String(el.value || '').slice(0, 200) : ''),
      visible: !!(rect.width && rect.height) && style.visibility !== 'hidden' && style.display !== 'none',
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    }
  })
}

async function pageSnapshot(page, payload = {}) {
  const maxItems = Math.min(toNumber(payload.maxItems, 80), 300)
  return await page.evaluate(({ maxItems, includeStorage }) => {
    const clean = (value, max = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return Boolean(rect.width && rect.height && style.visibility !== 'hidden' && style.display !== 'none')
    }
    const cssPath = (el) => {
      if (el.id) return `#${CSS.escape(el.id)}`
      const parts = []
      let node = el
      while (node && node.nodeType === 1 && parts.length < 5) {
        let part = node.tagName.toLowerCase()
        const name = node.getAttribute('name')
        const testId = node.getAttribute('data-testid') || node.getAttribute('data-test')
        if (testId) part += `[data-testid="${CSS.escape(testId)}"]`
        else if (name) part += `[name="${CSS.escape(name)}"]`
        else {
          const parent = node.parentElement
          if (parent) {
            const same = [...parent.children].filter((child) => child.tagName === node.tagName)
            if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`
          }
        }
        parts.unshift(part)
        node = node.parentElement
      }
      return parts.join(' > ')
    }
    const labelFor = (el) => {
      if (el.id) {
        const direct = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (direct) return clean(direct.innerText)
      }
      const parent = el.closest('label')
      return parent ? clean(parent.innerText) : ''
    }
    const roleFor = (el) => el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: el.type === 'submit' ? 'button' : 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox' }[el.tagName] || '')
    const describe = (el, index) => {
      const rect = el.getBoundingClientRect()
      const type = el.getAttribute('type') || ''
      const value = el instanceof HTMLInputElement && el.type === 'password' ? '***' : ('value' in el ? clean(el.value) : '')
      const text = clean(el.innerText || el.textContent)
      const label = labelFor(el)
      const selector = cssPath(el)
      const candidates = [
        el.id ? `#${CSS.escape(el.id)}` : '',
        el.getAttribute('data-testid') ? `[data-testid="${CSS.escape(el.getAttribute('data-testid'))}"]` : '',
        el.getAttribute('name') ? `[name="${CSS.escape(el.getAttribute('name'))}"]` : '',
        el.getAttribute('placeholder') ? `${el.tagName.toLowerCase()}[placeholder="${CSS.escape(el.getAttribute('placeholder'))}"]` : '',
        selector
      ].filter(Boolean)
      return {
        index,
        tag: el.tagName.toLowerCase(),
        role: roleFor(el),
        type,
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        label,
        text,
        href: el.href || '',
        value,
        visible: isVisible(el),
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        selector,
        selectorCandidates: [...new Set(candidates)].slice(0, 6),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      }
    }
    const interactiveSelector = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])'
    const elements = [...document.querySelectorAll(interactiveSelector)].slice(0, maxItems).map(describe)
    const forms = [...document.querySelectorAll('form')].slice(0, 20).map((form, index) => ({
      index,
      action: form.action || '',
      method: form.method || 'get',
      selector: cssPath(form),
      text: clean(form.innerText, 500),
      fields: [...form.querySelectorAll('input,textarea,select')].map((el) => ({ name: el.getAttribute('name') || '', type: el.getAttribute('type') || el.tagName.toLowerCase(), label: labelFor(el), placeholder: el.getAttribute('placeholder') || '' }))
    }))
    const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 30).map((el) => ({ tag: el.tagName.toLowerCase(), text: clean(el.innerText), selector: cssPath(el) }))
    const alerts = [...document.querySelectorAll('[role="alert"],.alert,.error,.toast,[aria-live]')].slice(0, 20).map((el) => ({ text: clean(el.innerText || el.textContent, 500), selector: cssPath(el), visible: isVisible(el) }))
    const storage = includeStorage ? {
      localStorageKeys: Object.keys(localStorage || {}),
      sessionStorageKeys: Object.keys(sessionStorage || {})
    } : undefined
    return {
      url: location.href,
      title: document.title,
      text: clean(document.body?.innerText || '', 2500),
      headings,
      forms,
      elements,
      alerts,
      storage
    }
  }, { maxItems, includeStorage: Boolean(payload.includeStorage) })
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
  await applyViewportIfRequested(session, payload)
  const url = normalizeUrl(payload, guard)
  await session.page.goto(url, {
    waitUntil: payload.waitUntil || 'domcontentloaded',
    timeout: toNumber(payload.timeoutMs, 30000)
  })
  await waitForNavigationOrIdle(session.page, payload)
  return { ...(await pageInfo(session)), screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserClick(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  const timeout = toNumber(payload.timeoutMs, 30000)
  const before = session.page.url()
  try {
    if (payload.selector || payload.text || payload.role || payload.label || payload.testId) {
      const locator = locatorFromTarget(session.page, payload.selector ? { selector: payload.selector } : payload)
      if (payload.trial) await locator.click({ timeout, trial: true })
      await locator.click({ timeout, button: payload.button || 'left', clickCount: toNumber(payload.clickCount, 1) })
    } else if (payload.x != null && payload.y != null) {
      await session.page.mouse.click(toNumber(payload.x, 0), toNumber(payload.y, 0), {
        button: payload.button || 'left',
        clickCount: toNumber(payload.clickCount, 1)
      })
    } else {
      throw new Error('browser.click requiere selector/text/role/label/testId o coordenadas x/y')
    }
  } catch (error) {
    throw browserActionError('browser.click', error, { selector: payload.selector || payload.text || payload.role || '', url: before })
  }
  const navigation = await waitForNavigationOrIdle(session.page, payload, before)
  return { ...(await pageInfo(session)), navigation, screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserType(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  if (!payload.selector && !payload.label && !payload.placeholder && !payload.name && !payload.role && !payload.testId) throw new Error('browser.type requiere selector, label, placeholder, name, role o testId')
  const text = String(payload.text ?? payload.value ?? '')
  const timeout = toNumber(payload.timeoutMs, 30000)
  const locator = locatorFromTarget(session.page, payload)
  try {
    if (payload.replace === false) await locator.type(text, { delay: toNumber(payload.delayMs, 0), timeout })
    else await locator.fill(text, { timeout })
  } catch (error) {
    throw browserActionError('browser.type', error, { selector: payload.selector || payload.label || payload.name || '', url: session.page.url() })
  }
  const field = await describeLocator(locator, timeout).catch(() => null)
  await waitForNavigationOrIdle(session.page, payload)
  return { ...(await pageInfo(session)), field, verified: field ? (field.value === '***' || field.value === safeString(text)) : null, screenshot: await captureIfRequested(session.page, payload, guard) }
}


export async function browserInspect(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  const snapshot = await pageSnapshot(session.page, payload)
  let matches = []
  const query = payload.query || payload.text || payload.selector
  if (query) {
    const needle = String(query).toLowerCase()
    matches = snapshot.elements.filter((item) => [item.text, item.label, item.placeholder, item.name, item.ariaLabel, item.selector].some((value) => String(value || '').toLowerCase().includes(needle)))
  }
  return { ...(await pageInfo(session)), snapshot, matches, screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserFill(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  const fields = Array.isArray(payload.fields) ? payload.fields : []
  if (!fields.length) throw new Error('browser.fill requiere payload.fields con {selector|label|placeholder|name|role|testId, value}')
  const timeout = toNumber(payload.timeoutMs, 30000)
  const results = []
  for (const field of fields) {
    const value = String(field.text ?? field.value ?? '')
    const locator = locatorFromTarget(session.page, field)
    try {
      await locator.fill(value, { timeout })
      const info = await describeLocator(locator, timeout).catch(() => null)
      results.push({ ok: true, target: { selector: field.selector || '', label: field.label || '', name: field.name || '', placeholder: field.placeholder || '' }, value: info?.value || '', verified: info ? (info.value === '***' || info.value === safeString(value)) : null, element: info })
    } catch (error) {
      results.push({ ok: false, target: field, error: error?.message || String(error) })
      if (payload.continueOnError !== true) throw browserActionError('browser.fill', error, { selector: field.selector || field.label || field.name || '', url: session.page.url() })
    }
  }
  await waitForNavigationOrIdle(session.page, payload)
  return { ...(await pageInfo(session)), fields: results, ok: results.every((item) => item.ok), screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserSubmit(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  if (Array.isArray(payload.fields) && payload.fields.length) await browserFill({ ...payload, waitMs: 0, includeBase64: false, path: null, screenshotPath: null }, guard, config)
  const before = session.page.url()
  const timeout = toNumber(payload.timeoutMs, 30000)
  try {
    if (payload.selector || payload.text || payload.role || payload.label || payload.testId) {
      const locator = locatorFromTarget(session.page, payload.selector ? { selector: payload.selector } : payload)
      await locator.click({ timeout })
    } else {
      const button = session.page.locator('button[type="submit"], input[type="submit"], button').first()
      await button.click({ timeout })
    }
  } catch (error) {
    throw browserActionError('browser.submit', error, { selector: payload.selector || payload.text || payload.role || '', url: before })
  }
  const navigation = await waitForNavigationOrIdle(session.page, { waitForNetworkIdle: true, ...payload }, before)
  const snapshot = payload.inspect !== false ? await pageSnapshot(session.page, { maxItems: payload.maxItems || 60 }) : null
  return { ...(await pageInfo(session)), navigation, snapshot, screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserResize(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  const viewport = await applyViewportIfRequested(session, payload)
  if (!viewport) throw new Error('browser.resize requiere width/height o viewportWidth/viewportHeight')
  await waitAfter(session.page, payload)
  return { ...(await pageInfo(session)), resizedTo: viewport, screenshot: await captureIfRequested(session.page, payload, guard) }
}

export async function browserStorage(payload = {}, guard, config = {}) {
  const session = await getSession(payload, guard, config)
  const includeValues = Boolean(payload.includeValues)
  const maxValueLength = Math.min(toNumber(payload.maxValueLength, 16), 200)
  const storage = await session.page.evaluate(({ includeValues, maxValueLength }) => {
    const redact = (key, value) => {
      if (!includeValues) return undefined
      if (/token|key|secret|password|auth|credential/i.test(key)) return '[redacted]'
      const text = String(value || '')
      return text.length <= maxValueLength ? text : `${text.slice(0, maxValueLength)}…`
    }
    const dump = (store) => Object.fromEntries(Object.keys(store).map((key) => [key, redact(key, store.getItem(key))]))
    return {
      cookies: document.cookie ? document.cookie.split(';').map((item) => item.trim().split('=')[0]).filter(Boolean) : [],
      localStorageKeys: Object.keys(localStorage || {}),
      sessionStorageKeys: Object.keys(sessionStorage || {}),
      localStorage: includeValues ? dump(localStorage) : undefined,
      sessionStorage: includeValues ? dump(sessionStorage) : undefined
    }
  }, { includeValues, maxValueLength })
  return { ...(await pageInfo(session)), storage }
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
