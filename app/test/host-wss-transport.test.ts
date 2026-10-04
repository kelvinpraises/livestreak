// @vitest-environment node
//
// Drives the REAL HostWssTransport (app leg B) against an in-process host that speaks the ONE
// canonical wire protocol from `@livestreak/schema`: POST /remote/:s/join → grant; WSS ui.hello →
// ready + functions; call → call_result; plus a board_patch push. (The real host RELAY — grant
// verification, scope-deny, replay — is proven over real sockets in host/test/remote-wss.test.ts.)

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket as NodeWS, WebSocketServer } from 'ws'
import { bridgeActionScope, type CapabilityGrant } from '@livestreak/schema'
import { HostWssTransport, type WebSocketLike } from '#/utils/host-wss-transport'

const PASSWORD = 'streak'
const grantFor = (sessionId: string): CapabilityGrant => ({
  id: `grant_${sessionId}`,
  sessionId,
  holder: 'ui:test',
  scopes: ['bridge:action:fund'],
  revoked: false,
  expiresAt: Date.now() + 3_600_000,
  sig: 'stub-sig',
  hostKeyId: 'stub-key',
})

const FUNCTIONS = [{ name: 'fund', label: 'Fund', scope: 'bridge:action:fund', disabled: false }]

describe('HostWssTransport (leg B) against an in-process canonical host', () => {
  let server: Server
  let wss: WebSocketServer
  let baseUrl: string
  let available = true

  beforeEach(async () => {
    available = true
    server = createServer((req, res) => {
      const match = /^\/remote\/([^/]+)\/join$/.exec(req.url ?? '')
      if (req.method === 'POST' && match) {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const password = (JSON.parse(body || '{}') as { password?: string }).password
          if (password !== PASSWORD) {
            res.writeHead(401).end(JSON.stringify({ error: { message: 'invalid password' } }))
            return
          }
          const sessionId = decodeURIComponent(match[1]!)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ grant: grantFor(sessionId), wsPath: `/remote/${sessionId}/ui` }))
        })
        return
      }
      res.writeHead(404).end()
    })

    wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      if (!/^\/remote\/[^/]+\/ui/.test(req.url ?? '')) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('message', (data) => {
          const frame = JSON.parse(data.toString()) as { type: string; callId?: string; sessionId?: string }
          if (!available) return
          if (frame.type === 'ui.hello') {
            ws.send(JSON.stringify({ type: 'ready', sessionId: frame.sessionId, functions: FUNCTIONS }))
          } else if (frame.type === 'call') {
            ws.send(
              JSON.stringify({
                type: 'call_result',
                callId: frame.callId,
                ok: true,
                result: { txId: '0x1', tokenId: '42' },
              }),
            )
            ws.send(JSON.stringify({ type: 'board_patch', board: { calls: 1 } }))
          }
        })
        wss.emit('connection', ws, req)
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    for (const ws of wss.clients) ws.terminate()
    wss.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const newTransport = () =>
    new HostWssTransport({
      hostBaseUrl: baseUrl,
      webSocketFactory: (url) => new NodeWS(url) as unknown as WebSocketLike,
    })

  it('redeem → connect → ready(functions) → send → call_result + board_patch', async () => {
    const t = newTransport()
    const functions: unknown[] = []
    const boards: unknown[] = []
    t.onFunctions((f) => functions.push(...f))
    t.onPatch((b) => boards.push(b))

    const session = await t.redeem('demo', PASSWORD)
    expect(session.grant.sessionId).toBe('demo')

    await t.connect(session)
    expect(t.status).toBe('open')
    expect((functions[0] as { name: string }).name).toBe('fund')

    const result = await t.send({ scope: bridgeActionScope, action: 'fund', args: { deposit: '1' } })
    expect(result.ok).toBe(true)
    // The gateway's call outcome must survive the transport — mint's tokenId is the console's confirmation.
    expect(result.result).toEqual({ txId: '0x1', tokenId: '42' })
    await new Promise((r) => setTimeout(r, 20))
    expect(boards.length).toBeGreaterThan(0)

    t.disconnect()
  })

  it('rejects a wrong password at redeem (401)', async () => {
    const t = newTransport()
    await expect(t.redeem('demo', 'wrong')).rejects.toThrow(/Invalid password/)
  })
  it('reconnects with a full snapshot and never resends an ambiguous call', async () => {
    let connections = 0
    let calls = 0
    wss.on('connection', ws => {
      connections++
      ws.on('message', data => {
        const f = JSON.parse(data.toString()) as { type: string }
        if (f.type === 'ui.hello') ws.send(JSON.stringify({ type: 'ready', sessionId: 'demo', functions: FUNCTIONS, boards: { observe: { revision: connections } } }))
        if (f.type === 'call') calls++
      })
    })
    const t = new HostWssTransport({ hostBaseUrl: baseUrl, retryDelaysMs: [10, 20], readyTimeoutMs: 100, webSocketFactory: url => new NodeWS(url) as unknown as WebSocketLike })
    const statuses: string[] = []
    let board: unknown
    t.onStatus(s => statuses.push(s)); t.onPatch(b => { board = b })
    await t.connect(await t.redeem('demo', PASSWORD))
    await new Promise(r => setTimeout(r, 20))
    for (const ws of wss.clients) ws.terminate()
    await expect.poll(() => ({ status: t.status, board }), { timeout: 1000 }).toEqual({
      status: 'open', board: { observe: { revision: 2 } },
    })
    expect(statuses).toContain('reconnecting')
    expect(calls).toBe(0)
    t.disconnect()
  })

  it('reports explicit revocation and expiry and cancels reconnect after Leave', async () => {
    const t = newTransport()
    await t.connect(await t.redeem('demo', PASSWORD))
    for (const ws of wss.clients) ws.send(JSON.stringify({ type: 'revoked', reason: 'ttl_expired' }))
    await new Promise(r => setTimeout(r, 20)); expect(t.status).toBe('expired')
    t.disconnect()
    const r = newTransport(); await r.connect(await r.redeem('demo', PASSWORD))
    for (const ws of wss.clients) ws.send(JSON.stringify({ type: 'revoked', reason: 'revoked' }))
    await new Promise(resolve => setTimeout(resolve, 20)); expect(r.status).toBe('revoked')
    r.disconnect()
  })

  it('exhausts bounded retries and Leave prevents a delayed reconnect', async () => {
    let dials = 0
    const t = new HostWssTransport({ hostBaseUrl: baseUrl, retryDelaysMs: [5, 10], readyTimeoutMs: 20, webSocketFactory: url => { dials++; return new NodeWS(url) as unknown as WebSocketLike } })
    await t.connect(await t.redeem('demo', PASSWORD))
    available = false
    for (const ws of wss.clients) ws.terminate()
    const deadline = Date.now() + 1000
    while (t.status !== 'unavailable' && Date.now() < deadline) await new Promise(r => setTimeout(r, 5))
    expect(t.status).toBe('unavailable'); expect(dials).toBe(3)
    t.disconnect()
    available = true
    const r = new HostWssTransport({ hostBaseUrl: baseUrl, retryDelaysMs: [100], webSocketFactory: url => { dials++; return new NodeWS(url) as unknown as WebSocketLike } })
    await r.connect(await r.redeem('demo', PASSWORD))
    for (const ws of wss.clients) ws.terminate()
    await new Promise(resolve => setTimeout(resolve, 10)); expect(r.status).toBe('reconnecting')
    const before = dials; r.disconnect()
    await new Promise(resolve => setTimeout(resolve, 150)); expect(dials).toBe(before)
  })

})
