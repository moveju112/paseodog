import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withTestLock } from '../scripts/test.mjs';

// 루트 회귀 검사는 실제 공유 화면 테스트를 호출한다. 여러 파일이 동시에
// Vitest/브라우저를 띄워 릴리즈 호스트 자원 한도를 넘지 않도록 별도 잠금을 쓴다.
export async function runSharedAppTests(files) {
    return withTestLock(() => {
        const result = spawnSync('npm', ['test', '--', ...files], {
            cwd: fileURLToPath(new URL('../android/packages/app/', import.meta.url)),
            encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024,
        });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, result.stdout + result.stderr);
    }, 'paseodog-shared-app-tests');
}
