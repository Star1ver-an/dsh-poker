/** React-free mirror of server state; Desktop credentials and sockets are owned by the Host bridge. */
import { z } from 'zod'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import {
  accountSchema,
  challengeSchema,
  frameSchema,
  roomSchema,
  serviceConfigSchema,
  type AccountView,
  type Activity,
  type CaptchaConfig,
  type PokerAction,
  type RoomView,
} from './protocol.ts'
import type { PokerConfig } from '../config.ts'

type Pending = { path: string; body: object; kind: 'action' | 'buy-in' | 'start' | 'leave' }
/** Immutable personal state consumed by framework-generated hooks. */
export interface PokerSnapshot {
  status: 'signed-out' | 'connecting' | 'live' | 'offline'
  account: AccountView | null
  challenge: { token: string; maskedEmail: string | null } | null
  tables: string[]
  captcha: CaptchaConfig
  tableID: string
  room: RoomView | null
  error: string | null
  detail: string | null
  busy: boolean
  pending: boolean
  activity: Activity[]
  animate: string | null
  clockOffset: number
}
/** Instance-local browser ports make reconnection and teardown independently testable. */
export interface PokerPorts {
  fetch: typeof fetch
  socket: (url: string) => WebSocket
  origin: string
  now: () => number
  uuid: () => string
}

/** Owns the socket, the pending command and the in-memory login step until plugin disposal. */
export class PokerClient {
  #state: PokerSnapshot = {
    status: 'signed-out',
    account: null,
    challenge: null,
    tables: [],
    captcha: { provider: 'none', siteKey: null, appID: null },
    tableID: '',
    room: null,
    error: null,
    detail: null,
    busy: false,
    pending: false,
    activity: [],
    animate: null,
    clockOffset: 0,
  }
  #listeners = new Set<() => void>()
  #generation = 0
  #configured = false
  #socket: WebSocket | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #requests = new Set<AbortController>()
  #pending: Pending | undefined
  #cursor: { handID: string; revision: number } | undefined
  #baseline = true
  constructor(
    private config: PokerConfig,
    private ports: PokerPorts,
  ) {}
  /** Stable snapshot until the next publication. */
  getSnapshot = (): PokerSnapshot => this.#state
  /** Subscribe to committed client state; disposal removes only this listener. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  #publish(patch: Partial<PokerSnapshot>) {
    this.#state = { ...this.#state, ...patch }
    notifySubscribers(this.#listeners, 'ui-poker')
  }
  #root() {
    return this.config.endpoint.replace(/\/$/, '')
  }
  /** Changing service discards the previous account and pending retry. */
  resetService() {
    this.disconnect()
    this.#configured = false
    this.#publish({tables:[],tableID:''})
  }
  /** The port relays authenticated requests without exposing session cookies to the UI. */
  async #service(path: string, body?: object): Promise<unknown> {
    const abort = new AbortController()
    this.#requests.add(abort)
    const timer = setTimeout(() => {
      abort.abort()
    }, this.config.requestTimeoutMs)
    try {
      const response = await this.ports.fetch(this.#root() + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: abort.signal,
        redirect: 'error',
        cache: 'no-store',
      })
      const result = z
        .object({ data: z.unknown().optional(), error: z.string().optional(), detail: z.string().nullable().optional() })
        .parse(await response.json())
      if (!response.ok) throw new RequestError(response.status, result.error ?? 'UNAVAILABLE', result.detail ?? null)
      return result.data
    } finally {
      clearTimeout(timer)
      this.#requests.delete(abort)
    }
  }
  #room(path: string, body?: object) {
    return this.#service(`/rooms/${encodeURIComponent(this.#state.tableID)}${path}`, body)
  }
  /** Avatars are served by the poker service, so the browser only ever loads a same-origin address. */
  #avatarPath(path: string) {
    return path.startsWith(this.#root() + '/') ? path : this.#root() + path
  }
  #projectAccount(account: AccountView): AccountView {
    return { ...account, avatarURL: account.avatarURL === null ? null : this.#avatarPath(account.avatarURL) }
  }
  /** Seat avatars are service-relative; the panel needs an address the browser can load. */
  #project(room: RoomView): RoomView {
    return {
      ...room,
      seats: room.seats.map(seat => ({
        ...seat,
        avatarURL: seat.avatarURL === null ? null : this.#avatarPath(seat.avatarURL),
      })),
    }
  }
  #fail(error: unknown) {
    if (error instanceof RequestError) {
      this.#publish({
        error: error.code,
        detail: error.detail,
        ...(error.status === 401 ? { account: null, challenge: null, status: 'signed-out' as const } : {}),
      })
      return
    }
    this.#publish({ error: 'DISCONNECTED', detail: null })
  }
  async #configure(): Promise<void> {
    if (this.#configured) return
    const config = serviceConfigSchema.parse(await this.#service('/account/config'))
    this.#configured = true
    this.#publish({
      tables: config.tables,
      captcha: config.captcha,
      tableID: this.#state.tableID === '' ? (config.tables[0] ?? '') : this.#state.tableID,
    })
  }
  /** Sign in with the relay email and password, or advance to the second-factor step.
   * @param email - relay account email.
   * @param password - relay account password; the panel clears it after submission.
   * @param turnstileToken - optional human-check token when the relay enables Cloudflare Turnstile.
   */
  async login(email: string, password: string, turnstileToken?: string): Promise<void> {
    await this.#account('/account/login', { email, password, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) })
  }
  /** Complete a second-factor login with the code from the authenticator app.
   * @param code - six-digit authenticator code.
   */
  async verify(code: string): Promise<void> {
    const challenge = this.#state.challenge
    if (!challenge) return
    await this.#account('/account/verify', { tempToken: challenge.token, code })
  }
  /** Confirm or change the name shown at the table; omitting the avatar keeps the stored one.
   * @param username - display name shown on the seat and mirrored to the relay.
   * @param avatarURL - replacement image as a data URL; omitted keeps the relay avatar.
   */
  async saveProfile(username: string, avatarURL?: string): Promise<void> {
    if (!this.#state.account) return
    await this.#account('/account/profile', { username, ...(avatarURL === undefined ? {} : { avatarURL }) })
  }
  async #account(path: string, body: object): Promise<void> {
    if (this.#state.busy || this.#state.pending) return
    const generation = this.#generation
    this.#publish({ busy: true, error: null, detail: null })
    try {
      const result = await this.#service(path, body)
      if (generation !== this.#generation) return
      const challenge = challengeSchema.safeParse(result)
      if (challenge.success) {
        this.#publish({
          challenge: { token: challenge.data.tempToken, maskedEmail: challenge.data.emailMasked },
          busy: false,
        })
        return
      }
      await this.#configure()
      if (generation !== this.#generation) return
      this.#publish({ account: this.#projectAccount(accountSchema.parse(result)), challenge: null })
      await this.#activate(generation)
    } catch (error) {
      if (generation === this.#generation) this.#fail(error)
    } finally {
      if (generation === this.#generation) this.#publish({ busy: false })
    }
  }
  /** Restore a persisted browser session after a reload or a reopened panel. */
  async restore(): Promise<void> {
    if (this.#state.busy) return
    const generation = this.#generation
    if (this.#state.status === 'live') {
      if (this.#state.pending) return
      this.#publish({ busy: true })
      try {
        await this.#refreshBalance(generation)
      } finally {
        if (generation === this.#generation) this.#publish({ busy: false })
      }
      return
    }
    this.#publish({ busy: true })
    try {
      await this.#configure()
      const account = this.#projectAccount(accountSchema.parse(await this.#service('/account/me')))
      if (generation !== this.#generation) return
      this.#publish({ account, challenge: null })
      await this.#activate(generation)
    } catch (error) {
      if (generation !== this.#generation) return
      if (error instanceof RequestError && error.status === 401) this.#publish({ account: null, status: 'signed-out', error: null })
      else this.#fail(error)
    } finally {
      if (generation === this.#generation) this.#publish({ busy: false })
    }
  }
  /** A profile read must never turn a confirmed funds transfer into a retryable transfer. */
  async #refreshBalance(generation: number): Promise<void> {
    const userID = this.#state.account?.userID
    if (userID === undefined) return
    try {
      const account = accountSchema.parse(await this.#service('/account/me'))
      if (generation !== this.#generation || this.#state.account?.userID !== userID) return
      if (account.userID !== userID) throw new Error('Account changed during balance refresh')
      this.#publish({
        account: { ...this.#state.account, balance: account.balance },
        ...(this.#state.error === 'BALANCE_REFRESH_FAILED' ? { error: null, detail: null } : {}),
      })
    } catch {
      if (generation !== this.#generation || this.#state.account?.userID !== userID) return
      this.#publish({
        account: { ...this.#state.account, balance: null },
        ...(this.#state.error === null ? { error: 'BALANCE_REFRESH_FAILED', detail: null } : {}),
      })
    }
  }
  /** Pick a room from the configured set; a seated player must leave first.
   * @param tableID - one of the configured room identifiers.
   */
  selectTable(tableID: string): void {
    if (this.#state.busy || tableID === this.#state.tableID || !this.#state.tables.includes(tableID)) return
    this.#stopSocket()
    this.#cursor = undefined
    this.#pending = undefined
    this.#publish({ tableID, room: null, activity: [], pending: false, error: null, detail: null, animate: null })
    if (this.#state.account) void this.#activate(this.#generation)
  }
  /** Restore a funded seat and any unresolved funds intent. An unfunded identity stays in the lobby. */
  async #activate(generation: number): Promise<void> {
    this.#publish({ status: 'connecting' })
    try {
      const pending = z
        .object({ kind: z.enum(['buy-in', 'start', 'leave']), operationID: z.string(), amount: z.string().optional() })
        .nullable()
        .parse(await this.#room('/pending'))
      if (generation !== this.#generation) return
      if (pending) {
        this.#pending = {
          kind: pending.kind,
          path: `/${pending.kind}`,
          body: { operationID: pending.operationID, ...(pending.amount ? { amount: pending.amount } : {}) },
        }
        this.#publish({ pending: true, error: 'FUNDS_PENDING' })
      }
      let room: RoomView | null = null
      try {
        room = this.#project(roomSchema.parse(await this.#room('')))
      } catch (error) {
        if (!(error instanceof RequestError && error.status === 403)) throw error
      }
      if (generation !== this.#generation) return
      this.#publish({ room, status: 'live' })
      if (room) this.#open()
    } catch (error) {
      if (generation === this.#generation) this.#fail(error)
    }
  }
  #open() {
    const generation = this.#generation
    const url = new URL(`${this.#root()}/rooms/${encodeURIComponent(this.#state.tableID)}/socket`, this.ports.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    this.#baseline = true
    const socket = this.ports.socket(url.href)
    this.#socket = socket
    socket.onopen = () => {
      if (generation === this.#generation)
        socket.send(JSON.stringify({ type: 'sync', ...(this.#cursor ? { cursor: this.#cursor } : {}) }))
    }
    socket.onmessage = (message) => {
      if (generation !== this.#generation || this.#socket !== socket) return
      try {
        const raw: unknown = JSON.parse(String(message.data))
        if (z.object({ type: z.literal('error'), code: z.string() }).safeParse(raw).success) return
        const frame = frameSchema.parse(raw)
        if (frame.snapshot.tableID !== this.#state.tableID) throw new Error('Wrong table')
        const same = this.#cursor?.handID === frame.cursor?.handID
        if (same && frame.cursor && this.#cursor && frame.cursor.revision < this.#cursor.revision) return
        const displayed = this.#state.room?.hand
        if (
          displayed?.handID === frame.cursor?.handID &&
          frame.cursor &&
          displayed &&
          displayed.revision > frame.cursor.revision
        )
          return
        const fresh = frame.batches
          .filter(batch => !same || batch.revision > (this.#cursor?.revision ?? -1))
          .flatMap(batch =>
            batch.events.map((event, i) => ({ ...event, id: `${frame.cursor?.handID}:${batch.revision}:${i}` })),
          )
        const animate = this.#baseline ? null : (fresh.at(-1)?.id ?? this.#state.animate)
        this.#cursor = frame.cursor ?? undefined
        this.#baseline = false
        this.#publish({
          room: this.#project(frame.snapshot),
          status: 'live',
          error: this.#pending ? this.#state.error : null,
          activity: [...(same ? this.#state.activity : []), ...fresh].slice(-12),
          animate,
          clockOffset: Date.parse(frame.serverTime) - this.ports.now(),
        })
      } catch {
        this.#publish({ status: 'offline', error: 'INVALID_RESPONSE' })
        socket.close()
      }
    }
    socket.onerror = () => {
      socket.close()
    }
    socket.onclose = (event) => {
      if (generation !== this.#generation || this.#socket !== socket) return
      socket.onmessage = null
      socket.onopen = null
      socket.onerror = null
      socket.onclose = null
      this.#socket = undefined
      this.#publish({ status: 'offline', error: event.code === 1008 ? 'ACCESS_DENIED' : 'DISCONNECTED', animate: null })
      if (event.code !== 1008)
        this.#timer = setTimeout(() => {
          if (generation === this.#generation) this.#open()
        }, this.config.reconnectMs)
    }
  }
  /** Submit only a server-advertised action at the displayed revision.
   * @param action - selected action and street-total raise amount.
   */
  async act(action: PokerAction): Promise<void> {
    const hand = this.#state.room?.hand
    if (!hand || this.#state.status !== 'live' || this.#pending || this.#state.busy) return
    const legal = hand.legalActions.find(value => value.kind === action.kind)
    if (
      !legal ||
      ('amount' in action &&
        (!('minAmount' in legal) ||
          !Number.isSafeInteger(action.amount) ||
          action.amount < legal.minAmount ||
          action.amount > legal.maxAmount))
    )
      return
    await this.#submit({
      path: `/hands/${encodeURIComponent(hand.handID)}/actions`,
      body: { id: this.ports.uuid(), expectedRevision: hand.revision, action },
      kind: 'action',
    })
  }
  /** Buy in, start, or leave through the authenticated HTTP transaction interface.
   * @param kind - transaction operation.
   * @param amount - exact decimal balance for buy-in.
   */
  async fund(kind: 'buy-in' | 'start' | 'leave', amount?: string): Promise<void> {
    if (!this.#state.account || this.#pending || this.#state.busy || this.#state.status !== 'live') return
    await this.#submit({
      kind,
      path: `/${kind}`,
      body: { operationID: this.ports.uuid(), ...(kind === 'buy-in' ? { amount } : {}) },
    })
  }
  /** Repeat the exact uncertain request, including its original operation ID. */
  async retry(): Promise<void> {
    if (this.#pending && !this.#state.busy) await this.#submit(this.#pending)
  }
  async #submit(pending: Pending) {
    this.#pending = pending
    const generation = this.#generation
    this.#publish({ busy: true, pending: true, error: null, detail: null })
    try {
      const result = await this.#room(pending.path, pending.body)
      if (generation !== this.#generation) return
      if (pending.kind === 'action')
        z.object({ accepted: z.object({ revision: z.number().int().nonnegative(), replayed: z.boolean() }) }).parse(result)
      if (pending.kind !== 'action') {
        const operation = z.object({ state: z.enum(['pending', 'complete', 'rejected']) }).parse(result)
        if (operation.state === 'pending') {
          this.#publish({ error: 'FUNDS_PENDING' })
          return
        }
        if (operation.state === 'rejected') {
          this.#pending = undefined
          this.#publish({ error: 'REJECTED', pending: false })
          return
        }
      }
      this.#pending = undefined
      this.#publish({ pending: false })
      if ((pending.kind === 'buy-in' || pending.kind === 'leave') && this.#state.account)
        this.#publish({ account: { ...this.#state.account, balance: null } })
      if (pending.kind === 'leave') {
        this.#stopSocket()
        this.#cursor = undefined
        this.#publish({ room: null, activity: [], status: 'live' })
        await this.#refreshBalance(generation)
        return
      }
      if (pending.kind === 'buy-in') {
        await this.#refreshBalance(generation)
        if (generation !== this.#generation) return
      }
      const room = this.#project(roomSchema.parse(await this.#room('')))
      if (generation !== this.#generation) return
      this.#publish({ room })
      if (!this.#socket) this.#open()
      else if (this.#socket.readyState === 1)
        this.#socket.send(JSON.stringify({ type: 'sync', ...(this.#cursor ? { cursor: this.#cursor } : {}) }))
    } catch (error) {
      if (generation !== this.#generation) return
      const definitive = error instanceof RequestError && error.status < 500 && error.code !== 'BUSY'
      if (definitive) this.#pending = undefined
      if (!this.#pending && !definitive) {
        this.#publish({ status: 'offline', error: 'DISCONNECTED', pending: false })
        if (!this.#socket) this.#open()
        else if (this.#socket.readyState === 1) this.#socket.send(JSON.stringify({ type: 'sync' }))
      } else this.#publish({ error: definitive ? error.code : 'UNCERTAIN', pending: Boolean(this.#pending) })
    } finally {
      if (generation === this.#generation) this.#publish({ busy: false })
    }
  }
  #stopSocket() {
    if (this.#timer) clearTimeout(this.#timer)
    const socket = this.#socket
    this.#socket = undefined
    if (socket) {
      socket.onclose = null
      socket.onmessage = null
      socket.onopen = null
      socket.onerror = null
      socket.close()
    }
  }
  /** End the relay session; seats and table funds stay untouched until the player leaves. */
  async logout(): Promise<void> {
    try {
      await this.#service('/account/logout', {})
    } catch {
      // The local session ends even when the relay cannot confirm the sign-out.
    }
    this.disconnect()
  }
  /** Clear local credentials and cancel all producers without changing server funds or seats. */
  disconnect(): void {
    this.#generation++
    this.#stopSocket()
    for (const request of this.#requests) request.abort()
    this.#pending = undefined
    this.#cursor = undefined
    this.#publish({
      status: 'signed-out',
      account: null,
      challenge: null,
      room: null,
      error: null,
      detail: null,
      busy: false,
      pending: false,
      activity: [],
      animate: null,
    })
  }
  /** Plugin disposal removes observers before stopping outstanding work. */
  dispose(): void {
    this.#listeners.clear()
    this.disconnect()
  }
}
class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string | null,
  ) {
    super(code)
  }
}
