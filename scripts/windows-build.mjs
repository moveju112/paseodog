import { join } from 'node:path';

// 실제 NSIS 패키징을 검증한 이미지 digest를 고정해 호스트별 Wine 차이를 제거한다.
export const WINDOWS_WINE_IMAGE = 'electronuserland/builder@sha256:f3a8d451994c881d0972e7b1846ee4d4fdc15eb41fc6b1f350b38cbf99ca90fe';

export function windowsBuildMode(value = 'host') {
    if (!['host', 'docker'].includes(value)) throw new Error('windowsBuildMode must be host or docker');
    return value;
}

export function windowsBuildCommands({ mode, builder, root, workspace, uid, gid }) {
    if (windowsBuildMode(mode) === 'host') return [[...builder, '--win', 'nsis', '--x64']];
    const desktop = join(root, 'android/packages/desktop');
    // 네이티브 런타임 준비는 기존 호스트 훅으로 수행한다. Wine이 필요한 NSIS 단계만 격리한다.
    // 소스는 읽기 전용이고 산출물만 쓰기 가능하며, 개인 HOME·Wine 설정은 공유하지 않는다.
    return [
        [...builder, '--win', '--x64', '--dir'],
        ['docker', 'run', '--rm', '--user', `${uid}:${gid}`, '--memory', '16g', '--memory-swap', '18g',
            '--entrypoint', '/bin/bash', '-e', 'ELECTRON_BUILDER_COMPRESSION_LEVEL=1', '-e', 'CI=1',
            '-v', `${root}:${root}:ro`, '-v', `${workspace}:${workspace}`,
            '-w', desktop, WINDOWS_WINE_IMAGE, '-c',
            // Wine은 HOME 소유권을 검사하므로 실행 계정이 소유하는 새 디렉터리를 사용한다.
            'export HOME="$(mktemp -d /tmp/paseodog-wine.XXXXXX)" && exec "$@"', 'paseodog-windows',
            'node', join(root, 'android/node_modules/electron-builder/out/cli/cli.js'),
            ...builder.slice(2), '--win', 'nsis', '--x64', '--prepackaged', join(workspace, 'desktop/win-unpacked')],
    ];
}
