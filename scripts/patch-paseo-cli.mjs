#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// upstream Paseo PR #6607:ACK 대기와 오류 매핑만 0.11.4 배포 JS에 이식.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CLI_VERSION = '0.11.4';
export const CLI_ROOT = fileURLToPath(new URL('../tools/node_modules/@getpaseo/cli/', import.meta.url));
export const ORIGINAL_HASHES = {
    allow: '91e40335e58f1de0e3f4edbb0089eff43bdd4ccae726801a9ef970a6b718bfeb',
    deny: '5c2477a6b051c576ac06a88fb7921dd1248e2661c277e9d9a1d081e7c1b9e67b',
};

// 설치된 원본 호출 블록 -> upstream PR과 같은 ACK 대기·오류 블록.
export function responseEdit(command) {
    if (!Object.hasOwn(ORIGINAL_HASHES, command)) throw new Error('Unknown permit command');
    const options = command === 'allow'
        ? '                ...(updatedInput ? { updatedInput } : {}),\n'
        : '                ...(options.message ? { message: options.message } : {}),\n                ...(options.interrupt ? { interrupt: true } : {}),\n';
    const before = '            await client.respondToPermission(resolvedAgentId, permission.id, {\n'
        + `                behavior: "${command}",\n` + options + '            });\n';
    const call = before.replace('respondToPermission(', 'respondToPermissionAndWait(');
    const after = '            try {\n'
        + call.split('\n').filter(Boolean).map(line => '    ' + line).join('\n') + '\n'
        + '            }\n'
        + '            catch (err) {\n'
        + '                const message = err instanceof Error ? err.message : String(err);\n'
        + '                const error = {\n'
        + '                    code: "PERMISSION_RESPONSE_UNCONFIRMED",\n'
        + '                    message: `Permission response unconfirmed for request ${permission.id}: ${message}`,\n'
        + '                    details: \'Use "paseo permit ls" to check whether the request is still pending\',\n'
        + '                };\n'
        + '                throw error;\n'
        + '            }\n';
    return { before, after };
}

// 전체 바이트 해시 -> 정확한 원본 또는 정확한 패치본만 허용.
export function patchPermitSource(source, command) {
    const { before, after } = responseEdit(command);
    const originalHash = ORIGINAL_HASHES[command];
    const hash = value => createHash('sha256').update(value).digest('hex');
    if (hash(source) === originalHash) {
        if (source.split(before).length !== 2) throw new Error(`Missing unique ${command} patch anchor`);
        return source.replace(before, after);
    }
    if (source.split(after).length === 2 && hash(source.replace(after, before)) === originalHash) {
        return source;
    }
    throw new Error(`Paseo CLI ${command} source drift; expected audited SHA-256 ${originalHash}`);
}

// 버전·두 파일 모두 검증 -> 적용 또는 패치 설치 상태 확인.
export async function patchInstalledCli(mode, root = CLI_ROOT) {
    if (!['--apply', '--check'].includes(mode)) throw new Error('Expected --apply or --check');
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (manifest.name !== '@getpaseo/cli' || manifest.version !== CLI_VERSION) {
        throw new Error(`Expected @getpaseo/cli ${CLI_VERSION}; refusing version drift`);
    }
    const files = await Promise.all(Object.keys(ORIGINAL_HASHES).map(async command => {
        const filename = join(root, 'dist/commands/permit', `${command}.js`);
        const source = await readFile(filename, 'utf8');
        return { filename, source, patched: patchPermitSource(source, command) };
    }));
    if (mode === '--check' && files.some(file => file.source !== file.patched)) {
        throw new Error('Paseo CLI ACK patch is not installed');
    }
    if (mode === '--apply') {
        for (const file of files) {
            if (file.source !== file.patched) await writeFile(file.filename, file.patched, 'utf8');
        }
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
        console.error('Usage: node scripts/patch-paseo-cli.mjs --apply|--check');
        process.exitCode = 1;
    } else {
        patchInstalledCli(args[0]).then(
            () => console.log(`Paseo CLI ${CLI_VERSION}: ${args[0]} ACK patch verified`),
            error => { console.error(error.message); process.exitCode = 1; },
        );
    }
}
