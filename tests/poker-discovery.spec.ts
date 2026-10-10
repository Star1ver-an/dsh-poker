import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { advertise, candidate, discover, probe } from '../src/discovery.ts'

it('finds a local advertiser and releases its port when disabled', async () => {
  const host = await advertise('http://127.0.0.1:8090/poker', 0)
  const options = {port:host.port,timeoutMs:80,targets:['127.0.0.1']}
  try {
    const results = await discover(undefined, options)
    expect(results).toEqual([{name:expect.any(String),url:'http://127.0.0.1:8090/poker'}])
  } finally { await host.close() }
  expect(await discover(undefined, options)).toEqual([])
  const next = await advertise('http://127.0.0.1:8090/poker', options.port)
  await next.close()
})
it('cancels discovery and never advertises a remote backend', async () => {
  const abort = new AbortController()
  const scan = discover(abort.signal, {port:41889,timeoutMs:10000,targets:['127.0.0.1']})
  abort.abort()
  expect(await scan).toEqual([])
  await expect(advertise('http://192.168.1.2:8090/poker')).rejects.toThrow('Only a service')
})
it('binds discovery results to sender and nonce; rejects injected URLs and oversized packets', () => {
  const nonce = 'a'.repeat(32)
  const p = {protocol:'dsh-poker/1',type:'service',nonce,name:'Host',scheme:'http',port:8090,path:'/poker',url:'http://attacker.invalid'}
  const decode = (changes = {}, address = '192.168.1.20') => candidate(Buffer.from(JSON.stringify({...p,...changes})), address, nonce)
  expect(decode()).toEqual({name:'Host',url:'http://192.168.1.20:8090/poker'})
  for (const changes of [{nonce:'b'.repeat(32)},{port:0},{path:'//example.com'},{path:'/../secret'},{scheme:'file'},{name:'x'.repeat(1500)}]) expect(decode(changes)).toBeNull()
  expect(decode({}, '8.8.8.8')).toBeNull()
  expect(candidate(Buffer.from('null'), '127.0.0.1', nonce)).toBeNull()
})
it('verifies the poker protocol without credentials and rejects redirects and large responses', async () => {
  const cookies:string[] = []
  const server = createServer((req, res) => {
    cookies.push(req.headers.cookie ?? '')
    if (req.url?.startsWith('/redirect')) { res.writeHead(302,{Location:'/'}); res.end(); return }
    if (req.url?.startsWith('/large')) { res.end('x'.repeat(34000)); return }
    res.end(JSON.stringify({data:{tables:['friends'],captcha:{provider:'none'}}}))
  })
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`
  try {
    await probe(url)
    await expect(probe(url+'/redirect')).rejects.toThrow()
    await expect(probe(url+'/large')).rejects.toThrow('too large')
    expect(cookies.every(v => v === '')).toBe(true)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
