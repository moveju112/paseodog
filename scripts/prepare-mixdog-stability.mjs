import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HOST_PATCHES, PIN, gitBlob, patchedAgentSource } from './patch-mixdog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../engine/node_modules/mixdog/package.json', import.meta.url));
const { structuredPatch } = require('diff');

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : [path];
    }).sort();
}

function editsBetween(before, after) {
    const fragment = (hunk, text, side) => {
        const lines = hunk.lines.filter(line => line[0] === ' ' || line[0] === (side === 'old' ? '-' : '+'));
        const total = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
        const atEnd = hunk[`${side}Start`] + hunk[`${side}Lines`] - 1 === total;
        return lines.map(line => line.slice(1)).join('\n') + (atEnd && !text.endsWith('\n') ? '' : '\n');
    };
    for (const context of [3, 20, Infinity]) {
        const edits = structuredPatch('before', 'after', before, after, '', '', { context }).hunks.map(hunk => [
            fragment(hunk, before, 'old'), fragment(hunk, after, 'new'),
        ]);
        let text = before;
        if (edits.some(([old, next]) => {
            if (text.split(old).length !== 2) return true;
            text = text.replace(old, () => next);
            return false;
        })) continue;
        if (text === after) return edits;
    }
    throw new Error('Cannot represent a backport with unique exact anchors');
}

// 입력은 고정 npm 원본과 검토한 이식 소스다. 생성물은 실행 코드 대신 정확한 텍스트 편집 데이터다.
export function prepareStabilityBackports({ sourceRoot, backportRoot, provenance }) {
    const version = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8')).version;
    if (version !== PIN) throw new Error(`Mixdog ${PIN} source required; found ${version}`);
    const hostByFile = new Map(HOST_PATCHES.map(spec => [spec.file, spec]));
    const patches = [], files = [];
    for (const path of sourceFiles(backportRoot)) {
        const file = relative(backportRoot, path).replaceAll('\\', '/');
        if (!/^src\/[\w./-]+\.(?:mjs|cjs)$/.test(file)) throw new Error(`Invalid backport path: ${file}`);
        const source = readFileSync(path, 'utf8');
        let original;
        try { original = readFileSync(join(sourceRoot, file), 'utf8'); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            files.push({ file, content: source, commits: provenance[file] });
            continue;
        }
        if (source === original) continue;
        const host = hostByFile.get(file);
        const before = host ? patchedAgentSource(original, host) : original;
        let after = source;
        for (const [old, next] of host?.edits || []) {
            if (after.split(old).length !== 2) throw new Error(`Host/backport conflict: ${file}`);
            after = after.replace(old, () => next);
        }
        let edits;
        try { edits = editsBetween(before, after); }
        catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
        patches.push({ file, blob: gitBlob(original), patchedBlob: gitBlob(after),
            commits: provenance[file], edits });
    }
    return { version, patches, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: {
            'source-root': { type: 'string' }, 'backport-root': { type: 'string' },
            provenance: { type: 'string' },
        } });
        const result = prepareStabilityBackports({
            sourceRoot: resolve(values['source-root']), backportRoot: resolve(values['backport-root']),
            provenance: JSON.parse(readFileSync(values.provenance, 'utf8')),
        });
        writeFileSync(join(root, 'patches/mixdog-stability.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify({ version: result.version, patched: result.patches.length, added: result.files.length }));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
