// 로컬 패치: 검토된 Paseo 0.11.4 번들의 기존 에이전트 설정 화면을 호스트 메뉴에 다시 연결한다.
export const AGENTS_SETTINGS_BEFORE = 'const Ae=[{id:"engine-accounts",labelKey:"settings.hostSections.engineAccounts",icon:f.KeyRound}';
export const AGENTS_SETTINGS_AFTER = 'const Ae=[{id:"agents",labelKey:"settings.hostSections.agents",icon:f.Bot},{id:"engine-accounts",labelKey:"settings.hostSections.engineAccounts",icon:f.KeyRound}';

// 메뉴 연결 복원 (유일한 앵커에만 기존 agents 경로 추가)
export function withAgentsSettings(source) {
    if (source.split(AGENTS_SETTINGS_BEFORE).length !== 2) throw new Error('Paseo agents settings anchor mismatch');
    return source.replace(AGENTS_SETTINGS_BEFORE, AGENTS_SETTINGS_AFTER);
}

// 원본 검증 준비 (메뉴 연결만 제거해 기존 전체 blob 게이트 유지)
export function withoutAgentsSettings(source) {
    if (source.split(AGENTS_SETTINGS_AFTER).length > 2) throw new Error('Paseo agents settings patch drift');
    return source.replace(AGENTS_SETTINGS_AFTER, AGENTS_SETTINGS_BEFORE);
}
