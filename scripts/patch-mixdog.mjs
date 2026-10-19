import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const PIN = '1.2.6';
export const ORIGINAL_BLOB = '6de5147ccdce6c9b3aa5f48dc740af439834b7b1';
export const ANCHOR = '      const turnContext = await dispatchPromptSubmit(turn, session0, prompt, options);';
export const ADDITION = '\n      // PaseoDog host-policy boundary v1 (local Apache-2.0 modification).\n      if (typeof options.beforeSessionAsk === \'function\') {\n        await options.beforeSessionAsk(session0);\n      }';
export const MARKER = 'PaseoDog host-policy boundary v1';
export const AGENT_PATCHES = [
    {
        file: 'src/session-runtime/boot/providers.mjs',
        blob: '34fc9fec9d09ac3b21d9a88b8e5468f3927992f3',
        edits: [[
            '    getRoute: () => rt.route,\n    cfgMod,\n    sharedCfgMod,',
            '    getRoute: () => rt.route,\n    cfgMod: boot.params.initialConfig ? { ...cfgMod, loadConfig: () => boot.params.initialConfig } : cfgMod,\n    sharedCfgMod,',
        ]],
    },
    {
        file: 'src/session-runtime/turn/turn-run/ask-callbacks.mjs',
        blob: '05b64099a27c0aae0e86be27ee493407661e3361',
        edits: [[
            '      beforeToolExecution: () => turn.snapshot.promise || Promise.resolve(),',
            '      hostManagedCompletions: options.hostManagedCompletions === true,\n      beforeToolExecution: () => turn.snapshot.promise || Promise.resolve(),',
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/session/manager/ask-session.mjs',
        blob: '40a774b8654fbb7ac7a658fc9020fc16cf9c75af',
        edits: [[
            '  const kickFollowUpAsk = () => {',
            '  const kickFollowUpAsk = () => {\n    if (askOpts.hostManagedCompletions === true) return;',
        ]],
    },
    {
        file: 'src/session-runtime/runtime-core.mjs',
        blob: '14ae394742a849f5cfd5bdc18123d9779ec6a7d3',
        edits: [
            ['  executeAgentControl = null,', '  agentSessionSurface = null,\n  executeAgentControl = null,'],
            ['    executeAgentControl,\n', '    agentSessionSurface,\n    executeAgentControl,\n'],
        ],
    },
    {
        file: 'src/session-runtime/boot/tools.mjs',
        blob: '704c7bcc84c8d6a52b0d13ea7412ba287d40b9fd',
        previousEditCount: 1,
        edits: [[
            '    // SubagentStart/SubagentStop: bridge internal worker spawn/finish to the',
            '    sessionSurface: params.agentSessionSurface?.({ mgr, getAgentTool: () => boot.routedAgentTool }),\n    // SubagentStart/SubagentStop: bridge internal worker spawn/finish to the',
        ], [
            '  const agentTool = createStandaloneAgent({\n    cfgMod,',
            '  const agentTool = createStandaloneAgent({\n    cfgMod: params.agentSessionSurface ? { ...cfgMod, loadConfig: () => rt.config } : cfgMod,',
        ]],
    },
];
// 정확한 원본 또는 정확한 패치 결과만 허용한다.
export function patchedAgentSource(text, spec) {
    let original = text;
    for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, before);
    if (gitBlob(original) !== spec.blob) throw new Error(`Mixdog source hash mismatch: ${spec.file}`);
    let result = original;
    for (const [before, after] of spec.edits) {
        if (result.split(before).length !== 2) throw new Error(`Mixdog patch anchor mismatch: ${spec.file}`);
        result = result.replace(before, after);
    }
    let previous = original;
    for (const [before, after] of spec.edits.slice(0, spec.previousEditCount || 0))
        previous = previous.replace(before, after);
    if (text !== original && text !== result && text !== previous)
        throw new Error(`Partial Mixdog patch: ${spec.file}`);
    return result;
}
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
    // 모든 원본을 먼저 검사해 미검토 파일이 있으면 쓰기 전에 중단한다.
    const changes = [
        { file: 'src/session-runtime/turn/turn-run.mjs', transform: patchedSource },
        ...AGENT_PATCHES.map((spec) => ({ file: spec.file, transform: (text) => patchedAgentSource(text, spec) })),
    ].map(({ file, transform }) => {
        const path = resolve(root, file);
        const before = readFileSync(path, 'utf8');
        return { path, before, after: transform(before) };
    });
    if (check && changes.some(({ before, after }) => before !== after))
        throw new Error('Required host-policy patch is missing; run npm --prefix engine run patch');
    for (const { path, before, after } of changes) {
        if (!check && before !== after) {
            const temp = path + '.paseodog-tmp';
            writeFileSync(temp, after); renameSync(temp, path);
        }
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
