// 저장된 이전 협업 모드만 스웜으로 정규화하고 단독 실행은 유지한다.
export function normalizeOrchestrationMode(mode) {
    return mode === 'focused' || mode === 'balanced' ? 'swarm' : mode;
}
