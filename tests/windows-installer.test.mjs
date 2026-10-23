import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';

// 실제 NSIS 코드와 Windows 프로세스 API를 격리된 Windows/Wine에서 실행한다.
const compiler = process.env.PASEODOG_NSIS_BINARY;
const runner = process.env.PASEODOG_WINDOWS_RUNNER;
const root = fileURLToPath(new URL('../', import.meta.url));
const config = createRequire(import.meta.url)('../android/packages/desktop/electron-builder.cjs');

test('Windows installer closes background processes only after consent', {
    skip: !compiler || !runner ? 'Set PASEODOG_NSIS_BINARY and PASEODOG_WINDOWS_RUNNER' : false,
    timeout: 120_000,
}, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-installer-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const appName = `PaseoDogFixture${process.pid}.exe`;
    const title = `PaseoDog installer fixture ${process.pid}`;
    const installed = join(directory, 'installed');
    const outside = join(directory, 'installed-other');
    mkdirSync(installed);
    mkdirSync(outside);
    const children = new Set();
    t.after(() => {
        for (const child of children) child.kill();
    });

    function compile(name, body) {
        const source = join(directory, `${name}.nsi`);
        const executable = join(directory, `${name}.exe`);
        writeFileSync(source, `Unicode true
!include "LogicLib.nsh"
OutFile "${executable}"
RequestExecutionLevel user
${body}
`);
        const result = spawnSync(compiler, ['-WX', '-INPUTCHARSET', 'UTF8', '-V2', source], {
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

    async function waitForReady(paths) {
        const deadline = Date.now() + 30_000;
        while (!paths.every(path => existsSync(path))) {
            assert.ok(Date.now() < deadline, 'Fixture processes did not become ready');
            await delay(100);
        }
    }

    // 이름이 다른 내장 실행파일은 종료하고, 경로 접두사만 비슷한 별도 설치는 보존한다.
    const appBody = `SilentInstall silent
!include "FileFunc.nsh"
Section
  ${'${GetParameters}'} $0
  FileOpen $1 "$EXEDIR\\$0.ready" w
  FileWrite $1 "ready"
  FileClose $1
  Sleep 60000
SectionEnd`;
    const app = compile(`installed/${appName.slice(0, -4)}`, appBody);
    const native = compile('installed/native-helper', appBody);
    const other = compile(`installed-other/${appName.slice(0, -4)}`, appBody);
    compile('installed/installer', `Name "${title}"
Caption "${title}"
!define PRODUCT_FILENAME "${appName.slice(0, -4)}"
!include "${resolve(root, 'android/packages/desktop', config.nsis.include)}"
Page instfiles
Section
  StrCpy $INSTDIR "$EXEDIR"
  !insertmacro customCheckAppRunning
  SetErrorLevel 0
  SetAutoClose true
SectionEnd`);
    // 실제 업그레이드처럼 설치 폴더 안의 부모 설치기도 실행 상태로 둔다.
    const installer = compile('installed/launcher', `SilentInstall silent
!include "FileFunc.nsh"
Section
  ${'${GetParameters}'} $0
  ExecWait '"$EXEDIR\\installer.exe" $0' $1
  SetErrorLevel $1
SectionEnd`);
    const invalidTarget = compile('invalid-target', `SilentInstall silent
!define PRODUCT_FILENAME "${appName.slice(0, -4)}"
!include "${resolve(root, 'android/packages/desktop', config.nsis.include)}"
!include "FileFunc.nsh"
Section
  ${'${GetParameters}'} $INSTDIR
  !insertmacro customCheckAppRunning
  SetErrorLevel 0
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
    assert.equal(await launch(invalidTarget).result, 1603 & 255);
    assert.equal(await launch(invalidTarget, ['C:\\']).result, 1603 & 255);
    const second = launch(native, ['second']);
    const unrelated = launch(other, ['other']);
    await waitForReady([join(installed, 'second.ready'), join(outside, 'other.ready')]);
    // PaseoDog.exe가 전혀 없어도 설치 폴더의 다른 실행파일은 감지해야 한다.
    const silent = await launch(installer, ['/S']).result;
    assert.equal(silent, 1602 & 255);
    assert.equal(second.exitCode, null);
    const decline = launch(decliner);
    const cancelled = await launch(installer).result;
    const declined = await decline.result;
    assert.equal(declined, 0);
    assert.equal(cancelled, 1602 & 255);
    assert.equal(second.exitCode, null);
    const first = launch(app, ['first']);
    await waitForReady([join(installed, 'first.ready')]);
    const accept = launch(clicker);
    const completed = await launch(installer).result;
    const accepted = await accept.result;
    assert.equal(accepted, 0);
    assert.equal(completed, 0);
    await Promise.all([first.result, second.result]);
    assert.equal(unrelated.exitCode, null, 'Unrelated executables must remain running');
});
