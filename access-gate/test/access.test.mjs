import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import gate from '../src/worker.mjs';
globalThis.crypto ||= webcrypto;
const env={VK_APP_ID:'12345',VK_GROUP_ID:'45678',VK_GROUP_TOKEN:'mock-group-credential',SESSION_SECRET:'x'.repeat(40),
ASSETS:{fetch:async()=>new Response('<html><body>DIAGNOSIS</body></html>')}};
class Rewriter{on(){return this;}transform(r){return r;}}
globalThis.HTMLRewriter=Rewriter;
const host='https://preview.invalid';
let members=[10],requests=[],apiBroken=false,wrongIdentity=false;
globalThis.fetch=async(input,opts)=>{
 const url=new URL(String(input));requests.push({url,opts});
 if(apiBroken)throw Error('unavailable');
 if(url.pathname==='/oauth2/auth')return Response.json({access_token:'test',user_id:10,state:url.searchParams.get('state')});
 if(url.pathname==='/oauth2/user_info')return Response.json({user:{user_id:wrongIdentity?'11':'10'}});
 if(url.pathname==='/method/groups.getMembers'){
  const offset=Number(url.searchParams.get('offset'));
  return Response.json({response:{count:members.length,items:members.slice(offset,offset+1000)}});
 }
 throw Error('unexpected remote');
};
const run=(p,c='',extra={})=>gate.fetch(new Request(host+p,{headers:c?{cookie:c}:{}}),{...env,...extra});
const jar=r=>r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
async function signIn(){
 const start=await run('/auth/start');
 const uri=new URL(start.headers.get('location'));
 const path='/auth/callback?state='+encodeURIComponent(uri.searchParams.get('state'))+'&code=abc&device_id=def';
 return {start,uri,flow:jar(start),end:await run(path,jar(start))};
}
test('no session never serves the application',async()=>{
 requests=[];const r=await run('/');assert.doesNotMatch(await r.text(),/DIAGNOSIS/);
 assert.equal((await run('/api/access')).status,403);
 assert.equal(requests.length,0);
});
test('OAuth uses random state, PKCE, short HttpOnly cookie',async()=>{
 const r=await run('/auth/start'),uri=new URL(r.headers.get('location'));
 assert.equal(uri.hostname,'id.vk.ru');
 assert.equal(uri.searchParams.get('redirect_uri'),host+'/auth/callback');
 assert.equal(uri.searchParams.get('code_challenge_method'),'s256');
 assert.ok(uri.searchParams.get('state').length>=20);
 assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 assert.match(r.headers.get('set-cookie'),/Max-Age=600/);
});
test('paid subscriber accesses app and revoked subscriber is denied',async()=>{
 members=[10];const {end}=await signIn();assert.equal(end.status,303);
 const c=jar(end);assert.match(c,/sd_session=/);
 assert.equal((await run('/api/access',c)).status,200);
 assert.match(await(await run('/',c)).text(),/DIAGNOSIS/);
 members=[];
 assert.equal((await run('/api/access',c)).status,403);
 assert.doesNotMatch(await(await run('/',c)).text(),/DIAGNOSIS/);
});
test('non paying user never obtains a session',async()=>{
 members=[];const {end}=await signIn();
 assert.equal(end.headers.get('location'),'/?error=no_subscription');
 assert.doesNotMatch(jar(end),/sd_session=/);
});
test('OAuth callback rejects missing or forged state and user',async()=>{
 assert.equal((await run('/auth/callback?code=abc&state=x&device_id=y')).headers.get('location'),'/?error=auth');
 wrongIdentity=true;const {end}=await signIn();
 assert.equal(end.headers.get('location'),'/?error=vk_unavailable');wrongIdentity=false;
});
test('VK outages and tampered session fail closed',async()=>{
 members=[10];const {end}=await signIn(),c=jar(end);
 assert.equal((await run('/api/access',c.replace('sd_session=','sd_session=A'))).status,403);
 apiBroken=true;assert.equal((await run('/api/access',c)).status,403);
 assert.equal((await run('/',c)).status,503);apiBroken=false;
});
test('large subscriber list is searched beyond first 1000',async()=>{
 members=Array.from({length:2100},(_,i)=>i+1000);members[2095]=10;requests=[];
 const {end}=await signIn();assert.equal(end.headers.get('location'),'/');
 assert.ok(requests.filter(x=>x.url.pathname==='/method/groups.getMembers').length>=3);
 members=[10];
});
test('unrecognized paths and incorrect configuration are refused',async()=>{
 const {end}=await signIn(),c=jar(end);
 assert.equal((await run('/other.html',c)).status,404);
 assert.equal((await run('/',c,{VK_GROUP_ID:'invalid'})).status,503);
});
test('logout expires cookie',async()=>{
 const {end}=await signIn(),r=await run('/auth/logout',jar(end));
 assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
});
