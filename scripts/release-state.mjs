import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export async function fileHash(path, algorithm = 'sha256', encoding = 'hex') {
    const hash = createHash(algorithm);
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest(encoding);
}

export async function artifactHashes(paths) {
    const rows = {};
    async function visit(path) {
        const info = await stat(path);
        if (info.isDirectory()) {
            for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
        } else rows[path] = { bytes: info.size, sha256: await fileHash(path) };
    }
    for (const path of paths) await visit(path);
    return rows;
}

// 성공·실패·실행 중을 원자적으로 기록한다. 중단된 원격 변경을 재개만으로 재전송하지 않는다.
export async function openReleaseState(workspace, identity, { retryStage } = {}) {
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    const path = join(workspace, 'release-state.json');
    let state;
    try { state = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        state = { identity, stages: {} };
    }
    if (JSON.stringify(state.identity) !== JSON.stringify(identity))
        throw new Error('Release identity changed; allocate a new workspace');
    let writes = Promise.resolve();
    function save() {
        const contents = JSON.stringify(state, null, 2) + '\n';
        writes = writes.then(async () => {
            const temporary = `${path}.${randomUUID()}`;
            await writeFile(temporary, contents, { mode: 0o600 });
            await rename(temporary, path);
        });
        return writes;
    }
    await save();
    return {
        state,
        async stage(name, run, { mutation = false, artifacts = [] } = {}) {
            const previous = state.stages[name];
            if (previous?.status === 'complete') {
                if (JSON.stringify(await artifactHashes(artifacts)) !== JSON.stringify(previous.artifacts))
                    throw new Error(`Release artifact drift: ${name}; do not publish mixed builds`);
                return previous.result;
            }
            if (previous && mutation && retryStage !== name)
                throw new Error(`Uncertain mutation ${name}; inspect remote state, then explicitly --retry-stage ${name} if safe`);
            const started = Date.now();
            const attempt = (previous?.attempt || 0) + 1;
            state.stages[name] = { status: 'running', mutation, attempt, startedAt: new Date(started).toISOString() };
            await save();
            console.log(`${name}: start (attempt ${attempt})`);
            try {
                const result = await run();
                state.stages[name] = { ...state.stages[name], status: 'complete',
                    elapsedMs: Date.now() - started, artifacts: await artifactHashes(artifacts), result: result ?? null };
                await save();
                console.log(`${name}: complete (${Date.now() - started}ms)`);
                return result;
            } catch (error) {
                // 외부 명령의 출력은 단계 로그에만 둔다. 상태에는 자격증명·명령행을 복제하지 않는다.
                state.stages[name] = { ...state.stages[name], status: 'failed', elapsedMs: Date.now() - started };
                await save();
                throw error;
            }
        },
    };
}

export function insideWorkspace(workspace, path) {
    const child = relative(workspace, path);
    return child !== '' && child !== '..' && !child.startsWith('../') && !child.startsWith('/');
}
