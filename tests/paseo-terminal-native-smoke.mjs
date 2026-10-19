import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
    SERVER_ROOT, SERVER_VERSION, TERMINAL_FILE, BEFORE, AFTER,
    patchTerminalSource, patchInstalledTerminal,
} from '../scripts/patch-paseo-terminal.mjs';

const require = createRequire(new URL('../tools/package.json', import.meta.url));
const xterm = require('@xterm/headless');
const { TerminalStateSchema } = await import('../tools/node_modules/@getpaseo/protocol/dist/messages.js');
const fixture = JSON.parse(await readFile(new URL('./fixtures/paseo-terminal-snapshots.json', import.meta.url), 'utf8'));
const installed = await readFile(join(SERVER_ROOT, TERMINAL_FILE), 'utf8');
const original = installed.replaceAll(AFTER, BEFORE);
const patched = patchTerminalSource(original);
const clientSource = await readFile(new URL('../tools/node_modules/@getpaseo/protocol/dist/terminal-snapshot.js', import.meta.url), 'utf8');
const clientAnchor = '        const cell = row[index] ?? { char: " " };\n';
assert.equal(clientSource.split(clientAnchor).length, 2);
// 실제 0.11.4 렌더러 -> PR #6452의 클라이언트 가드만 메모리에서 적용.
async function loadRenderer(source) {
    return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).renderTerminalSnapshotToAnsi;
}
const oldRender = await loadRenderer(clientSource);
const render = await loadRenderer(clientSource.replace(clientAnchor,
    clientAnchor + '        if (cell.char === "") {\n            continue;\n        }\n'));

// 감사된 실제 배포 함수 -> 프로세스·PTY 없이 실제 xterm 버퍼에서 실행.
function loadSerialization(source) {
    const start = source.indexOf('function extractCell(');
    const end = source.indexOf('// xterm marks a line', start);
    assert.ok(start >= 0 && end > start);
    return new Function(source.slice(start, end) + '\nreturn { extractGrid, extractScrollback };')();
}
const before = loadSerialization(original);
const after = loadSerialization(patched);

// xterm 비동기 쓰기 완료 -> 스냅샷 또는 복원 텍스트 확인.
async function writeTerminal(terminal, data) {
    await new Promise(resolve => terminal.write(data, resolve));
}

// 기존 와이어 모양 그대로 -> 선택적으로 이미 존재하는 줄바꿈 플래그 포함.
function snapshot(terminal, serialization, withWrapFlags = false) {
    const state = {
        rows: terminal.rows,
        cols: terminal.cols,
        grid: serialization.extractGrid(terminal),
        scrollback: serialization.extractScrollback(terminal),
        cursor: { row: terminal.buffer.active.cursorY, col: terminal.buffer.active.cursorX },
    };
    if (withWrapFlags) {
        state.gridWrapped = state.grid.map(() => false);
        state.scrollbackWrapped = state.scrollback.map(() => false);
    }
    return TerminalStateSchema.parse(JSON.parse(JSON.stringify(state)));
}

test('0.11.4 full-file hash gate is idempotent and rejects every unrelated change', async () => {
    await patchInstalledTerminal('--check');
    assert.equal(patched, installed);
    assert.equal(patchTerminalSource(patched), patched);
    assert.equal(patched.replaceAll(AFTER, BEFORE), original);
    for (const source of [original + '\n', patched + '\n', original.replace(BEFORE, AFTER), '']) {
        assert.throws(() => patchTerminalSource(source), /source drift/);
    }
});

test('check, version and source gates fail closed without writing; apply is idempotent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paseo-terminal-patch-'));
    const filename = join(root, TERMINAL_FILE);
    try {
        await mkdir(join(root, 'dist/server/terminal'), { recursive: true });
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@getpaseo/server', version: SERVER_VERSION }));
        await writeFile(filename, original);
        await assert.rejects(patchInstalledTerminal('--check', root), /not installed/);
        assert.equal(await readFile(filename, 'utf8'), original);
        await writeFile(filename, original + '\n');
        await assert.rejects(patchInstalledTerminal('--apply', root), /source drift/);
        assert.equal(await readFile(filename, 'utf8'), original + '\n');
        await writeFile(filename, original);
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@getpaseo/server', version: '0.12.0' }));
        await assert.rejects(patchInstalledTerminal('--apply', root), /version drift/);
        assert.equal(await readFile(filename, 'utf8'), original);
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@getpaseo/server', version: SERVER_VERSION }));
        await patchInstalledTerminal('--apply', root);
        await patchInstalledTerminal('--apply', root);
        await patchInstalledTerminal('--check', root);
        assert.equal(await readFile(filename, 'utf8'), patched);
    } finally {
        await rm(root, { recursive: true });
    }
});

for (const entry of fixture.cases) {
    for (const scrollback of [false, true]) {
        test(`${scrollback ? 'scrollback' : 'viewport'}: actual xterm snapshot/replay preserves ${JSON.stringify(entry.text)}`, async () => {
            const terminal = new xterm.Terminal({ cols: entry.cols, rows: 2, allowProposedApi: true });
            const restored = new xterm.Terminal({ cols: entry.cols, rows: 2, allowProposedApi: true });
            try {
                await writeTerminal(terminal, entry.text + (scrollback ? '\r\nnext\r\nlast' : ''));
                const oldState = snapshot(terminal, before);
                const state = snapshot(terminal, after);
                const row = (scrollback ? state.scrollback : state.grid)[0];
                assert.deepEqual(row.slice(0, entry.firstCells.length).map(cell => cell.char), entry.firstCells);
                assert.equal(row.at(-1).char, ' ');
                // 旧 스냅샷은 추측 보정하지 않음; 旧 클라이언트도 기존 공백 동작 유지.
                await writeTerminal(restored, render(oldState));
                const restoredRow = scrollback ? 0 : restored.buffer.active.baseY;
                assert.equal(restored.buffer.active.getLine(restoredRow).translateToString(true), entry.legacyText);
                // 旧 렌더러의 행 길이 계산은 끝 연속 셀을 공백으로 하나 더 출력할 수 있음.
                // 구 클라이언트는 수정되지 않으므로 기존 음절 사이 공백도 그대로 남음.
                restored.reset();
                await writeTerminal(restored, oldRender(state));
                assert.equal(restored.buffer.active.getLine(scrollback ? 0 : restored.buffer.active.baseY).translateToString(true), entry.oldClientText);
                assert.equal(render(oldState), oldRender(oldState));
                for (const withWrapFlags of [false, true]) {
                    restored.reset();
                    await writeTerminal(restored, render(snapshot(terminal, after, withWrapFlags)));
                    assert.equal(restored.buffer.active.getLine(scrollback ? 0 : restored.buffer.active.baseY).translateToString(true), entry.text);
                }
                const limited = after.extractScrollback(terminal, { scrollbackLines: 0 });
                assert.deepEqual(limited, []);
            } finally {
                terminal.dispose();
                restored.dispose();
            }
        });
    }
}

test('colored wide cells retain attributes, cursor, and ordinary blank cells', async () => {
    const terminal = new xterm.Terminal({ cols: 20, rows: 2, allowProposedApi: true });
    const restored = new xterm.Terminal({ cols: 20, rows: 2, allowProposedApi: true });
    try {
        await writeTerminal(terminal, '\x1b[1;31m한\x1b[0m A');
        const state = snapshot(terminal, after);
        const oldState = snapshot(terminal, before);
        assert.deepEqual(state.cursor, oldState.cursor);
        assert.equal(state.grid[0][0].bold, true);
        assert.equal(state.grid[0][1].char, '');
        assert.equal(state.grid[0][2].char, ' ');
        assert.deepEqual(state.grid.map(row => row.map(cell => ({ ...cell, char: cell.char || ' ' }))), oldState.grid);
        await writeTerminal(restored, render(state));
        assert.equal(restored.buffer.active.getLine(0).translateToString(true), '한 A');
        assert.equal(restored.buffer.active.getLine(0).getCell(0).isBold(), terminal.buffer.active.getLine(0).getCell(0).isBold());
        assert.equal(restored.buffer.active.getLine(0).getCell(0).getFgColor(), terminal.buffer.active.getLine(0).getCell(0).getFgColor());
        assert.equal(restored.buffer.active.cursorX, terminal.buffer.active.cursorX);
    } finally {
        terminal.dispose();
        restored.dispose();
    }
});
