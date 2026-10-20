import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maskSecrets, parseFrontmatter, parseToml, readNativeConfig } from '../plugin/server/native-config.mjs';

// 임시 홈 생성 (테스트 종료 시 삭제)
function tempHome(t) {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-native-config-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

// 파일 쓰기 도우미 (상위 폴더 생성 -> 내용 기록)
function put(path, content) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

// 트리 전체 스냅샷 (경로 -> 내용·수정 시각, 읽기 전용 검증용)
function snapshot(root) {
    const result = {};
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isSymbolicLink()) result[path] = 'link';
            else if (entry.isDirectory()) walk(path);
            else result[path] = `${statSync(path).mtimeMs}:${readFileSync(path, 'utf8')}`;
        }
    };
    walk(root);
    return result;
}

const SECRET = 'sk-ant-THISISASECRETVALUE1234567890';

test('secret masking keeps env references and hides tokens, credentials and assignments', () => {
    const masked = maskSecrets(`API_KEY=${SECRET} curl -H "Authorization: Bearer abcdefghijkl" https://user:pw@host/x?token=zzz9999&x=1 --password hunter22 GITHUB_TOKEN=$GITHUB_TOKEN`);
    for (const leaked of [SECRET, 'abcdefghijkl', 'user:pw', 'zzz9999', 'hunter22']) assert.ok(!masked.includes(leaked), leaked);
    assert.match(masked, /GITHUB_TOKEN=\$GITHUB_TOKEN/);
    assert.match(masked, /x=1/);
    assert.equal(maskSecrets('python3 hook.py --mode fast'), 'python3 hook.py --mode fast');
    assert.equal(maskSecrets('-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----'), '***');
    assert.equal(maskSecrets('-----BEGIN RSA PRIVATE KEY-----\ntruncated private material'), '***');
});

test('TOML subset parser handles Codex config shapes and reports only line numbers', () => {
    const value = parseToml([
        '# comment', 'model = "x" # tail', 'list = [', '  1, # c', '  { a = "b", c.d = true },', ']', 'when = 1979-05-27',
        '[features]', 'hooks = false', '',
        '[hooks.state."/h/.codex/hooks.json:pre_tool_use:0:0"]', 'enabled = false', "trusted_hash = 'sha256:ab'",
        '[[hooks.Stop]]', 'matcher = """', 'a\\', '   b"""', '[[hooks.Stop.hooks]]', "command = '''py \"q\"'''", 'timeout = 1_0',
        '[[skills.config]]', 'path = "/s/SKILL.md"', 'enabled = false',
    ].join('\n'));
    assert.equal(value.features.hooks, false);
    assert.equal(value.hooks.state['/h/.codex/hooks.json:pre_tool_use:0:0'].enabled, false);
    assert.equal(value.hooks.Stop[0].matcher, 'ab');
    assert.equal(value.hooks.Stop[0].hooks[0].command, 'py "q"');
    assert.equal(value.hooks.Stop[0].hooks[0].timeout, 10);
    assert.equal(value.skills.config[0].path, '/s/SKILL.md');
    assert.equal(value.list[1].c.d, true);
    assert.equal(value.when, '1979-05-27');
    assert.throws(() => parseToml(`ok = 1\nsecret = "${SECRET}`), (error) => /TOML 2행/.test(error.message) && !error.message.includes(SECRET));
    assert.throws(() => parseToml('a = 1\na = 2'), /중복 키/);
});

test('frontmatter parser reads quoted, folded and literal scalars', () => {
    const parsed = parseFrontmatter('---\nname: "q-name"\ndescription: >\n  first line\n  second\nnotes: |\n  keep\n  lines\n---\n# Body\n');
    assert.deepEqual(parsed.fields, { name: 'q-name', description: 'first line second', notes: 'keep\nlines' });
    assert.equal(parsed.body, '# Body\n');
    assert.equal(parseFrontmatter('# no frontmatter').hasFrontmatter, false);
});

test('Claude view lists personal/enterprise skills and settings hooks read-only with masking', async (t) => {
    const home = tempHome(t);
    const managed = join(home, 'managed');
    const marker = join(home, 'hook-ran');
    put(join(home, '.claude', 'settings.json'), {
        env: { ANTHROPIC_API_KEY: SECRET },
        skillOverrides: { quiet: 'off' },
        hooks: {
            PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `touch ${marker}; API_KEY=${SECRET} run`, timeout: 5 }] }],
            Notification: [{ hooks: [{ type: 'http', url: 'https://bot:pw@example.com/hook?token=abc12345', headers: { Authorization: `Bearer ${SECRET}` } }] }],
            Stop: ['not-a-group'],
        },
    });
    put(join(home, '.claude', 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ndescription: >\n  Alpha skill\n  folded\ndisable-model-invocation: true\n---\nUse token=${SECRET}\n`);
    put(join(home, '.claude', 'skills', 'quiet', 'SKILL.md'), '---\ndescription: no name\n---\nbody');
    put(join(home, '.claude', 'skills', '.trash', 'old', 'SKILL.md'), '---\nname: old\n---\n');
    put(join(home, '.claude', 'skills', 'synced', 'web', 'SKILL.md'), '---\nname: web\ndescription: synced\n---\n');
    put(join(managed, 'managed-settings.json'), {
        allowManagedHooksOnly: true,
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'managed-hook' }] }] },
    });
    put(join(managed, '.claude', 'skills', 'corp', 'SKILL.md'), '---\nname: corp\ndescription: enterprise\n---\n');
    const before = snapshot(home);
    const view = await readNativeConfig({ source: 'claude' }, { home, env: {}, claudeManagedDir: managed, codexSystemDir: '' });
    assert.deepEqual(snapshot(home), before);
    assert.equal(existsSync(marker), false);
    const json = JSON.stringify(view);
    assert.ok(!json.includes(SECRET) && !json.includes('bot:pw') && !json.includes('abc12345'));
    assert.equal(view.appliedToPaseoDog, false);
    assert.equal(view.readOnly, true);
    assert.match(view.notice, /적용되지 않/);
    const skills = Object.fromEntries(view.skills.items.map((item) => [item.name, item]));
    assert.deepEqual(Object.keys(skills).sort(), ['alpha', 'corp', 'quiet', 'web']);
    assert.equal(skills.alpha.description, 'Alpha skill folded');
    assert.match(skills.alpha.state, /모델 자동 호출 끔/);
    assert.match(skills.alpha.body, /token=\*\*\*/);
    assert.equal(skills.alpha.path, '~/.claude/skills/alpha/SKILL.md');
    assert.equal(skills.quiet.enabled, false);
    assert.equal(skills.corp.scope, 'enterprise');
    assert.equal(skills.web.scope, 'synced');
    const rules = Object.fromEntries(view.hooks.rules.map((rule) => [rule.event, rule]));
    assert.equal(rules.PreToolUse.enabled, false);
    assert.match(rules.PreToolUse.state, /allowManagedHooksOnly/);
    assert.equal(rules.PreToolUse.timeout, 5);
    assert.equal(rules.Notification.headerCount, 1);
    assert.equal(rules.SessionStart.enabled, true);
    assert.equal(rules.SessionStart.scope, 'managed');
    assert.ok(view.hooks.sources[0].warnings.some((warning) => warning.startsWith('Stop[0]')));
});

test('Claude view reports missing and malformed settings without leaking contents', async (t) => {
    const home = tempHome(t);
    put(join(home, 'claude-dir', 'settings.json'), `{"env": {"KEY": "${SECRET}"},`);
    const view = await readNativeConfig({ source: 'claude' }, {
        home, env: { CLAUDE_CONFIG_DIR: join(home, 'claude-dir') }, claudeManagedDir: join(home, 'none'),
    });
    assert.equal(view.configRoot, '~/claude-dir');
    assert.equal(view.hooks.sources[0].status, 'malformed');
    assert.match(view.hooks.sources[0].error, /JSON 형식 오류/);
    assert.ok(!JSON.stringify(view).includes(SECRET));
    assert.deepEqual(view.hooks.rules, []);
    assert.ok(view.skills.roots.every((root) => root.status === 'missing'));
    await assert.rejects(readNativeConfig({ source: 'other' }), /지원하지 않는/);
});

test('Codex view follows hooks.json, inline [hooks], hooks.state and skills.config without executing', async (t) => {
    const home = tempHome(t);
    const codex = join(home, '.codex');
    const marker = join(home, 'hook-ran');
    put(join(codex, 'hooks.json'), {
        description: 'x',
        hooks: {
            PreToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: `touch ${marker} --api-key ${SECRET}`, timeout: 3 }] }],
            SessionStart: [{ hooks: [{ type: 'command', command: 'start-hook' }, { type: 'prompt' }] }],
            Notification: [{ hooks: [{ type: 'command', command: 'claude-only-event' }] }],
        },
    });
    const hooksPath = join(codex, 'hooks.json');
    put(join(codex, 'config.toml'), [
        `[mcp_servers.x.env]`, `API_KEY = "${SECRET}"`,
        `[hooks.state."${hooksPath}:pre_tool_use:0:0"]`, 'enabled = false', 'trusted_hash = "sha256:1"',
        `[hooks.state."${hooksPath}:session_start:0:0"]`, 'trusted_hash = "sha256:2"',
        '[[hooks.Stop]]', '[[hooks.Stop.hooks]]', 'type = "command"', 'command = "inline-stop"',
        '[[skills.config]]', `path = "${join(home, '.agents', 'skills', 'off', 'SKILL.md')}"`, 'enabled = false',
    ].join('\n'));
    put(join(home, '.agents', 'skills', 'good', 'SKILL.md'), '---\nname: good\ndescription: works\n---\nbody');
    put(join(home, '.agents', 'skills', 'off', 'SKILL.md'), '---\nname: off\ndescription: disabled\n---\n');
    put(join(home, '.agents', 'skills', 'group', 'nested', 'SKILL.md'), '---\nname: nested\ndescription: deep\n---\n');
    put(join(home, '.agents', 'skills', 'bad', 'SKILL.md'), '---\nname: bad\n---\n');
    put(join(codex, 'skills', '.system', 'sys', 'SKILL.md'), '---\nname: sys\ndescription: bundled\n---\n');
    symlinkSync(join(home, '.agents', 'skills', 'good'), join(codex, 'skills', 'good'));
    const before = snapshot(home);
    const view = await readNativeConfig({ source: 'codex' }, { home, env: {}, codexSystemDir: join(home, 'etc-codex') });
    assert.deepEqual(snapshot(home), before);
    assert.equal(existsSync(marker), false);
    assert.ok(!JSON.stringify(view).includes(SECRET));
    assert.equal(view.appliedToPaseoDog, false);
    const rules = view.hooks.rules.map((rule) => [rule.event, rule.type, rule.position, rule.enabled, rule.state]);
    assert.deepEqual(rules, [
        ['PreToolUse', 'command', '0:0', false, '꺼짐 (hooks.state)'],
        ['SessionStart', 'command', '0:0', true, '켜짐 · 신뢰 기록 있음'],
        ['SessionStart', 'prompt', '0:1', false, 'Codex가 해석만 하고 실행하지 않는 유형'],
        ['Notification', 'command', '0:0', false, 'Codex가 인식하지 않는 이벤트 (무시됨)'],
        ['Stop', 'command', '0:0', true, '켜짐 · 신뢰 기록 없음 (검토 전 실행 안 됨)'],
    ]);
    assert.match(view.hooks.rules[0].command, /--api-key \*\*\*/);
    const skills = Object.fromEntries(view.skills.items.map((item) => [item.name, item]));
    assert.deepEqual(Object.keys(skills).sort(), ['bad', 'good', 'nested', 'off', 'sys']);
    assert.deepEqual(skills.good.aliases, ['~/.codex/skills/good/SKILL.md']);
    assert.equal(skills.off.enabled, false);
    assert.equal(skills.off.state, '꺼짐 (skills.config)');
    assert.equal(skills.bad.enabled, false);
    assert.match(skills.bad.issues[0], /name\/description 누락/);
    assert.equal(skills.sys.scope, 'system');
    assert.equal(skills.nested.path, '~/.agents/skills/group/nested/SKILL.md');
});

test('Codex view marks feature-off, malformed hooks.json and broken config.toml explicitly', async (t) => {
    const home = tempHome(t);
    const codex = join(home, 'codex-home');
    put(join(codex, 'hooks.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] }, extra: true });
    put(join(codex, 'config.toml'), '[features]\nhooks = false\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "inline"\n');
    const off = await readNativeConfig({ source: 'codex' }, { home, env: { CODEX_HOME: codex }, codexSystemDir: '' });
    assert.equal(off.configRoot, '~/codex-home');
    assert.match(off.hooks.globalState, /features.hooks = false/);
    assert.equal(off.hooks.sources[0].status, 'malformed');
    assert.match(off.hooks.sources[0].error, /최상위 키\(extra\)/);
    assert.deepEqual(off.hooks.rules.map((rule) => [rule.command, rule.enabled]), [['inline', false]]);

    put(join(codex, 'hooks.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'json-stop' }] }] } });
    put(join(codex, 'config.toml'), `[features]\nhooks = true\nbroken = "${SECRET}`);
    const broken = await readNativeConfig({ source: 'codex' }, { home, env: { CODEX_HOME: codex }, codexSystemDir: '' });
    const config = broken.hooks.sources.find((row) => row.path.endsWith('config.toml'));
    assert.equal(config.status, 'malformed');
    assert.match(config.error, /TOML 3행/);
    assert.ok(!JSON.stringify(broken).includes(SECRET));
    assert.deepEqual(broken.hooks.rules.map((rule) => [rule.command, rule.enabled]), [['json-stop', null]]);
    assert.ok(broken.skills.roots.every((root) => root.status === 'missing'));
});
