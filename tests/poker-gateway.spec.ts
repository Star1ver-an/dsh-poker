import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { gateway } from '../src/gateway.ts'

it('routes only poker paths and preserves each client cookie while adapting Origin', async () => {
  const calls: {path:string; origin:string; cookie:string}[] = []
  const server = createServer((req, res) => {
    calls.push({path:req.url!,origin:req.headers.origin!,cookie:req.headers.cookie ?? ''})
    res.setHeader('Set-Cookie','poker_session=example; Path=/; HttpOnly; SameSite=Strict')
    res.end(JSON.stringify({data:{tables:['friends'],captcha:{provider:'none'}}}))
  })
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r))
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`
  const entry = await gateway(origin+'/poker',0)
  try {
    const response = await fetch(entry.url+'/account/config')
    expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    for (const cookie of ['poker_session=a','poker_session=b']) {
      expect((await fetch(entry.url+'/account/profile',{method:'POST',headers:{Origin:entry.url,Cookie:cookie},body:'{}'})).status).toBe(200)
    }
    expect(calls).toEqual([
      {path:'/poker/account/config',origin,cookie:''},
      {path:'/poker/account/profile',origin,cookie:'poker_session=a'},
      {path:'/poker/account/profile',origin,cookie:'poker_session=b'},
    ])
    expect((await fetch(entry.url+'/api/other')).status).toBe(404)
    expect((await fetch(entry.url+'/account/profile',{method:'POST',headers:{Origin:'https://unrelated.example'},body:'{}'})).status).toBe(403)
    expect(calls).toHaveLength(3)
  } finally { await entry.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})
it('relays WebSocket frames with the original client session and closes them on disable', async () => {
  const server = createServer(), ws = new WebSocketServer({server})
  let seen: {cookie?:string; origin?:string; path?:string} = {}
  ws.on('connection',(socket,req) => { seen = {cookie:req.headers.cookie,origin:req.headers.origin,path:req.url}; socket.on('message',data => socket.send(data.toString())) })
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r))
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`
  const entry = await gateway(origin+'/poker',0)
  const client = new WebSocket(entry.url.replace('http:','ws:')+'/rooms/friends/socket',{headers:{Origin:entry.url,Cookie:'poker_session=a'}})
  try {
    await new Promise<void>((r,j) => { client.once('open',r); client.once('error',j) })
    const message = new Promise<string>(r => client.once('message',data => r(data.toString())))
    client.send('sync'); expect(await message).toBe('sync')
    expect(seen).toEqual({cookie:'poker_session=a',origin,path:'/poker/rooms/friends/socket'})
    const closed = new Promise<void>(r => client.once('close',() => r()))
    await entry.close(); await closed
  } finally { client.terminate(); for (const socket of ws.clients) socket.terminate(); ws.close(); await new Promise<void>(r => server.close(() => r())) }
})
