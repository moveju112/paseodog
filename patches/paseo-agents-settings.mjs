import { basicAgentIds } from '../android/packages/app/src/screens/settings/basic-agent-roles.ts';

// 로컬 패치: 검토된 Paseo 0.11.4 번들의 기존 에이전트 설정 화면을 호스트 메뉴에 다시 연결한다.
export const AGENTS_SETTINGS_BEFORE = 'const Ae=[{id:"engine-accounts",labelKey:"settings.hostSections.engineAccounts",icon:f.KeyRound}';
export const AGENTS_SETTINGS_AFTER = 'const Ae=[{id:"agents",labelKey:"settings.hostSections.agents",icon:f.Bot},{id:"engine-accounts",labelKey:"settings.hostSections.engineAccounts",icon:f.KeyRound}';

const basicIds = JSON.stringify(basicAgentIds);
export const BASIC_AGENTS_WEB_EDITS = [
    ['function re(e){return"maintainer"!==e.id}function ce(e){return"maintainer"===e.id}',
        `function re(e){return!ce(e)}function ce(e){return${basicIds}.includes(e.id)}`],
    ['l.agents.find(ce)', 'l.agents.filter(ce)'],
    ['te=Mt&&(0,C.jsx)(se,{agent:Mt,models:l.models,disabled:s,onPress:mt})',
        'te=Mt.map(e=>(0,C.jsx)(se,{agent:e,models:l.models,disabled:s,onPress:mt},e.id))'],
    [String.raw`children:"\uc6f9 \uac80\uc0c9\uacfc \uc124\uc815 \uc720\uc9c0\ub97c \ub2f4\ub2f9\ud558\ub294 \uae30\ubcf8 \uc5d0\uc774\uc804\ud2b8\uc785\ub2c8\ub2e4."`,
        'children:"기본값은 모두 off이며 역할마다 모델을 따로 선택해 켤 수 있어요. 필요한 조건에서만 호출하며, 탐색·실패 분석·인계·검토는 메인이 필요할 때 위임해요."'],
];

// 메뉴 연결 복원 (유일한 앵커에만 기존 agents 경로 추가)
export function withAgentsSettings(source) {
    if (source.split(AGENTS_SETTINGS_BEFORE).length !== 2) throw new Error('Paseo agents settings anchor mismatch');
    source = source.replace(AGENTS_SETTINGS_BEFORE, AGENTS_SETTINGS_AFTER);
    for (const [before, after] of BASIC_AGENTS_WEB_EDITS) {
        if (source.split(before).length !== 2) throw new Error('Paseo basic agents anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source.replaceAll('r?.webSearch??!0', 'r?.webSearch??!1')
        .replaceAll('l.toolModules?.webSearch??!0', 'l.toolModules?.webSearch??!1');
}

// 원본 검증 준비 (메뉴 연결만 제거해 기존 전체 blob 게이트 유지)
export function withoutAgentsSettings(source) {
    if (source.split(AGENTS_SETTINGS_AFTER).length > 2) throw new Error('Paseo agents settings patch drift');
    const counts = BASIC_AGENTS_WEB_EDITS.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1)) throw new Error('Paseo basic agents patch drift');
    if (counts.includes(0) && counts.some((count) => count > 0)) throw new Error('Partial Paseo basic agents patch');
    for (const [before, after] of [...BASIC_AGENTS_WEB_EDITS].reverse()) source = source.replace(after, () => before);
    source = source.replaceAll('r?.webSearch??!1', 'r?.webSearch??!0')
        .replaceAll('l.toolModules?.webSearch??!1', 'l.toolModules?.webSearch??!0');
    return source.replace(AGENTS_SETTINGS_AFTER, AGENTS_SETTINGS_BEFORE);
}
