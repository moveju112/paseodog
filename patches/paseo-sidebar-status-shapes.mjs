// A안: 진행 링·완료 체크·입력 대기 느낌표를 기존 슬롯에서 구분한다. 전체 blob gate는 composer가 소유한다.
export const SIDEBAR_STATUS_SHAPE_EDITS = [
    ['children:(0,v.jsx)(t.View,{style:E.standaloneStatusDot})',
        'children:(0,v.jsx)(t.Text,{style:E.statusAttentionCheck,accessible:!1,children:"✓"})'],
    ['o=h?(0,v.jsx)(t.View,{style:E.workspaceStatusDot,testID:"workspace-status-indicator-done",children:(0,v.jsx)(t.View,{style:E.idleStatusDot})}):null',
        'o=(0,v.jsx)(t.View,{style:E.workspaceStatusDot,testID:"workspace-status-indicator-done",children:(0,v.jsx)(t.Text,{style:E.statusDoneCheck,accessible:!1,children:"✓"})})'],
    ['standaloneStatusDot:{width:b.STATUS_INDICATOR_FILLED_DOT_SIZE,height:b.STATUS_INDICATOR_FILLED_DOT_SIZE,borderRadius:t.borderRadius.full,backgroundColor:(0,k.getStatusDotColor)({theme:t,bucket:"attention"})??void 0,uni__dependencies:[0]}',
        'statusAttentionCheck:{color:t.colors.statusSuccess,fontSize:14,lineHeight:20,fontWeight:"700",uni__dependencies:[0]}'],
    ['idleStatusDot:{width:b.STATUS_INDICATOR_FILLED_DOT_SIZE,height:b.STATUS_INDICATOR_FILLED_DOT_SIZE,borderRadius:t.borderRadius.full,backgroundColor:t.colors.foregroundExtraMuted,opacity:.3,uni__dependencies:[0]}',
        'statusDoneCheck:{color:t.colors.foregroundMuted,fontSize:14,lineHeight:20,fontWeight:"500",uni__dependencies:[0]}'],
    ['e.getProjectStatusBadgeContent=function(t){if("needs_input"===t)return{kind:"alert"};if("failed"===t||"attention"===t||"running"===t)return{kind:"dot",bucket:t};return null}',
        'e.getProjectStatusBadgeContent=function(t){if("needs_input"===t)return{kind:"alert"};if("attention"===t||"done"===t)return{kind:"check",bucket:t};if("failed"===t||"running"===t)return{kind:"dot",bucket:t};return null}'],
    ['I="alert"===u.kind?(0,y.jsx)(D,{size:j.STATUS_INDICATOR_ALERT_SIZE,uniProps:w}):(0,y.jsx)(V,{bucket:u.bucket})',
        'I="alert"===u.kind?(0,y.jsx)(D,{size:j.STATUS_INDICATOR_ALERT_SIZE,uniProps:w}):"check"===u.kind?(0,y.jsx)(t.Text,{style:"done"===u.bucket?L.statusDoneCheck:L.statusCheck,accessible:!1,children:"✓"}):(0,y.jsx)(V,{bucket:u.bucket})'],
    ['projectIconFallbackText:{fontSize:9},statusBadge:{position:"absolute",right:-4,bottom:-4,width:12,height:12,',
        'projectIconFallbackText:{fontSize:9},statusCheck:{color:t.colors.statusSuccess,fontSize:10,lineHeight:12,fontWeight:"700",uni__dependencies:[0]},statusDoneCheck:{color:t.colors.foregroundMuted,fontSize:10,lineHeight:12,fontWeight:"500",uni__dependencies:[0]},statusBadge:{position:"absolute",right:-4,bottom:-4,width:12,height:12,'],
];

// 한 번씩 나오는 원본 앵커에만 상태 모양을 적용한다.
export function withSidebarStatusShapes(source) {
    for (const [before, after] of SIDEBAR_STATUS_SHAPE_EDITS) {
        if (source.split(before).length !== 2 || source.includes(after)) throw new Error('Paseo sidebar status shape anchor mismatch');
    }
    return SIDEBAR_STATUS_SHAPE_EDITS.reduce((result, [before, after]) => result.replace(before, after), source);
}

// 완성된 패치만 되돌려 기존 composer 원본 해시 검증을 보존한다.
export function withoutSidebarStatusShapes(source) {
    const counts = SIDEBAR_STATUS_SHAPE_EDITS.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1)) throw new Error('Paseo sidebar status shape drift');
    if (counts.includes(0) && counts.includes(1)) throw new Error('Partial Paseo sidebar status shape patch');
    return SIDEBAR_STATUS_SHAPE_EDITS.reduce((result, [before, after]) => result.replace(after, before), source);
}
