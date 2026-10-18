import { spawn,spawnSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { worker,runtimeEnv,supportedNode } from './paths.mjs';
import { deadline } from '../plugin/server/util.mjs';
if(!process.argv.includes('--confirm-api-use')){console.error('This makes real model requests and may use paid API/plan quota. Pass --confirm-api-use after running paseodog auth.');process.exit(2);}
if(!supportedNode()){console.error('Unsupported Node version; use Node 24 LTS.');process.exit(1);}
const env=runtimeEnv();
const route={provider:env.PASEODOG_PROVIDER,model:env.PASEODOG_MODEL,effort:env.PASEODOG_EFFORT,
    ...(env.PASEODOG_AUTO_EFFORT==='false'?{autoEffort:false}:{}),
    ...(env.PASEODOG_FAST==='false'?{fast:false}:{})};
if(process.argv.includes('--subscription-only')&&route.provider!=='openai-oauth'){
    console.error('Subscription-only smoke requires the openai-oauth route');process.exit(2);
}
const cwd=mkdtempSync(join(tmpdir(),'paseodog-live-'));spawnSync('git',['init','-q',cwd]);
const token='PASEODOG_'+randomUUID().replaceAll('-','');
const config={cwd,env:{},systemPrompt:'Do not call tools. Respond to the user directly.',mcpServers:{},settings:{},persist:true};
const factory=processEngineFactory({launch:{command:process.execPath,args:[worker],env},spawnProcess:(command,args,opts)=>spawn(command,args,{...opts,detached:process.platform!=='win32'}),terminateProcess:(child)=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}}});
let engine,nativeSessionId;
const result={at:new Date().toISOString(),node:process.version,route,checks:[],attemptedTurns:0,status:'FAIL'};
try{
    engine=await factory.create({config,route});
    const callbacks={onIdentity:(x)=>{
        if(process.argv.includes('--subscription-only')&&
            (x.state.provider!=='openai-oauth'||x.state.model!==route.model))
            throw new Error('Unexpected subscription model route');
        nativeSessionId=x.id;
    },onToolApproval:async()=>({approved:false,reason:'Smoke test forbids tools'})};
    result.attemptedTurns++;
    const first=await deadline(engine.ask(`Remember this exact token: ${token}. Reply with the token only.`,callbacks),180000,'Live request timed out');
    if(!first.result?.content?.includes(token))throw new Error('First response did not contain the expected token');
    nativeSessionId=nativeSessionId||engine.id;if(!nativeSessionId)throw new Error('Native session identity missing');
    result.checks.push('real response');await engine.close();engine=null;
    engine=await factory.create({config,route,nativeSessionId});
    result.attemptedTurns++;
    const second=await deadline(engine.ask('What exact token did I ask you to remember? Reply with the token only.',callbacks),180000,'Restore request timed out');
    if(!second.result?.content?.includes(token))throw new Error('Restored session lost the remembered token');
    result.checks.push('native persistence and restore');result.status='PASS';
}catch(error){result.error=error.message;process.exitCode=1;}
finally{try{await engine?.close();}catch{};rmSync(cwd,{recursive:true,force:true});}
result.notChecked=['Paseo plugin loader/SDK end-to-end','Tool permission path with real native tools','Android pairing/reconnect','Reboot recovery'];
console.log(JSON.stringify(result,null,2));
