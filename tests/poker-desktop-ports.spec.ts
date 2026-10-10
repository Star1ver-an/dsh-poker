import {expect,it,vi} from 'vitest'
import {desktopPorts} from '../src/client/desktop-ports.ts'

it('consumes plain Typert stream frames, unwraps ordinary RPC results, and cancels on close',async()=>{
  let signal: AbortSignal
  const remote={
    async *follow(table:string,cancel:AbortSignal){
      expect(table).toBe('friends');signal=cancel
      yield {type:'open'};yield {type:'message',data:'{"type":"state"}'}
      await new Promise<void>(resolve=>cancel.addEventListener('abort',()=>resolve(),{once:true}))
    },
    sync:vi.fn(async()=>({ok:true,value:true})),
  }
  const socket=desktopPorts(remote).socket('wss://dsh-poker.invalid/poker/rooms/friends/socket')
  socket.onopen=()=>socket.send('{"type":"sync"}')
  const message=new Promise(resolve=>{socket.onmessage=resolve})
  expect(await message).toEqual({data:'{"type":"state"}'})
  expect(remote.sync).toHaveBeenCalledWith('friends','{"type":"sync"}')
  socket.close();expect(signal!.aborted).toBe(true);expect(socket.readyState).toBe(3)
})
it('signals disconnection when synchronization was refused',async()=>{
  const remote={async *follow(_table:string,cancel:AbortSignal){yield {type:'open'};await new Promise<void>(resolve=>cancel.addEventListener('abort',()=>resolve(),{once:true}))},sync:async()=>({ok:true,value:false})}
  const socket=desktopPorts(remote).socket('wss://dsh-poker.invalid/poker/rooms/friends/socket')
  socket.onopen=()=>socket.send('{"type":"sync"}')
  const closed=new Promise(resolve=>{socket.onclose=resolve})
  expect(await closed).toEqual({code:1006})
})
