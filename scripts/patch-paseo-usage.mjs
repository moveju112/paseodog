import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';

// 내장 Claude 사용량은 Mixdog로 대체하고 사용하지 않는 Copilot 사용량 카드는 제외한다.
export function patchPaseoUsage(root, { check = false } = {}) {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    if (manifest.version !== '0.11.4') throw new Error('Paseo 0.11.4 required');
    const path = resolve(root, 'dist/server/server/plugins/builtin/index.js');
    const before = readFileSync(path, 'utf8');
    const anchor = '    "claude-usage-source",';
    const replacement = '    // PaseoDog: Claude usage is owned by Mixdog.';
    const copilotAnchor = '    "copilot-usage-source",';
    const copilotReplacement = '    // PaseoDog: Copilot usage card is disabled.';
    const original = before.replace(replacement, anchor).replace(copilotReplacement, copilotAnchor);
    if (gitBlob(original) !== PASEO_USAGE_BLOB) throw new Error('Paseo usage source hash mismatch');
    const after = original.replace(anchor, replacement).replace(copilotAnchor, copilotReplacement);
    if (check && before !== after) throw new Error('Mixdog usage source patch is missing');
    if (!check && before !== after) writeFileSync(path, after);
}

export const PASEO_USAGE_BLOB = 'd94adc58d404341bbc622f71920779a652efd2dc';
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    patchPaseoUsage(resolve(dirname(self), '../tools/node_modules/@getpaseo/server'), {
        check: process.argv.includes('--check'),
    });
}
