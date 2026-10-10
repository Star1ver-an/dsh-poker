/** Credential-free IPv4 LAN discovery. Addresses always come from the UDP sender. */
import { createSocket } from 'node:dgram'
import { networkInterfaces, hostname } from 'node:os'
import { randomBytes } from 'node:crypto'

const protocol = 'dsh-poker/1'
export const discoveryPort = 41889
const noncePattern = /^[a-f0-9]{32}$/
export function localAddress(address: string) {
  const p = address.split('.').map(Number)
  return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (p[0] === 10 || p[0] === 127 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31))
}
export function loopbackService(value: string) {
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname) } catch { return false }
}
function packet(data: Buffer) {
  if (data.length > 1400) return null
  try { const p = JSON.parse(data.toString()); return p && p.protocol === protocol && noncePattern.test(p.nonce) ? p : null } catch { return null }
}
export function candidate(data: Buffer, address: string, nonce: string) {
  const p = packet(data)
  if (!p || p.type !== 'service' || p.nonce !== nonce || !localAddress(address) ||
      !['http', 'https'].includes(p.scheme) || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535 ||
      typeof p.path !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(p.path) || p.path.length > 160 ||
      typeof p.name !== 'string' || p.name.length > 80) return null
  return {name:p.name.replace(/[\u0000-\u001f\u007f]/g, ''), url:`${p.scheme}://${address}:${p.port}${p.path.replace(/\/$/, '')}`}
}
/** Only a loopback backend can be advertised; remote clients never become duplicate hosts. */
export async function advertise(value: string, port = discoveryPort) {
  if (!loopbackService(value)) throw new Error('Only a service on this computer can be shared')
  const url = new URL(value)
  if (!/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(url.pathname)) throw new Error('Unsupported discovery path')
  const socket = createSocket('udp4')
  let error = '', closed = false, count = 0, second = 0
  socket.on('error', e => { error = e.message })
  socket.on('message', (data, peer) => {
    const request = packet(data)
    if (!request || request.type !== 'search' || !localAddress(peer.address)) return
    const now = Math.floor(Date.now() / 1000)
    if (now !== second) { second = now; count = 0 }
    if (++count > 40) return
    const message = Buffer.from(JSON.stringify({protocol, type:'service', nonce:request.nonce,
      name:hostname().slice(0, 80), scheme:url.protocol.slice(0, -1),
      port:Number(url.port || (url.protocol === 'https:' ? 443 : 80)), path:url.pathname}))
    socket.send(message, peer.port, peer.address, e => { if (e) error = e.message })
  })
  await new Promise<void>((resolve, reject) => {
    const fail = (e: Error) => { try { socket.close() } catch { /* Bind already closed the socket. */ } reject(e) }
    socket.once('error', fail)
    socket.bind(port, '0.0.0.0', () => { socket.off('error', fail); socket.unref(); resolve() })
  })
  return { get error() { return error }, port:(socket.address() as {port:number}).port,
    close:() => new Promise<void>(resolve => { if (closed) return resolve(); closed = true; socket.close(() => resolve()) }) }
}
function broadcasts() {
  const addresses = new Set(['255.255.255.255', '127.0.0.1'])
  for (const infos of Object.values(networkInterfaces())) for (const info of infos ?? []) {
    if (info.family !== 'IPv4' || info.internal || !localAddress(info.address)) continue
    const mask = info.netmask.split('.').map(Number)
    addresses.add(info.address.split('.').map((n, i) => Number(n) | (255 ^ mask[i])).join('.'))
  }
  return [...addresses]
}
/** Each scan uses a fresh nonce and ephemeral socket, closed on timeout or cancellation. */
export async function discover(signal?: AbortSignal, options = {port:discoveryPort, timeoutMs:1600, targets:broadcasts()}) {
  const socket = createSocket('udp4'), nonce = randomBytes(16).toString('hex')
  const found = new Map<string, {name:string; url:string}>()
  if (signal?.aborted) return []
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>, finished = false
    const finish = (error?: Error) => {
      if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel)
      try { socket.close() } catch { /* Cancellation can precede bind completion. */ }
      if (error) reject(error); else resolve()
    }
    const cancel = () => finish()
    signal?.addEventListener('abort', cancel, {once:true})
    socket.on('error', finish)
    socket.on('message', (data, peer) => {
      const item = candidate(data, peer.address, nonce)
      if (item && found.size < 16) found.set(item.url, item)
    })
    socket.bind(0, '0.0.0.0', () => {
      if (finished) return
      socket.setBroadcast(true)
      const message = Buffer.from(JSON.stringify({protocol, type:'search', nonce}))
      for (const address of options.targets) socket.send(message, options.port, address, () => { /* Unroutable adapters do not abort the other broadcasts. */ })
      timer = setTimeout(() => finish(), options.timeoutMs)
    })
  })
  return [...found.values()]
}
/** Confirm the public poker protocol before offering an address to the user. No cookies are sent. */
export async function probe(url: string, signal?: AbortSignal) {
  const response = await fetch(`${url.replace(/\/$/, '')}/account/config`, {redirect:'error', signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(1500)]) : AbortSignal.timeout(1500)})
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty service response')
  let size = 0; const chunks: Uint8Array[] = []
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 32768) throw new Error('Service response too large'); chunks.push(part.value) } }
  finally { await reader.cancel() }
  const body = JSON.parse(Buffer.concat(chunks).toString())
  if (!Array.isArray(body?.data?.tables) || !body.data.tables.every((v: unknown) => typeof v === 'string') || !body.data.captcha) throw new Error('Not a poker service')
}
