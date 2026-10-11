import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const PIN = '1.0.12';
export const ORIGINAL_BLOB = '25339f8b798855011f30b5d51c5476602723f303';
export const ANCHOR = '      const turnContext = await dispatchPromptSubmit(turn, session0, prompt, options);';
export const ADDITION = '\n      // PaseoDog host-policy boundary v1 (local Apache-2.0 modification).\n      if (typeof options.beforeSessionAsk === \'function\') {\n        await options.beforeSessionAsk(session0);\n      }';
export const MARKER = 'PaseoDog host-policy boundary v1';
export function gitBlob(text) { const b = Buffer.from(text); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); }
export function patchedSource(text, expectedBlob = ORIGINAL_BLOB) {
    const original = text.includes(MARKER) ? text.replace(ADDITION, '') : text;
    if (gitBlob(original) !== expectedBlob) throw new Error('Mixdog source hash mismatch; refusing an unreviewed patch');
    if (original.split(ANCHOR).length !== 2) throw new Error('Mixdog patch anchor mismatch');
    return original.replace(ANCHOR, ANCHOR + ADDITION);
}
export function patch(root, { check = false } = {}) {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    if (manifest.version !== PIN) throw new Error(`Mixdog ${PIN} required; found ${manifest.version}`);
    const file = resolve(root, 'src/session-runtime/turn/turn-run.mjs');
    const before = readFileSync(file, 'utf8');
    const after = patchedSource(before);
    if (check && before !== after) throw new Error('Required host-policy patch is missing; run npm --prefix engine run patch');
    if (!check && before !== after) {
        const temp = file + '.paseodog-tmp';
        writeFileSync(temp, after); renameSync(temp, file);
    }
    return { version: manifest.version, patched: true, originalBlob: ORIGINAL_BLOB };
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    try {
        const root = resolve(dirname(self), '../engine/node_modules/mixdog');
        console.log(JSON.stringify(patch(root, { check: process.argv.includes('--check') })));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
