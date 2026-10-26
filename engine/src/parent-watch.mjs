// 엔진을 띄운 소유자(플러그인) 프로세스나 부모가 사라지면 표준입력 EOF와 관계없이 종료한다.
// 다른 프로세스가 연결 소켓을 계속 쥐고 있어도 엔진이 고아로 남아 후보 디렉터리를 붙잡지 않게 한다.
function processAlive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code === 'EPERM'; }
}

// initial은 무거운 모듈을 불러오기 전에 기록한 부모, owner는 소유자가 넘긴 자기 PID다.
// 소유자 확인은 엔진이 시작되기 전에 소유자가 이미 종료된 경우도 잡는다.
export function watchParent(stop, { ppid = () => process.ppid, intervalMs = 5000, initial = ppid(),
    owner = null, alive = processAlive } = {}) {
    const watchOwner = Number.isInteger(owner) && owner > 1;
    const watchParentChange = Number.isInteger(initial) && initial > 1;
    if (!watchOwner && !watchParentChange) return () => {};
    const timer = setInterval(() => {
        if ((!watchParentChange || ppid() === initial) && (!watchOwner || alive(owner))) return;
        clearInterval(timer);
        void stop('Parent process exited');
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}

// 소유자가 환경변수로 넘긴 PID. 형식이 맞지 않으면 무시한다.
export function ownerFromEnv(env = process.env) {
    const value = Number(env.PASEODOG_ENGINE_OWNER_PID);
    return Number.isInteger(value) && value > 1 ? value : null;
}
