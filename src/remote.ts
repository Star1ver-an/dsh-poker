/** Identical RPC validators used by the Host and the browser. */
import { z } from 'zod'
const name = '@dsh-local/poker'
export const serviceUrl = z.string().max(2048).refine(value => {
  if (value === '') return true
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash } catch { return false }
}, 'Use an HTTP(S) service URL without credentials, query or fragment')
export const servicePath = z.string().max(2048).regex(/^\/(?:account|rooms|avatars)(?:\/[A-Za-z0-9_%.-]+)*$/).refine(path => {try{return !decodeURIComponent(path).split('/').some(p => p === '..' || p === '.')}catch{return false}})
const table = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const frame = z.discriminatedUnion('type', [z.object({type:z.literal('open')}),z.object({type:z.literal('message'),data:z.string()}),z.object({type:z.literal('close'),code:z.number()})])
const sharing = z.object({enabled:z.boolean(), canShare:z.boolean(), error:z.string(), urls:z.array(serviceUrl)})
const declarations = [
  ['discover', [], z.array(z.object({name:z.string(), url:serviceUrl}))],
  ['sharing', [], sharing], ['setSharing', [['enabled', z.boolean()]], sharing],
  ['endpoint', [], z.string()], ['configure', [['url', serviceUrl]], z.string()],
  ['avatar', [['path', servicePath]], z.string()],
  ['request', [['path', servicePath], ['body', z.string().max(2_000_000).nullable()]], z.object({status:z.number(),text:z.string()})],
  ['follow', [['table', table]], frame, 'stream'],
  ['sync', [['table', table], ['message', z.string().max(4096)]], z.boolean()],
]
const descriptors = declarations.map(([method, parameters, result, mode]) => ({
  id:`${name}#pokerBridge/${method}`, service:'pokerBridge', namespace:'pokerBridge', method,
  ...(mode ? {mode} : {}), invocation:{kind:'direct'},
  parameters:parameters.map(([parameter, schema]) => ({name:parameter,wire:parameter,source:'json',codec:{mode:'strict',typeSymbol:`${name}#${method}:${parameter}`,create:()=>schema}})),
  cancellation:{parameter:'signal'},result:{mode:'strict',typeSymbol:`${name}#${method}:result`,create:()=>result},
}))
export const TYPERT = {package:name,face:'host',schemas:[],invocations:descriptors,model:{services:[],events:[],objects:[]}}
export const TYPERT_REMOTE = {package:name,descriptors}
