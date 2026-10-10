/** Poker connection settings contain no player or service credentials. */
import { z } from 'zod'

/** Same-origin reverse-proxy path and reconnect delay. */
export const configSchema = z.object({
  endpoint: z
    .string()
    .regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/)
    .default('/poker'),
  reconnectMs: z.number().int().min(250).max(10000).default(1000),
  requestTimeoutMs: z.number().int().min(1000).max(30000).default(10000),
})
/** Resolved public plugin configuration. */
export type PokerConfig = z.infer<typeof configSchema>
