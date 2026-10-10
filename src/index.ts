/** Desktop bridge: remote-service cookies and sockets stay in the Host. */
import { Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { CookieJar } from 'tough-cookie'
import WebSocket from 'ws'
import { serviceUrl, servicePath } from './remote.ts'
import { advertise, discover, loopbackService, probe } from './discovery.ts'
import { gateway } from './gateway.ts'

const settings = defineDomain({name:'local_poker',version:1,layout:'per-record',tables:{settings:domainTable(z.string())}})
export const inject = ['typert','storageDomain']
export const Config = s.object({upstreamUrl:s.string().default(''),requestTimeoutMs:s.number().min(1000).max(30000).default(10000),sharePort:s.number().min(1024).max(65535).default(41890)})
export function apply(ctx, config) { ctx.plugin(PokerBridge, config) }

export class PokerBridge extends TypertRemoteService {
  static inject = ['typert','storageDomain']
  config; jar = new CookieJar(); sockets = new Map(); aborts = new Set(); domain; table; upstream = ''
  advertiser; gateway; sharingError = ''; disposed = false; sharingChange = false
  constructor(ctx, config) { super(ctx,'pokerBridge'); this.config = config }
  async [Service.init]() {
    this.domain = await this.ctx.storageDomain.open(settings)
    this.table = this.domain.table('settings')
    this.upstream = serviceUrl.parse(this.config.upstreamUrl || await this.table.get('upstreamUrl') || '')
    if (await this.table.get('sharing') === 'true' && loopbackService(this.upstream)) {
      try { await this.startSharing() } catch (error) { this.sharingError = String(error) }
    }
    this.ctx.effect(() => async () => {
      this.disposed = true
      await this.advertiser?.close(); await this.gateway?.close()
      for (const abort of this.aborts) abort.abort()
      for (const socket of this.sockets.values()) socket.terminate()
      this.sockets.clear(); await this.jar.removeAllCookies(); await this.domain.close()
    },'poker: network and settings')
  }
  @Remote
  endpoint() { return this.upstream }
  @Remote
  sharing() { return {enabled:Boolean(this.advertiser), canShare:loopbackService(this.upstream), error:this.sharingError || this.advertiser?.error || '', urls:this.gateway?.urls ?? []} }
  async startSharing() {
    const entry = await gateway(this.upstream, this.config.sharePort)
    try {
      const responder = await advertise(entry.url)
      if (this.disposed) { await responder.close(); throw new Error('Plugin stopped') }
      this.gateway = entry; this.advertiser = responder
    } catch (error) { await entry.close(); throw error }
  }
  @Remote
  async setSharing(enabled) {
    if (this.sharingChange) throw new Error('Sharing settings are being updated')
    this.sharingChange = true
    try {
      if (enabled && !loopbackService(this.upstream)) throw new Error('Only a local backend can be shared')
      await this.advertiser?.close(); await this.gateway?.close(); this.advertiser = undefined; this.gateway = undefined; this.sharingError = ''
      if (enabled) {
        await probe(this.upstream)
        await this.startSharing()
      }
      await this.table.put('sharing', String(enabled))
      return this.sharing()
    } finally { this.sharingChange = false }
  }
  @Remote
  async discover(signal) {
    const abort = new AbortController(); this.aborts.add(abort)
    const cancel = () => abort.abort(); signal?.addEventListener('abort', cancel, {once:true})
    if (signal?.aborted) abort.abort()
    try {
      const candidates = await discover(abort.signal)
      const checked = await Promise.all(candidates.map(async item => {
        if (this.gateway && [this.gateway.url, ...this.gateway.urls].includes(item.url)) return null
        try { await probe(item.url, abort.signal); return item } catch { return null }
      }))
      return checked.filter(Boolean)
    } finally { this.aborts.delete(abort); signal?.removeEventListener('abort', cancel) }
  }
  @Remote
  async configure(url) {
    const value = serviceUrl.parse(url).replace(/\/+$/, '')
    if (this.gateway && [this.gateway.url, ...this.gateway.urls].includes(value)) throw new Error('This is your own sharing address; keep the local backend configured')
    if (this.sharingChange) throw new Error('Sharing settings are being updated')
    if (this.sockets.size) throw new Error('Close the table and sign out before changing the service')
    if (value !== this.upstream) {
      await this.advertiser?.close(); await this.gateway?.close(); this.advertiser = undefined; this.gateway = undefined
      await this.table.put('sharing', 'false')
    }
    for (const abort of this.aborts) abort.abort()
    const previousJar = this.jar; this.jar = new CookieJar()
    await previousJar.removeAllCookies(); await this.table.put('upstreamUrl',value); this.upstream = value
    return value
  }
  url(path) {
    if (!this.upstream) throw new Error('POKER_NOT_CONFIGURED')
    servicePath.parse(path)
    return this.upstream.replace(/\/+$/, '') + path
  }
  @Remote
  async request(path, body, signal) {
    if (!this.upstream) return {status:503,text:JSON.stringify({error:'POKER_NOT_CONFIGURED'})}
    const url = this.url(path); const jar = this.jar; const abort = new AbortController(); this.aborts.add(abort)
    const onAbort = () => abort.abort()
    signal?.addEventListener('abort',onAbort,{once:true})
    if (signal?.aborted) abort.abort()
    const timer = setTimeout(onAbort,this.config.requestTimeoutMs)
    try {
      const response = await fetch(url,{method:body === null ? 'GET' : 'POST',body:body ?? undefined,headers:{'Content-Type':'application/json',Cookie:await jar.getCookieString(url),Origin:new URL(url).origin},redirect:'error',signal:abort.signal})
      for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie,url)
      const text = (await boundedBody(response,4_000_000)).toString('utf8')
      return {status:response.status,text}
    } finally {clearTimeout(timer);this.aborts.delete(abort);signal?.removeEventListener('abort',onAbort)}
  }
  @Remote
  async avatar(path, signal) {
    if (!/^\/account\/avatars\/[A-Za-z0-9_.-]+$/.test(path) && !/^\/avatars\/[A-Za-z0-9_.-]+$/.test(path)) throw new Error('Invalid avatar path')
    const url = this.url(path)
    const abort = new AbortController(); this.aborts.add(abort)
    const stop = () => abort.abort(); signal?.addEventListener('abort',stop,{once:true})
    if(signal?.aborted)stop()
    const timer=setTimeout(stop,this.config.requestTimeoutMs)
    try {
      const response=await fetch(url,{headers:{Cookie:await this.jar.getCookieString(url)},redirect:'error',signal:abort.signal})
      const mime=response.headers.get('content-type')?.split(';')[0]
      if(!response.ok || !['image/png','image/jpeg','image/webp'].includes(mime)) throw new Error('Unsupported avatar')
      return `data:${mime};base64,${(await boundedBody(response,512_000)).toString('base64')}`
    } finally {clearTimeout(timer);this.aborts.delete(abort);signal?.removeEventListener('abort',stop)}
  }
  @Remote({mode:'stream'})
  async *follow(table, signal) {
    const httpUrl = this.url(`/rooms/${encodeURIComponent(table)}/socket`)
    const url = new URL(httpUrl); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url,{headers:{Cookie:await this.jar.getCookieString(httpUrl),Origin:new URL(httpUrl).origin},handshakeTimeout:this.config.requestTimeoutMs,maxPayload:4_000_000})
    this.sockets.get(table)?.terminate();this.sockets.set(table,socket)
    const queue = []; let wake; let done = false
    const push = value => {if(queue.length >= 128){socket.terminate();return};queue.push(value);wake?.()}
    const stop = () => {done=true;socket.terminate();wake?.()}
    signal?.addEventListener('abort',stop,{once:true})
    socket.on('open',()=>push({type:'open'}))
    socket.on('message',data=>push({type:'message',data:data.toString()}))
    socket.on('close',code=>{push({type:'close',code});done=true;wake?.()})
    socket.on('error',()=>{push({type:'close',code:1006});done=true;wake?.()})
    try {
      if(signal?.aborted)stop()
      while(!done || queue.length){if(queue.length)yield queue.shift();else await new Promise(resolve=>{wake=resolve})}
    } finally {signal?.removeEventListener('abort',stop);stop();if(this.sockets.get(table)===socket)this.sockets.delete(table)}
  }
  @Remote
  sync(table, message) {
    const command = z.object({type:z.literal('sync'),cursor:z.object({handID:z.string(),revision:z.number()}).optional()}).strict().parse(JSON.parse(message))
    const socket=this.sockets.get(table)
    if(!socket || socket.readyState!==WebSocket.OPEN)return false
    socket.send(JSON.stringify(command));return true
  }
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const chunks: Uint8Array[]=[];let length=0
  if(!response.body)return Buffer.alloc(0)
  for await(const chunk of response.body){length+=chunk.byteLength;if(length>limit)throw new Error('Poker response exceeds size limit');chunks.push(chunk)}
  return Buffer.concat(chunks)
}
