import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';

// 실제 NSIS 코드와 nsProcess 플러그인을 격리된 Windows/Wine에서 실행한다.
const compiler = process.env.PASEODOG_NSIS_BINARY;
const plugins = process.env.PASEODOG_NSIS_PLUGINS;
const runner = process.env.PASEODOG_WINDOWS_RUNNER;
const root = fileURLToPath(new URL('../', import.meta.url));
const config = createRequire(import.meta.url)('../android/packages/desktop/electron-builder.cjs');

test('Windows installer closes background processes only after consent', {
    skip: !compiler || !plugins || !runner ? 'Set PASEODOG_NSIS_BINARY, PASEODOG_NSIS_PLUGINS and PASEODOG_WINDOWS_RUNNER' : false,
    timeout: 120_000,
}, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-installer-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const appName = `PaseoDogFixture${process.pid}.exe`;
    const otherName = `OtherFixture${process.pid}.exe`;
    const title = `PaseoDog installer fixture ${process.pid}`;
    const children = new Set();
    t.after(() => {
        for (const child of children) child.kill();
    });

    function compile(name, body) {
        const source = join(directory, `${name}.nsi`);
        const executable = join(directory, `${name}.exe`);
        writeFileSync(source, `Unicode true
!include "LogicLib.nsh"
!addplugindir "${plugins}"
OutFile "${executable}"
RequestExecutionLevel user
${body}
`);
        const result = spawnSync(compiler, ['-V2', source], {
            encoding: 'utf8', timeout: 20_000,
            env: { ...process.env, NSISDIR: dirname(dirname(compiler)) },
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        return executable;
    }

    function launch(executable, args = []) {
        const child = spawn(runner, [executable, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
        children.add(child);
        // Wine의 다른 프로세스가 공유한 출력 핸들이 아니라 해당 프로세스의 종료를 기다린다.
        child.result = new Promise((resolveRun, reject) => {
            child.on('error', reject);
            child.on('exit', code => {
                children.delete(child);
                resolveRun(code);
            });
        });
        return child;
    }

    // PowerShell·taskkill 없이 창이 없는 여러 프로세스까지 종료해야 한다.
    const appBody = `SilentInstall silent
!include "FileFunc.nsh"
Section
  ${'${GetParameters}'} $0
  FileOpen $1 "$EXEDIR\\$0.ready" w
  FileWrite $1 "ready"
  FileClose $1
  Sleep 60000
SectionEnd`;
    const app = compile(appName.slice(0, -4), appBody);
    const other = compile(otherName.slice(0, -4), appBody);
    const installer = compile('installer', `Name "${title}"
Caption "${title}"
!define APP_EXECUTABLE_FILENAME "${appName}"
!include "${resolve(root, 'android/node_modules/app-builder-lib/templates/nsis/include/nsProcess.nsh')}"
!include "${resolve(root, 'android/packages/desktop', config.nsis.include)}"
Page instfiles
Section
  !insertmacro customCheckAppRunning
  SetErrorLevel 0
  SetAutoClose true
SectionEnd`);
    const clickerBody = button => `SilentInstall silent
Section
  StrCpy $R0 0
  retry:
    FindWindow $0 "#32770" "${title}"
    find_dialog:
      StrCmp $0 0 wait
      GetDlgItem $1 $0 6
      StrCmp $1 0 next_dialog
      GetDlgItem $1 $0 7
      StrCmp $1 0 next_dialog
      GetDlgItem $1 $0 ${button}
      SendMessage $1 0x00F5 0 0
      SetErrorLevel 0
      Quit
    next_dialog:
      FindWindow $0 "#32770" "${title}" 0 $0
      Goto find_dialog
    wait:
      Sleep 100
      IntOp $R0 $R0 + 1
      IntCmp $R0 300 failed retry failed
    failed:
      SetErrorLevel 99
SectionEnd`;
    const clicker = compile('clicker', clickerBody(6));
    const decliner = compile('decline', clickerBody(7));

    const empty = await launch(installer, ['/S']).result;
    assert.equal(empty, 0);
    const first = launch(app, ['first']);
    const second = launch(app, ['second']);
    const unrelated = launch(other, ['other']);
    const deadline = Date.now() + 30_000;
    while (!['first', 'second', 'other'].every(name => existsSync(join(directory, `${name}.ready`)))) {
        assert.ok(Date.now() < deadline, 'Fixture processes did not become ready');
        await delay(100);
    }
    const silent = await launch(installer, ['/S']).result;
    assert.equal(silent, 1602 & 255);
    assert.equal(first.exitCode, null);
    assert.equal(second.exitCode, null);
    const decline = launch(decliner);
    const cancelled = await launch(installer).result;
    const declined = await decline.result;
    assert.equal(declined, 0);
    assert.equal(cancelled, 1602 & 255);
    assert.equal(first.exitCode, null);
    assert.equal(second.exitCode, null);
    const accept = launch(clicker);
    const installed = await launch(installer).result;
    const accepted = await accept.result;
    assert.equal(accepted, 0);
    assert.equal(installed, 0);
    await Promise.all([first.result, second.result]);
    assert.equal(unrelated.exitCode, null, 'Unrelated executables must remain running');
});
