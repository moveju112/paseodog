import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

// stdout 수집은 명시한 읽기 전용 조회에만 사용한다. 실제 빌드·배포 로그는 파일로 스트리밍한다.
export function runCommand(command, args, { cwd, env = process.env, log, capture = false } = {}) {
    return new Promise((resolve, reject) => {
        const output = log ? createWriteStream(log, { flags: 'a', mode: 0o600 }) : null;
        const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let text = '';
        child.stdout.on('data', data => {
            if (capture) text += data;
            else if (!output) process.stdout.write(data);
            output?.write(data);
        });
        child.stderr.on('data', data => { if (output) output.write(data); else process.stderr.write(data); });
        output?.on('error', reject);
        child.on('error', error => { output?.end(); reject(error); });
        child.on('close', (code, signal) => {
            const done = () => code === 0 ? resolve(text) :
                reject(new Error(`${command} failed (${signal ?? code})${log ? `; see ${log}` : ''}`));
            if (output) output.end(done); else done();
        });
    });
}
