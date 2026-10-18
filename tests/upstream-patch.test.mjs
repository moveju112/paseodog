import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchedSource,gitBlob,ORIGINAL_BLOB } from '../scripts/patch-mixdog.mjs';
const original=readFileSync(new URL('./fixtures/upstream-turn-run.mjs.txt',import.meta.url),'utf8');
test('retained upstream turn-run fixture matches the exact Git blob fetched from Mixdog',()=>{
    assert.equal(gitBlob(original),ORIGINAL_BLOB);assert.equal(patchedSource(patchedSource(original)),patchedSource(original));
});
async function runUpstream(deps,before){
    const source=patchedSource(original).replace(/^import .*;\n/gm,'');
    // Helpers are dependency fixtures; the turn runner itself is exact pinned source + patch.
    const prelude=`const beginTurnSnapshot=()=>{},cancelTurnSnapshot=()=>{},completeTurnSnapshot=()=>{};
const runWithCwdOverride=(_cwd,fn)=>fn();
const createTurnTranscript=()=>({});
const createTurnTimingFactory=()=>({});
const createSnapshotTrackerFactory=()=>({});
const createTurnOpener=()=>()=>({});
const createTurnPreparation=(deps)=>({prepareSession:async()=>deps.getSession(),dispatchPromptSubmit:async()=>null});
const createAskCallbacks=()=>({askCallbacks:()=>({onProviderSendStarted:()=>{}}),plannedToolCalls:()=>null});
const registerNativeWebSearchUsageSink=()=>()=>{};
const createTurnSettlement=(deps)=>({completeTurn:async(_t,_s,r)=>r,reportTurnError:()=>{},settleTurn:async()=>deps.settled()});\n`;
    const mod=await import('data:text/javascript;base64,'+Buffer.from(prelude+source).toString('base64'));
    return mod.createTurnRunner(deps).ask('prompt',{beforeSessionAsk:before});
}
test('actual patched upstream runner invokes host guard before inference and settles errors',async()=>{
    const order=[];const session={id:'native'};const deps={getSession:()=>session,getCurrentCwd:()=>'/work',settled:()=>order.push('settled'),mgr:{askSession:async()=>{order.push('inference');return 'done';}}};
    assert.equal(await runUpstream(deps,async(s)=>{assert.equal(s,session);order.push('policy');}),'done');assert.deepEqual(order,['policy','inference','settled']);
    order.length=0;await assert.rejects(runUpstream(deps,async()=>{throw new Error('Guard failed');}),/Guard failed/);assert.deepEqual(order,['settled']);
});
