import { appendFileSync } from 'node:fs';
import { serveWorker } from '../../engine/src/worker.mjs';
const server=serveWorker({input:process.stdin,output:process.stdout,onExit:()=>process.exit(0),engineFactory:async(args,{emit})=>{
    let aborted=false,release;
    return { id:'sess_child',
        async ask(text,callbacks){
            if(args.config.env.ASK_LOG) appendFileSync(args.config.env.ASK_LOG, JSON.stringify({text})+'\n');
            if(text==='crash') process.exit(42);
            if(text==='hang') return new Promise(()=>{});
            if(text==='wait'){await new Promise(r=>{release=r;});if(aborted)throw new Error('aborted');}
            emit('identity',{id:'sess_child',state:{model:'fixture'}});
            if(text==='permission'){const answer=await callbacks.onToolApproval({name:'shell',args:{command:'pwd'}});return {result:{content:answer.approved?'allowed':'denied'}};}
            callbacks.onTextDelta?.('child ');callbacks.onTextDelta?.('result');callbacks.onTextReset?.({chars:1});
            return {result:{content:args.config.env.TEST_VALUE||'child result',providerReplay:'MUST_NOT_CROSS_WIRE'},session:{secrets:'MUST_NOT_CROSS_WIRE'}};
        },compact:async()=>({changed:true,messages:[{content:'MUST_NOT_CROSS_WIRE'}],providerReplay:'MUST_NOT_CROSS_WIRE'}),abort(){aborted=true;release?.();},close:async()=>{},
    };
}});
process.on('SIGTERM',()=>void server.stop('sigterm'));
