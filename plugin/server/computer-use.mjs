import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UPSTREAM_VERSIONS } from './util.mjs';
import { readDedicatedSetting, writeDedicatedSetting } from './dedicated-setting.mjs';

const SETTING_FILE = 'paseodog-computer-use.json';
const DISCOVERY_FILE = 'computer-bridge.json';
// Mixdog bridge-discovery.mjs와 같은 계약: 앱이 60초마다 갱신하므로 5분 넘게 멈춘 파일은 잔재다.
const DISCOVERY_VERSION = 1;
const DISCOVERY_MAX_AGE_MS = 5 * 60_000;
// 앱이 같은 폴더에 게시하는 다른 bridge 도구는 이 토글의 범위가 아니라서 계속 숨긴다.
const OTHER_BRIDGE_FEATURES = ['MIXDOG_FEATURE_BROWSER', 'MIXDOG_FEATURE_TERMINAL', 'MIXDOG_FEATURE_VISUALIZE'];
const DESKTOP_ENV_KEYS = new Set([
    'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP',
    'XDG_SESSION_DESKTOP', 'DESKTOP_SESSION', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
    'SWAYSOCK', 'HYPRLAND_INSTANCE_SIGNATURE',
]);

// 설치형 Mixdog 데스크톱 앱이 bridge discovery 파일을 게시하는 공용 데이터 폴더.
export function desktopBridgeDirectory(home = homedir()) {
    return join(home, '.mixdog', 'data');
}

// 저장된 값이 없으면 꺼짐이다. 화면과 입력을 넘기는 기능이라 사용자가 명시적으로 켜야 한다.
export function readComputerUse(env = {}) {
    const saved = readDedicatedSetting(env, SETTING_FILE);
    if (saved === undefined) return false;
    if (typeof saved?.enabled !== 'boolean') throw new Error('Invalid computer use setting');
    return saved.enabled;
}

export function writeComputerUse(env, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    writeDedicatedSetting(env, SETTING_FILE, { enabled });
}

// 토글이 엔진의 computer 도구 노출을 결정한다. 상속된 bridge 경로와 기능 override는 토글 값으로 덮는다.
export function withComputerUse(env, enabled, home = homedir()) {
    const next = { ...env };
    if (!enabled) {
        delete next.MIXDOG_BRIDGE_DISCOVERY_DIR;
        next.MIXDOG_FEATURE_COMPUTER = '0';
        return next;
    }
    next.MIXDOG_BRIDGE_DISCOVERY_DIR = desktopBridgeDirectory(home);
    delete next.MIXDOG_FEATURE_COMPUTER;
    for (const key of OTHER_BRIDGE_FEATURES) next[key] ??= '0';
    return next;
}

// Linux 서비스가 로그인 세션 밖에서 시작돼도 실제 bridge를 띄운 같은 사용자의 앱 환경을 쓴다.
// 환경 전체를 자식에게 넘기지 않고 화면·입력 사전 점검에 필요한 값만 가져온다.
export function computerSessionEnvironment(env, { platform = process.platform, home,
    readEnvironment = (pid) => {
        const directory = `/proc/${pid}`;
        if (statSync(directory).uid !== process.getuid()) throw new Error('Bridge owner mismatch');
        return readFileSync(join(directory, 'environ'), 'utf8');
    } } = {}) {
    if (platform !== 'linux') return env;
    const bridge = readComputerBridge(desktopBridgeDirectory(home));
    if (bridge.state !== 'connected' || !Number.isInteger(bridge.pid) || bridge.pid < 2) return env;
    let entries;
    try { entries = readEnvironment(bridge.pid).split('\0'); }
    catch { return env; }
    const desktop = {};
    for (const entry of entries) {
        const separator = entry.indexOf('=');
        const key = entry.slice(0, separator);
        if (DESKTOP_ENV_KEYS.has(key)) desktop[key] = entry.slice(separator + 1);
    }
    if (!desktop.DISPLAY && !desktop.WAYLAND_DISPLAY) return env;
    const next = { ...env };
    for (const key of DESKTOP_ENV_KEYS) delete next[key];
    return { ...next, ...desktop };
}

// pid가 없거나 권한 오류면 살아 있는 것으로 본다(Mixdog processAlive와 같은 판정).
function processAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return true;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code !== 'ESRCH';
    }
}

// 연결 상태만 판정하며 토큰·포트는 응답에 담지 않는다.
function readComputerBridge(directory, { now = Date.now, alive = processAlive } = {}) {
    const path = join(directory, DISCOVERY_FILE);
    let modified;
    try { modified = statSync(path).mtimeMs; }
    catch { return { state: 'missing' }; }
    if (now() - modified >= DISCOVERY_MAX_AGE_MS) return { state: 'expired' };
    let parsed;
    try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
    catch { return { state: 'invalid' }; }
    const port = Number(parsed?.port);
    if (Number(parsed?.version) !== DISCOVERY_VERSION || !Number.isInteger(port) || port <= 0 || port > 65_535
        || !parsed?.token) return { state: 'invalid' };
    const pid = Number(parsed?.pid || 0);
    return { state: alive(pid) ? 'connected' : 'stale', pid };
}

export function computerBridgeState(directory, options) {
    return readComputerBridge(directory, options).state;
}

// Linux 엔진은 자기 env의 그래픽 세션으로 화면을 다루므로 DISPLAY 또는 WAYLAND_DISPLAY가 있어야 한다.
export function computerUseStatus(env = {}, { platform = process.platform, home, now, alive, readEnvironment } = {}) {
    const desktop = computerSessionEnvironment(env, { platform, home, readEnvironment });
    return {
        enabled: readComputerUse(env),
        bridge: computerBridgeState(desktopBridgeDirectory(home), { now, alive }),
        display: platform !== 'linux' || Boolean(desktop.DISPLAY || desktop.WAYLAND_DISPLAY),
        mixdogVersion: UPSTREAM_VERSIONS.mixdog,
    };
}
