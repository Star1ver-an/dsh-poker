/** Validated public poker projections. Private decks are never part of this model. */
import { z } from 'zod'

const chips = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const card = z.object({
  rank: z.enum(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']),
  suit: z.enum(['c', 'd', 'h', 's']),
})
const action = z.union([
  z.object({ kind: z.enum(['fold', 'check']) }),
  z.object({ kind: z.literal('call'), amount: chips }),
  z.object({ kind: z.enum(['bet-to', 'raise-to']), minAmount: chips, maxAmount: chips }),
])
const player = z.object({
  playerId: z.string(),
  seat: chips.max(5),
  holeCards: z.array(card).length(2).nullable(),
  folded: z.boolean(),
  allIn: z.boolean(),
  committedStreet: chips,
  committedHand: chips,
})
/** Public account projection of the signed-in player; no relay token or email is present. */
export const accountSchema = z.object({
  userID: chips.positive(),
  username: z.string().nullable(),
  avatarURL: z.string().nullable(),
  balance: z.string().nullable(),
  initialized: z.boolean(),
})
/** A login that still needs the second factor keeps its temporary relay token in memory. */
export const challengeSchema = z.object({
  requires2FA: z.literal(true),
  tempToken: z.string().min(1),
  emailMasked: z.string().nullable(),
})
/** Service configuration the login form needs: available rooms and the required human check. */
export const serviceConfigSchema = z.object({
  tables: z.array(z.string()).min(1),
  captcha: z.object({
    provider: z.enum(['turnstile', 'tencent', 'aliyun', 'none']),
    siteKey: z.string().nullable(),
    appID: z.string().nullable(),
  }),
})
/** Room projection accepted from both HTTP and WebSocket. */
export const roomSchema = z.object({
  tableID: z.string(),
  phase: z.enum(['waiting', 'playing', 'funds-pending']),
  seats: z
    .array(
      z.object({
        userID: chips.positive(),
        position: chips.max(5),
        username: z.string().nullable(),
        avatarURL: z.string().nullable(),
      }),
    )
    .max(6),
  wallet: z
    .object({
      balance_per_chip: z.string(),
      version: chips,
      stacks: z.array(z.object({ user_id: chips.positive(), chips })),
    })
    .nullable(),
  turn: z.object({ userID: chips.positive(), revision: chips, deadlineAt: z.iso.datetime() }).nullable(),
  hand: z
    .object({
      handID: z.string(),
      revision: chips,
      legalActions: z.array(action),
      table: z.object({
        config: z.object({ smallBlind: chips, bigBlind: chips }),
        seats: z.array(z.object({ playerId: z.string(), stack: chips }).nullable()),
        hand: z.object({
          stage: z.enum(['preflop', 'flop', 'turn', 'river', 'complete']),
          currentBet: chips,
          buttonSeat: chips,
          communityCards: z.array(card).max(5),
          players: z.array(player).max(6),
          pots: z.array(
            z.object({
              amount: chips,
              winnerPlayerIds: z.array(z.string()),
              awards: z.array(z.object({ playerId: z.string(), amount: chips })),
            }),
          ),
        }),
      }),
    })
    .nullable(),
})
/** Projected events keep only fields used by animation and activity copy. */
export const eventSchema = z.object({
  type: z.string(),
  playerId: z.string().optional(),
  paid: chips.optional(),
  amount: chips.optional(),
  action: z.object({ kind: z.string() }).optional(),
  street: z.string().optional(),
})
/** A complete synchronization frame is the only socket message that changes the table. */
export const frameSchema = z.object({
  type: z.literal('state'),
  snapshot: roomSchema,
  batches: z.array(z.object({ revision: chips, events: z.array(eventSchema) })),
  cursor: z.object({ handID: z.string(), revision: chips }).nullable(),
  reset: z.boolean(),
  serverTime: z.iso.datetime(),
})
/** Current personal room view. */
export type RoomView = z.infer<typeof roomSchema>
/** Signed-in player as the table sees them. */
export type AccountView = z.infer<typeof accountSchema>
/** Required human check of the relay deployment. */
export type CaptchaConfig = z.infer<typeof serviceConfigSchema>['captcha']
/** One seat as rendered on the table. */
export type SeatView = RoomView['seats'][number]
/** One visible card. */
export type CardView = z.infer<typeof card>
/** One supported user action; raise amounts are street totals. */
export type PokerAction = { kind: 'fold' | 'check' | 'call' } | { kind: 'bet-to' | 'raise-to'; amount: number }
/** One rendered event with a stable hand/revision/ordinal identity. */
export type Activity = z.infer<typeof eventSchema> & { id: string }
