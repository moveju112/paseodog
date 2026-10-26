import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { writeJsonAtomicSync, withFileLockSync } from 'mixdog/src/runtime/shared/atomic-file.mjs';
import { readHookDocument, updateHookRules } from 'mixdog/src/session-runtime/services/hook-bus/rule-file.mjs';
import { normalizeRules } from 'mixdog/src/session-runtime/services/hook-bus/config.mjs';
import { summarizeRule } from 'mixdog/src/session-runtime/services/hook-bus/rules.mjs';

const events = ['PreToolUse', 'PostToolUse', 'Stop'];

// 네이티브가 이미 읽는 두 파일을 분리해 표준 훅 추가가 기존 deny/block 규칙을 가리지 않게 한다.
function load(status) {
    if (!status?.rulesPath) return null;
    if (process.env.MIXDOG_HOOKS_FILE)
        throw new Error('MIXDOG_HOOKS_FILE 재정의 중에는 앱에서 훅을 편집할 수 없어요.');
    const path = join(dirname(status.rulesPath), 'hooks', 'hooks.json');
    // 설정 조회·편집은 손상본을 복구하거나 옮기지 않고 그대로 보존한다.
    const readOptions = { restore: false, onDamaged(error) { throw error; } };
    const legacy = readHookDocument(status.rulesPath, readOptions);
    const document = readHookDocument(path, readOptions) ?? { hooks: {} };
    if (!document || typeof document !== 'object' || Array.isArray(document)
        || normalizeRules(document).length || !document.hooks
        || typeof document.hooks !== 'object' || Array.isArray(document.hooks))
        throw new Error('표준 훅 파일 형식을 확인해 주세요. 기존 규칙은 변경하지 않았어요.');
    const revision = createHash('sha256').update(JSON.stringify([legacy, document])).digest('hex').slice(0, 24);
    const rows = normalizeRules(legacy).map((rule, index) => {
        const value = summarizeRule(rule, index);
        return {
            legacyIndex: index, event: `도구 정책 · ${value.action}`,
            matcher: String(value.tool), command: JSON.stringify({
                reason: value.reason, match: value.match, cwd: value.cwd, patch: value.patch,
            }), enabled: value.enabled,
        };
    });
    for (const [event, groups] of Object.entries(document.hooks)) {
        if (!Array.isArray(groups)) throw new Error('잘못된 훅 이벤트 형식이에요.');
        for (const [groupIndex, group] of groups.entries()) {
            if (!group || !Array.isArray(group.hooks)) throw new Error('잘못된 훅 그룹 형식이에요.');
            for (const field of ['hooks', 'paseodogDisabledHooks']) {
                for (const [handlerIndex, handler] of (group[field] || []).entries()) {
                    if (handler?.type !== 'command') continue;
                    rows.push({
                        event, groupIndex, field, handlerIndex,
                        matcher: group.matcher || '', command: String(handler.command || ''),
                        enabled: field === 'hooks',
                    });
                }
            }
        }
    }
    return { path, document, revision, rows };
}

export function readHookSettings(status) {
    const state = load(status);
    return {
        rules: (state?.rows || []).map(({ event, matcher, command, enabled }, index) => ({
            index, event, matcher, command, enabled, revision: state.revision,
        })),
    };
}

// 수정은 파일 잠금 안에서 조회 시점의 revision을 확인한다. 인덱스가 밀렸으면 다른 규칙을 건드리지 않는다.
export function changeHookSettings(status, request) {
    const state = load(status);
    if (!state) throw new Error('이 호스트는 훅 설정을 지원하지 않아요.');
    const assertRevision = (current) => {
        if (!request.hookRevision || request.hookRevision !== current.revision)
            throw new Error('훅 설정이 변경됐어요. 새로고침한 뒤 다시 선택해 주세요.');
    };
    const row = state.rows[request.hookIndex];
    if (request.hookAction !== 'add') {
        assertRevision(state);
        if (!row) throw new Error('훅 규칙을 찾지 못했어요.');
        if (!['toggle', 'delete'].includes(request.hookAction)) throw new Error('지원하지 않는 훅 작업이에요.');
        if (request.hookAction === 'toggle' && typeof request.enabled !== 'boolean')
            throw new Error('훅 활성화 값이 필요해요.');
    }
    if (row?.legacyIndex !== undefined && request.hookAction !== 'add') {
        return updateHookRules(status.rulesPath, (rules) => {
            assertRevision(load(status));
            if (request.hookAction === 'delete') return rules.filter((_, index) => index !== row.legacyIndex);
            return rules.map((rule, index) => index === row.legacyIndex ? { ...rule, enabled: request.enabled } : rule);
        });
    }
    return withFileLockSync(`${state.path}.lock`, () => {
        const current = load(status);
        const { document } = current;
        if (request.hookAction === 'add') {
            const rule = request.hookRule;
            if (!events.includes(rule?.event) || typeof rule.command !== 'string' || !rule.command.trim()
                || rule.command.length > 2048 || (rule.matcher !== undefined
                    && (typeof rule.matcher !== 'string' || rule.matcher.length > 256)))
                throw new Error('훅 이벤트·명령어·패턴을 확인해 주세요.');
            const group = { matcher: rule.event === 'Stop' ? '' : rule.matcher || '', hooks: [],
                paseodogDisabledHooks: [{ type: 'command', command: rule.command.trim() }] };
            (document.hooks[rule.event] ??= []).push(group);
        } else {
            assertRevision(current);
            const selected = current.rows[request.hookIndex];
            const group = document.hooks[selected.event][selected.groupIndex];
            const [handler] = group[selected.field].splice(selected.handlerIndex, 1);
            if (request.hookAction === 'toggle') {
                const field = request.enabled ? 'hooks' : 'paseodogDisabledHooks';
                (group[field] ??= []).push(handler);
            }
        }
        writeJsonAtomicSync(state.path, document, { lock: false });
    });
}
