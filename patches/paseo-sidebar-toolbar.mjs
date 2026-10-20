// 로컬 패치: 검토된 사이드바 하단 모듈에서 PaseoDog 항목만 쿼터 행에서 빼고 좌측 하단 도구줄 호스트 버튼 뒤에 둔다.
export const TOOLBAR_ITEM = 'function paseodogToolbarItem(e){return"plugin"===e.kind&&"paseodog-provider"===e.group?.pluginId}';
// 기존 하단 항목 훅·PluginSidebarItem 렌더러를 그대로 써서 PaseoDog 하단 항목을 도구줄 아이콘 줄로 그린다.
export const TOOLBAR_ITEMS = 'function PaseodogToolbarItems(e){const{items:l}=(0,L.useSidebarNavItems)("footer"),u=(0,h.useRef)(null),n=l.filter(e=>e.visible&&paseodogToolbarItem(e));return 0===n.length?null:(0,oe.jsx)(t.View,{ref:u,collapsable:!1,style:{flexDirection:"row",alignItems:"center"},children:n.map(o=>(0,oe.jsx)(N.PluginSidebarItem,{group:o.group,section:"footer",fallbackAnchorRef:u,onBeforeNavigate:e.onBeforeNavigate},o.key))})}';
export const ROWS_FILTER_ANCHOR = 'e=e=>e.visible&&("plugin"===e.kind||c)';
export const ROWS_FILTER = 'e=e=>e.visible&&!paseodogToolbarItem(e)&&("plugin"===e.kind||c)';
export const TOOLBAR_SOURCE_ANCHOR = 'function de(e){const o=(0,n.c)(30)';
export const TOOLBAR_SOURCE = TOOLBAR_ITEM + TOOLBAR_ITEMS + TOOLBAR_SOURCE_ANCHOR;
export const TOOLBAR_RENDER_ANCHOR = 'testID:"sidebar-footer-bottom-line",children:[w,x,y,R,v,W]';
export const TOOLBAR_RENDER = 'testID:"sidebar-footer-bottom-line",children:[w,x,y,(0,oe.jsx)(PaseodogToolbarItems,{onBeforeNavigate:f}),R,v,W]';

const HOOKS = [
    [ROWS_FILTER_ANCHOR, ROWS_FILTER],
    [TOOLBAR_SOURCE_ANCHOR, TOOLBAR_SOURCE],
    [TOOLBAR_RENDER_ANCHOR, TOOLBAR_RENDER],
];

// 도구줄 훅 전체가 있을 때만 제거해 원본 해시 검증을 유지한다.
export function withoutSidebarToolbar(source) {
    const present = HOOKS.map(([, patched]) => source.includes(patched));
    if (present.some((value) => value !== present[0])) throw new Error('Partial Paseo sidebar toolbar patch');
    return HOOKS.reduce((result, [anchor, patched]) => result.replace(patched, () => anchor), source);
}

// 전체 원본 해시를 통과한 번들의 정확한 앵커에만 도구줄 훅을 붙인다.
export function withSidebarToolbar(source) {
    for (const [anchor] of HOOKS) {
        if (source.split(anchor).length !== 2) throw new Error('Paseo sidebar toolbar anchor mismatch');
    }
    return HOOKS.reduce((result, [anchor, patched]) => result.replace(anchor, () => patched), source);
}
