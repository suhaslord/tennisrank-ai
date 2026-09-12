const {test} = require('node:test');
const assert = require('node:assert/strict');
const users = require('../api/users');
const auth = require('../api/auth-api');

async function scenario(options, run) {
  const previous = global.fetch;
  const env = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY];
  process.env.SUPABASE_URL = 'https://auth.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  const state = {profiles:options.existing ? [{id:'existing',email:'player@example.test'}] : [], events:[], deleted:[], recovery:[], passwordUpdates:0, cleared:false};
  global.fetch = async (input, init={}) => {
    const url = new URL(input); const path = url.pathname; const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    state.events.push(`${method} ${path}`);
    const reply=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
    if(path==='/auth/v1/user' && method==='GET') return reply({id:'viewer'});
    if(path==='/auth/v1/user' && method==='PUT') {
      state.passwordUpdates++;
      assert.ok(body.password.length>=10);
      assert.equal(init.headers.Authorization,'Bearer viewer-token');
      return options.passwordError ? reply({msg:'Password rejected'},400) : reply({id:'viewer'});
    }
    if(path==='/auth/v1/admin/users' && method==='POST') {
      if(options.authError) return reply({msg:'Email already exists'},422);
      state.newPassword=body.password;
      return reply({id:'new-user'});
    }
    if(path.startsWith('/auth/v1/admin/users/') && method==='DELETE') { state.deleted.push(path); return reply({}); }
    if(path==='/auth/v1/recover') {
      state.recovery.push({email:body.email,redirect:url.searchParams.get('redirect_to')});
      assert.ok(state.profiles.length, 'account is persisted before sending an email');
      if(options.emailTimeout) throw new Error('Request timed out');
      return options.emailError ? reply(options.emailError.body,options.emailError.status) : reply({});
    }
    if(path==='/rest/v1/profiles') {
      if(method==='POST') {
        if(options.profileError) return reply({message:'Database unavailable'},503);
        state.profiles.push(body);return reply([body],201);
      }
      if(method==='PATCH') {state.cleared=true;return reply([{id:'viewer',must_change_password:false}]);}
      if(url.searchParams.get('id')==='eq.viewer') return reply([{id:'viewer',role:options.role||'admin',must_change_password:Boolean(options.pending)}]);
      return reply(state.profiles);
    }
    if(path==='/rest/v1/players') return reply([]);
    throw new Error(`Unhandled mock ${method} ${path}`);
  };
  try {await run(state);} finally {global.fetch=previous;env.forEach((v,i)=>{const k=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'][i];if(v===undefined)delete process.env[k];else process.env[k]=v;});}
}
async function invoke(handler, body, extra={}) {
  const req={method:'POST',headers:{authorization:'Bearer viewer-token'},body,...extra};
  const res={code:200,headers:{},status(code){this.code=code;return this;},setHeader(k,v){this.headers[k]=v;return this;},send(body){this.body=JSON.parse(body);return this;},end(){return this;}};
  await handler(req,res);return res;
}
const account={email:'player@example.test',fullName:'Player QA',role:'admin',deliveryMethod:'email'};

test('email account uses a random password, persists first and sends a setup link',()=>scenario({},async state=>{
  const result=await invoke(users,account);
  assert.equal(result.code,201);assert.equal(result.body.delivery.status,'accepted');
  assert.ok(state.newPassword.length>=32);
  assert.equal(state.recovery[0].redirect,'https://tennisrank-ai.vercel.app/player');
  assert.equal(state.profiles[0].must_change_password,true);
  assert.ok(!JSON.stringify(result.body).includes(state.newPassword));
}));
test('manual account sends no email and reports the sharing requirement',()=>scenario({},async state=>{
  const result=await invoke(users,{...account,deliveryMethod:'manual',temporaryPassword:'private-password-123'});
  assert.equal(result.code,201);assert.equal(state.recovery.length,0);
  assert.equal(result.body.delivery.status,'not-requested');
  assert.match(result.body.delivery.message,/No email was sent/);
}));
for(const emailError of [
  {status:403,body:{code:'email_address_not_authorized',msg:'Email address not authorized'}},
  {status:429,body:{msg:'Email rate limit exceeded'}},
  {status:500,body:{msg:'Error sending recovery email'}},
]) test(`email failure ${emailError.status} retains account and gives a retry path`,()=>scenario({emailError},async state=>{
  const result=await invoke(users,account);
  assert.equal(result.code,201);assert.equal(result.body.delivery.status,'failed');
  assert.equal(state.profiles.length,1);assert.equal(state.deleted.length,0);
  assert.match(result.body.delivery.message,/email|sender/i);
}));
test('email timeout is unconfirmed, never claimed as delivered',()=>scenario({emailTimeout:true},async state=>{
  const result=await invoke(users,account);assert.equal(result.body.delivery.status,'unknown');assert.equal(state.deleted.length,0);
}));
test('resend addresses the stored account and never resets its password',()=>scenario({existing:true},async state=>{
  const result=await invoke(users,{action:'send-password-email',profileId:'existing',email:'attacker@example.test'});
  assert.equal(result.code,200);assert.equal(state.recovery[0].email,'player@example.test');
  assert.equal(state.passwordUpdates,0);assert.equal(state.newPassword,undefined);
}));
test('duplicate account sends no email and does not alter existing account',()=>scenario({existing:true},async state=>{
  const result=await invoke(users,account);assert.equal(result.code,409);assert.equal(state.recovery.length,0);assert.equal(state.deleted.length,0);
}));
test('failed profile creation rolls back the newly created auth user before any email',()=>scenario({profileError:true},async state=>{
  const result=await invoke(users,account);assert.equal(result.code,503);assert.equal(state.deleted.length,1);assert.equal(state.recovery.length,0);
}));
for(const options of [{role:'player'},{pending:true}]) test(`account admin access enforced ${JSON.stringify(options)}`,()=>scenario(options,async state=>{
  const result=await invoke(users,account);assert.equal(result.code,403);assert.equal(state.recovery.length,0);assert.equal(state.newPassword,undefined);
}));
test('missing resend account fails without requesting any email',()=>scenario({},async state=>{
  const result=await invoke(users,{action:'send-password-email',profileId:'missing'});assert.equal(result.code,404);assert.equal(state.recovery.length,0);
}));
test('client boolean cannot skip password setup',()=>scenario({pending:true},async state=>{
  const result=await invoke(auth,{passwordChanged:true},{method:'PATCH',query:{route:'session'}});
  assert.equal(result.code,400);assert.equal(state.cleared,false);
}));
test('password setup clears the gate only after Auth accepts the password',()=>scenario({pending:true},async state=>{
  const result=await invoke(auth,{password:'new-private-password-123'},{method:'PATCH',query:{route:'session'}});
  assert.equal(result.code,200);assert.equal(state.passwordUpdates,1);assert.equal(state.cleared,true);
}));
test('rejected password retains the setup requirement',()=>scenario({pending:true,passwordError:true},async state=>{
  const result=await invoke(auth,{password:'new-private-password-123'},{method:'PATCH',query:{route:'session'}});
  assert.equal(result.code,400);assert.equal(state.cleared,false);
}));
