import { open, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { plainObject } from './util.mjs';

// 원본 Claude Code·Codex 설정 읽기 전용 뷰어. 파일 쓰기·훅 실행·동기화는 하지 않는다.
// 지원 경로·형식 근거: Claude Code 문서(skills, hooks, settings, managed-settings),
// Codex 문서(hooks, skills)와 codex-rs hooks/src/engine/discovery.rs, ext/skills/src/host_roots.rs.

const LIMITS = Object.freeze({
    skills: 300, skillBytes: 256 * 1024, bodyChars: 8000, bodyBudget: 600000,
    descriptionChars: 2000, hooks: 300, textChars: 4000, configBytes: 1024 * 1024,
    dirEntries: 2000, scannedDirs: 2000, codexDepth: 6,
});
const CODEX_EVENTS = new Set([
    'PreModelRequest', 'PostModelRequest', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact',
    'PostCompact', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt',
]);
const CLAUDE_OVERRIDE_STATES = {
    on: '켜짐', 'name-only': '이름만 노출', 'user-invocable-only': '사용자 호출 전용', off: '꺼짐',
};
const NOT_APPLIED = '원본 설정 보기 전용입니다. PaseoDog 세션에는 적용되지 않으며 편집·실행·동기화하지 않습니다.';
const SECRET_NAME = '(?:api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|secret|token|password|passwd|credential|authorization|auth[_-]?token|cookie|session[_-]?id)';
const SECRET_PATTERNS = [
    [/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g, '***'],
    [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:'"]+(?::[^\s/@'"]*)?@/gi, '$1***@'],
    [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/g, '$1 ***'],
    [new RegExp(`([?&][a-z0-9_.-]*${SECRET_NAME}[a-z0-9_.-]*=)[^&#\\s"']+`, 'gi'), '$1***'],
    [new RegExp(`(--?[a-z0-9-]*${SECRET_NAME}[a-z0-9-]*)(=|\\s+)("[^"\\n]*"|'[^'\\n]*'|[^\\s"';&|]+)`, 'gi'), '$1$2***'],
    [/\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g, '***'],
];
const SECRET_ASSIGNMENT = new RegExp(`(\\b[A-Za-z0-9_-]*${SECRET_NAME}[A-Za-z0-9_-]*["']?\\s*[:=]\\s*)("[^"\\n]*"|'[^'\\n]*'|[^\\s,;&|}]+)`, 'gi');

// 비밀값 가림 (토큰·키·비밀번호·URL 자격 증명 -> ***, 환경변수 참조는 유지)
export function maskSecrets(value) {
    let text = String(value ?? '');
    for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
    return text.replace(SECRET_ASSIGNMENT, (match, key, raw) => {
        const inner = raw.replace(/^["']|["']$/g, '');
        if (!inner || inner === '***' || /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(inner) || /^<[^>]*>$/.test(inner)
            || /^(true|false|null)$/i.test(inner)) return match;
        return `${key}***`;
    });
}

// 길이 제한 + 비밀값 가림 (원문 -> 표시용 문자열, 잘림 여부)
function clip(value, max = LIMITS.textChars) {
    const text = maskSecrets(value);
    return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

// 홈 경로를 ~로 줄여 표시 (절대 경로 -> 표시 경로)
function displayPath(path, home) {
    const absolute = resolve(path);
    if (home && (absolute === home || absolute.startsWith(home + sep))) return `~${absolute.slice(home.length)}`;
    return absolute;
}

// 크기 제한 읽기 (파일 경로 -> 상태·본문, 읽기 전용 열기)
async function readTextBounded(path, maxBytes, allowTruncate = false) {
    let info;
    try { info = await stat(path); } catch (error) {
        return { status: ['ENOENT', 'ENOTDIR'].includes(error?.code) ? 'missing' : 'unreadable' };
    }
    if (!info.isFile()) return { status: 'not-file' };
    if (info.size > maxBytes && !allowTruncate) return { status: 'too-large' };
    let handle;
    try {
        handle = await open(path, 'r');
        const buffer = Buffer.alloc(Math.min(info.size, maxBytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return { status: 'ok', text: buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, ''), truncated: info.size > maxBytes };
    } catch { return { status: 'unreadable' }; }
    finally { await handle?.close().catch(() => {}); }
}

// 내용 노출 없는 JSON 해석 (텍스트 -> 값 또는 줄 번호만 담은 오류)
function parseJsonSafe(text) {
    try { return { value: JSON.parse(text) }; } catch (error) {
        const position = /position (\d+)/.exec(String(error?.message))?.[1];
        const line = position === undefined ? 0 : text.slice(0, Number(position)).split('\n').length;
        return { error: line ? `JSON 형식 오류 (${line}행)` : 'JSON 형식 오류' };
    }
}

// TOML 문서 해석 (텍스트 -> 객체, 오류는 값 없이 줄 번호만 보고)
export function parseToml(text) {
    const source = String(text).replace(/^\uFEFF/, '');
    const length = source.length;
    const root = Object.create(null);
    let index = 0, line = 1, table = root;
    const fail = (reason) => { throw new Error(`TOML ${line}행: ${reason}`); };
    const peek = (offset = 0) => source[index + offset];
    const skipSpace = () => { while (peek() === ' ' || peek() === '\t') index++; };
    const skipComment = () => { if (peek() === '#') while (index < length && peek() !== '\n') index++; };
    const newline = () => {
        if (peek() === '\r' && peek(1) === '\n') index++;
        if (peek() !== '\n') return false;
        index++; line++;
        return true;
    };
    const skipBlank = () => { for (;;) { skipSpace(); skipComment(); if (!newline()) return; } };
    const endOfLine = () => { skipSpace(); skipComment(); if (index < length && !newline()) fail('줄 끝 형식 오류'); };
    const isTable = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const escapes = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
    function escape() {
        const code = source[index++];
        if (code in escapes) return escapes[code];
        const size = { x: 2, u: 4, U: 8 }[code];
        const hex = size ? source.slice(index, index + size) : '';
        if (!size || hex.length !== size || !/^[0-9a-fA-F]+$/.test(hex)) fail('이스케이프 형식 오류');
        index += size;
        return String.fromCodePoint(parseInt(hex, 16));
    }
    function string() {
        const quote = peek();
        const multi = source.startsWith(quote.repeat(3), index);
        index += multi ? 3 : 1;
        if (multi) newline();
        let out = '';
        for (;;) {
            if (index >= length) fail('닫히지 않은 문자열');
            const char = peek();
            if (multi && source.startsWith(quote.repeat(3), index)) {
                let run = 3;
                while (run < 5 && peek(run) === quote) run++;
                out += quote.repeat(run - 3);
                index += run;
                return out;
            }
            if (!multi && char === quote) { index++; return out; }
            if (char === '\n' || (char === '\r' && peek(1) === '\n')) {
                if (!multi) fail('문자열 줄바꿈');
                newline(); out += '\n';
                continue;
            }
            if (quote === '"' && char === '\\') {
                index++;
                if (multi && /^[ \t]*\r?\n/.test(source.slice(index, index + 64))) {
                    for (;;) { skipSpace(); if (!newline()) break; }
                    continue;
                }
                out += escape();
                continue;
            }
            out += char; index++;
        }
    }
    function keyPart() {
        skipSpace();
        if (peek() === '"' || peek() === "'") return string();
        const start = index;
        while (index < length && /[A-Za-z0-9_-]/.test(peek())) index++;
        if (start === index) fail('키 형식 오류');
        return source.slice(start, index);
    }
    function key() {
        const parts = [keyPart()];
        skipSpace();
        while (peek() === '.') { index++; parts.push(keyPart()); skipSpace(); }
        return parts;
    }
    function assign(target, keys, value) {
        let node = target;
        for (const part of keys.slice(0, -1)) {
            if (node[part] === undefined) node[part] = Object.create(null);
            node = Array.isArray(node[part]) ? node[part].at(-1) : node[part];
            if (!isTable(node)) fail('키 충돌');
        }
        const last = keys.at(-1);
        if (Object.hasOwn(node, last)) fail('중복 키');
        node[last] = value;
    }
    function value() {
        skipSpace();
        const char = peek();
        if (char === '"' || char === "'") return string();
        if (char === '[') {
            index++;
            const list = [];
            for (;;) {
                skipBlank();
                if (peek() === ']') { index++; return list; }
                list.push(value());
                skipBlank();
                if (peek() === ',') { index++; continue; }
                if (peek() === ']') { index++; return list; }
                fail('배열 형식 오류');
            }
        }
        if (char === '{') {
            index++;
            const object = Object.create(null);
            skipSpace();
            if (peek() === '}') { index++; return object; }
            for (;;) {
                const keys = key();
                if (peek() !== '=') fail('인라인 테이블 형식 오류');
                index++;
                assign(object, keys, value());
                skipSpace();
                if (peek() === ',') { index++; continue; }
                if (peek() === '}') { index++; return object; }
                fail('인라인 테이블 형식 오류');
            }
        }
        const start = index;
        while (index < length && !/[\s,\]}#]/.test(peek())) index++;
        const token = source.slice(start, index);
        const number = token.replace(/_/g, '');
        if (token === 'true' || token === 'false') return token === 'true';
        if (/^[+-]?(\d+|0x[0-9a-f]+|0o[0-7]+|0b[01]+)$/i.test(number)) return Number(number);
        if (/^[+-]?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(number)) return Number(number);
        if (/^[+-]?(inf|nan)$/.test(token)) return token.endsWith('nan') ? NaN : (token.startsWith('-') ? -Infinity : Infinity);
        if (/^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/.test(token)) return token;
        return fail('값 형식 오류');
    }
    function descend(keys, arrayTable) {
        let node = root;
        keys.forEach((part, position) => {
            if (arrayTable && position === keys.length - 1) {
                if (node[part] === undefined) node[part] = [];
                if (!Array.isArray(node[part])) fail('배열 테이블 충돌');
                const item = Object.create(null);
                node[part].push(item);
                node = item;
                return;
            }
            if (node[part] === undefined) node[part] = Object.create(null);
            node = Array.isArray(node[part]) ? node[part].at(-1) : node[part];
            if (!isTable(node)) fail('테이블 충돌');
        });
        return node;
    }
    for (;;) {
        skipBlank();
        if (index >= length) return root;
        if (peek() === '[') {
            const arrayTable = peek(1) === '[';
            index += arrayTable ? 2 : 1;
            const keys = key();
            const close = arrayTable ? ']]' : ']';
            if (!source.startsWith(close, index)) fail('테이블 헤더 형식 오류');
            index += close.length;
            table = descend(keys, arrayTable);
            endOfLine();
            continue;
        }
        const keys = key();
        if (peek() !== '=') fail('= 누락');
        index++;
        assign(table, keys, value());
        endOfLine();
    }
}

// TOML 파일 읽기 (경로 -> 상태·객체, 해석 실패 시 줄 번호만)
async function readToml(path) {
    const file = await readTextBounded(path, LIMITS.configBytes);
    if (file.status !== 'ok') return { status: file.status };
    try { return { status: 'ok', value: parseToml(file.text) }; } catch (error) {
        return { status: 'malformed', error: String(error?.message || 'TOML 형식 오류') };
    }
}

// JSON 파일 읽기 (경로 -> 상태·객체, 해석 실패 시 줄 번호만)
async function readJson(path) {
    const file = await readTextBounded(path, LIMITS.configBytes);
    if (file.status !== 'ok') return { status: file.status };
    const parsed = parseJsonSafe(file.text);
    return parsed.error ? { status: 'malformed', error: parsed.error } : { status: 'ok', value: parsed.value };
}

// SKILL.md 앞머리 해석 (YAML 최상위 스칼라 -> 필드, 나머지 본문)
export function parseFrontmatter(text) {
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    if (!match) return { fields: {}, body: text, hasFrontmatter: false };
    const fields = {};
    const lines = match[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        const entry = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[index]);
        if (!entry) continue;
        const raw = entry[2].replace(/\s+#.*$/, '').trim();
        const rest = [];
        while (index + 1 < lines.length && (/^[ \t]/.test(lines[index + 1]) || !lines[index + 1].trim())) rest.push(lines[++index]);
        while (rest.length && !rest.at(-1).trim()) rest.pop();
        const block = /^([|>])[+-]?\d*$/.exec(raw);
        let result;
        if (block) {
            const indent = Math.min(...rest.filter((row) => row.trim()).map((row) => /^[ \t]*/.exec(row)[0].length), 1000);
            const rows = rest.map((row) => row.slice(indent));
            result = block[1] === '|' ? rows.join('\n')
                : rows.reduce((out, row) => (!row ? `${out}\n` : out && !out.endsWith('\n') ? `${out} ${row}` : out + row), '');
        } else {
            const joined = [entry[2].trim(), ...rest.map((row) => row.trim())].filter(Boolean).join(' ');
            if (joined.startsWith('"')) {
                try { result = JSON.parse(joined); } catch { result = joined.replace(/^"|"$/g, ''); }
            } else if (joined.startsWith("'")) result = joined.replace(/^'|'$/g, '').replace(/''/g, "'");
            else result = [raw, ...rest.map((row) => row.trim())].filter(Boolean).join(' ');
        }
        fields[entry[1]] = String(result ?? '').trim();
    }
    return { fields, body: text.slice(match[0].length), hasFrontmatter: true };
}

// 스킬 루트 탐색 (루트 목록 -> 루트 상태·스킬 목록, 실제 경로 기준 중복 제거)
async function collectSkills(roots, { home, recursive, decorate }) {
    const items = [], seen = new Map(), visited = new Set(), rootRows = [];
    let truncated = false, bodyBudget = LIMITS.bodyBudget, scanned = 0;
    async function addSkill(file, folderName, root) {
        const real = await realpath(file).catch(() => resolve(file));
        if (seen.has(real)) {
            seen.get(real).aliases.push(displayPath(file, home));
            return 1;
        }
        if (items.length >= LIMITS.skills) { truncated = true; return 0; }
        const read = await readTextBounded(file, LIMITS.skillBytes, true);
        const parsed = read.status === 'ok' ? parseFrontmatter(read.text) : { fields: {}, body: '', hasFrontmatter: false };
        const description = clip(parsed.fields.description || '', LIMITS.descriptionChars);
        const allowed = Math.max(0, Math.min(LIMITS.bodyChars, bodyBudget));
        const body = clip(parsed.body.trim(), allowed);
        bodyBudget -= body.text.length;
        const item = {
            name: parsed.fields.name || '', folder: folderName, description: description.text,
            body: body.text, bodyTruncated: body.truncated || read.truncated === true,
            path: displayPath(file, home),
            ...(real !== resolve(file) ? { realPath: displayPath(real, home) } : {}),
            scope: root.scope, scopeLabel: root.label, aliases: [], issues: [],
            ...(read.status !== 'ok' ? { readStatus: read.status } : {}),
        };
        decorate(item, { fields: parsed.fields, hasFrontmatter: parsed.hasFrontmatter, file, real, readStatus: read.status });
        seen.set(real, item);
        items.push(item);
        return 1;
    }
    async function walk(directory, depth, root) {
        if (scanned++ >= LIMITS.scannedDirs) { truncated = true; return 0; }
        const real = await realpath(directory).catch(() => resolve(directory));
        if (visited.has(real)) return 0;
        visited.add(real);
        const entries = (await readdir(directory, { withFileTypes: true })).map((entry) => entry.name).sort();
        if (entries.length > LIMITS.dirEntries) truncated = true;
        let count = 0;
        for (const name of entries.slice(0, LIMITS.dirEntries)) {
            if (name.startsWith('.') || root.skip?.includes(name)) continue;
            const folder = join(directory, name);
            const info = await stat(folder).catch(() => null);
            if (!info?.isDirectory()) continue;
            const skillInfo = await stat(join(folder, 'SKILL.md')).catch(() => null);
            if (skillInfo?.isFile()) count += await addSkill(join(folder, 'SKILL.md'), name, root);
            else if (recursive && depth + 1 < LIMITS.codexDepth) count += await walk(folder, depth + 1, root).catch(() => 0);
        }
        return count;
    }
    for (const root of roots) {
        const row = { path: displayPath(root.path, home), scope: root.scope, label: root.label, status: 'ok', count: 0 };
        const info = await stat(root.path).catch((error) => ({ error }));
        if (info.error) row.status = ['ENOENT', 'ENOTDIR'].includes(info.error.code) ? 'missing' : 'unreadable';
        else if (!info.isDirectory()) row.status = 'not-directory';
        else {
            try { row.count = await walk(root.path, 0, root); } catch { row.status = 'unreadable'; }
        }
        rootRows.push(row);
    }
    return { roots: rootRows, items, truncated };
}

// 훅 핸들러 표시 필드 추출 (원본 핸들러 -> 가린 명령·URL·프롬프트)
function handlerFields(handler) {
    const out = { type: typeof handler.type === 'string' ? handler.type : '' };
    let truncated = false;
    for (const field of ['command', 'commandWindows', 'command_windows', 'url', 'prompt', 'statusMessage', 'server', 'tool', 'model']) {
        if (typeof handler[field] !== 'string') continue;
        const clipped = clip(handler[field]);
        out[field === 'command_windows' ? 'commandWindows' : field] = clipped.text;
        truncated ||= clipped.truncated;
    }
    if (typeof handler.timeout === 'number') out.timeout = handler.timeout;
    if (typeof handler.async === 'boolean') out.async = handler.async;
    if (plainObject(handler.headers)) out.headerCount = Object.keys(handler.headers).length;
    if (plainObject(handler.input)) out.inputKeys = Object.keys(handler.input).slice(0, 20);
    if (truncated) out.truncated = true;
    return out;
}

// Claude 훅 목록화 (settings.json hooks -> 규칙, 항목별 끄기 없음·설정 단위 상태)
function claudeHookRules(hooks, source, status, push) {
    const warnings = [];
    if (hooks === undefined) return warnings;
    if (!plainObject(hooks)) return ['hooks 값이 객체가 아님'];
    for (const [event, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) { warnings.push(`${event}: 배열이 아님`); continue; }
        groups.forEach((group, groupIndex) => {
            if (!plainObject(group) || !Array.isArray(group.hooks)) { warnings.push(`${event}[${groupIndex}]: hooks 배열 없음`); return; }
            group.hooks.forEach((handler, handlerIndex) => {
                if (!plainObject(handler)) { warnings.push(`${event}[${groupIndex}].hooks[${handlerIndex}]: 객체가 아님`); return; }
                push({
                    event, matcher: typeof group.matcher === 'string' ? maskSecrets(group.matcher) : '',
                    ...handlerFields(handler), source: source.path, scope: source.scope,
                    position: `${groupIndex}:${handlerIndex}`, ...status(source),
                });
            });
        });
    }
    return warnings;
}

// Codex 훅 파일 검증 (Codex 파서 규칙 -> 실패 사유, 실패 시 Codex는 파일 전체를 건너뜀)
function codexHooksError(events, topLevel) {
    if (topLevel) {
        const unknown = Object.keys(topLevel).filter((name) => !['description', 'hooks'].includes(name));
        if (unknown.length) return `알 수 없는 최상위 키(${unknown.join(', ')})`;
    }
    if (!plainObject(events)) return 'hooks 값이 객체가 아님';
    for (const [event, groups] of Object.entries(events)) {
        if (!CODEX_EVENTS.has(event)) continue;
        if (!Array.isArray(groups)) return `${event}: 배열이 아님`;
        for (const [groupIndex, group] of groups.entries()) {
            if (!plainObject(group)) return `${event}[${groupIndex}]: 객체가 아님`;
            if (group.matcher !== undefined && typeof group.matcher !== 'string') return `${event}[${groupIndex}]: matcher가 문자열이 아님`;
            if (group.hooks !== undefined && !Array.isArray(group.hooks)) return `${event}[${groupIndex}]: hooks가 배열이 아님`;
            for (const [handlerIndex, handler] of (group.hooks || []).entries()) {
                const where = `${event}[${groupIndex}].hooks[${handlerIndex}]`;
                if (!plainObject(handler) || !['command', 'mcp_tool', 'prompt', 'agent'].includes(handler.type)) return `${where}: 지원하지 않는 type`;
                if (handler.type === 'command' && typeof handler.command !== 'string') return `${where}: command 누락`;
                if (handler.type === 'mcp_tool' && (typeof handler.server !== 'string' || typeof handler.tool !== 'string')) return `${where}: server/tool 누락`;
            }
        }
    }
    return '';
}

// Codex 훅 목록화 (이벤트 표 -> 규칙, hooks.state 키는 경로:이벤트_스네이크:그룹:핸들러)
function codexHookRules(events, source, context, push) {
    for (const [event, groups] of Object.entries(events)) {
        if (!Array.isArray(groups)) continue;
        const label = event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
        groups.forEach((group, groupIndex) => (plainObject(group) && Array.isArray(group.hooks) ? group.hooks : []).forEach((handler, handlerIndex) => {
            if (!plainObject(handler)) return;
            const state = source.keys.map((keySource) => context.hookStates?.[`${keySource}:${label}:${groupIndex}:${handlerIndex}`])
                .find((value) => plainObject(value));
            const row = {
                event, matcher: typeof group.matcher === 'string' ? maskSecrets(group.matcher) : '',
                ...handlerFields(handler), source: source.path, scope: source.scope, position: `${groupIndex}:${handlerIndex}`,
            };
            if (!CODEX_EVENTS.has(event)) Object.assign(row, { enabled: false, state: 'Codex가 인식하지 않는 이벤트 (무시됨)' });
            else if (['prompt', 'agent'].includes(handler.type)) Object.assign(row, { enabled: false, state: 'Codex가 해석만 하고 실행하지 않는 유형' });
            else if (context.featureEnabled === false) Object.assign(row, { enabled: false, state: 'features.hooks = false (전체 꺼짐)' });
            else if (source.managed) Object.assign(row, { enabled: true, state: '관리 훅 (항상 켜짐)', trust: 'managed' });
            else if (context.configError) Object.assign(row, { enabled: null, state: 'config.toml 해석 실패로 상태 확인 불가' });
            else if (state?.enabled === false) Object.assign(row, { enabled: false, state: '꺼짐 (hooks.state)', trust: state.trusted_hash ? 'recorded' : 'none' });
            else Object.assign(row, {
                enabled: true,
                trust: typeof state?.trusted_hash === 'string' ? 'recorded' : 'none',
                state: typeof state?.trusted_hash === 'string' ? '켜짐 · 신뢰 기록 있음' : '켜짐 · 신뢰 기록 없음 (검토 전 실행 안 됨)',
            });
            push(row);
        }));
    }
}

// 훅 규칙 누적기 (상한 초과 시 잘림 표시)
function hookCollector() {
    const rules = [];
    let truncated = false;
    return {
        rules, get truncated() { return truncated; },
        push(rule) { if (rules.length >= LIMITS.hooks) truncated = true; else rules.push(rule); },
    };
}

// 환경 기준 경로 해석 (env·홈 -> Claude/Codex 설정 위치)
function locations(options) {
    const env = options.env || process.env;
    const home = resolve(options.home || homedir());
    const absoluteEnv = (name) => (typeof env[name] === 'string' && isAbsolute(env[name]) ? resolve(env[name]) : '');
    const platform = options.platform || process.platform;
    const claudeManagedDir = options.claudeManagedDir ?? ({
        linux: '/etc/claude-code', darwin: '/Library/Application Support/ClaudeCode', win32: 'C:\\Program Files\\ClaudeCode',
    }[platform] || '');
    const codexSystemDir = options.codexSystemDir ?? (platform === 'win32' ? '' : '/etc/codex');
    return {
        home, claudeDir: absoluteEnv('CLAUDE_CONFIG_DIR') || join(home, '.claude'),
        codexHome: absoluteEnv('CODEX_HOME') || join(home, '.codex'), claudeManagedDir, codexSystemDir,
    };
}

// 설정 파일 상태 행 (경로·읽기 결과 -> 표시용 상태)
function sourceRow(path, home, scope, label, read, extra = {}) {
    return { path: displayPath(path, home), scope, label, status: read.status, ...(read.error ? { error: read.error } : {}), ...extra };
}

// Claude Code 원본 설정 보기 (사용자·관리 설정 -> 스킬·훅 읽기 전용 목록)
async function readClaudeView(where) {
    const { home, claudeDir, claudeManagedDir } = where;
    const files = [];
    const userPath = join(claudeDir, 'settings.json');
    files.push({ path: userPath, scope: 'user', label: '사용자 설정', read: await readJson(userPath) });
    if (claudeManagedDir) {
        const dropIn = join(claudeManagedDir, 'managed-settings.d');
        const names = await readdir(dropIn).catch(() => []);
        for (const name of names.filter((item) => item.endsWith('.json') && !item.startsWith('.')).sort().slice(0, 50)) {
            files.push({ path: join(dropIn, name), scope: 'managed', label: '관리 설정 (drop-in)', read: await readJson(join(dropIn, name)) });
        }
        const managedPath = join(claudeManagedDir, 'managed-settings.json');
        files.push({ path: managedPath, scope: 'managed', label: '관리 설정', read: await readJson(managedPath) });
    }
    const valueOf = (file) => (file.read.status === 'ok' && plainObject(file.read.value) ? file.read.value : null);
    const managed = files.filter((file) => file.scope === 'managed').map(valueOf).filter(Boolean);
    const user = valueOf(files[0]);
    const managedDisableAll = managed.some((value) => value.disableAllHooks === true);
    const managedOnly = managed.some((value) => value.allowManagedHooksOnly === true);
    const userDisableAll = user?.disableAllHooks === true;
    const overrides = Object.assign({}, ...[user, ...managed].map((value) => (plainObject(value?.skillOverrides) ? value.skillOverrides : {})));

    const collector = hookCollector();
    const status = (source) => {
        if (managedDisableAll) return { enabled: false, state: '꺼짐 · 관리 설정 disableAllHooks' };
        if (source.scope === 'managed') return { enabled: true, state: '켜짐 (관리 설정)' };
        if (managedOnly) return { enabled: false, state: '꺼짐 · 관리 설정 allowManagedHooksOnly' };
        if (userDisableAll) return { enabled: false, state: '꺼짐 · disableAllHooks = true' };
        return { enabled: true, state: '켜짐' };
    };
    const sources = files.map((file) => {
        const value = valueOf(file);
        const read = file.read.status === 'ok' && !value ? { status: 'malformed', error: '최상위 값이 객체가 아님' } : file.read;
        const warnings = value ? claudeHookRules(value.hooks, { path: displayPath(file.path, home), scope: file.scope }, status, collector.push) : [];
        return sourceRow(file.path, home, file.scope, file.label, read, warnings.length ? { warnings: warnings.slice(0, 20) } : {});
    });
    const skills = await collectSkills([
        ...(claudeManagedDir ? [{ path: join(claudeManagedDir, '.claude', 'skills'), scope: 'enterprise', label: '관리(Enterprise)' }] : []),
        { path: join(claudeDir, 'skills'), scope: 'personal', label: '개인', skip: ['synced'] },
        { path: join(claudeDir, 'skills', 'synced'), scope: 'synced', label: 'claude.ai 동기화' },
    ], {
        home, recursive: false,
        decorate(item, { fields }) {
            if (!item.name) item.name = item.folder;
            const override = typeof overrides[item.name] === 'string' ? overrides[item.name] : 'on';
            item.enabled = override !== 'off';
            item.state = `${CLAUDE_OVERRIDE_STATES[override] || override}${override === 'on' ? '' : ' (skillOverrides)'}`;
            if (fields['disable-model-invocation'] === 'true') item.state += ' · 모델 자동 호출 끔';
            if (fields['user-invocable'] === 'false') item.state += ' · / 메뉴 숨김';
        },
    });
    return {
        skills,
        hooks: {
            supported: true, sources, rules: collector.rules, truncated: collector.truncated,
            globalState: managedDisableAll ? '관리 설정 disableAllHooks = true: 모든 훅 꺼짐'
                : userDisableAll ? '사용자 disableAllHooks = true: 사용자 훅 꺼짐 (관리 훅 제외)'
                    : managedOnly ? '관리 설정 allowManagedHooksOnly = true: 관리 훅만 실행' : '훅 사용 가능',
        },
        notes: [
            'Claude Code 훅은 항목별 켜기/끄기가 없고 disableAllHooks·allowManagedHooksOnly 설정 단위로만 꺼집니다.',
            '스킬 상태는 사용자·관리 설정의 skillOverrides와 SKILL.md 앞머리 기준입니다.',
            '관리 파일 여러 개의 우선순위를 완전히 재현하지 않습니다. 표시 상태는 읽은 설정 기준이며 Claude의 실제 적용 상태를 보장하지 않습니다.',
            '프로젝트(.claude/), settings.local.json, 플러그인, --add-dir, .claude/commands, 번들 스킬은 표시하지 않습니다.',
        ],
    };
}

// Codex 원본 설정 보기 (사용자·시스템 계층 -> 스킬·훅 읽기 전용 목록)
async function readCodexView(where) {
    const { home, codexHome, codexSystemDir } = where;
    const layers = [
        ...(codexSystemDir ? [{ dir: codexSystemDir, scope: 'system', label: '시스템', managed: true }] : []),
        { dir: codexHome, scope: 'user', label: '사용자', managed: false },
    ];
    for (const layer of layers) {
        layer.configPath = join(layer.dir, 'config.toml');
        layer.config = await readToml(layer.configPath);
    }
    const user = layers.at(-1).config;
    const tableOf = (layer, name) => (layer.config.status === 'ok' && plainObject(layer.config.value[name]) ? layer.config.value[name] : null);
    let featureEnabled = true;
    for (const layer of layers) {
        const features = tableOf(layer, 'features');
        const flag = typeof features?.hooks === 'boolean' ? features.hooks : features?.codex_hooks;
        if (typeof flag === 'boolean') featureEnabled = flag;
    }
    const hookStates = tableOf(layers.at(-1), 'hooks')?.state;
    const context = { featureEnabled, hookStates, configError: user.status === 'malformed' };
    const collector = hookCollector();
    const sources = [];
    for (const layer of layers) {
        const configRow = sourceRow(layer.configPath, home, layer.scope, `${layer.label} config.toml [hooks]`, layer.config);
        const jsonPath = join(layer.dir, 'hooks.json');
        const realDir = await realpath(layer.dir).catch(() => resolve(layer.dir));
        const keysFor = (name) => [...new Set([join(resolve(layer.dir), name), join(realDir, name)])];
        const json = await readJson(jsonPath);
        const jsonRow = sourceRow(jsonPath, home, layer.scope, `${layer.label} hooks.json`, json);
        let jsonEvents = null, inlineEvents = null;
        if (json.status === 'ok') {
            const error = plainObject(json.value) ? codexHooksError(json.value.hooks ?? {}, json.value) : '최상위 값이 객체가 아님';
            if (error) Object.assign(jsonRow, { status: 'malformed', error: `${error} — Codex가 이 파일을 불러오지 않음` });
            else jsonEvents = json.value.hooks ?? {};
        }
        const inline = tableOf(layer, 'hooks');
        if (inline) {
            const events = Object.fromEntries(Object.entries(inline).filter(([name]) => !['state', 'managed_dir', 'windows_managed_dir'].includes(name)));
            const error = codexHooksError(events);
            if (error) Object.assign(configRow, { status: 'malformed', error: `[hooks] ${error} — Codex가 인라인 훅을 불러오지 않음` });
            else if (Object.keys(events).length) inlineEvents = events;
        }
        if (jsonEvents && inlineEvents && Object.keys(jsonEvents).length) {
            jsonRow.warnings = ['같은 계층에 hooks.json과 인라인 [hooks]가 함께 있어 Codex가 병합하고 경고합니다.'];
        }
        for (const [events, row, name] of [[jsonEvents, jsonRow, 'hooks.json'], [inlineEvents, configRow, 'config.toml']]) {
            if (events) codexHookRules(events, { path: row.path, scope: layer.scope, managed: layer.managed, keys: keysFor(name) }, context, collector.push);
        }
        sources.push(jsonRow, configRow);
    }
    const skillConfig = Array.isArray(user.value?.skills?.config) ? user.value.skills.config : [];
    const disabledPaths = new Map();
    for (const entry of skillConfig) {
        if (!plainObject(entry) || typeof entry.path !== 'string' || typeof entry.enabled !== 'boolean') continue;
        const target = entry.path.startsWith('~/') ? join(home, entry.path.slice(2)) : resolve(entry.path);
        disabledPaths.set(target, entry.enabled);
        disabledPaths.set(await realpath(target).catch(() => target), entry.enabled);
    }
    const skills = await collectSkills([
        { path: join(home, '.agents', 'skills'), scope: 'user', label: '사용자 (~/.agents/skills)' },
        { path: join(codexHome, 'skills'), scope: 'user-legacy', label: '사용자 ($CODEX_HOME/skills, 호환용)' },
        { path: join(codexHome, 'skills', '.system'), scope: 'system', label: '시스템 (Codex 번들 캐시)' },
        ...(codexSystemDir ? [{ path: join(codexSystemDir, 'skills'), scope: 'admin', label: '관리자' }] : []),
    ], {
        home, recursive: true,
        decorate(item, { fields, file, real }) {
            const configured = disabledPaths.get(resolve(file)) ?? disabledPaths.get(real);
            if (!fields.name || !fields.description) {
                item.issues.push('앞머리 name/description 누락 — Codex가 로드하지 않음');
                Object.assign(item, { name: item.name || item.folder, enabled: false, state: '로드 안 됨' });
                return;
            }
            item.enabled = user.status === 'malformed' ? null : configured !== false;
            item.state = item.enabled === null ? 'config.toml 해석 실패로 상태 확인 불가'
                : configured === false ? '꺼짐 (skills.config)' : '켜짐';
        },
    });
    return {
        skills,
        hooks: {
            supported: true, sources, rules: collector.rules, truncated: collector.truncated,
            globalState: featureEnabled ? '훅 기능 켜짐 (features.hooks)' : 'features.hooks = false: 모든 훅 꺼짐',
        },
        notes: [
            'Codex 훅은 hooks.json과 config.toml 인라인 [hooks]를 읽고, 사용자 훅의 켜짐·신뢰 기록은 config.toml [hooks.state]를 따릅니다.',
            '신뢰 상태는 기록 유무만 표시합니다. 현재 정의와 해시 일치 여부는 Codex /hooks에서 확인하세요.',
            '이벤트 지원 여부는 참조한 Codex 소스 기준이며 설치 버전에 따라 다를 수 있습니다. 실제 실행 가능 여부를 확인하는 화면은 아닙니다.',
            '프로젝트(.agents/skills, .codex/), 플러그인, requirements.toml·MDM·클라우드 관리 훅은 표시하지 않습니다.',
        ],
    };
}

// 원본 설정 보기 진입점 (source -> 정제·상한 적용된 읽기 전용 결과)
export async function readNativeConfig(request = {}, options = {}) {
    const source = request.source;
    if (source !== 'claude' && source !== 'codex') throw new Error('지원하지 않는 원본 설정 종류');
    const where = locations(options);
    const view = source === 'claude' ? await readClaudeView(where) : await readCodexView(where);
    return {
        source, label: source === 'claude' ? 'Claude Code' : 'Codex',
        readOnly: true, appliedToPaseoDog: false, notice: NOT_APPLIED,
        configRoot: displayPath(source === 'claude' ? where.claudeDir : where.codexHome, where.home),
        observedAt: Date.now(), ...view,
    };
}
