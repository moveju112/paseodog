// 부모(데몬)가 사라지면 표준입력 EOF와 관계없이 종료한다.
// 다른 프로세스가 연결 소켓을 계속 쥐고 있어도 엔진이 고아로 남아 후보 디렉터리를 붙잡지 않게 한다.
export function watchParent(stop, { ppid = () => process.ppid, intervalMs = 5000 } = {}) {
    const initial = ppid();
    // 시작부터 init에 붙은 프로세스는 비교할 부모가 없다.
    if (!Number.isInteger(initial) || initial <= 1) return () => {};
    const timer = setInterval(() => {
        if (ppid() === initial) return;
        clearInterval(timer);
        void stop('Parent process exited');
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}
