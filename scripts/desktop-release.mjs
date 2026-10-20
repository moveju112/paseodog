import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, closeSync, readSync, writeSync, fstatSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { VERSION, UPSTREAM_VERSIONS } from '../plugin/server/util.mjs';
const DESKTOP_COMPOSER_FILE = '/opt/PaseoDog/resources/app-dist/_expo/static/js/web/index-92699df43a283bb08831cc9d2fb07982.js';
import { gitBlob } from './patch-mixdog.mjs';
import { patchedDesktopSettings } from '../patches/paseo-desktop-settings.mjs';

const require = createRequire(new URL('../tools/package.json', import.meta.url));
const asar = require('@electron/asar');
const { Pickle } = require('@electron/asar/lib/pickle.js');
const updaterPath = 'dist/features/auto-updater.js';
const updaterBefore = `    async checkForUpdates() {
        try {
            const result = await electron_updater_1.autoUpdater.checkForUpdates();
            if (!result)
                return null;
            return {
                isUpdateAvailable: result.isUpdateAvailable,
                updateInfo: result.updateInfo,
            };
        }
        catch (error) {
            if (isUpdateChannelNotPublished(error))
                return null;
            throw error;
        }
    }`;
const updaterAfter = `    async checkForUpdates() {
        // PaseoDog는 검토한 기반 버전에 패치를 재적용하는 자체 업데이트 경로만 사용한다.
        return null;
    }`;
const checkBefore = `async function checkForAppUpdate({ currentVersion, releaseChannel, intent, }) {
    updateLifecycleLog.checkStarted({ currentVersion, releaseChannel, intent });
    const result = await appUpdateService.checkForAppUpdate({
        currentVersion,
        releaseChannel,
        intent,
    });
    updateLifecycleLog.checkCompleted({
        currentVersion,
        targetVersion: result.latestVersion,
        releaseChannel,
        intent,
        hasUpdate: result.hasUpdate,
        readyToInstall: result.readyToInstall,
        errorMessage: result.errorMessage,
    });
    return result;
}`;
const checkAfter = `async function checkForAppUpdate({ currentVersion, releaseChannel, intent, }) {
    // 자동 확인을 끈 빌드는 최신 여부를 모르므로 수동 업데이트 상태를 그대로 알린다.
    return {
        hasUpdate: false,
        readyToInstall: false,
        currentVersion,
        latestVersion: null,
        body: null,
        date: null,
        errorMessage: null,
        updateMode: "manual",
    };
}`;
const updaterPatches = [[updaterBefore, updaterAfter], [checkBefore, checkAfter]];

// 원본 업데이터만 허용하고 상위 제품의 자동 덮어쓰기를 차단하며 수동 업데이트 상태를 명시한다.
export function patchDesktopUpdater(source) {
    const original = updaterPatches.reduce((text, [before, after]) => text.replace(after, before), source);
    if (gitBlob(original) !== '31a64cc1b2868408187f4a029f954860401a4812')
        throw new Error('Unreviewed desktop updater source');
    return updaterPatches.reduce((text, [before, after]) => text.replace(before, after), original);
}

// 아카이브의 링크·권한·비대상 바이트는 유지하며 변경된 파일과 무결성 헤더만 갱신한다.
export function rewriteArchive(inputPath, outputPath, changes) {
    const { header, headerSize } = asar.getRawHeader(inputPath);
    const files = [];
    // 링크를 해석하지 않고 원본 파일 트리와 본문 오프셋을 수집한다.
    function walk(node, prefix = '') {
        for (const [name, entry] of Object.entries(node.files || {})) {
            const path = prefix ? prefix + '/' + name : name;
            if (entry.files) walk(entry, path);
            else files.push({ path, entry, offset: Number(entry.offset), size: entry.size });
        }
    }
    walk(header);
    const packed = files.filter((file) => changes.has(file.path) && !file.entry.unpacked).sort((a, b) => a.offset - b.offset);
    for (const file of files) {
        const { path, entry } = file;
        if (!entry.link && !entry.unpacked) entry.offset = String(file.offset + packed
            .filter((change) => change.offset < file.offset)
            .reduce((total, change) => total + changes.get(change.path).length - change.size, 0));
        if (!changes.has(path)) continue;
        const buffer = changes.get(path);
        entry.size = buffer.length;
        const blockSize = entry.integrity.blockSize;
        entry.integrity.hash = createHash('sha256').update(buffer).digest('hex');
        entry.integrity.blocks = [];
        for (let at = 0; at < buffer.length; at += blockSize)
            entry.integrity.blocks.push(createHash('sha256').update(buffer.subarray(at, at + blockSize)).digest('hex'));
        if (entry.unpacked) {
            const target = outputPath + '.unpacked/' + path;
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, buffer);
        }
    }
    if ([...changes.keys()].some((path) => !files.some((file) => file.path === path)))
        throw new Error('Missing archive target');
    const headerPickle = Pickle.createEmpty();
    headerPickle.writeString(JSON.stringify(header));
    const encoded = headerPickle.toBuffer();
    const size = Pickle.createEmpty();
    size.writeUInt32(encoded.length);
    const input = openSync(inputPath, 'r'), output = openSync(outputPath, 'wx');
    try {
        writeSync(output, size.toBuffer()); writeSync(output, encoded);
        const buffer = Buffer.alloc(1024 * 1024);
        // 큰 바이너리를 메모리에 올리지 않고 필요한 구간만 복사한다.
        const copy = (start, end) => {
            while (start < end) {
                const count = readSync(input, buffer, 0, Math.min(buffer.length, end - start), start);
                if (!count) throw new Error('Unexpected archive EOF');
                writeSync(output, buffer, 0, count); start += count;
            }
        };
        const base = 8 + headerSize;
        let cursor = base;
        for (const file of packed) {
            copy(cursor, base + file.offset); writeSync(output, changes.get(file.path));
            cursor = base + file.offset + file.size;
        }
        copy(cursor, fstatSync(input).size);
    } finally { closeSync(input); closeSync(output); }
}

// 매 업데이트마다 검토한 원본 위에 제품 버전·입력 패치·업데이트 정책을 함께 적용한다.
export function prepareDesktopRelease({ source = '/opt/PaseoDog/resources', output }) {
    if (!output || resolve(output) === resolve(source)) throw new Error('Separate output directory required');
    mkdirSync(output, { recursive: true });
    // 실행 창 아이콘 설치 (기존 PaseoDog 브랜드 자산 -> Electron resources/icon.png)
    const icon = readFileSync(new URL('../android/packages/app/assets/images/paseodog-icon.png', import.meta.url));
    writeFileSync(join(output, 'icon.png'), icon);
    const archive = join(source, 'app.asar');
    const manifest = JSON.parse(asar.extractFile(archive, 'package.json'));
    if (manifest.version !== UPSTREAM_VERSIONS.paseo
        && manifest.paseodogUpstream?.paseo !== UPSTREAM_VERSIONS.paseo)
        throw new Error('Desktop upstream version requires review');
    const next = { ...manifest, version: VERSION, paseodogUpstream: UPSTREAM_VERSIONS };
    const changes = new Map([
        ['package.json', Buffer.from(JSON.stringify(next, null, 2) + '\n')],
        [updaterPath, Buffer.from(patchDesktopUpdater(asar.extractFile(archive, updaterPath).toString()))],
    ]);
    rewriteArchive(archive, join(output, 'app.asar'), changes);
    const client = relative('/opt/PaseoDog/resources', DESKTOP_COMPOSER_FILE);
    const target = join(output, client);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, patchedDesktopSettings(readFileSync(join(source, client), 'utf8')));
    if (JSON.parse(asar.extractFile(join(output, 'app.asar'), 'package.json')).version !== VERSION)
        throw new Error('Desktop product version verification failed');
    return { output: resolve(output), version: VERSION, upstream: UPSTREAM_VERSIONS, client };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    const args = process.argv.slice(2), index = args.indexOf('--output');
    const result = prepareDesktopRelease({ output: index >= 0 ? args[index + 1] : undefined });
    if (args.includes('--apply')) {
        // 명시적인 적용 요청에서만 정확한 PaseoDog 설치 경로 두 곳을 교체한다.
        for (const path of ['app.asar', result.client, 'icon.png'])
            execFileSync('sudo', ['-n', 'install', '-o', 'root', '-g', 'root', '-m', '0644',
                join(result.output, path), join('/opt/PaseoDog/resources', path)], { stdio: 'inherit' });
    }
    console.log(JSON.stringify(result));
}
