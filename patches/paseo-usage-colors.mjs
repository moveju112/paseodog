// 로컬 패치: 검토된 UsageMeter의 quiet(사이드바) 채움도 호스트 windowTone 단계 색(>90 위험, >=70 경고, 그 외 기본)을 그대로 쓴다.
// 숫자 표시·쿼터 계산·임계값은 호스트 원본(windowTone·fillDefault/fillWarning/fillDanger)을 재사용하고 새 기준을 만들지 않는다.
export const USAGE_COLORS_ANCHOR = 'f[2]!==h||f[3]!==k?(v=h?u.fillQuiet:s(k),';
export const USAGE_COLORS = 'f[2]!==h||f[3]!==k?(v=s(k),';

// 패치된 채움 훅이 정확히 하나일 때만 원래 앵커로 되돌려 원본 해시 검증을 유지한다.
export function withoutUsageColors(source) {
    const count = source.split(USAGE_COLORS).length - 1;
    if (count > 1) throw new Error('Paseo usage colors patch drift');
    return source.replace(USAGE_COLORS, () => USAGE_COLORS_ANCHOR);
}

// 전체 원본 해시를 통과한 번들의 유일한 앵커에만 단계 색 채움을 붙인다.
export function withUsageColors(source) {
    if (source.split(USAGE_COLORS_ANCHOR).length !== 2 || source.includes(USAGE_COLORS))
        throw new Error('Paseo usage colors anchor mismatch');
    return source.replace(USAGE_COLORS_ANCHOR, () => USAGE_COLORS);
}
