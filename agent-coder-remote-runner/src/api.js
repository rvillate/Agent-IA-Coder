export class GatewayClient {
  constructor(config) {
    this.config = config
  }

  async request(path, body) {
    const response = await fetch(`${this.config.gatewayUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-key': this.config.runnerSharedKey
      },
      body: JSON.stringify(body || {})
    })
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : text
      throw new Error(`Gateway ${response.status}: ${message}`)
    }
    return data
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
}
