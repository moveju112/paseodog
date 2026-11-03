import { readFileSync } from 'node:fs';

// 1.4.1의 호스트 수정 위에 검토한 안정성 수정만 합친다. 버전·원본 해시 게이트는 유지한다.
const backports = JSON.parse(readFileSync(new URL('./mixdog-stability.json', import.meta.url), 'utf8'));
if (backports.version !== '1.4.1') throw new Error('Mixdog stability backport version mismatch');
export const STABILITY_BACKPORTS = backports.patches;
export const STABILITY_FILES = backports.files;

export function withStabilityBackports(hostPatches, backports = STABILITY_BACKPORTS) {
    const merged = new Map(hostPatches.map(spec => [spec.file, spec]));
    for (const backport of backports) {
        const host = merged.get(backport.file);
        if (!host) {
            merged.set(backport.file, backport);
            continue;
        }
        if (host.blob !== backport.blob) throw new Error(`Mixdog backport base mismatch: ${host.file}`);
        merged.set(host.file, {
            ...host,
            edits: [...host.edits, ...backport.edits],
            previousEditCounts: [...new Set([
                ...(host.previousEditCounts || [host.previousEditCount || 0]),
                host.edits.length,
            ])],
        });
    }
    return [...merged.values()];
}
