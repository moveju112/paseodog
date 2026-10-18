import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './paths.mjs';
import { PIN } from './patch-mixdog.mjs';

const execute = promisify(execFile);
const targets = [
    { directory: 'engine', name: 'mixdog', section: 'dependencies' },
    { directory: 'tools', name: '@getpaseo/cli', section: 'dependencies' },
    { directory: 'plugin', name: '@getpaseo/plugin', section: 'devDependencies' },
];

// npm 배포 버전만 조회하며 설치·패치·서비스 변경은 하지 않는다.
async function latestVersion(name) {
    const { stdout } = await execute('npm', ['view', name, 'dist-tags.latest', '--json'], {
        timeout: 20000, maxBuffer: 64 * 1024,
    });
    const version = JSON.parse(stdout);
    if (typeof version !== 'string' || !version.trim()) throw new Error(`Invalid registry version: ${name}`);
    return version;
}

// 고정 버전·lockfile·패치 대상의 일치를 검사한 뒤 최신 배포와 비교한다.
export async function checkUpstream({ projectRoot = root, lookup = latestVersion } = {}) {
    const rows = targets.map(({ directory, name, section }) => {
        const manifest = JSON.parse(readFileSync(resolve(projectRoot, directory, 'package.json'), 'utf8'));
        const lock = JSON.parse(readFileSync(resolve(projectRoot, directory, 'package-lock.json'), 'utf8'));
        const pinned = manifest[section]?.[name];
        if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pinned || ''))
            throw new Error(`Exact version required: ${name}`);
        if (lock.packages?.['']?.[section]?.[name] !== pinned ||
            lock.packages?.[`node_modules/${name}`]?.version !== pinned)
            throw new Error(`Lockfile mismatch: ${name}`);
        return { name, pinned };
    });
    if (rows[0].pinned !== PIN) throw new Error('Mixdog patch pin mismatch');
    if (rows[1].pinned !== rows[2].pinned) throw new Error('Paseo CLI/SDK pins differ');
    return Promise.all(rows.map(async (row) => {
        const latest = await lookup(row.name);
        return { ...row, latest, reviewRequired: latest !== row.pinned };
    }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        console.log(JSON.stringify({ readOnly: true, packages: await checkUpstream(),
            notice: 'Different versions require source/adapter review and tests; nothing was installed.' }, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
