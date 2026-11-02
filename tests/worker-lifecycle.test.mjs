import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deadline } from '../plugin/server/util.mjs';

const launcher = new URL('../engine/bin/paseodog-engine.mjs', import.meta.url).href;

// 실제 배포 진입점을 쓰되 세션을 열거나 모델을 호출하지 않는다.
for (const mode of ['--stdio', '--controls-stdio']) {
    for (const failure of ['stderr', 'stdout', 'uncaughtException', 'unhandledRejection']) {
        test(`${mode} exits unsuccessfully after ${failure} without recursive diagnostics`, { timeout: 10000 }, async () => {
            const source = `
                const wire = process.stdout.write.bind(process.stdout);
                await import(${JSON.stringify(launcher)});
                process.once('message', () => {
                    if (${JSON.stringify(failure)} === 'stdout') wire('closed output probe\\n');
                    else if (${JSON.stringify(failure)} === 'stderr') process.stderr.write('closed diagnostic probe\\n');
                    else if (${JSON.stringify(failure)} === 'unhandledRejection') void Promise.reject(new Error('test rejection'));
                    else throw new Error('test exception');
                });
                wire('ready\\n');
            `;
            const child = spawn(process.execPath, ['--input-type=module', '--eval', source, '--', mode], {
                cwd: fileURLToPath(new URL('../', import.meta.url)),
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                env: { ...process.env, PASEODOG_ENGINE_OWNER_PID: String(process.pid) },
            });
            const exited = new Promise((resolve, reject) => {
                child.once('error', reject);
                child.once('exit', (code, signal) => resolve({ code, signal }));
            });
            const ready = new Promise((resolve, reject) => {
                let text = '';
                child.stdout.on('data', chunk => {
                    text += chunk;
                    if (text.includes('ready\n')) resolve();
                });
                child.once('exit', () => reject(new Error('Worker exited before becoming ready')));
                child.once('error', reject);
            });
            // stdout 실패에서는 진단 채널을 남겨 두고, 나머지는 실제로 stderr 수신자를 닫는다.
            child.stderr.resume();
            try {
                await deadline(ready, 5000, 'Worker startup timed out');
                if (failure === 'stdout') child.stdout.destroy();
                else child.stderr.destroy();
                child.send('trigger');
                const result = await deadline(exited, 1500, 'Worker remained alive after fatal IPC failure');
                assert.deepEqual(result, { code: 1, signal: null });
            } finally {
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                await exited;
                child.stdin.destroy();
                child.stdout.destroy();
                child.stderr.destroy();
            }
        });
    }
}
