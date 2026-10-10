import { TYPERT_REMOTE } from './remote.ts'
import * as ui from './client/index.ts'
export const inject = ['remote','slots','locale']
export async function apply(ctx) {
  const dispose = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(()=>dispose,'poker: remote namespace')
  ctx.plugin(ui)
}
