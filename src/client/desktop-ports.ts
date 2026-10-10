/** Adapt authenticated DSH Remote streams to the table connection model. */
export async function unwrap(call) {const result=await call;if(!result.ok)throw new Error(result.error.message);return result.value}
class RemoteSocket {
  readyState=0;onopen=null;onmessage=null;onerror=null;onclose=null;abort=new AbortController()
  constructor(remote,table){this.remote=remote;this.table=table;queueMicrotask(()=>void this.run())}
  async run(){
    try{
      for await(const frame of this.remote.follow(this.table,this.abort.signal)){
        if(frame.type==='open'){this.readyState=1;this.onopen?.({})}
        if(frame.type==='message')this.onmessage?.({data:frame.data})
        if(frame.type==='close'){this.finish(frame.code);return}
      }
      this.finish(1006)
    }catch(error){if(!this.abort.signal.aborted){console.warn('[poker] stream:',error instanceof Error ? error.message : String(error));this.finish(1006)}}
  }
  send(message){void unwrap(this.remote.sync(this.table,message)).then(sent=>{if(!sent)this.finish(1006)}).catch(()=>this.finish(1006))}
  finish(code){if(this.readyState===3)return;this.readyState=3;this.abort.abort();this.onclose?.({code})}
  close(){this.finish(1000)}
}
export function desktopPorts(remote){return {
  origin:'https://dsh-poker.invalid',now:Date.now,uuid:()=>crypto.randomUUID(),
  fetch:async(url,init={})=>{
    const path=new URL(String(url),'https://dsh-poker.invalid').pathname.replace(/^\/poker/,'')
    const reply=await unwrap(remote.request(path,init.body ?? null,init.signal))
    return new Response(reply.text,{status:reply.status,headers:{'Content-Type':'application/json'}})
  },
  socket:url=>new RemoteSocket(remote,decodeURIComponent(new URL(url).pathname.split('/').at(-2))),
}}
