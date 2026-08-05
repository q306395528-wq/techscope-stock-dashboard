'use strict';
import worker from './worker.js';
import { handleOverview } from './overview.js';

function timingSafeEqual(left,right){const a=String(left||''),b=String(right||'');if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i+=1)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function authorized(request,env){return !env.APP_ACCESS_TOKEN||timingSafeEqual(request.headers.get('x-techscope-key'),env.APP_ACCESS_TOKEN);}
function unauthorized(){return new Response(JSON.stringify({error:'需要正确的 TechScope 访问口令。'}),{status:401,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/overview'&&request.method==='GET'){
      if(!authorized(request,env))return unauthorized();
      return handleOverview(env);
    }
    if(url.pathname==='/api/config'&&request.method==='GET'){
      const response=await worker.fetch(request,env,ctx);
      if(!response.ok)return response;
      const data=await response.json();
      return new Response(JSON.stringify({...data,version:'4.1.0'}),{status:200,headers:response.headers});
    }
    return worker.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return worker.scheduled(controller,env,ctx);}
};
