/** Open state is shared by the sidebar entry and table overlay. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
type State = { open: boolean }
type Actions = { setOpen: (draft: State, open: boolean) => void }

/** Create one panel viewing store per plugin instance.
 * @returns the shared panel store handle.
 */
export function createPokerStore(): EngineStoreHandle<State, Actions> {
  return defineStore({
    init: () => ({ open: false }),
    actions: {
      setOpen: (draft, open: boolean) => {
        draft.open = open
      },
    },
  })
}
