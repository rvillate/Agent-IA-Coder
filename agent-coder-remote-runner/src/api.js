export class GatewayClient {
  constructor(config) {
    this.config = config
  }

  buildUrl(path) {
    return `${String(this.config.gatewayUrl).replace(/\/$/, '')}${path}`
  }

  runnerHeaders(extra = {}) {
    return {
      ...extra,
      'x-runner-key': this.config.runnerSharedKey,
      'x-agent-runner-key': this.config.runnerSharedKey,
      authorization: `Bearer ${this.config.runnerSharedKey}`
    }
  }

  async parseResponse(response) {
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : text
      throw new Error(`Gateway ${response.status}: ${message}`)
    }
    return data
  }

  async request(path, body) {
    const response = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers: this.runnerHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(body || {})
    })
    return this.parseResponse(response)
  }

  async get(path) {
    const response = await fetch(this.buildUrl(path), {
      method: 'GET',
      headers: this.runnerHeaders()
    })
    return this.parseResponse(response)
  }

  register(payload) {
    return this.request('/runner/register', payload)
  }

  heartbeat(payload) {
    return this.request('/runner/heartbeat', payload)
  }

  claimNext(runnerId) {
    return this.request('/runner/claim-next', { runnerId })
  }

  updateJob(jobId, payload) {
    return this.request(`/runner/jobs/${encodeURIComponent(jobId)}/update`, payload)
  }

  getJob(jobId) {
    return this.get(`/runner/jobs/${encodeURIComponent(jobId)}/status?runnerId=${encodeURIComponent(this.config.runnerId)}`)
  }
}
