// 압축 여유 버퍼 단위 변환. 앱 계약은 비율(0.2 = 20%)이고 Mixdog mainBufferPercent는 0~100 단위다.

// 저장된 버퍼를 앱 계약 비율로 읽는다 (이전 앱의 선택값만 이관하고 네이티브 25% 상한 적용)
export function compactionBufferRatio(compaction = {}) {
    const normalized = migrateCompactionBuffer(compaction);
    const percent = normalized.mainBufferPercent;
    if (Number.isFinite(percent) && percent >= 0) return Math.min(0.25, percent / 100);
    const ratio = normalized.mainBufferRatio;
    if (Number.isFinite(ratio) && ratio >= 0) return Math.min(0.25, ratio > 1 ? ratio / 100 : ratio);
    return undefined;
}

// 이전 앱이 비율을 퍼센트 키에 저장한 값(0.2 -> 실제 0.2%)을 비율 키로 옮긴다 (토큰·비율 키가 이미 있으면 유지)
export function migrateCompactionBuffer(compaction) {
    const percent = compaction?.mainBufferPercent;
    if (![0.15, 0.2, 0.3].includes(percent)) return compaction;
    if (compaction.mainBufferRatio !== undefined || compaction.mainBufferTokens || compaction.mainBuffer) return compaction;
    const { mainBufferPercent, ...rest } = compaction;
    return { ...rest, mainBufferRatio: Math.min(0.25, mainBufferPercent) };
}
