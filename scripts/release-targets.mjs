import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const TARGETS = ['android', 'desktop', 'web', 'runtime'];
const CLIENTS = ['android', 'desktop', 'web'];
const COMMIT = /^[0-9a-f]{40}$/;

// 매 배포마다 바뀌는 릴리즈 메타데이터는 대상 판정에서 제외한다.
const METADATA = new Set(['plugin/shared/release.json', 'CHANGELOG.md', 'MANIFEST.sha256']);

// 첫 일치 규칙을 사용한다. 어느 규칙에도 없는 경로는 모든 대상으로 본다.
const RULES = [
    [/^(docs|tests|reports|\.rule-architect|android\/docs|android\/packages\/website)\//, []],
    [/(^|\/)__tests__\//, []],
    [/\.(test|spec)\.[cm]?[jt]sx?$/, []],
    [/\.md$/, []],
    [/^scripts\/(release-[\w-]+|build-release|build-web|build-metrics|verified-build-cache|runtime-changes|test|test-files|check|check-upstream|benchmark-report|live-acceptance|live-smoke|doctor)\.mjs$/, []],
    [/^scripts\/(android-update-manifest\.py|check-env\.sh)$/, []],
    [/^android\/packages\/app\/(android|plugins)\//, ['android']],
    // Metro의 Android/native 구현만 바뀌면 웹 번들·데스크톱·데몬은 재배포하지 않는다.
    [/^android\/packages\/app\/src\/.*\.(android|native)\.[jt]sx?$/, ['android']],
    // 데몬 웹 패치·런타임이 앱·서버 소스와 protocol을 직접 가져다 쓴다(patches/*.mjs). 런타임에도 포함한다.
    [/^android\/packages\/(app\/src|protocol)\//, TARGETS],
    [/^android\/(package\.json|package-lock\.json)$/, TARGETS],
    [/^android\/packages\/server\/src\//, ['desktop', 'runtime']],
    [/^android\/packages\/(desktop|server|cli)\//, ['desktop']],
    [/^(scripts\/(desktop-profile|desktop-release|prepare-desktop-runtime|patch-windows-installer)\.mjs|scripts\/package\.py|patches\/windows-installer\.mjs)$/, ['desktop']],
    [/^android\/packages\/(app|protocol|client|highlight|relay|plugin|expo-two-way-audio)\//, CLIENTS],
    [/^android\/(package\.json|package-lock\.json|patches\/|scripts\/)/, CLIENTS],
    [/^(plugin|engine)\//, ['runtime', 'desktop']],
    [/^scripts\/patch-mixdog\.mjs$/, ['runtime', 'desktop']],
    [/^scripts\/(background-results|delivery-notify)\.mjs$/, ['runtime', 'desktop']],
    [/^(bin|tools|patches|config)\//, ['runtime']],
    [/^scripts\/(patch-paseo-(?!android)[\w-]+|install|configure|service)\.(mjs|sh)$/, ['runtime']],
    [/^(package\.json|package-lock\.json)$/, ['runtime', 'desktop']],
];

export function pathTargets(path) {
    if (METADATA.has(path)) return [];
    for (const [pattern, targets] of RULES) if (pattern.test(path)) return targets;
    return TARGETS;
}

// 대상별로 변경 경로를 모은다. 판정 근거를 보고할 수 있도록 경로 목록을 유지한다.
export function classifyPaths(paths) {
    const changes = Object.fromEntries(TARGETS.map(target => [target, []]));
    for (const path of paths) for (const target of pathTargets(path)) changes[target].push(path);
    return changes;
}

export function ledgerPath(cacheRoot) {
    return join(cacheRoot, 'delivery-ledger.json');
}

export async function readLedger(cacheRoot) {
    try { return JSON.parse(await readFile(ledgerPath(cacheRoot), 'utf8')); }
    catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
        throw error;
    }
}

// 세션 기억 대신 실제로 완료된 배포만 기록한다. 같은 대상의 이전 기록을 덮어쓴다.
export async function recordDeployment(cacheRoot, target, entry) {
    await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    const ledger = await readLedger(cacheRoot);
    ledger[target] = { ...entry, at: new Date().toISOString() };
    const path = ledgerPath(cacheRoot);
    const temporary = `${path}.${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, path);
}

function requestedTargets(value) {
    if (value === undefined || value === 'auto') return null;
    if (value === 'full') return TARGETS;
    if (!Array.isArray(value) || !value.length || value.some(target => !TARGETS.includes(target)))
        throw new Error(`targets must be auto, full or a subset of ${TARGETS.join(', ')}`);
    return value;
}

export function validateTargets(value) {
    requestedTargets(value);
    return value ?? 'auto';
}

// 배포 대상과 이전 공개 산출물의 이월 여부를 정한다.
// 기준점을 확인할 수 없는 대상은 전체 배포로 되돌린다.
export async function deliveryPlan(config, { capture, commit, cwd }) {
    const explicit = requestedTargets(config.targets);
    const baselines = {}, changes = {}, reasons = {};
    const quiet = async (command, args) => {
        try { return await capture(command, args, cwd); } catch { return null; }
    };
    const releaseCommit = async tag => {
        const text = await quiet('gh', ['release', 'view', tag, '--repo', config.repo, '--json', 'targetCommitish,isDraft']);
        try {
            const row = JSON.parse(text);
            return !row.isDraft && COMMIT.test(row.targetCommitish) ? row.targetCommitish : null;
        } catch { return null; }
    };
    const changedSince = async base => {
        if (!COMMIT.test(base || '')) return null;
        const text = await quiet('git', ['diff', '--name-only', '-z', base, commit]);
        return text === null ? null : text.split('\0').filter(Boolean);
    };

    // GitHub latest의 업데이터 매니페스트가 가리키는 버전이 실제 공개된 클라이언트다.
    let latest = null;
    try {
        latest = JSON.parse(await quiet('gh', ['release', 'view', '--repo', config.repo, '--json', 'tagName,assets']));
        if (!/^v[0-9][0-9A-Za-z.+-]*$/.test(latest?.tagName || '') || !Array.isArray(latest.assets)) latest = null;
    } catch { latest = null; }
    const manifests = join(config.workspace, 'baseline');
    const published = {};
    if (latest) {
        await mkdir(manifests, { recursive: true, mode: 0o700 });
        await quiet('gh', ['release', 'download', latest.tagName, '--repo', config.repo, '--dir', manifests, '--clobber',
            '--pattern', 'paseodog-android-update.json', '--pattern', 'latest-linux.yml', '--pattern', 'latest.yml']);
        try {
            const android = JSON.parse(await readFile(join(manifests, 'paseodog-android-update.json'), 'utf8'));
            if (Number.isSafeInteger(android.versionCode) && /^[0-9][0-9A-Za-z.+-]*$/.test(android.versionName))
                published.android = { version: android.versionName, versionCode: android.versionCode };
        } catch { /* 기준점 없음 */ }
        try {
            const versions = await Promise.all(['latest-linux.yml', 'latest.yml'].map(async name =>
                /^version: ([0-9][0-9A-Za-z.+-]*)$/m.exec(await readFile(join(manifests, name), 'utf8'))?.[1]));
            if (versions[0] && versions[0] === versions[1]) published.desktop = { version: versions[0] };
        } catch { /* 기준점 없음 */ }
    }
    const installed = (await quiet('dpkg-query', ['-W', '-f=${Version}', 'paseodog']))?.trim().replace('~', '-');

    const bases = {
        android: [published.android?.version],
        // PC 설치본이 공개 버전보다 뒤처졌으면 그 사이 변경도 데스크톱 대상에 포함한다.
        desktop: [published.desktop?.version, installed],
    };
    for (const target of ['android', 'desktop']) {
        const versions = [...new Set(bases[target])];
        const commits = await Promise.all(versions.map(version => version ? releaseCommit(`v${version}`) : null));
        baselines[target] = Object.fromEntries(versions.map((version, index) => [version ?? 'unknown', commits[index]]));
    }
    const ledger = await readLedger(config.cacheRoot);
    baselines.web = { ledger: ledger.web?.commit ?? null };
    let receipt = null;
    if (config.updaterRoot) {
        try { receipt = JSON.parse(await readFile(join(config.updaterRoot, 'receipt.json'), 'utf8')); }
        catch { receipt = null; }
    }
    baselines.runtime = { updater: receipt?.phase === 'applied' ? receipt.revision : null };

    const targets = {};
    for (const target of TARGETS) {
        const commits = Object.values(baselines[target]);
        const lists = await Promise.all(commits.map(changedSince));
        if (!commits.length || lists.some(list => list === null)) {
            targets[target] = true;
            reasons[target] = 'baseline unknown';
            changes[target] = [];
            continue;
        }
        const paths = [...new Set(lists.flat())].sort();
        changes[target] = classifyPaths(paths)[target];
        targets[target] = changes[target].length > 0;
        reasons[target] = targets[target] ? 'changed' : 'unchanged';
    }
    if (explicit) for (const target of TARGETS) {
        targets[target] = explicit.includes(target);
        reasons[target] = targets[target] ? 'requested' : 'not requested';
    }
    const github = targets.android || targets.desktop;
    // 공개 latest가 업데이터 매니페스트의 기준이므로 바뀌지 않은 플랫폼의 매니페스트를 이월한다.
    const carry = {
        android: github && !targets.android ? published.android ?? null : null,
        desktop: github && !targets.desktop ? published.desktop ?? null : null,
    };
    if (github && ((!targets.android && !carry.android) || (!targets.desktop && !carry.desktop)))
        throw new Error('Cannot carry unchanged platform assets forward; deliver with targets full');
    return { mode: explicit ? 'explicit' : 'auto', targets, reasons, baselines,
        latestTag: latest?.tagName ?? null, carry,
        changes: Object.fromEntries(TARGETS.map(target => [target, changes[target].slice(0, 50)])) };
}

export function carriedAssets(carry) {
    const names = [];
    if (carry.android) names.push('paseodog-android-update.json');
    if (carry.desktop) {
        const version = carry.desktop.version;
        names.push(`PaseoDog-${version}-amd64.deb`, `PaseoDog-${version}-x86_64.AppImage`, 'latest-linux.yml',
            `PaseoDog-Setup-${version}-x64.exe`, `PaseoDog-Setup-${version}-x64.exe.blockmap`, 'latest.yml');
    }
    return names;
}

export function describePlan(plan) {
    return TARGETS.map(target => `${target}=${plan.targets[target] ? 'deploy' : 'skip'} (${plan.reasons[target]})`).join(', ');
}
