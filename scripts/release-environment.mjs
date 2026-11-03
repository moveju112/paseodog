import { delimiter, isAbsolute, resolve } from 'node:path';

// 최초 준비·분리 실행·직접 재개가 같은 호스트 프로필을 사용한다.
export function releaseEnvironment(config, inherited = process.env) {
    const env = { ...inherited };
    for (const key of ['androidHome', 'wineBin']) {
        const value = config[key];
        if (value !== undefined && (typeof value !== 'string' || !isAbsolute(value) || resolve(value) === '/'))
            throw Object.assign(new Error(`${key} must be an explicit absolute non-root path`), {
                code: key === 'androidHome' ? 'android-sdk-missing' : 'preflight-failed',
            });
    }
    if (config.androidHome) env.ANDROID_HOME = config.androidHome;
    if (config.wineBin) env.PATH = [config.wineBin,
        ...(env.PATH || '').split(delimiter).filter(path => path && path !== config.wineBin)].join(delimiter);
    return env;
}
