/** Deterministic socket and HTTP tests with per-instance ports and owned fake time. */
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PokerClient } from '../src/client/connection.ts'
import { configSchema } from '../src/config.ts'
import { roomSchema } from '../src/client/protocol.ts'

const room = roomSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/playing.json', import.meta.url), 'utf8')))
const account = { userID: 4, username: 'Dana', avatarURL: '/account/avatars/4', balance: '42.5', initialized: true }
class Socket extends EventTarget {
  CONNECTING = 0
  OPEN = 1
  CLOSING = 2
  CLOSED = 3
  binaryType: BinaryType = 'blob'
  bufferedAmount = 0
  extensions = ''
  protocol = ''
  readyState = 1
  url = ''
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  sent: string[] = []
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.onclose?.(new CloseEvent('close', { code: 1006 }))
  }
  frame(value: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) }))
  }
}
const owned: PokerClient[] = []
afterEach(() => {
  for (const client of owned.splice(0)) client.dispose()
  vi.useRealTimers()
})
function bench({ session = account, seatless = false, login = 'complete' }: {
  session?: typeof account | null
  seatless?: boolean
  login?: 'complete' | 'challenge'
} = {}) {
  const sockets: Socket[] = []
  const calls: { path: string; body?: string; credentials: RequestCredentials | undefined }[] = []
  const recovery: { value: unknown } = { value: null }
  const failures: ('lost' | 'pending' | 'rejected')[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({
      path,
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      credentials: init?.credentials,
    })
    if (path.endsWith('/account/config'))
      return Response.json({
        data: { tables: ['friends'], captcha: { provider: 'none', siteKey: null, appID: null } },
      })
    if (path.endsWith('/account/logout')) return Response.json({ data: { ok: true } })
    if (path.includes('/account/')) {
      if (login === 'challenge')
        return Response.json({ data: { requires2FA: true, tempToken: 'temp-token', emailMasked: 'd***@example.com' } })
      if (session === null) return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
      return Response.json({ data: session })
    }
    if (init?.method === 'POST') {
      const failure = failures.shift()
      if (failure === 'lost') throw new Error('Transport failed')
      return Response.json({
        data: path.endsWith('/actions')
          ? { accepted: { revision: 1, replayed: false } }
          : { state: failure ?? 'complete' },
      })
    }
    if (path.endsWith('/pending')) return Response.json({ data: recovery.value })
    if (seatless) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
    return Response.json({ data: room })
  })
  const client = new PokerClient(configSchema.parse({}), {
    fetch: fetcher,
    socket: () => {
      const socket = new Socket()
      sockets.push(socket)
      return socket as WebSocket
    },
    origin: 'https://dsh.test',
    now: () => Date.parse('2026-09-21T12:00:00Z'),
    uuid: () => 'unique-command',
  })
  owned.push(client)
  return { client, sockets, calls, failures, recovery }
}
function frame(revision = 0) {
  return {
    type: 'state',
    snapshot: { ...room, hand: { ...room.hand, revision } },
    cursor: { handID: room.hand!.handID, revision },
    batches: [{ revision, events: [{ type: 'player-acted', playerId: '4', action: { kind: 'call' }, paid: 10 }] }],
    reset: revision === 0,
    serverTime: '2026-09-21T12:00:00.000Z',
  }
}
it('restores a relay session with cookie-only transport and serves avatars from the poker service', async () => {
  vi.useFakeTimers()
  const b = bench()
  await b.client.restore()
  expect(b.calls.every(call => call.credentials === 'include')).toBe(true)
  expect(b.client.getSnapshot().account).toEqual({ ...account, avatarURL: '/poker/account/avatars/4' })
  expect(b.client.getSnapshot().status).toBe('live')
  const first = b.sockets[0]!
  first.onopen?.(new Event('open'))
  expect(first.sent[0]).toBe('{"type":"sync"}')
  first.frame(frame())
  expect(b.client.getSnapshot().animate).toBeNull()
  first.frame(frame(1))
  expect(b.client.getSnapshot().animate).toBeTruthy()
  const activity = b.client.getSnapshot().activity
  first.frame(frame(1))
  expect(b.client.getSnapshot().activity).toEqual(activity)
  first.close()
  expect(b.client.getSnapshot().status).toBe('offline')
  await b.client.act({ kind: 'call' })
  expect(b.calls.some(c => c.body)).toBe(false)
  await vi.advanceTimersByTimeAsync(1000)
  const second = b.sockets[1]!
  second.onopen?.(new Event('open'))
  expect(second.sent[0]).toBe(
    JSON.stringify({ type: 'sync', cursor: { handID: room.hand!.handID, revision: 1 } }),
  )
})
it('keeps a signed-out browser in the login form and stores only the challenge', async () => {
  const b = bench({ session: null })
  await b.client.restore()
  expect(b.client.getSnapshot().status).toBe('signed-out')
  expect(b.client.getSnapshot().account).toBeNull()
  const challenged = bench({ login: 'challenge' })
  await challenged.client.login('dana@example.com', 'secret')
  expect(challenged.client.getSnapshot().challenge).toEqual({ token: 'temp-token', maskedEmail: 'd***@example.com' })
  expect(challenged.client.getSnapshot().account).toBeNull()
  await challenged.client.logout()
  expect(challenged.calls.some(call => call.path.endsWith('/account/logout'))).toBe(true)
  expect(challenged.client.getSnapshot().status).toBe('signed-out')
})
it('a login without a seat stays in the lobby and logout clears the local session', async () => {
  const b = bench({ seatless: true })
  await b.client.login('dana@example.com', 'secret')
  expect(JSON.parse(b.calls.find(call => call.body)!.body!)).toEqual({ email: 'dana@example.com', password: 'secret' })
  expect(b.client.getSnapshot().room).toBeNull()
  expect(b.client.getSnapshot().status).toBe('live')
  expect(b.sockets).toHaveLength(0)
  await b.client.logout()
  expect(b.client.getSnapshot().account).toBeNull()
  expect(b.client.getSnapshot().status).toBe('signed-out')
})
it('retains the original action ID and payload after an uncertain delivery', async () => {
  const b = bench()
  await b.client.restore()
  b.sockets[0]!.frame(frame())
  b.failures.push('lost')
  await b.client.act({ kind: 'call' })
  expect(b.client.getSnapshot().pending).toBe(true)
  await b.client.act({ kind: 'fold' })
  expect(b.calls.filter(c => c.body)).toHaveLength(1)
  await b.client.retry()
  expect(b.calls.filter(c => c.body).map(c => c.body)).toEqual([
    b.calls.find(c => c.body)!.body,
    b.calls.find(c => c.body)!.body,
  ])
  expect(b.client.getSnapshot().pending).toBe(false)
})
it('pending wallet results keep one operation and rejected operations release the form', async () => {
  const b = bench()
  await b.client.restore()
  b.failures.push('pending', 'rejected')
  await b.client.fund('buy-in', '10.00')
  expect(b.client.getSnapshot().pending).toBe(true)
  await b.client.retry()
  expect(b.client.getSnapshot().pending).toBe(false)
  expect(b.calls.filter(c => c.body)[0]?.body).toBe(b.calls.filter(c => c.body)[1]?.body)
})
it('rejects malformed frames and prevents disposal from reconnecting or publishing', async () => {
  vi.useFakeTimers()
  const b = bench()
  await b.client.restore()
  b.sockets[0]!.frame({ ...frame(), snapshot: { ...room, turn: { userID: 4, revision: 0, deadlineAt: 'bad-date' } } })
  expect(b.client.getSnapshot().status).toBe('offline')
  const notify = vi.fn()
  b.client.subscribe(notify)
  b.client.dispose()
  await vi.advanceTimersByTimeAsync(5000)
  expect(b.sockets).toHaveLength(1)
  expect(notify).not.toHaveBeenCalled()
})
it('blocks unsafe raise values before any HTTP mutation', async () => {
  const b = bench()
  await b.client.restore()
  await b.client.act({ kind: 'raise-to', amount: 1.5 })
  await b.client.act({ kind: 'raise-to', amount: 999999 })
  expect(b.calls.filter(c => c.body)).toEqual([])
})
it('restores the original funds intent after a refreshed page', async () => {
  const b = bench()
  b.recovery.value = { kind: 'buy-in', operationID: 'original-buy', amount: '12.50' }
  await b.client.restore()
  expect(b.client.getSnapshot().pending).toBe(true)
  await b.client.retry()
  const request = b.calls.find(call => call.body)
  expect(JSON.parse(request!.body!)).toEqual({ operationID: 'original-buy', amount: '12.50' })
  expect(b.client.getSnapshot().pending).toBe(false)
})
