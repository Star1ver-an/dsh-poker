import {afterEach, beforeEach, expect, it} from 'vitest'
import {createServer} from 'node:http'
import {WebSocketServer} from 'ws'
import {Context} from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import {DomainFacility} from '@deepseek-ai/dsh-storage-domain'
import {PokerBridge} from '../src/index.ts'
import {serviceUrl,servicePath} from '../src/remote.ts'
import {MemoryMediaPool,MemoryStorageBackend} from './helpers/memory-backend.ts'

let ctx: Context, bridge: PokerBridge, server: ReturnType<typeof createServer>, ws: WebSocketServer, base: string
let cookies: string[], commands: string[], socketCookie: string
beforeEach(async()=>{
  cookies=[];commands=[];socketCookie=''
  server=createServer((req,res)=>{
    cookies.push(req.headers.cookie ?? '')
    if(req.url==='/poker/account/login')res.setHeader('Set-Cookie','test-session=private; HttpOnly; Path=/poker; SameSite=Strict')
    if(req.url==='/poker/account/avatars/1'){res.setHeader('Content-Type','image/png');res.end(Buffer.from([137,80,78,71]));return}
    if(req.url==='/poker/account/redirect'){res.writeHead(302,{Location:'/unexpected'});res.end();return}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{ok:true}}))
  })
  ws=new WebSocketServer({server})
  ws.on('connection',(socket,req)=>{
    socketCookie=req.headers.cookie ?? ''
    socket.on('message',data=>{commands.push(data.toString());socket.send(JSON.stringify({type:'snapshot'}))})
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}/poker`
  ctx=new Context();await ctx.plugin(Storage)
  ctx.storage.backend.register('memory',new MemoryStorageBackend(new MemoryMediaPool()))
  const facility=new DomainFacility(ctx,{backend:'memory',routes:{}})
  ctx.storage.mount('domain',facility);ctx.provide('storageDomain',facility);ctx.provide('typert',{} as never)
  await ctx.plugin(PokerBridge,{upstreamUrl:'',requestTimeoutMs:1000})
  bridge=(ctx as any).pokerBridge
})
afterEach(async()=>{
  await ctx?.fiber.dispose()
  for(const client of ws?.clients ?? [])client.terminate()
  ws?.close();server?.closeAllConnections();await new Promise<void>(resolve=>server?.close(()=>resolve()))
})
it('keeps authentication in Host across HTTP and WebSocket, and cancels the stream',async()=>{
  await bridge.configure(base)
  await bridge.request('/account/login','{}')
  await bridge.request('/account/session',null)
  expect(cookies).toEqual(['','test-session=private'])
  const cancel=new AbortController(),frames=bridge.follow('friends',cancel.signal)
  expect((await frames.next()).value).toEqual({type:'open'})
  expect(socketCookie).toBe('test-session=private')
  expect(bridge.sync('friends',JSON.stringify({type:'sync'}))).toBe(true)
  expect((await frames.next()).value).toEqual({type:'message',data:'{"type":"snapshot"}'})
  expect(commands).toEqual(['{"type":"sync"}'])
  await expect(bridge.configure(base+'/other')).rejects.toThrow('Close the table')
  cancel.abort();await frames.return(undefined)
  expect(bridge.sockets.size).toBe(0)
})
it('clears authentication on service change and keeps only the address in storage',async()=>{
  await bridge.configure(base);await bridge.request('/account/login','{}')
  expect(await bridge.table.get('upstreamUrl')).toBe(base)
  await bridge.configure(base);await bridge.request('/account/session',null)
  expect(cookies.at(-1)).toBe('')
  await bridge.configure('');expect(await bridge.request('/account/config',null)).toMatchObject({status:503})
})
it('relays permitted avatars without exposing cookies and refuses redirects',async()=>{
  await bridge.configure(base);await bridge.request('/account/login','{}')
  expect(await bridge.avatar('/account/avatars/1')).toBe('data:image/png;base64,iVBORw==')
  expect(cookies.at(-1)).toBe('test-session=private')
  await expect(bridge.avatar('/account/login')).rejects.toThrow('Invalid avatar')
  await expect(bridge.request('/account/redirect',null)).rejects.toThrow()
})
it('validates configured origins, traversal, and pre-cancelled requests',async()=>{
  for(const value of ['file:///a','https://user:pass@example.com','https://example.com/?secret=x'])expect(serviceUrl.safeParse(value).success).toBe(false)
  for(const value of ['/account/../x','/account/%2e%2e/x','https://example.com','/account/%'])expect(servicePath.safeParse(value).success).toBe(false)
  await bridge.configure(base)
  const cancel=new AbortController();cancel.abort()
  await expect(bridge.request('/account/session',null,cancel.signal)).rejects.toThrow()
  expect(bridge.aborts.size).toBe(0);expect(cookies).toEqual([])
})
it('disabling the plugin closes a live socket and clears authentication',async()=>{
  await bridge.configure(base);await bridge.request('/account/login','{}')
  const frames=bridge.follow('friends');await frames.next()
  await ctx.fiber.dispose();await frames.next();await frames.return(undefined)
  expect(bridge.sockets.size).toBe(0)
  expect(await bridge.jar.getCookieString(base)).toBe('')
})
