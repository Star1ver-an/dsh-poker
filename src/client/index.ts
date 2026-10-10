/** Browser plugin assembly; transport lifetime outlives opening and closing the table. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { configSchema, type PokerConfig } from '../config.ts'
import { PokerClient } from './connection.ts'
import { PokerPanel, PokerTrigger, type PokerInjected } from './PokerPanel.tsx'
import { createPokerStore } from './stores.ts'
import { en, zh, type PokerKey } from './locales.ts'
import { desktopPorts, unwrap } from './desktop-ports.ts'

/** Browser loader configuration schema. */
export const Config = configSchema.default(configSchema.parse({}))
/** Services used by the poker slot registrations. */
export const inject = ['slots', 'locale', 'remote', 'remote.pokerBridge']
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Private poker table copy. */ poker: PokerKey
  }
}
/** Register reversible locale, transport and UI contributions.
 * @param ctx - browser plugin context.
 * @param input - public connection settings, never credentials.
 */
export function apply(ctx: Context, input: Partial<PokerConfig> = {}): void {
  const config = configSchema.parse(input)
  const client = new PokerClient(config, desktopPorts(ctx.remote.pokerBridge))
  ctx.effect(
    () => () => {
      client.dispose()
    },
    'ui-poker: connection',
  )
  ctx.effect(() => ctx.locale.register('poker', { zh, en }), 'ui-poker: dictionaries')
  const store = createPokerStore()
  const loadAvatar = (url: string, signal: AbortSignal) => unwrap(ctx.remote.pokerBridge.avatar(new URL(url,'https://dsh-poker.invalid').pathname.replace(/^\/poker/,''),signal))
  const face = (): PokerInjected => ({
    loadAvatar,
    endpoint: () => unwrap(ctx.remote.pokerBridge.endpoint()),
    discover: signal => unwrap(ctx.remote.pokerBridge.discover(signal)),
    sharing: () => unwrap(ctx.remote.pokerBridge.sharing()),
    setSharing: enabled => unwrap(ctx.remote.pokerBridge.setSharing(enabled)),
    configure: async url => { await unwrap(ctx.remote.pokerBridge.configure(url)); client.resetService(); await client.restore() },
    hooks: { poker: client },
    restore: () => client.restore(),
    login: (email, password, turnstileToken) => client.login(email, password, turnstileToken),
    verify: code => client.verify(code),
    saveProfile: (username, avatarURL) => client.saveProfile(username, avatarURL),
    logout: () => client.logout(),
    selectTable: (tableID) => {
      client.selectTable(tableID)
    },
    act: action => client.act(action),
    fund: (kind, amount) => client.fund(kind, amount),
    retry: () => client.retry(),
  })
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'poker', store, locale: 'poker', inject: face },
      PokerTrigger,
    ),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'poker', store, locale: 'poker', inject: face }, PokerPanel),
  )
}
