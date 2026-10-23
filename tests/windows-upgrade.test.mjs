import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { windowsInstallerScript, prepareWindowsInstaller } from '../scripts/patch-windows-installer.mjs';
import { withWindowsExtraction, WINDOWS_INSTALLER_BLOBS, WINDOWS_INSTALLER_VERSION } from '../patches/windows-installer.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const builder = join(root, 'android/node_modules/app-builder-lib');
const templates = join(builder, 'templates/nsis');
const compiler = process.env.PASEODOG_NSIS_BINARY;
const runner = process.env.PASEODOG_WINDOWS_RUNNER;
const resources = process.env.PASEODOG_NSIS_RESOURCES;
const win = path => 'Z:' + resolve(path).replaceAll('/', '\\');

test('Windows installer generation gates every upstream input and check mode never writes', t => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-nsis-gate-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const output = join(directory, 'installer.nsi');
    prepareWindowsInstaller(output);
    assert.equal(readFileSync(output, 'utf8'), windowsInstallerScript());
    prepareWindowsInstaller(output, { check: true });
    writeFileSync(output, 'stale');
    assert.throws(() => prepareWindowsInstaller(output, { check: true }), /patch is missing/);
    assert.equal(readFileSync(output, 'utf8'), 'stale');
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '0.0.0' }));
    assert.throws(() => windowsInstallerScript(directory), /26\.8\.1 required/);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: WINDOWS_INSTALLER_VERSION }));
    for (const file of Object.keys(WINDOWS_INSTALLER_BLOBS)) {
        const target = join(directory, 'templates/nsis', file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(templates, file)));
    }
    for (const file of Object.keys(WINDOWS_INSTALLER_BLOBS)) {
        const target = join(directory, 'templates/nsis', file);
        const original = readFileSync(target);
        writeFileSync(target, 'drift');
        assert.throws(() => windowsInstallerScript(directory), /source hash mismatch/);
        writeFileSync(target, original);
    }
});

test('Windows upgrade copies all long-path files and reports copy failures without completing', {
    skip: !compiler || !runner || !resources ? 'Set PASEODOG_NSIS_BINARY, PASEODOG_WINDOWS_RUNNER and PASEODOG_NSIS_RESOURCES' : false,
    timeout: 120_000,
}, t => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-upgrade-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = join(directory, 'payload');
    const installed = join(directory, 'installed');
    const oldCopy = join(directory, 'legacy-copy');
    const data = join(directory, 'user-data', 'settings.json');
    mkdirSync(dirname(data));
    writeFileSync(data, '{"preserved":true}');
    const long = Array.from({ length: 8 }, (_, i) => `${i}-${'dependency'.repeat(3)}`).join('/');
    const files = new Map([
        ['PaseoDog.txt', 'new release'],
        ['폴더 with spaces/한글.txt', '한글 내용'],
        [long + '/implementation.js', 'export default "long path";'],
    ]);
    for (const [file, content] of files) {
        const target = join(source, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }
    mkdirSync(join(source, 'empty'));
    mkdirSync(join(installed, long), { recursive: true });
    writeFileSync(join(installed, long, 'obsolete.txt'), 'old release');
    writeFileSync(join(installed, 'obsolete.txt'), 'old release');
    assert.ok(win(join(installed, long, 'implementation.js')).length > 300);
    const archive = join(directory, 'payload.7z');
    const sevenZip = join(root, 'android/node_modules/7zip-bin/linux/x64/7za');
    const archived = spawnSync(sevenZip, ['a', archive, '.'], { cwd: source, encoding: 'utf8', timeout: 20_000 });
    assert.equal(archived.status, 0, archived.stdout + archived.stderr);

    function compile(name, body) {
        const nsi = join(directory, name + '.nsi');
        const executable = join(directory, name + '.exe');
        writeFileSync(nsi, `Unicode true
!include "LogicLib.nsh"
!addplugindir "${resources}/plugins/x86-unicode"
OutFile "${executable}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
${body}`);
        const result = spawnSync(compiler, ['-WX', '-V2', '-INPUTCHARSET', 'UTF8', nsi], {
            encoding: 'utf8', timeout: 20_000,
            env: { ...process.env, NSISDIR: dirname(dirname(compiler)) },
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        return executable;
    }
    function run(executable, args = []) {
        const result = spawnSync(runner, [executable, ...args], { encoding: 'utf8', timeout: 30_000 });
        assert.ifError(result.error);
        return result;
    }

    // 이전 버전 제거 함수도 실제 기반 템플릿에서 읽어 긴 경로 파일의 제거를 검증한다.
    const atomic = readFileSync(join(templates, 'uninstaller.nsh'), 'utf8')
        .match(/Function un\.atomicRMDir[\s\S]*?FunctionEnd/)[0];
    const legacy = compile('legacy', `!define UNINSTALL_FILENAME "\\unused.exe"
${atomic}
Section
  WriteUninstaller "${win(join(directory, 'old-uninstaller.exe'))}"
  SetOutPath "${win(oldCopy)}"
  CopyFiles /SILENT "${win(source)}\\*" "$OUTDIR"
SectionEnd
Section "Uninstall"
  InitPluginsDir
  CreateDirectory "$PLUGINSDIR\\old-install"
  Push ""
  Call un.atomicRMDir
  Pop $R0
  StrCmp $R0 0 +3
    SetErrorLevel 1603
    Quit
SectionEnd`);
    assert.equal(run(legacy).status, 0);
    assert.equal(existsSync(join(oldCopy, long, 'implementation.js')), false,
        'Legacy Shell copy must reproduce the long-path omission');
    assert.equal(run(join(directory, 'old-uninstaller.exe'), [`_?=${win(installed)}`]).status, 0);
    assert.equal(existsSync(join(installed, long, 'obsolete.txt')), false);
    assert.equal(existsSync(join(installed, 'obsolete.txt')), false);

    const patched = withWindowsExtraction(readFileSync(join(templates, 'include/extractAppPackage.nsh'), 'utf8'));
    const extract = patched.slice(patched.indexOf('!macro extractUsing7za FILE'));
    const installer = compile('upgrade', `!define PRODUCT_FILENAME "PaseoDogFixture"
!include "${join(root, 'android/packages/desktop/scripts/installer.nsh')}"
!insertmacro paseodogCopyTreeFunction
${extract}
Section
  InitPluginsDir
  StrCpy $INSTDIR "${win(installed)}"
  !insertmacro customCheckAppRunning
  SetOutPath "$INSTDIR"
  File "/oname=$PLUGINSDIR\\payload.7z" "${archive}"
  !insertmacro extractUsing7za "$PLUGINSDIR\\payload.7z"
  FileOpen $0 "$INSTDIR\\completed" w
  FileWrite $0 "complete"
  FileClose $0
SectionEnd`);
    assert.equal(run(installer).status, 0);
    for (const [file, content] of files) assert.equal(readFileSync(join(installed, file), 'utf8'), content, file);
    assert.equal(readdirSync(join(installed, 'empty')).length, 0);
    assert.equal(readFileSync(data, 'utf8'), '{"preserved":true}');
    assert.ok(existsSync(join(installed, 'completed')));

    // 대상 경로가 파일인 경우에는 완료 마커를 쓰지 않고 실패해야 한다.
    const failure = compile('failure', `!define PRODUCT_FILENAME "PaseoDogFixture"
!include "${join(root, 'android/packages/desktop/scripts/installer.nsh')}"
!insertmacro paseodogCopyTreeFunction
${extract}
Section
  InitPluginsDir
  StrCpy $INSTDIR "${win(join(directory, 'blocked'))}"
  !insertmacro customCheckAppRunning
  SetOutPath "$INSTDIR"
  File "/oname=$PLUGINSDIR\\payload.7z" "${archive}"
  !insertmacro extractUsing7za "$PLUGINSDIR\\payload.7z"
  FileOpen $0 "${win(join(directory, 'incorrect-success'))}" w
  FileClose $0
SectionEnd`);
    mkdirSync(join(directory, 'blocked'));
    writeFileSync(join(directory, 'blocked', '폴더 with spaces'), 'not a directory');
    assert.equal(run(failure).status, 1603 & 255);
    assert.equal(existsSync(join(directory, 'incorrect-success')), false);
    assert.equal(readFileSync(data, 'utf8'), '{"preserved":true}');
});
