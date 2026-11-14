import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';

// Drive Express with real Node request/response streams, without opening a port.
export async function requestInProcess(app,url,body,method,auth='',headers={}){
 const chunks=[];
 const socket=new Duplex({read(){},write(chunk,encoding,callback){chunks.push(Buffer.from(chunk));callback();}});
 Object.defineProperty(socket,'remoteAddress',{value:'127.0.0.1'});
 const req=new IncomingMessage(socket);req.method=method||(body===undefined?'GET':'POST');req.url='/api'+url;req.httpVersion='1.1';req.httpVersionMajor=1;req.httpVersionMinor=1;
 const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
 req.headers={host:'test.local',origin:'http://test.local','x-bill-request':'1',...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{}),...(auth?{cookie:auth}:{}),...headers};
 const res=new ServerResponse(req);res.assignSocket(socket);
 const result=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.destroy();reject(new Error('Response timed out: '+url));},5000);
  res.on('error',e=>{clearTimeout(timer);reject(e);});res.on('finish',()=>{
   clearTimeout(timer);
   try{
    const raw=Buffer.concat(chunks).toString(),text=raw.slice(raw.indexOf('\r\n\r\n')+4);let data;try{data=JSON.parse(text);}catch{data=text;}
    const headers=res.getHeaders();resolve({status:res.statusCode,headers,data,cookie:[].concat(headers['set-cookie']||[])[0]?.split(';')[0]});
   }catch(e){reject(e);}finally{socket.destroy();}
  });
 });
 req.complete=true;app.handle(req,res);if(bytes)req.push(bytes);req.push(null);return result;
}
