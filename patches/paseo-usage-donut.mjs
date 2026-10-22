// 로컬 패치: 사용량 옵션에 "Sidebar style"(Bars/Donuts)을 더하고, Donuts를 고르면 사이드바 쿼터 요약을 창마다 사용률 링·공급자 아이콘·짧은 이름·초기화 카운트다운으로 그린다.
// usage_widget 작업표시줄 위젯의 카운트다운 표기(H:MM, ND)를 따르고 색은 호스트 windowTone 단계(막대 게이지와 같은 기준)를 재사용한다.
// 공유 앱 원본(android/packages/app/src/usage/donut*.ts(x), preferences.ts, display.ts, options.tsx, pinned.ts, sidebar-item.tsx)과 같은 의미다.

// 초기화까지 남은 시간 (하루 이상 -> "6D", 미만 -> "0:53", 모름 -> "--:--")
export function usageCountdownText(resetsAt, now) {
    const at = resetsAt ? Date.parse(resetsAt) : Number.NaN;
    if (!Number.isFinite(at)) return '--:--';
    const seconds = (at - now) / 1000;
    if (seconds <= 0) return '0:00';
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)}D`;
    const minutes = Math.max(1, Math.floor(seconds / 60));
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

// 호버 문구 (usage_widget 툴팁처럼 공급자당 한 줄: "Claude: 5H 31% / 7D 64%")
export function usageTooltipText(sources) {
    return sources.map((source) => `${source.label}: ${source.windows
        .map((window) => `${window.shortLabel} ${window.percentText}`.trim()).join(' / ')}`).join('\n');
}

// 공급자 아이콘만 브랜드색으로 칠하고 사용률 링의 경고·위험 색은 보존한다.
export function usageIconSvg(icon, sourceId) {
    let color = null;
    if (sourceId === 'codex') color = '#3B82F6';
    else if (sourceId === 'claude') color = '#D97757';
    return icon && color ? icon.replaceAll('currentColor', color) : icon;
}

// 반원 두 개의 호 회전각 (퍼센트 -> 오른쪽·왼쪽 회전각, 보이지 않는 쪽은 null)
export function donutArcRotations(percent) {
    const angle = (Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0)) / 100) * 360;
    return {
        right: angle > 0 ? 45 + Math.min(angle, 180) : null,
        left: angle > 180 ? angle - 180 - 135 : null,
    };
}

// 번들 사이드바 모듈 안에서 실행할 트리거 생성 (모듈 지역 의존성 -> 설정에 따라 도넛 또는 원래 막대 트리거)
export function createUsageSummaryTrigger(deps) {
    const { React, jsx, jsxs, View, Text, SourceIcon, usePreferences, StyleSheet, BarTrigger,
        Tooltip, TooltipTrigger, TooltipContent, describe, countdown, rotations, tooltipText, iconSvg } = deps;
    const size = 30, stroke = 3;
    const arcColor = (color) => ({ borderLeftColor: color, borderBottomColor: color, uni__dependencies: [0] });
    const styles = StyleSheet.create((theme) => ({
        trigger: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start',
            justifyContent: 'center', columnGap: theme.spacing[4], rowGap: 0,
            paddingVertical: 0, marginVertical: -theme.spacing[1.5], paddingHorizontal: theme.spacing[2],
            borderRadius: theme.borderRadius.lg, uni__dependencies: [0] },
        triggerHovered: { backgroundColor: theme.colors.surfaceSidebarHover, uni__dependencies: [0] },
        cell: { alignItems: 'center' },
        tooltipText: { fontSize: theme.fontSize.base, color: theme.colors.popoverForeground, uni__dependencies: [0] },
        ring: { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        track: { position: 'absolute', top: 0, left: 0, width: size, height: size, borderRadius: size / 2,
            borderWidth: stroke, borderColor: theme.colors.surface3, uni__dependencies: [0] },
        halfRight: { position: 'absolute', top: 0, left: size / 2, width: size / 2, height: size, overflow: 'hidden' },
        halfLeft: { position: 'absolute', top: 0, left: 0, width: size / 2, height: size, overflow: 'hidden' },
        arc: { position: 'absolute', top: 0, width: size, height: size, borderRadius: size / 2,
            borderWidth: stroke, borderColor: 'transparent' },
        arcInRight: { left: -size / 2 },
        arcInLeft: { left: 0 },
        arcDefault: arcColor(theme.colors.foregroundMuted),
        arcOk: arcColor(theme.colors.statusSuccess),
        arcWarning: arcColor(theme.colors.statusWarning),
        arcDanger: arcColor(theme.colors.statusDanger),
        label: { color: theme.colors.foregroundMuted, fontSize: 8, lineHeight: 9, uni__dependencies: [0] },
        countdown: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, lineHeight: 14, fontVariant: ['tabular-nums'],
            uni__dependencies: [0] },
    }));
    const toneStyle = (tone) => tone === 'ok' ? styles.arcOk : tone === 'warning' ? styles.arcWarning
        : tone === 'danger' ? styles.arcDanger : styles.arcDefault;
    const half = (side, rotation, tone) => rotation === null ? null : jsx(View, {
        style: side === 'right' ? styles.halfRight : styles.halfLeft,
        children: jsx(View, { style: [styles.arc, side === 'right' ? styles.arcInRight : styles.arcInLeft, tone,
            { transform: [{ rotate: `${rotation}deg` }] }] }),
    });
    const donut = (icon, window, now) => {
        const rotation = rotations(window.percent);
        const tone = toneStyle(window.tone);
        return jsxs(View, { style: styles.cell, testID: 'sidebar-usage-pinned-window', children: [
            jsxs(View, { style: styles.ring, children: [
                jsx(View, { style: styles.track }),
                half('right', rotation.right, tone),
                half('left', rotation.left, tone),
                jsx(SourceIcon, { svg: icon, size: 12 }),
                window.shortLabel === '' ? null : jsx(Text, { style: styles.label, numberOfLines: 1, children: window.shortLabel }),
            ] }),
            jsx(Text, { style: styles.countdown, numberOfLines: 1, children: countdown(window.resetsAt, now) }),
        ] }, window.key);
    };
    const DonutTrigger = ({ label, sources, onPress }) => {
        const [now, setNow] = React.useState(Date.now);
        React.useEffect(() => {
            const timer = setInterval(() => setNow(Date.now()), 30000);
            return () => clearInterval(timer);
        }, []);
        return jsxs(Tooltip, { delayDuration: 300, children: [
            jsx(TooltipTrigger, {
                onPress, accessibilityRole: 'button', accessibilityLabel: describe(label, sources), testID: 'sidebar-usage',
                style: ({ hovered }) => hovered ? [styles.trigger, styles.triggerHovered] : styles.trigger,
                children: sources.flatMap((source) => source.windows.map((window) => donut(iconSvg(source.icon, source.sourceId), window, now))),
            }),
            jsx(TooltipContent, { side: 'top', align: 'center', offset: 8, maxWidth: 560,
                children: jsx(Text, { style: styles.tooltipText, children: tooltipText(sources) }) }),
        ] });
    };
    return function UsageSummaryTrigger(props) {
        const { preferences } = usePreferences();
        return jsx(preferences.sidebarStyle === 'donut' ? DonutTrigger : BarTrigger, props);
    };
}

const SIDEBAR_STYLE_OPTIONS = 'pdSidebarStyles=[{value:"bar",label:C.usageCopy.sidebarStyleBar,testID:"usage-sidebar-style-bar"},{value:"donut",label:C.usageCopy.sidebarStyleDonut,testID:"usage-sidebar-style-donut"}],';
const SIDEBAR_STYLE_ROW = '(0,D.jsx)(s.View,{style:b.settingsStyles.rowBorder,children:(0,D.jsx)(y.SettingsRow,{label:C.usageCopy.sidebarStyle,children:(0,D.jsx)(h.SegmentedControl,{options:pdSidebarStyles,value:pdUsage.preferences.sidebarStyle??"bar",onValueChange:pdUsage.setSidebarStyle,size:"sm",testID:"usage-sidebar-style"})})})';
// 사이드바 모듈에 넣을 트리거 정의 (툴팁 모듈 id -> 모듈 지역 의존성으로 만든 트리거)
function triggerSource(tooltipId) {
    return `const pdUsageTrigger=(${createUsageSummaryTrigger})({React:l,jsx:S.jsx,jsxs:S.jsxs,View:n.View,Text:t.Text,SourceIcon:y.UsageSourceIcon,usePreferences:b.useUsagePreferences,StyleSheet:u.StyleSheet,BarTrigger:P,Tooltip:r(${tooltipId}).Tooltip,TooltipTrigger:r(${tooltipId}).TooltipTrigger,TooltipContent:r(${tooltipId}).TooltipContent,describe:U,countdown:${usageCountdownText},rotations:${donutArcRotations},tooltipText:${usageTooltipText},iconSvg:${usageIconSvg}});`;
}

// 번들의 유일한 툴팁 모듈 id (TooltipContent 정의 모듈 -> Metro 모듈 번호)
function tooltipModuleId(source) {
    const marker = 'e.TooltipContent=function';
    const at = source.indexOf(marker);
    if (at < 0 || source.indexOf(marker, at + 1) >= 0) throw new Error('Paseo usage donut anchor mismatch');
    const tail = /\},(\d+),\[[\d,]*\]\);/.exec(source.slice(at, source.indexOf('\n__d(', at)));
    if (!tail) throw new Error('Paseo usage donut anchor mismatch');
    return Number(tail[1]);
}

// 번들별 패치 지점 목록 (번들 원문 -> [원래 앵커, 패치 결과] 목록)
export function usageDonutEdits(source) {
    return [
        ...USAGE_DONUT_FIXED_EDITS,
        [TRIGGER_ANCHOR, `${triggerSource(tooltipModuleId(source))}${TRIGGER_ANCHOR}`],
    ];
}

const TRIGGER_PREFIX = 'const pdUsageTrigger=(';
const TRIGGER_ANCHOR = 'function R(n,t){return n+t.windows.length}';
const SIDEBAR_REFRESH_BEFORE = 'h={queryKey:f,queryFn:y,dataShape:"list",staleTimeMs:p}';

const USAGE_DONUT_FIXED_EDITS = [
    // 설정 스키마: Donuts만 저장값으로 남기고 없거나 잘못된 값은 Bars로 읽는다.
    ['serverId:n.z.string().nullable().catch(null)}).transform(({displayAs:n,pins:s,pinned:t,serverId:o})=>{const c=t&&t.length>0?t:null;return{displayAs:n,pins:void 0===s?c:s,serverId:o}})',
        'serverId:n.z.string().nullable().catch(null),sidebarStyle:n.z.enum(["bar","donut"]).optional().catch(void 0)}).transform(({displayAs:n,pins:s,pinned:t,serverId:o,sidebarStyle:pdStyle})=>{const c=t&&t.length>0?t:null;return Object.assign({displayAs:n,pins:void 0===s?c:s,serverId:o},"donut"===pdStyle?{sidebarStyle:pdStyle}:{})})'],
    ['e.setUsageHost=function(n,s){return Object.assign({},n,{serverId:s})};',
        'e.setUsageHost=function(n,s){return Object.assign({},n,{serverId:s})},e.setUsageSidebarStyle=function(n,s){return Object.assign({},n,{sidebarStyle:s})};'],
    // 사용량 설정 훅: 기존 표시 객체 메모는 그대로 두고 표시 방식 저장 함수를 곁들인다.
    ['(D={preferences:c,display:v},', '(D={preferences:c,display:v,setSidebarStyle:s=>{o(t=>({usage:(0,p.setUsageSidebarStyle)(t.usage,s)}))}},'],
    // 문구와 사용량 옵션 메뉴의 Percentages 아래 행
    ['showInSidebarHint:"Pinned windows show in the sidebar footer"}',
        'showInSidebarHint:"Pinned windows show in the sidebar footer",sidebarStyle:"Sidebar style",sidebarStyleBar:"Bars",sidebarStyleDonut:"Donuts"}'],
    ['{display:x}=(0,I.useUsagePreferences)()', 'pdUsage=(0,I.useUsagePreferences)(),{display:x}=pdUsage'],
    ['n[13]!==V||n[14]!==_?(z=(0,D.jsx)(l.DropdownMenuContent,', '!0?(z=(0,D.jsx)(l.DropdownMenuContent,'],
    ['testID:"usage-options-fields",children:[V,_]}', `testID:"usage-options-fields",children:[V,_,${SIDEBAR_STYLE_ROW}]}`],
    ['testID:"usage-display-remaining"}],j=', `testID:"usage-display-remaining"}],${SIDEBAR_STYLE_OPTIONS}j=`],
    // 요약 창에 초기화 시각을 싣고 사이드바 항목은 설정을 읽는 트리거로 그린다.
    ['percentText:f,tone:(0,o.windowTone)(s)}', 'percentText:f,tone:(0,o.windowTone)(s),resetsAt:s.resetsAt??null}'],
    ['[{key:l.id,icon:l.icon??null,windows:s}]', '[{key:l.id,sourceId:l.sourceId,label:l.sourceLabel+(l.account.label?" ("+l.account.label+")":""),icon:l.icon??null,windows:s}]'],
    ['h=(0,S.jsx)(P,{label:l,sources:b,onPress:u})', 'h=(0,S.jsx)(pdUsageTrigger,{label:l,sources:b,onPress:u})'],
    // 사이드바 쿼터 조회(useUsageHostReports)는 usage_widget 폴링 주기처럼 보는 동안 2분마다 다시 읽는다(데몬 5분 캐시가 실제 조회를 묶는다).
    [SIDEBAR_REFRESH_BEFORE, 'h={queryKey:f,queryFn:y,dataShape:"list",staleTimeMs:p,refetchInterval:12e4}'],
];
// 이전 버전 패치에 없던 공급자 이름·사이드바 주기 갱신 편집의 위치
const SOURCE_LABEL_EDIT = USAGE_DONUT_FIXED_EDITS.findIndex(([before]) => before === '[{key:l.id,icon:l.icon??null,windows:s}]');
const SIDEBAR_REFRESH_EDIT = USAGE_DONUT_FIXED_EDITS.findIndex(([before]) => before === SIDEBAR_REFRESH_BEFORE);

// 문자열 안 정확한 일치 횟수를 센다.
function occurrences(source, text) {
    return source.split(text).length - 1;
}

// 패치 지점이 모두 하나씩 있을 때만 원래 앵커로 되돌려 원본 해시 검증을 유지한다(중복·일부 적용은 실패).
// 이전 버전 패치(공급자 이름 없음·다른 트리거 본문)도 같은 원래 앵커로 되돌린다.
export function withoutUsageDonut(source) {
    source = source.replace('[{key:l.id,label:l.sourceLabel+(l.account.label?" ("+l.account.label+")":""),icon:l.icon??null,windows:s}]',
        '[{key:l.id,icon:l.icon??null,windows:s}]');
    const start = source.indexOf(TRIGGER_PREFIX);
    if (start >= 0) {
        const end = source.indexOf(TRIGGER_ANCHOR, start);
        if (source.indexOf(TRIGGER_PREFIX, start + 1) >= 0 || end < 0) throw new Error('Paseo usage donut patch drift');
        source = source.slice(0, start) + source.slice(end);
    }
    const counts = USAGE_DONUT_FIXED_EDITS.map(([, after]) => occurrences(source, after));
    if (counts.some((count) => count > 1)) throw new Error('Paseo usage donut patch drift');
    const required = [start >= 0 ? 1 : 0,
        ...counts.filter((_, index) => index !== SOURCE_LABEL_EDIT && index !== SIDEBAR_REFRESH_EDIT)];
    if (required.includes(0) && required.includes(1)) throw new Error('Partial Paseo usage donut patch');
    return USAGE_DONUT_FIXED_EDITS.reduce((result, [before, after]) => result.replace(after, () => before), source);
}

// 전체 원본 해시를 통과한 번들의 유일한 앵커에만 도넛 표시 설정과 렌더러를 붙인다.
export function withUsageDonut(source) {
    const edits = usageDonutEdits(source);
    for (const [before, after] of edits) {
        if (occurrences(source, before) !== 1 || source.includes(after))
            throw new Error('Paseo usage donut anchor mismatch');
    }
    return edits.reduce((result, [before, after]) => result.replace(before, () => after), source);
}
