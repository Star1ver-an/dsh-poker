/** A sharing-only gateway to the configured loopback backend, never a general proxy. */
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import { loopbackService, localAddress } from './discovery.ts'

export async function gateway(base: string, port = 41890) {
  if (!loopbackService(base)) throw new Error('Sharing requires a local backend')
  const target = new URL(base), sockets = new Set<Duplex>()
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest
  const allowed = (path: string) => /^\/(?:account|rooms|avatars)(?:\/[A-Za-z0-9_%.-]+)*$/.test(path) &&
    !/%2[ef]|\.\./i.test(path)
  const upstream = (req: IncomingMessage) => request(new URL(target.href.replace(/\/$/, '') + req.url), {
    method:req.method, headers:{'content-type':req.headers['content-type'] ?? 'application/json',
      cookie:req.headers.cookie ?? '', origin:target.origin,
      ...(req.headers.upgrade ? {upgrade:'websocket',connection:'Upgrade',
        'sec-websocket-key':req.headers['sec-websocket-key'], 'sec-websocket-version':'13'} : {})}, timeout:15000,
  })
  const originAllowed = (req: IncomingMessage) => req.headers.origin === `http://${req.headers.host}`
  const server = createServer((req, res) => {
    if (!allowed(req.url ?? '') || !['GET','POST'].includes(req.method ?? '')) { res.writeHead(404); res.end(); return }
    if (req.method === 'POST' && !originAllowed(req)) { res.writeHead(403); res.end(); return }
    const out = upstream(req)
    out.on('response', response => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res)
    })
    out.on('timeout', () => out.destroy(new Error('Backend timeout')))
    out.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    let bytes = 0
    req.on('data', chunk => {
      bytes += chunk.length
      if (bytes > 2_000_000) { out.destroy(); if (!res.headersSent) res.writeHead(413); res.end(); req.destroy() }
    })
    req.on('aborted', () => out.destroy())
    res.on('close', () => out.destroy())
    req.pipe(out)
  })
  server.requestTimeout = 20000; server.headersTimeout = 10000
  server.on('connection', socket => {
    if (!localAddress((socket.remoteAddress ?? '').replace(/^::ffff:/, ''))) { socket.destroy(); return }
    sockets.add(socket); socket.on('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req.url ?? '') || !originAllowed(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    const out = upstream(req)
    socket.on('error', () => out.destroy()); socket.on('close', () => out.destroy())
    out.on('error', () => socket.destroy()); out.on('timeout', () => out.destroy())
    out.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode ?? 502} Rejected\r\nConnection: close\r\n\r\n`); response.resume() })
    out.on('upgrade', (response, backend, upstreamHead) => {
      out.setTimeout(0); sockets.add(backend)
      const headers = Object.entries(response.headers).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(v => `${key}: ${v}`))
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join('\r\n')}\r\n\r\n`)
      if (head.length) backend.write(head)
      if (upstreamHead.length) socket.write(upstreamHead)
      backend.on('error', () => socket.destroy()); backend.on('close', () => { sockets.delete(backend); socket.destroy() })
      socket.on('close', () => backend.destroy()); socket.pipe(backend); backend.pipe(socket)
    })
    out.end()
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port,'0.0.0.0', () => {server.off('error',reject); resolve()}) })
  server.unref()
  const boundPort = (server.address() as {port:number}).port
  return {url:`http://127.0.0.1:${boundPort}`, urls:Object.values(networkInterfaces()).flatMap(infos =>
    (infos ?? []).filter(i => i.family === 'IPv4' && !i.internal && localAddress(i.address)).map(i => `http://${i.address}:${boundPort}`)),
    close:() => new Promise<void>(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()) })}
}
