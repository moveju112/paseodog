// 호스트 행은 작업 화면 전환, 톱니 버튼은 개요로 분리한다. 새 선택값도 React Compiler 캐시에 포함한다.
const edits = [
    ['setGroupMode:t=>e({groupMode:t}),toggleHostFilter:',
        'setGroupMode:t=>e({groupMode:t}),selectHost:t=>e({hostFilters:[t],projectFilters:[]}),toggleHostFilter:'],
    ['function ne(e){const t=(0,n.c)(13),{theme:o,label:s,onAddHost:l,onOpenHostSettings:u}',
        'function ne(e){const hostFilters=(0,M.useSidebarViewStore)(e=>e.hostFilters),selectedHost=1===hostFilters.length?hostFilters[0]:"";const t=(0,n.c)(14),{theme:o,label:s,onAddHost:l,onOpenHostSettings:u}'],
    ['t[0]!==u?(_=e=>{u(e)},t[0]=u,t[1]=_):_=t[1]',
        't[0]!==u?(_=e=>{M.useSidebarViewStore.getState().selectHost(e);r(d[4]).router.replace((0,q.buildHostRootRoute)(e))},t[0]=u,t[1]=_):_=t[1]'],
    ['t[6]!==j||t[7]!==p||t[8]!==f||t[9]!==l||t[10]!==u||t[11]!==y?(R=',
        't[13]!==selectedHost||t[6]!==j||t[7]!==p||t[8]!==f||t[9]!==l||t[10]!==u||t[11]!==y?(R='],
    ['W.HostPicker,{hosts:p,value:"",onSelect:j', 'W.HostPicker,{hosts:p,value:selectedHost,onSelect:j'],
    ['t[6]=j,t[7]=p,t[8]=f,t[9]=l,t[10]=u,t[11]=y,t[12]=R):R=t[12],R}',
        't[13]=selectedHost,t[6]=j,t[7]=p,t[8]=f,t[9]=l,t[10]=u,t[11]=y,t[12]=R):R=t[12],R}'],
];

export function withoutHostSwitch(source) {
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}

export function withHostSwitch(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo host switch anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
