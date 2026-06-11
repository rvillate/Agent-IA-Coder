const base = process.env.AGENT_BASE_URL || 'http://localhost:8787'
const response = await fetch(`${base.replace(/\/$/, '')}/api/health`)
console.log(await response.text())
process.exit(response.ok ? 0 : 1)
