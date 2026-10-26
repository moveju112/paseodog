// 데몬 업데이터용: 두 리비전 사이 변경이 데몬 런타임에 영향을 주는지 판정한다.
// 판정할 수 없으면 영향이 있는 것으로 보고 전체 준비·검증 경로를 유지한다.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { classifyPaths } from './release-targets.mjs';

const RELEASE_METADATA = 'plugin/shared/release.json';

export function runtimeChanges(paths) {
    const runtime = classifyPaths(paths).runtime;
    return { runtime: runtime.length > 0, paths: runtime.slice(0, 50), releaseMetadata: paths.includes(RELEASE_METADATA) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let result;
    try {
        const { values } = parseArgs({ options: { repo: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } });
        if (![values.from, values.to].every((value) => /^[0-9a-f]{40}$/.test(value || '')) || !values.repo)
            throw new Error('--repo, --from and --to (full commits) are required');
        const paths = execFileSync('git', ['-C', values.repo, 'diff', '--name-only', '-z', values.from, values.to],
            { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
        result = runtimeChanges(paths);
    } catch (error) {
        result = { runtime: true, paths: [], releaseMetadata: true, error: String(error?.message || error).slice(0, 300) };
    }
    console.log(JSON.stringify(result));
}
