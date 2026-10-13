import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import gate from '../src/worker.mjs';
globalThis.crypto ||= webcrypto;
const env={VK_APP_ID:'12345',VK_GROUP_ID:'45678',VK_GROUP_TOKEN:'mock-group-credential',SESSION_SECRET:'x'.repeat(40),
ASSETS:{fetch:async()=>new Response('<html><body>DIAGNOSIS</body></html>')}};
class Rewriter{on(){return this;}transform(r){return r;}}
globalThis.HTMLRewriter=Rewriter;
const host='https://preview.invalid';
let members=[10],requests=[],apiBroken=false,wrongIdentity=false,memberObjects=false,invalidMember=false,remoteError='';
globalThis.fetch=async(input,opts)=>{
 const url=new URL(String(input));requests.push({url,opts});
 if(apiBroken)throw Error('unavailable');
 if(url.pathname==='/oauth2/auth')return remoteError==='exchange'?Response.json({error:'invalid_grant'}):Response.json({access_token:'test',user_id:10,state:url.searchParams.get('state')});
 if(url.pathname==='/oauth2/user_info')return remoteError==='userinfo'?Response.json({error:'user_info_failed'}):Response.json({user:{user_id:wrongIdentity?'11':'10'}});
 if(url.pathname==='/method/groups.getMembers'){
  if(remoteError==='donut')return Response.json({error:{error_code:15,error_msg:'Access denied'}});
  const offset=Number(url.searchParams.get('offset'));
  const page=members.slice(offset,offset+1000);return Response.json({response:{count:members.length,items:invalidMember?[{id:'10'}]:memberObjects?page.map(id=>({id})):page}});
 }
 throw Error('unexpected remote');
};
const run=(p,c='',extra={})=>gate.fetch(new Request(host+p,{headers:c?{cookie:c}:{}}),{...env,...extra});
const jar=r=>r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
async function signIn(extra={}){
 const start=await run('/auth/start');
 const uri=new URL(start.headers.get('location'));
 const path='/auth/callback?state='+encodeURIComponent(uri.searchParams.get('state'))+'&code=abc&device_id=def';
 return {start,uri,flow:jar(start),end:await run(path,jar(start),extra)};
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
 assert.equal(end.headers.get('location'),'/?error=vkid_userinfo_shape');wrongIdentity=false;
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

test('official filterResponse supports member objects with integer id',async()=>{
  members=[10];memberObjects=true;requests=[];
  try{
    const {end}=await signIn();
    assert.equal(end.headers.get('location'),'/');
    const c=jar(end);
    assert.equal((await run('/api/access',c)).status,200);
    assert.equal(requests.some(x=>x.url.pathname==='/method/groups.getMembers'&&x.url.searchParams.get('filter')==='donut'),true);
  }finally{memberObjects=false;}
});
test('unexpected member objects fail closed instead of granting access',async()=>{
  invalidMember=true;members=[10];
  try{
    const {end}=await signIn();
    assert.equal(end.headers.get('location'),'/?error=donut_shape');
    assert.doesNotMatch(jar(end),/sd_session=/);
  }finally{invalidMember=false;}
});
test('owner bypass only works for matching verified VK identity',async()=>{
  members=[];requests=[];
  const {end}=await signIn({VK_OWNER_USER_ID:'10'});
  assert.equal(end.headers.get('location'),'/');
  const c=jar(end);
  assert.equal((await run('/api/access',c,{VK_OWNER_USER_ID:'10'})).status,200);
  assert.equal(requests.some(x=>x.url.pathname==='/method/groups.getMembers'),false);
  assert.equal((await run('/api/access',c,{VK_OWNER_USER_ID:'11'})).status,403);
  wrongIdentity=true;
  try{
    const {end:forged}=await signIn({VK_OWNER_USER_ID:'10'});
    assert.equal(forged.headers.get('location'),'/?error=vkid_userinfo_shape');
  }finally{wrongIdentity=false;members=[10];}
});
test('expired signed session cannot bypass gate',async()=>{
  members=[10];
  const {end}=await signIn(),c=jar(end);
  const realNow=Date.now;
  Date.now=()=>realNow()+13*3600*1000;
  try{
    assert.equal((await run('/api/access',c)).status,403);
    assert.doesNotMatch(await(await run('/index.html',c)).text(),/DIAGNOSIS/);
  }finally{Date.now=realNow;}
});
test('locked origin offers same-origin history JSON download without exposing app',async()=>{
  const r=await run('/'),h=await r.text();
  assert.equal(r.status,200);
  assert.match(h,/download-history/);
  assert.match(h,/salesDiagnosticHistory:v2/);
  assert.match(h,/historySchemaVersion:2/);
  assert.match(h,/sales-diagnostic-history.json/);
  assert.doesNotMatch(h,/DIAGNOSIS/);
  assert.match(r.headers.get('content-security-policy'),/script-src 'nonce-/);
  assert.match(r.headers.get('cache-control'),/no-store/);
});

test('locked-screen history export JSON matches diagnostic import contract',async()=>{
  const response=await run('/'),html=await response.text();
  const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script,'export script exists');
  const saved={schemaVersion:2,cycles:[{cycleId:'cycle_abc',status:'ACTIVE',answers:{a:1}}]};
  const message={textContent:''};let handler,downloaded,clicked=false,downloadName;
  const button={addEventListener:(event,fn)=>{assert.equal(event,'click');handler=fn;}};
  const dom={
    getElementById:id=>id==='download-history'?button:id==='history-message'?message:null,
    createElement:()=>({href:'',set download(v){downloadName=v;},get download(){return downloadName;},click(){clicked=true;},remove(){}}),
    body:{appendChild(){}}
  };
  const fakeUrl={createObjectURL:b=>{downloaded=b;return 'blob:local';},revokeObjectURL(){}};
  runInNewContext(script,{document:dom,localStorage:{getItem:key=>key==='salesDiagnosticHistory:v2'?JSON.stringify(saved):null},Blob,URL:fakeUrl,Date,JSON,setTimeout:()=>0});
  handler();
  assert.equal(clicked,true);
  assert.equal(downloadName,'sales-diagnostic-history.json');
  const exported=JSON.parse(await downloaded.text());
  assert.equal(exported.exportVersion,1);
  assert.equal(exported.historySchemaVersion,2);
  assert.deepEqual(exported.cycles,saved.cycles);
  assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
});

test('live troubleshooting distinguishes VK ID code exchange, identity, Donut API without leaking secrets',async()=>{
  const baselineMembers=[10];members=baselineMembers;
  const scenes=[
    ['exchange','vkid_exchange_api','Сбой VK ID на этапе получения токена.'],
    ['userinfo','vkid_userinfo_api','Сбой VK ID на этапе подтверждения аккаунта.'],
    ['donut','donut_api','Сбой проверки подписки VK Donut.']
  ];
  const warn=console.warn,diagnostics=[];
  console.warn=(...values)=>diagnostics.push(values);
  try{
    for(const [scenario,stage,description] of scenes){
      remoteError=scenario;requests=[];
      const {end}=await signIn();
      assert.equal(end.headers.get('location'),'/?error='+stage);
      assert.doesNotMatch(jar(end),/sd_session=/);
      const locked=await run('/?error='+stage),html=await locked.text();
      assert.equal(locked.status,200);
      assert.match(html,new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      assert.match(html,new RegExp('Код: '+stage+'\\.'));
      assert.doesNotMatch(html,/mock-group-credential|SESSION_SECRET|access_token|code_verifier/);
      assert.equal(diagnostics.at(-1)[0],'sd_vk_gate_failure');
      assert.equal(diagnostics.at(-1)[1],stage);
      assert.equal(diagnostics.at(-1)[2],scenario==='donut'?'15':'');
      if(scenario==='exchange')assert.equal(requests.some(x=>x.url.pathname==='/method/groups.getMembers'),false);
      if(scenario==='userinfo')assert.equal(requests.some(x=>x.url.pathname==='/method/groups.getMembers'),false);
    }
  }finally{remoteError='';console.warn=warn;members=[10];}
});
