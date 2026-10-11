#!/usr/bin/env node
/**
 * Opt-in source patch for upstream Paseo Android native terminal input.
 * This DOES NOT modify a Play Store APK and must be applied in a separate
 * checkout of getpaseo/paseo at the audited revision.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE_GIT_SHA = '4eea8a1da313e7348b06357ad007dd1557ebd732';
export const UPSTREAM_PATH = 'packages/app/src/terminal/native-renderer/terminal-input.native.tsx';
export const PATCH_MARKER = 'PASEODOG_ANDROID_TERMINAL_FIX_V1';

function replaceExactlyOnce(source, before, after, label) {
    const at = source.indexOf(before);
    if (at < 0 || source.indexOf(before, at + before.length) !== -1) {
        throw new Error(`Paseo terminal upstream mismatch at ${label}; refusing partial patch`);
    }
    return source.slice(0, at) + after + source.slice(at + before.length);
}

export function gitBlobSha(content) {
    const bytes = Buffer.from(content);
    return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export function patchPaseoTerminalInput(source, { allowFixture = false } = {}) {
    if (source.includes(PATCH_MARKER)) return { status: 'already-patched', content: source };
    if (!allowFixture && gitBlobSha(source) !== BASELINE_GIT_SHA) {
        throw new Error(`Paseo input source is not the audited upstream blob ${BASELINE_GIT_SHA}; inspect its changes before porting the patch`);
    }
    let output = source;
    output = replaceExactlyOnce(output,
        '  let replacementDesynced = false;\n',
        `  let replacementDesynced = false;\n`+
        `  // ${PATCH_MARKER}: reconcile Android IMEs that deliver onChangeText\n`+
        `  // before onKeyPress. Each edit is emitted exactly once, regardless\n`+
        `  // of which callback arrives first. Do not log typed credentials.\n`+
        `  let textFirstPrintable: string | null = null;\n`+
        `  let textFirstBackspaces = 0;\n`, 'state fields');
    output = replaceExactlyOnce(output,
        `      if (terminalKey) {\n        return { data: "", key: terminalKey, shouldClear: false };\n      }`,
        `      if (terminalKey) {\n        textFirstPrintable = null;\n        textFirstBackspaces = 0;\n        return { data: "", key: terminalKey, shouldClear: false };\n      }`, 'control key');
    output = replaceExactlyOnce(output,
        `      if (key === "Backspace") {\n        previousText = Array.from(previousText).slice(0, -1).join("");\n        if (replacementDesynced) {\n          return { data: "", shouldClear: false };\n        }\n        return { data: "\\x7f", shouldClear: false };\n      }`,
        `      if (key === "Backspace") {\n        textFirstPrintable = null;\n        if (textFirstBackspaces > 0) {\n          // The preceding onChangeText already forwarded this deletion.\n          textFirstBackspaces -= 1;\n          return { data: "", shouldClear: false };\n        }\n        previousText = Array.from(previousText).slice(0, -1).join("");\n        if (replacementDesynced) {\n          return { data: "", shouldClear: false };\n        }\n        return { data: "\\x7f", shouldClear: false };\n      }`, 'backspace key');
    output = replaceExactlyOnce(output,
        `      if (isPrintableKey(key)) {\n        previousText += key;\n        return { data: key, shouldClear: false };\n      }\n      return { data: "", shouldClear: false };`,
        `      if (isPrintableKey(key)) {\n        if (textFirstPrintable === key) {\n          // Samsung Keyboard can report the committed character via\n          // onChangeText first. Never send it again via onKeyPress.\n          textFirstPrintable = null;\n          return { data: "", shouldClear: false };\n        }\n        textFirstPrintable = null;\n        textFirstBackspaces = 0;\n        previousText += key;\n        return { data: key, shouldClear: false };\n      }\n      textFirstPrintable = null;\n      textFirstBackspaces = 0;\n      return { data: "", shouldClear: false };`, 'printable key');
    output = replaceExactlyOnce(output,
        `      if (text.length === 0) {\n        previousText = "";\n        return { data: "", shouldClear: false };\n      }`,
        `      if (text.length === 0) {\n        const removed = Array.from(previousText).length;\n        previousText = "";\n        textFirstPrintable = null;\n        if (removed && !replacementDesynced) {\n          textFirstBackspaces = removed;\n          return { data: "\\x7f".repeat(removed), shouldClear: false };\n        }\n        textFirstBackspaces = 0;\n        return { data: "", shouldClear: false };\n      }`, 'empty text');
    output = replaceExactlyOnce(output,
        `      if (text.includes("\\n") || text.includes("\\r")) {\n        previousText = "";\n        replacementDesynced = false;\n        return { data: "", shouldClear: true };\n      }`,
        `      if (text.includes("\\n") || text.includes("\\r")) {\n        previousText = "";\n        replacementDesynced = false;\n        textFirstPrintable = null;\n        textFirstBackspaces = 0;\n        return { data: "", shouldClear: true };\n      }`, 'multiline text');
    output = replaceExactlyOnce(output,
        `      if (!text.startsWith(previousText)) {\n        let compositionEdit = "";`,
        `      if (!text.startsWith(previousText)) {\n        if (!replacementDesynced && previousText.startsWith(text)) {\n          // A trailing deletion can precede the native Backspace event.\n          // Code-point lengths avoid double-rubout of surrogate pairs.\n          const removed = Array.from(previousText.slice(text.length)).length;\n          previousText = text;\n          textFirstPrintable = null;\n          textFirstBackspaces = removed;\n          return { data: "\\x7f".repeat(removed), shouldClear: false };\n        }\n        textFirstPrintable = null;\n        textFirstBackspaces = 0;\n        let compositionEdit = "";`, 'text-first trailing deletion');
    output = replaceExactlyOnce(output,
        `      const appendedText = text.slice(previousText.length);\n      previousText = text;\n      return {\n        data: appendedText,`,
        `      const appendedText = text.slice(previousText.length);\n      previousText = text;\n      // Only suppress ONE late matching ASCII keypress. Normal key-first\n      // keyboards still get their immediate key fallback without duplication.\n      textFirstPrintable = isPrintableKey(appendedText) ? appendedText : null;\n      textFirstBackspaces = 0;\n      return {\n        data: appendedText,`, 'text-first printable');
    output = replaceExactlyOnce(output,
        `    reset(): void {\n      previousText = "";\n      replacementDesynced = false;\n    },`,
        `    reset(): void {\n      previousText = "";\n      replacementDesynced = false;\n      textFirstPrintable = null;\n      textFirstBackspaces = 0;\n    },`, 'reset');
    return { status: 'patched', content: output };
}

async function main(argv) {
    if (argv.length !== 2 || !['--check', '--apply'].includes(argv[0])) {
        throw new Error('Usage: node scripts/patch-paseo-android.mjs --check|--apply /path/to/getpaseo/paseo');
    }
    const filename = join(resolve(argv[1]), UPSTREAM_PATH);
    const content = await readFile(filename, 'utf8');
    const next = patchPaseoTerminalInput(content);
    if (argv[0] === '--apply' && next.status === 'patched') {
        await writeFile(filename, next.content, 'utf8');
    }
    process.stdout.write(`${next.status}: ${filename}\n`);
}
const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
