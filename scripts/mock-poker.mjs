/** Loopback-only integration fixture. No external accounts or monetary actions. */
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {WebSocketServer} from 'ws'
const room=JSON.parse(readFileSync(new URL('../tests/fixtures/playing.json',import.meta.url),'utf8'))
const server=createServer((req,res)=>{
  console.log(req.method,req.url)
  res.setHeader('Content-Type','application/json')
  if(req.url.includes('/avatars/')){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=','base64'));return}
  if(req.method==='POST' && !req.url.endsWith('/account/logout')){res.writeHead(403);res.end('{"error":"TEST_READ_ONLY"}');return}
  const data=req.url.endsWith('/account/config')?{tables:['friends'],captcha:{provider:'none',siteKey:null,appID:null}}:
    req.url.endsWith('/account/logout')?{ok:true}:
    req.url.includes('/account/')?{userID:4,username:'本机测试',avatarURL:'/account/avatars/4',balance:'0',initialized:true}:
    req.url.endsWith('/pending')?null:room
  res.end(JSON.stringify({data}))
})
const sockets=new WebSocketServer({server})
sockets.on('connection',socket=>socket.on('message',raw=>{
  const command=JSON.parse(raw.toString());console.log('WebSocket',command.type)
  if(command.type==='sync')socket.send(JSON.stringify({type:'state',snapshot:room,cursor:{handID:room.hand.handID,revision:room.hand.revision},batches:[],reset:true,serverTime:new Date().toISOString()}))
}))
server.listen(0,'127.0.0.1',()=>console.log(`TEST_URL=http://127.0.0.1:${server.address().port}/poker`))
