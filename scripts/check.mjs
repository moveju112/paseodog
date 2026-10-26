import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { root } from './paths.mjs';

// 검사 대상과 플래그는 유지하고 짧은 구문 검사만 최대 4개씩 실행한다.
function walk(path) {
    return readdirSync(path, { withFileTypes: true }).flatMap(entry =>
        ['node_modules', '.git', 'reports'].includes(entry.name) || (path === root && entry.name === 'android') ? []
            : entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);
}
const files = walk(root);
let cursor = 0, count = 0, failures = 0;
async function worker() {
    while (cursor < files.length) {
        const file = files[cursor++];
        if (file.endsWith('.json')) {
            try { JSON.parse(readFileSync(file, 'utf8')); }
            catch (error) { console.error(file, error.message); failures++; }
            continue;
        }
        const javascript = file.endsWith('.mjs');
        if (!javascript && !(file.endsWith('.sh') && process.platform !== 'win32')) continue;
        if (javascript) count++;
        await new Promise(resolve => {
            const child = spawn(javascript ? process.execPath : 'bash',
                [javascript ? '--check' : '-n', file], { stdio: ['ignore', 'ignore', 'pipe'] });
            let error = '';
            child.stderr.on('data', bytes => { error += bytes; });
            child.on('error', failure => { error += failure.message; });
            child.on('close', code => {
                if (code !== 0) { console.error(file, error); failures++; }
                resolve();
            });
        });
    }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`Checked ${count} JavaScript modules, JSON and shell syntax; failures=${failures}`);
process.exitCode = failures ? 1 : 0;
