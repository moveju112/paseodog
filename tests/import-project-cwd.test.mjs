import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { runSharedAppTests } from './shared-app-tests.mjs';
import { IMPORT_CWD, IMPORT_CWD_ANCHOR, SOURCE_IMPORT_CWD, IMPORT_MENU_INSERT, IMPORT_LAUNCHER } from '../patches/paseo-import-cwd.mjs';
import { IMPORT_SOURCE_FILE, patchedImportSource } from '../scripts/patch-paseo-import-cwd.mjs';

const nativeSource = readFileSync(new URL('../android/' + IMPORT_SOURCE_FILE, import.meta.url), 'utf8');

test('web + menu reuses workspace import availability and callback without creating a tab', () => {
    for (const available of [true, false]) {
        let opened = 0;
        const launcher = new Script(`[${IMPORT_LAUNCHER}][0]()` ).runInNewContext({
            Sa: false, Wa: false, ss: true, ns: false, Gr() { throw new Error('must not launch a tab'); },
            nt: available, st() { opened++; },
        });
        for (const [host, surface] of [['main', 'menu'], ['explorer', 'menu'], ['main', 'panel']]) {
            const items = [{ id: 'agent' }, { id: 'terminal' }];
            new Script(IMPORT_MENU_INSERT).runInNewContext({
                T: surface, L: host, D: launcher, p: items, S: value => value, o: { Import: 'Import' },
            });
            const item = items.find(row => row.id === 'import-session');
            if (host !== 'main' || surface !== 'menu') { assert.equal(item, undefined); continue; }
            assert.equal(items[1], item);
            assert.equal(item.disabled, !available);
            assert.equal(item.launch, launcher.importSession.open);
            if (!item.disabled) item.launch();
        }
        assert.equal(opened, available ? 1 : 0);
    }
});

// 공유 화면의 실제 조회·선택·경로 필터·호스트 기능 경계를 실행한다.
test('project import passes the selected cwd through shared queries and preserves unscoped import', () =>
    runSharedAppTests([
        'src/components/import-session-sheet.test.tsx',
        'src/components/import-session-sheet-view-model.test.ts',
    ]));

test('shared Android source patch matches the bundle semantics and rejects drift', () => {
    const patched = patchedImportSource(nativeSource);
    assert.equal(patchedImportSource(patched), patched);
    assert.equal(patched.split(SOURCE_IMPORT_CWD).length, 2);
    assert.throws(() => patchedImportSource(nativeSource + '\n'), /source hash mismatch/);
    for (const cwd of ['/repo/current', null]) {
        const options = new Script(SOURCE_IMPORT_CWD).runInNewContext({
            useImportSession: (value) => value,
            selectedServerId: 'host', selectedSourceDirectory: cwd,
        });
        assert.equal(options.serverId, 'host');
        assert.equal(options.cwd, cwd ?? undefined);
    }
});
