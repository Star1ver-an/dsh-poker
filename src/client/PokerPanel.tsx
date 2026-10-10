/** Personal table presentation: all business state arrives through framework props. */
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { PokerClient } from './connection.ts'
import type { createPokerStore } from './stores.ts'
import type { PokerKey } from './locales.ts'
import type { Activity, CardView, PokerAction, RoomView, SeatView } from './protocol.ts'
import css from './PokerPanel.module.css'
import { ServiceSettings, type Sharing, type DiscoveredService } from './ServiceSettings.tsx'

/** Plain callbacks and a framework-bound poker observable. */
export interface PokerInjected {
  loadAvatar: (url: string, signal: AbortSignal) => Promise<string>
  endpoint: () => Promise<string>
  discover: (signal: AbortSignal) => Promise<DiscoveredService[]>
  sharing: () => Promise<Sharing>
  setSharing: (enabled: boolean) => Promise<Sharing>
  configure: (url: string) => Promise<void>
  hooks: { poker: PokerClient }
  restore: () => Promise<void>
  login: (email: string, password: string, turnstileToken?: string) => Promise<void>
  verify: (code: string) => Promise<void>
  saveProfile: (username: string, avatarURL?: string) => Promise<void>
  logout: () => Promise<void>
  selectTable: (tableID: string) => void
  act: (action: PokerAction) => Promise<void>
  fund: (kind: 'buy-in' | 'start' | 'leave', amount?: string) => Promise<void>
  retry: () => Promise<void>
}
type Shares = InjectFace<PokerInjected> & PropsStore<ReturnType<typeof createPokerStore>> & PropsLocale<'poker'>
/** Sidebar entry props derived from its slot. */
export type PokerTriggerProps = PropsRuntime<'sidebar.footer.action'> & Shares
/** Full table props derived from its overlay slot. */
export type PokerPanelProps = PropsRuntime<'shell.overlay'> & Shares
const format = (value: number) => value.toLocaleString('en-US')
/** Relay error codes the panel can explain in the reader's language. */
const errorKeys: Record<string, PokerKey> = {
  POKER_NOT_CONFIGURED: 'notConfigured',
  CREDENTIALS_INVALID: 'credentialsInvalid',
  ACCOUNT_DISABLED: 'accountDisabled',
  EMAIL_VERIFY_REQUIRED: 'emailVerifyRequired',
  RATE_LIMITED: 'rateLimited',
  CAPTCHA_REQUIRED: 'captchaRequired',
  ACCOUNT_UNAVAILABLE: 'accountUnavailable',
  ACCOUNT_REJECTED: 'accountRejected',
  CODE_INVALID: 'codeInvalid',
  CHALLENGE_EXPIRED: 'challengeExpired',
  AUTH_REQUIRED: 'denied',
  ACCESS_DENIED: 'denied',
  FORBIDDEN: 'forbidden',
  TURN_EXPIRED: 'late',
  CONNECT_FAILED: 'authError',
  AVATAR_TOO_LARGE: 'avatarTooLarge',
}
/** Open the table without leaving the conversation. */
export function PokerTrigger({ wide, useStore, actions, t }: PokerTriggerProps) {
  const open = useStore(s => s.open)
  return (
    <button
      type="button"
      className={css.trigger}
      aria-label={t('trigger')}
      aria-expanded={open}
      onClick={() => {
        actions.setOpen(!open)
      }}
    >
      <span aria-hidden="true" className={css.mark}>
        ♧
      </span>
      {wide && t('trigger')}
    </button>
  )
}
function Card({ card, t, delay = 0 }: { card?: CardView | undefined; t: Translate<PokerKey>; delay?: number }) {
  const symbols = { c: '♣', d: '♦', h: '♥', s: '♠' }
  const names = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const
  return (
    <span
      className={card ? css.card : css.cardBack}
      data-red={card && (card.suit === 'h' || card.suit === 'd')}
      style={{ '--delay': `${delay}ms` } as CSSProperties}
      aria-label={card ? t('card', { rank: card.rank, suit: t(names[card.suit]) }) : t('cardBack')}
      role="img"
    >
      {card ? (
        <>
          <b>{card.rank === 'T' ? '10' : card.rank}</b>
          <span>{symbols[card.suit]}</span>
          <small>{card.rank === 'T' ? '10' : card.rank}</small>
        </>
      ) : (
        <span aria-hidden="true">✦</span>
      )}
    </span>
  )
}
/** Seat portraits come from the relay; the first letter stands in while no avatar is set. */
function SeatAvatar({ label, avatarURL, badge, loadAvatar }: { label: string; avatarURL: string | null; badge?: ReactNode; loadAvatar: PokerInjected['loadAvatar'] }) {
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => {
    const abort=new AbortController();setImage(null)
    if(avatarURL?.startsWith('data:image/'))setImage(avatarURL)
    else if(avatarURL)void loadAvatar(avatarURL,abort.signal).then(value=>{if(!abort.signal.aborted)setImage(value)}).catch(()=>{})
    return ()=>abort.abort()
  },[avatarURL,loadAvatar])
  return (
    <div className={css.avatar}>
      {image === null ? (
        <span aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
      ) : (
        <img src={image} alt="" loading="lazy" decoding="async" />
      )}
      {badge}
    </div>
  )
}
/** Shrink the chosen image in the browser so the relay keeps accepting inline avatars. */
async function shrinkAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = 160
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    const scale = Math.max(side / bitmap.width, side / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    context.drawImage(bitmap, (side - width) / 2, (side - height) / 2, width, height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    bitmap.close()
  }
}
declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void }) => string
      remove: (id: string) => void
    }
    onTurnstileLoad?: () => void
  }
}
/** Cloudflare Turnstile widget, loaded only when the relay enables that provider. */
function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let widget: string | undefined
    const render = () => {
      if (!holder.current || !window.turnstile) return
      widget = window.turnstile.render(holder.current, { sitekey: siteKey, callback: onToken })
    }
    if (window.turnstile) render()
    else {
      window.onTurnstileLoad = render
      if (!document.querySelector('script[src*="challenges.cloudflare.com"]')) {
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
    }
    return () => {
      if (widget && window.turnstile) window.turnstile.remove(widget)
    }
  }, [siteKey, onToken])
  return <div className={css.captcha} ref={holder} />
}
function eventText(event: Activity, t: Translate<PokerKey>, name: (playerId: string) => string) {
  if (event.type === 'player-acted') {
    const kind = event.action?.kind
    const label =
      kind === 'fold'
        ? t('fold')
        : kind === 'check'
          ? t('check')
          : kind === 'call'
            ? t('call', { amount: format(event.paid ?? 0) })
            : `${t('raise')} ${format(event.paid ?? 0)}`
    return t('acted', { name: name(event.playerId ?? ''), action: label })
  }
  if (event.type === 'street-dealt')
    return event.street === 'flop' ? t('flop') : event.street === 'turn' ? t('turn') : t('river')
  if (event.type === 'pot-awarded') return t('awarded')
  if (event.type === 'hand-completed') return t('handDone')
  if (event.type === 'cards-revealed') return t('revealed')
  return t('dealt')
}
function ActionDock({
  room,
  disabled,
  act,
  t,
}: {
  room: RoomView
  disabled: boolean
  act: PokerInjected['act']
  t: Translate<PokerKey>
}) {
  const legal = room.hand?.legalActions ?? []
  const raise = legal.find(a => a.kind === 'raise-to' || a.kind === 'bet-to')
  const [amount, setAmount] = useState(String(raise && 'minAmount' in raise ? raise.minAmount : 0))
  const call = legal.find(a => a.kind === 'call')
  const pot = room.hand?.table.hand.players.reduce((sum, p) => sum + p.committedHand, 0) ?? 0
  const range = raise && 'minAmount' in raise ? raise : null
  const valid =
    range &&
    Number.isSafeInteger(Number(amount)) &&
    Number(amount) >= range.minAmount &&
    Number(amount) <= range.maxAmount
  return (
    <div className={css.actionDock}>
      {range && (
        <div className={css.raiseControls}>
          <label>
            {t('raiseHint')}
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              min={range.minAmount}
              max={range.maxAmount}
              step={1}
              onChange={(e) => {
                setAmount(e.target.value)
              }}
              disabled={disabled}
            />
          </label>
          <input
            aria-label={t('raiseHint')}
            type="range"
            min={range.minAmount}
            max={range.maxAmount}
            step={1}
            value={Math.max(range.minAmount, Math.min(range.maxAmount, Number(amount) || 0))}
            disabled={disabled}
            onChange={(e) => {
              setAmount(e.target.value)
            }}
          />
          <div className={css.presets}>
            {(
              [
                ['minimum', range.minAmount],
                ['half', Math.floor(pot / 2)],
                ['full', pot],
                ['maximum', range.maxAmount],
              ] as const
            ).map(([label, value]) => (
              <button
                type="button"
                disabled={disabled}
                key={label}
                onClick={() => {
                  setAmount(String(Math.max(range.minAmount, Math.min(range.maxAmount, value))))
                }}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={css.buttons}>
        {legal.some(a => a.kind === 'fold') && (
          <button
            type="button"
            className={css.fold}
            disabled={disabled}
            onClick={() => {
              void act({ kind: 'fold' })
            }}
          >
            {t('fold')}
          </button>
        )}
        {legal.some(a => a.kind === 'check') && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              void act({ kind: 'check' })
            }}
          >
            {t('check')}
          </button>
        )}
        {call && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              void act({ kind: 'call' })
            }}
          >
            {t('call', { amount: format('amount' in call ? call.amount : 0) })}
          </button>
        )}
        {range && (
          <button
            type="button"
            className={css.primary}
            disabled={disabled || !valid}
            onClick={() => {
              void act({ kind: range.kind, amount: Number(amount) })
            }}
          >
            {t(range.kind === 'bet-to' ? 'bet' : 'raise')} {format(Number(amount) || 0)}
          </button>
        )}
      </div>
    </div>
  )
}

/** One player's confirmed pot share and the resulting hand-stack change. */
type SettlementRow = {
  playerId: string
  name: string
  award: number
  delta: number
  split: boolean
}

/** Derives the visible settlement from server-owned awards; the browser adds no payout rule. */
function settlementRows(
  hand: NonNullable<RoomView['hand']>['table']['hand'],
  name: (playerId: string) => string,
): SettlementRow[] {
  const awards = new Map<string, number>()
  const splits = new Map<string, boolean>()
  for (const pot of hand.pots) {
    const potIsSplit = pot.awards.length > 1
    for (const award of pot.awards) {
      awards.set(award.playerId, (awards.get(award.playerId) ?? 0) + award.amount)
      splits.set(award.playerId, (splits.get(award.playerId) ?? false) || potIsSplit)
    }
  }
  return hand.players
    .map((player) => {
      const awarded = awards.get(player.playerId) ?? 0
      const delta = player.folded ? -player.committedHand : awarded - player.committedHand
      return { playerId: player.playerId, name: name(player.playerId), award: awarded, delta, split: splits.get(player.playerId) ?? false }
    })
    .sort((a, b) => b.award - a.award || b.delta - a.delta || a.name.localeCompare(b.name))
}

/** Shows a localized signed chip total without inventing a locale-specific sign convention. */
function signedAmount(amount: number, t: Translate<PokerKey>) {
  const key = amount > 0 ? 'gain' : amount < 0 ? 'loss' : 'unchanged'
  return t(key, { amount: format(Math.abs(amount)) })
}

/** Shows each player's pot share and net stack change after the server marks the hand complete. */
function SettlementSummary({
  rows,
  split,
  animate,
  t,
}: {
  rows: SettlementRow[]
  split: boolean
  animate: boolean
  t: Translate<PokerKey>
}) {
  return (
    <div className={css.settlement} data-animate={animate} role="status">
      <strong>{t('result')}</strong>
      {split && <small>{t('splitPot')}</small>}
      <ol>
        {rows.map(row => (
          <li key={row.playerId} data-winner={row.award > 0}>
            <span>{row.name}</span>
            <small>{row.award > 0 ? t('award', { amount: format(row.award) }) : t('noAward')}</small>
            <strong data-direction={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'flat'}>
              {t('net')} {signedAmount(row.delta, t)}
            </strong>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Render the responsive table, the sign-in flow and native modal focus containment. */
export function PokerPanel(props: PokerPanelProps) {
  const { useStore, usePoker, actions, t, restore, login, verify, saveProfile, logout, selectTable, fund, act, retry } =
    props
  const open = useStore(s => s.open)
  const state = usePoker(s => s)
  const dialog = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const [username, setUsername] = useState('')
  // An empty draft means "keep the avatar the relay already stores".
  const [avatar, setAvatar] = useState('')
  const [editingProfile, setEditingProfile] = useState(false)
  const [skippedProfile, setSkippedProfile] = useState(false)
  const [amount, setAmount] = useState('10.00')
  const [now, setNow] = useState(Date.now())
  const restoreRef = useRef(restore)
  useEffect(() => {
    restoreRef.current = restore
  }, [restore])
  const account = state.account
  const userID = account?.userID ?? null
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 250)
    return () => {
      clearInterval(timer)
    }
  }, [open])
  // The relay session outlives the panel, so reopening the table restores it.
  useEffect(() => {
    if (open) void restoreRef.current()
  }, [open])
  useEffect(() => {
    setUsername(account?.username ?? '')
    setAvatar('')
  }, [account?.userID, account?.username])
  const room = state.room
  const hand = room?.hand?.table.hand
  const remaining = room?.turn
    ? Math.max(0, Math.ceil((Date.parse(room.turn.deadlineAt) - Math.max(now, Date.now()) - state.clockOffset) / 1000))
    : null
  const mine = room?.turn?.userID === userID
  const unavailable = state.status !== 'live' || state.busy || state.pending
  const settled = room?.phase === 'waiting'
  const ownSeat = room?.seats.find(s => s.userID === userID)?.position ?? 0
  const ownPlayer = hand?.players.find(p => p.playerId === String(userID))
  const ownStack =
    room?.hand?.table.seats.find(p => p?.playerId === String(userID))?.stack ??
    room?.wallet?.stacks.find(s => s.user_id === userID)?.chips ??
    0
  const seatName = (seat: SeatView) => seat.username ?? t('player', { id: seat.userID })
  const accountName = account === null ? '' : (account.username ?? t('player', { id: account.userID }))
  const nameOf = (playerId: string) => {
    const seat = room?.seats.find(s => String(s.userID) === playerId)
    return seat ? seatName(seat) : t('player', { id: playerId })
  }
  const pot =
    hand?.stage === 'complete'
      ? hand.pots.reduce((sum, p) => sum + p.amount, 0)
      : (hand?.players.reduce((sum, p) => sum + p.committedHand, 0) ?? 0)
  const completeHand = hand?.stage === 'complete' ? hand : undefined
  const complete = completeHand !== undefined
  const settlements = completeHand ? settlementRows(completeHand, nameOf) : []
  const settlementByPlayer = new Map(settlements.map(row => [row.playerId, row]))
  const split = settlements.some(row => row.split)
  const activity = state.activity.filter(e =>
    ['player-acted', 'street-dealt', 'pot-awarded', 'hand-completed', 'hand-started', 'cards-revealed'].includes(
      e.type,
    ),
  )
  const error = state.error === null ? null : (errorKeys[state.error] ?? (state.pending ? 'pending' : 'error'))
  const needsProfile = account !== null && (!account.initialized || editingProfile) && !skippedProfile
  const signIn = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const credential = { email, password }
    setPassword('')
    void login(credential.email, credential.password, captchaToken || undefined).finally(() => {
      setCaptchaToken('')
      setCaptchaAttempt(attempt => attempt + 1)
    })
  }
  const pickAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void shrinkAvatar(file).then(setAvatar, () => {
      setAvatar('')
    })
  }
  return (
    <dialog
      ref={dialog}
      className={css.dialog}
      aria-label={t('title')}
      onCancel={() => {
        actions.setOpen(false)
      }}
    >
      <div className={css.page} data-seated={Boolean(room)} data-animate={Boolean(state.animate)}>
        <header className={css.header}>
          <div className={css.brand}>
            <span className={css.logo} aria-hidden="true">
              ♧
            </span>
            <span>{t('brand')}</span>
          </div>
          <div className={css.headerRight}>
            {account && (
              <span className={css.identity}>
                <SeatAvatar loadAvatar={props.loadAvatar} label={accountName} avatarURL={account.avatarURL} />
                <span className={css.identityName}>{accountName}</span>
              </span>
            )}
            <span className={css.connection} data-live={state.status === 'live'}>
              <i />
              {t(
                state.status === 'signed-out'
                  ? state.busy
                    ? 'restoring'
                    : 'signedout'
                  : state.status === 'connecting'
                    ? 'connecting'
                    : state.status === 'live'
                      ? 'live'
                      : 'offline',
              )}
            </span>
            <button
              type="button"
              className={css.close}
              aria-label={t('close')}
              onClick={() => {
                actions.setOpen(false)
              }}
            >
              ×
            </button>
          </div>
        </header>
        <div className={css.scrollArea}>
        <div className={css.heading}>
          <div>
            <div className={css.eyebrow}>{room ? state.tableID : t('trigger')}</div>
            <h1>
              {t('title')}
              <span aria-hidden="true">.</span>
            </h1>
            <p>{t('subtitle')}</p>
          </div>
          {room?.hand && (
            <div className={css.meta}>
              <span>
                {t('blinds', { small: room.hand.table.config.smallBlind, big: room.hand.table.config.bigBlind })}
              </span>
              <span>{t('hand', { revision: room.hand.revision })}</span>
            </div>
          )}
        </div>
        {open && <ServiceSettings api={props} t={t} locked={Boolean(account) || state.busy} />}
        {state.status === 'offline' && (
          <div role="status" className={css.notice}>
            {t('reconnect')}
          </div>
        )}
        {error && (
          <div role="alert" className={css.notice}>
            {t(error)}{' '}
            {state.detail && <small>{state.detail}</small>}
            {state.pending && (
              <button
                type="button"
                disabled={state.busy}
                onClick={() => {
                  void retry()
                }}
              >
                {t('retry')}
              </button>
            )}
          </div>
        )}
        <div className={css.content}>
          <main className={css.main}>
            <div className={css.tableArea} data-animate={Boolean(state.animate)}>
              <div className={css.tableSurface}>
                <span className={css.tableStamp} aria-hidden="true">
                  {t('stamp')}
                </span>
                <div className={css.board}>
                  <div className={css.pot} key={`${room?.hand?.handID}:${pot}`}>
                    <span>{t('pot')}</span>
                    <strong>{format(pot)}</strong>
                    <small>{t('chips')}</small>
                  </div>
                  <div className={css.community} aria-label={t('community')}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <div
                        key={`${room?.hand?.handID}:${i}:${hand?.communityCards[i]?.rank ?? 'empty'}`}
                        className={hand?.communityCards[i] ? css.reveal : css.placeholder}
                      >
                        {hand?.communityCards[i] ? (
                          <Card card={hand.communityCards[i]} t={t} delay={i * 120} />
                        ) : (
                          <span aria-hidden="true">·</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className={css.street}>
                    {room?.phase === 'funds-pending' ? t('settling') : hand ? t(hand.stage) : t('waiting')}
                  </div>
                </div>
              </div>
              {Array.from({ length: 6 }, (_, index) => {
                const position = (index + ownSeat) % 6
                const seat = room?.seats.find(s => s.position === position)
                const player = hand?.players.find(p => p.playerId === String(seat?.userID))
                const self = seat?.userID === userID
                const current = seat?.userID === room?.turn?.userID
                const stack =
                  room?.hand?.table.seats.find(p => p?.playerId === String(seat?.userID))?.stack ??
                  room?.wallet?.stacks.find(s => s.user_id === seat?.userID)?.chips ??
                  0
                const result = player ? settlementByPlayer.get(player.playerId) : undefined
                const won = complete && Boolean(result?.award)
                const chipDelta = result?.delta
                return (
                  <div
                    key={position}
                    className={`${css.seat} ${css[`seat${index}`]}`}
                    data-active={current}
                    data-folded={player?.folded}
                    data-winner={won}
                    data-empty={!seat}
                    data-self={self}
                  >
                    {seat ? (
                      <>
                        <SeatAvatar
                          loadAvatar={props.loadAvatar}
                          label={seatName(seat)}
                          avatarURL={seat.avatarURL}
                          badge={
                            player && player.seat === hand?.buttonSeat ? (
                              <span className={css.dealer} title={t('dealer')}>
                                {t('dealerShort')}
                              </span>
                            ) : null
                          }
                        />
                        <div className={css.seatInfo}>
                          <b>
                            {seatName(seat)}
                            {self && <span className={css.selfMark}>{t('you')}</span>}
                          </b>
                          <div className={css.stack}>
                            <strong key={`${room?.hand?.handID}:${stack}`}>{format(stack)}</strong>
                            {chipDelta !== undefined && (
                              <span
                                className={css.chipDelta}
                                data-direction={chipDelta > 0 ? 'up' : chipDelta < 0 ? 'down' : 'flat'}
                              >
                                {signedAmount(chipDelta, t)}
                              </span>
                            )}
                          </div>
                        </div>
                        {player && !self && (
                          <div className={css.miniCards}>
                            <Card card={player.holeCards?.[0]} t={t} delay={70} />
                            <Card card={player.holeCards?.[1]} t={t} delay={130} />
                          </div>
                        )}
                        {player && player.committedStreet > 0 && (
                          <span
                            key={`${room?.hand?.handID}:${player.committedStreet}`}
                            className={css.wager}
                            data-seat={index}
                            aria-hidden="true"
                          >
                            <span className={css.chipStack}>
                              <i />
                              <i />
                              <i />
                            </span>
                            {format(player.committedStreet)}
                          </span>
                        )}
                        <div className={css.seatStatus}>
                          {won
                            ? t(result?.split ? 'splitWinner' : 'winner', { amount: format(result?.award ?? 0) })
                            : player?.folded
                              ? t('folded')
                              : player?.allIn
                                ? t('allin')
                                : current && remaining !== null
                                  ? t('seconds', { count: remaining })
                                  : ''}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={css.emptyAvatar}>+</div>
                        <span>{t('empty')}</span>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
            {room ? (
              <section className={css.controls}>
                <div className={css.handRow}>
                  <div className={css.ownCards} key={room.hand?.handID} aria-label={t('yours')}>
                    {ownPlayer && (
                      <>
                        <Card card={ownPlayer.holeCards?.[0]} t={t} />
                        <Card card={ownPlayer.holeCards?.[1]} t={t} delay={60} />
                      </>
                    )}
                  </div>
                  <div>
                    <span className={css.eyebrow}>{t('yours')}</span>
                    <h2>
                      {room.phase === 'funds-pending'
                        ? t('settling')
                        : settled
                          ? t(hand ? 'ready' : 'waiting')
                          : mine
                            ? t('yourTurn')
                            : t('waitingTurn')}
                    </h2>
                    <p>
                      {format(ownStack)} {t('chips')}
                      {room.wallet && <span> · {t('exchange', { rate: room.wallet.balance_per_chip })}</span>}
                    </p>
                  </div>
                  {remaining !== null && (
                    <div
                      className={css.timer}
                      data-urgent={remaining <= 5}
                      role="timer"
                      aria-label={t('seconds', { count: remaining })}
                    >
                      {remaining}
                      <small>{t('seconds', { count: '' })}</small>
                    </div>
                  )}
                </div>
                {complete && <SettlementSummary rows={settlements} split={split} animate={Boolean(state.animate)} t={t} />}
                {room.phase === 'funds-pending' ? (
                  <p className={css.hint}>{t('settlementHint')}</p>
                ) : settled ? (
                  <div className={css.buttons}>
                    <button
                      className={css.primary}
                      type="button"
                      disabled={
                        unavailable || room.seats.length < 2 || Boolean(room.wallet?.stacks.some(s => s.chips === 0))
                      }
                      onClick={() => {
                        void fund('start')
                      }}
                    >
                      {t('start')}
                    </button>
                    <button
                      type="button"
                      disabled={unavailable}
                      onClick={() => {
                        void fund('leave')
                      }}
                    >
                      {t('leave')}
                    </button>
                  </div>
                ) : mine ? (
                  <ActionDock
                    key={`${room.hand?.handID}:${room.hand?.revision}`}
                    room={room}
                    act={act}
                    t={t}
                    disabled={unavailable || remaining === 0}
                  />
                ) : (
                  <p className={css.hint}>{t('connectionTip')}</p>
                )}
              </section>
            ) : (
              <div className={css.emptyCaption}>
                <h2>{t('waiting')}</h2>
                <p>{t('waitingHint')}</p>
              </div>
            )}
          </main>
          <aside className={css.aside}>
            {!account && (
              <section className={css.join}>
                {state.challenge ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void verify(code)
                    }}
                  >
                    <span className={css.eyebrow}>{state.challenge.maskedEmail ?? ''}</span>
                    <h2>{t('twoFactor')}</h2>
                    <label>
                      {t('code')}
                      <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={code}
                        required
                        onChange={(e) => {
                          setCode(e.target.value)
                        }}
                      />
                    </label>
                    <p>{t('twoFactorHint')}</p>
                    <button className={css.primary} disabled={state.busy} type="submit">
                      {t(state.busy ? 'verifying' : 'verify')}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={signIn}>
                    <span className={css.eyebrow}>{t('signedout')}</span>
                    <h2>{t('signin')}</h2>
                    <label>
                      {t('email')}
                      <input
                        type="email"
                        autoComplete="username"
                        value={email}
                        required
                        onChange={(e) => {
                          setEmail(e.target.value)
                        }}
                      />
                    </label>
                    <label>
                      {t('password')}
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        required
                        onChange={(e) => {
                          setPassword(e.target.value)
                        }}
                      />
                    </label>
                    <p>{t('signinHint')}</p>
                    {state.captcha.provider === 'turnstile' && state.captcha.siteKey && (
                      <Turnstile key={captchaAttempt} siteKey={state.captcha.siteKey} onToken={setCaptchaToken} />
                    )}
                    {state.captcha.provider !== 'none' && state.captcha.provider !== 'turnstile' && (
                      <p className={css.hint}>{t('captchaUnsupported')}</p>
                    )}
                    <button className={css.primary} disabled={state.busy} type="submit">
                      {t(state.busy ? 'signingIn' : 'signin')}
                    </button>
                  </form>
                )}
              </section>
            )}
            {needsProfile && (
              <form
                className={css.profile}
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveProfile(username.trim(), avatar === '' ? undefined : avatar).then(() => {
                    setEditingProfile(false)
                  })
                }}
              >
                <span className={css.eyebrow}>{account.username ?? t('profileTitle')}</span>
                <h2>{t('profileTitle')}</h2>
                <label>
                  {t('username')}
                  <input
                    value={username}
                    maxLength={40}
                    required
                    onChange={(e) => {
                      setUsername(e.target.value)
                    }}
                  />
                </label>
                <div className={css.avatarField}>
                  <SeatAvatar loadAvatar={props.loadAvatar} label={username || t('avatar')} avatarURL={avatar === '' ? account.avatarURL : avatar} />
                  <label className={css.upload}>
                    {t('uploadAvatar')}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickAvatar} />
                  </label>
                </div>
                <p>{t('profileHint')}</p>
                <p className={css.hint}>{t('avatarHint')}</p>
                <button className={css.primary} disabled={state.busy || username.trim() === ''} type="submit">
                  {t(state.busy ? 'saving' : 'save')}
                </button>
                {!account.initialized && (
                  <button
                    type="button"
                    className={css.later}
                    onClick={() => {
                      setSkippedProfile(true)
                    }}
                  >
                    {t('later')}
                  </button>
                )}
              </form>
            )}
            {account && !needsProfile && !room && (
              <section className={css.join}>
                {state.tables.length > 1 && (
                  <label>
                    {t('room')}
                    <select
                      value={state.tableID}
                      onChange={(e) => {
                        selectTable(e.target.value)
                      }}
                    >
                      {state.tables.map(table => (
                        <option key={table} value={table}>
                          {table}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <span className={css.eyebrow}>{t('noMoney')}</span>
                <h2>{t('connect')}</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void fund('buy-in', amount)
                  }}
                >
                  <label>
                    {t('amount')}
                    <input
                      inputMode="decimal"
                      value={amount}
                      pattern="(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?"
                      required
                      onChange={(e) => {
                        setAmount(e.target.value)
                      }}
                    />
                  </label>
                  {account.balance !== null && (
                    <p className={css.balance}>
                      {t('available')} <b>{account.balance}</b>
                    </p>
                  )}
                  <p>{t('amountHint')}</p>
                  <button className={css.primary} disabled={unavailable} type="submit">
                    {t('buy')}
                  </button>
                </form>
              </section>
            )}
            {room && settled && !needsProfile && (
              <form
                className={css.topup}
                onSubmit={(e) => {
                  e.preventDefault()
                  void fund('buy-in', amount)
                }}
              >
                <label>
                  {t('amount')}
                  <input
                    inputMode="decimal"
                    value={amount}
                    pattern="(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?"
                    required
                    onChange={(e) => {
                      setAmount(e.target.value)
                    }}
                  />
                </label>
                <button type="submit" disabled={unavailable}>
                  {t('buy')}
                </button>
              </form>
            )}
            {room && account && !needsProfile && (
              <section className={css.account}>
                {account.balance !== null && (
                  <p className={css.balance}>
                    {t('available')} <b>{account.balance}</b>
                  </p>
                )}
                <button
                  type="button"
                  disabled={state.busy || state.pending}
                  onClick={() => {
                    setEditingProfile(true)
                  }}
                >
                  {t('editProfile')}
                </button>
              </section>
            )}
            <details className={css.activity}>
              <summary>
                {t('activity')}
              </summary>
              {activity.length ? (
                <ol>
                  {activity
                    .slice(-6)
                    .reverse()
                    .map((event, i) => (
                      <li key={event.id} className={i === 0 && state.animate ? css.event : ''}>
                        <i />
                        <span>{eventText(event, t, nameOf)}</span>
                      </li>
                    ))}
                </ol>
              ) : (
                <div className={css.quiet}>
                  <span aria-hidden="true">⌁</span>
                  <h3>{t('quiet')}</h3>
                  <p>{t('activityHint')}</p>
                </div>
              )}
            </details>
            <div className={css.footnote}>{t('connectionTip')}</div>
            {account && (
              <button
                className={css.signout}
                type="button"
                disabled={state.busy || state.pending}
                onClick={() => {
                  void logout()
                }}
              >
                {t('logout')}
              </button>
            )}
          </aside>
        </div>
        </div>
      </div>
    </dialog>
  )
}
