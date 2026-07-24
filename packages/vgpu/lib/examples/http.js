import { network, integrity } from './errors.js';
export const LIMITS={discovery:32768,index:1048576,manifest:262144,file:2097152,pull:33554432};
export function trustedOrigin(baseUrl) {
 let u; try{u=new URL(baseUrl);}catch{throw integrity('Invalid examples API origin');}
 const loop=['127.0.0.1','localhost','::1'].includes(u.hostname);
 if (u.protocol!=='https:' && !(u.protocol==='http:'&&loop)) throw integrity('Examples API requires HTTPS');
 if (!loop && (u.hostname!=='vgpu.labs.vercel.dev'||u.port)) throw integrity('Untrusted examples API host');
 if(u.username||u.password||u.search||u.hash) throw integrity('Invalid examples API origin');
 return u.origin;
}
export function assertTrustedUrl(value, origin, immutable=false) {
 let u; try{u=new URL(value);}catch{throw integrity(`Invalid API URL: ${value}`);}
 if(u.origin!==origin||u.username||u.password||u.hash) throw integrity(`API URL leaves trusted origin: ${value}`);
 if(immutable&&!/^\/(?:api\/)?examples\/v1\/revisions\/[a-f0-9]{64}\//.test(u.pathname)) throw integrity(`Invalid immutable artifact URL: ${value}`);
 return u.href;
}
export async function requestBytes(url,{fetchImpl=fetch,limit,contentTypes,etag,timeoutMs=10000}={}) {
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
 let response;
 try { response=await fetchImpl(url,{redirect:'error',signal:controller.signal,headers:etag?{'if-none-match':etag}:{}}); }
 catch(e){clearTimeout(timer); throw network(e?.name==='AbortError'?`Request timed out: ${url}`:`Request failed: ${url}`);}
 if(response.status===304){clearTimeout(timer); return {notModified:true,etag:response.headers.get('etag')||etag};}
 if(!response.ok){clearTimeout(timer); throw network(`HTTP ${response.status} from ${url}`);}
 const type=(response.headers.get('content-type')||'').toLowerCase();
 if(!contentTypes.some(t=>type===t||type===`${t}; charset=utf-8`)) {clearTimeout(timer); throw integrity(`Unexpected content-type from ${url}: ${type||'(missing)'}`);}
 const length=response.headers.get('content-length'); if(length!==null&&(+length>limit||!Number.isSafeInteger(+length)||+length<0)){clearTimeout(timer); throw integrity(`Response exceeds ${limit} bytes`);}
 const chunks=[];let size=0;
 try { const reader=response.body?.getReader(); if(!reader) throw new Error('missing response body'); while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw integrity(`Response exceeds ${limit} bytes`);}chunks.push(value);} }
 catch(e){clearTimeout(timer);if(e?.code)throw e;throw network(`Truncated or timed out response: ${url}`);} clearTimeout(timer);
 return {bytes:Buffer.concat(chunks.map(x=>Buffer.from(x)),size),etag:response.headers.get('etag')||undefined};
}
export async function requestJson(url,opts){const r=await requestBytes(url,opts);if(r.notModified)return r;try{return {...r,value:JSON.parse(r.bytes.toString('utf8'))};}catch{throw integrity(`Invalid JSON from ${url}`);}}
