import { appendFileSync } from 'node:fs';
import { serveWorker } from '../../engine/src/worker.mjs';
// 실제 IPC의 개별 제한 안에서 연속 RPC 지연을 재현하는 테스트 전용 설정이다.
async function delayRpc(value) {
    if (value) await new Promise(resolve => setTimeout(resolve, Number(value)));
}
const server=serveWorker({input:process.stdin,output:process.stdout,onExit:()=>process.exit(0),engineFactory:async(args,{emit})=>{
    await delayRpc(args.config.env.TEST_OPEN_DELAY_MS);
    let aborted=false,release,releaseConfigure;
    const steering = [];
    const configuration = { autoEffort: args.config.settings?.autoEffort ?? true, effort: 'low' };
    return { id:'sess_child',
        // 실제 워커 왕복에서 세션별 설정 읽기와 변경 결과를 전달한다.
        configuration() { return { ...configuration }; },
        // 테스트 세션의 다음 턴 선호값만 변경한다.
        async configure(changes) {
            if (args.config.env.TEST_HOLD_CONFIGURE === 'true') await new Promise(resolve => { releaseConfigure = resolve; });
            Object.assign(configuration, changes); return { ...configuration };
        },
        auth() { releaseConfigure?.(); releaseConfigure = null; return { released: true }; },
        // 실제 JSONL 상태 조회를 통해 컨텍스트 표시 필드를 전달한다.
        async status() { await delayRpc(args.config.env.TEST_STATUS_DELAY_MS); return { context: { usedTokens: 40, effectiveContextWindow: 1000 } }; },
        // 계승 응답의 ID와 현재 워커 ID가 분리되는지 실제 IPC에서 확인한다.
        async action(request) {
            if (request.operation !== 'fork') throw new Error('Unknown fixture action');
            return { nativeSessionId: 'sess_heir' };
        },
        async ask(text,callbacks,source){
            steering.length = 0;
            if(text==='provenance')return{content:JSON.stringify(source)};
            if(text==='wait-provenance'){await new Promise(r=>{release=r;});return{content:JSON.stringify(steering)};}
            if(args.config.env.ASK_LOG) appendFileSync(args.config.env.ASK_LOG, JSON.stringify({text})+'\n');
            if(text==='crash') process.exit(42);
            if(text==='hang') return new Promise(()=>{});
            if(text==='wait'){await new Promise(r=>{release=r;});if(aborted)throw new Error('aborted');}
            callbacks.onIdentity?.({id:'sess_child',state:{model:'fixture'}});
            if(text==='question'){const answer=await callbacks.onToolApproval({name:'ask_user',kind:'question',args:{questions:[{question:'Pick?',header:'Pick',options:[{label:'A',description:'a'},{label:'B',description:'b'}]}]}});return {result:{content:JSON.stringify(answer)}};}
            if(text==='permission'){const answer=await callbacks.onToolApproval({name:'shell',args:{command:'pwd'}});return {result:{content:answer.approved?'allowed':'denied'}};}
            callbacks.onTextDelta?.(steering.length ? `${text}+${steering.join('+')}` : 'child ');
            if (!steering.length) callbacks.onTextDelta?.('result');
            callbacks.onTextReset?.({chars:1});
            return {result:{content:steering.length ? `${text}+${steering.join('+')}` : args.config.env.TEST_VALUE||'child result',providerReplay:'MUST_NOT_CROSS_WIRE'},session:{secrets:'MUST_NOT_CROSS_WIRE'}};
        // 진행 중인 실제 worker RPC에 지시를 추가하고 원래 ask를 이어간다.
        },steer(text,source){steering.push(source?{text,source}:text);release?.();return{accepted:true};
        },compact:async()=>({changed:true,messages:[{content:'MUST_NOT_CROSS_WIRE'}],providerReplay:'MUST_NOT_CROSS_WIRE'}),abort(){aborted=true;release?.();},close:async()=>{},
    };
}});
process.on('SIGTERM',()=>void server.stop('sigterm'));
