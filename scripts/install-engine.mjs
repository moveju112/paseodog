import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineInstallSteps } from './install.mjs';
import { runCommand } from './release-command.mjs';
import { root } from './paths.mjs';

// Mixdog의 정리 훅이 하위 패키지를 제거하기 전에 필요한 설치 훅을 순차 완료한다.
// CI와 일반 설치가 같은 단계 목록을 사용하며 중간 실패 후에는 다음 훅을 실행하지 않는다.
export async function installEngine(run = runCommand) {
    for (const { command, args } of engineInstallSteps()) await run(command, args, { cwd: root });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await installEngine(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
