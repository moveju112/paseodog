// 조회가 끝난 뒤 다음 조회를 예약하며 숨김·종료 뒤 응답은 표시하지 않는다.
export function createLiveMonitor({ read, onValue, onError, delayMs = 2000,
    schedule = setTimeout, cancel = clearTimeout }) {
    let timer, active = false, stopped = false, inFlight = false;
    // 중복 요청 없이 최신 엔진 상태를 조회한다.
    async function refresh() {
        if (!active || stopped || inFlight) return;
        inFlight = true;
        try {
            const value = await read();
            if (active && !stopped) onValue(value);
        } catch (error) {
            if (active && !stopped) onError(error);
        } finally {
            inFlight = false;
            if (active && !stopped) timer = schedule(refresh, delayMs);
        }
    }
    return {
        setActive(value) {
            active = value;
            cancel(timer);
            if (active) void refresh();
        },
        stop() { stopped = true; active = false; cancel(timer); },
    };
}
