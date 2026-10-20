// Executable checks for the used subset of Paseo ProviderEvent v1.
// Source: packages/plugin/src/server/provider.ts, commit 804335bc00bff52f2652f5de9e6227f013322948.
// Not a replacement for installing and typechecking the real SDK.
import assert from 'node:assert/strict';
export function validateEvent(event){
    assert.equal(typeof event.type,'string');
    if(event.type.startsWith('session.')||event.type==='timeline.item')assert.equal(typeof event.sessionId,'string');
    switch(event.type){
        case 'catalog':assert.ok(Array.isArray(event.catalog.models));break;
        case 'sessions':assert.ok(Array.isArray(event.sessions));break;
        case 'request.completed':case 'request.failed':assert.equal(typeof event.requestId,'string');break;
        case 'session.opened':assert.ok(['core','parent'].includes(event.restoration));assert.equal(typeof event.cwd,'string');assert.ok(Array.isArray(event.capabilities));break;
        case 'session.ready':case 'session.closed':case 'session.runtime_failed':case 'session.persistence':case 'session.notice':break;
        case 'session.config':for(const key of ['models','modes','thinkingOptions','settings'])assert.ok(Array.isArray(event.config[key]));break;
        case 'session.commands':assert.ok(Array.isArray(event.commands));break;
        case 'session.prompt_result':assert.equal(typeof event.clientMessageId,'string');assert.ok(['turn','steer','completed','failed'].includes(event.result.type));break;
        case 'session.turn':assert.equal(typeof event.turnId,'string');assert.ok(['started','completed','failed','canceled'].includes(event.state));break;
        case 'session.usage':for(const value of Object.values(event.usage))assert.ok(Number.isFinite(value)&&value>=0);break;
        case 'session.permission':{
            assert.equal(typeof event.request.id,'string');
            assert.ok(['tool','question'].includes(event.request.kind));
            if(event.request.kind==='question'){
                assert.equal(event.request.name,'ask_user');
                assert.ok(Array.isArray(event.request.input.questions));
            }break;
        }
        case 'session.permission_resolved':assert.equal(typeof event.permissionId,'string');break;
        case 'timeline.item':{
            const item=event.item;assert.equal(typeof item.id,'string');
            assert.ok(['user_message','assistant_message','reasoning','tool_call','error','notification','compaction'].includes(item.type));
            if(item.type==='tool_call'){
                assert.equal(typeof item.callId,'string');assert.equal(typeof item.name,'string');assert.ok(['running','completed','canceled','failed'].includes(item.status));
                if(item.status==='failed')assert.notEqual(item.error,null);else assert.equal(item.error,null);
            }break;
        }
        default:throw new Error('Unknown ProviderEvent: '+event.type);
    }
}
