export const WINDOWS_INSTALLER_VERSION = '26.8.1';
export const WINDOWS_UNINSTALLER_BLOB = 'e9daa9f78bd740b094f07503427733a84645ab7a';
export const WINDOWS_UNINSTALLER_MARKER = '; paseodog-standard-uninstaller\n';
const uninstallerAnchor = '        if (customScriptPath != null) {';
const uninstallerGuard = `        if (customScriptPath != null && !script.startsWith(${JSON.stringify(WINDOWS_UNINSTALLER_MARKER)})) {`;

// 기본 템플릿 기반의 PaseoDog 스크립트만 upstream의 uninstaller 생성·서명 단계를 유지한다.
export function withWindowsUninstaller(source) {
    if (source.split(uninstallerAnchor).length !== 2)
        throw new Error('Windows uninstaller pipeline anchor mismatch');
    return source.replace(uninstallerAnchor, uninstallerGuard);
}

export function withoutWindowsUninstaller(source) {
    return source.replace(uninstallerGuard, uninstallerAnchor);
}

export const WINDOWS_INSTALLER_BLOBS = {
    'installer.nsi': '4b1f42e4e96ba2b3e7d6d8d2f9ee19b46779a422',
    'installSection.nsh': '053772f55ca6ece52f0a34c4fa0f05c9a5f07bd2',
    'include/installer.nsh': '300ef3dd699d0f5a081b1934fcc22dbe12025bdb',
    'include/extractAppPackage.nsh': 'f5470bf52e923dc47266cea4684c76ef78ced451',
    'include/installUtil.nsh': '47367741632726ba0886ac516461dbe98b7aea58',
    'uninstaller.nsh': 'c3f4f11982689baa220de5051bbf144adbd9accc',
};

export function withWindowsUpgrade(source) {
    const start = source.indexOf('  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\old-uninstaller.exe"');
    const end = source.indexOf('\nFunctionEnd', start);
    if (start < 0 || end < 0) throw new Error('Windows upgrade cleanup anchor mismatch');
    // 이전 설치기의 버그를 매 업데이트마다 다시 실행하지 않고 이번 빌드의 검증된 제거기를 사용한다.
    return source.slice(0, start) + String.raw`  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\paseodog-upgrade-uninstaller.exe"
  File /oname=$PLUGINSDIR\paseodog-upgrade-uninstaller.exe "${'${UNINSTALLER_OUT_FILE}'}"

  UpgradeCleanup:
    ClearErrors
    ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0
    ${'${if}'} ${'${Errors}'}
      StrCpy $R0 1603
    ${'${endif}'}
    ${'${if}'} $R0 != 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "PaseoDog 이전 설치를 정리하지 못했습니다 (종료 코드 $R0).$\r$\n설치 폴더: $installationDir$\r$\n$\r$\n파일 사용 여부와 폴더 권한을 확인한 뒤 다시 시도하세요." /SD IDCANCEL IDRETRY UpgradeCleanup
      SetErrorLevel $R0
      Quit
    ${'${endif}'}
` + source.slice(end);
}

export function withWindowsRemoval(source) {
    const start = source.indexOf('Function un.atomicRMDir\n');
    const end = source.indexOf('\n!ifndef UNINSTALL_SECTION_NAME', start);
    if (start < 0 || end < 0) throw new Error('Windows removal anchor mismatch');
    // 복사뿐 아니라 이전 파일 이동·복원·최종 제거에도 동일한 확장 경로를 사용한다.
    const functions = source.slice(start, end)
        .replaceAll('"$INSTDIR$R0', String.raw`"\\?\$INSTDIR$R0`)
        .replaceAll('"$PLUGINSDIR\\old-install', String.raw`"\\?\$PLUGINSDIR\old-install`);
    return (source.slice(0, start) + functions + source.slice(end))
        .replace('RMDir /r $INSTDIR', String.raw`RMDir /r "\\?\$INSTDIR"`)
        .replace('        DetailPrint "File is busy, aborting: $R0"',
            '        DetailPrint "File is busy, aborting: $R0"\n        StrCpy $R4 $R0')
        .replace('        Abort `Can\'t rename "$INSTDIR" to "$PLUGINSDIR\\old-install".`',
            String.raw`        MessageBox MB_OK|MB_ICONSTOP "PaseoDog 이전 파일을 이동하지 못했습니다.$\r$\n$R4$\r$\n$\r$\n파일 사용 여부와 폴더 권한을 확인하세요." /SD IDOK
        SetErrorLevel 1603
        Quit`);
}

export function withWindowsExtraction(source) {
    const before = source.slice(source.indexOf('!macro extractUsing7za FILE'));
    if (!before.startsWith('!macro extractUsing7za FILE') || !before.endsWith('!macroend\n')) {
        throw new Error('Windows extraction anchor mismatch');
    }
    // Shell의 CopyFiles는 긴 경로를 누락할 수 있으므로 검증 가능한 Win32 복사만 사용한다.
    return source.slice(0, -before.length) + String.raw`!macro extractUsing7za FILE
  Push $OUTDIR
  CreateDirectory "$PLUGINSDIR\7z-out"
  SetOutPath "$PLUGINSDIR\7z-out"
  Nsis7z::Extract "${'${FILE}'}"
  Pop $R0
  SetOutPath $R0
  StrCpy $paseodogCopySource "$PLUGINSDIR\7z-out"
  StrCpy $paseodogCopyDestination "$OUTDIR"
  StrCpy $R1 0

  LoopExtract7za:
    IntOp $R1 $R1 + 1
    Push ""
    Call paseodogCopyTree
    Pop $R0
    StrCmp $R0 0 DoneExtract7za
    DetailPrint "PaseoDog file copy failed: $R0"
    ${'${if}'} $R1 < 5
      Sleep 1000
      Goto LoopExtract7za
    ${'${endif}'}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "PaseoDog 설치 파일을 복사하지 못했습니다.$\r$\n$R0$\r$\n$\r$\n파일 사용 여부·폴더 권한·디스크 여유 공간을 확인한 뒤 다시 시도하세요." /SD IDCANCEL IDRETRY LoopExtract7za
    SetErrorLevel 1603
    Quit
  DoneExtract7za:
!macroend
`;
}

export function withWindowsInstallerSources(sources) {
    const extractor = withWindowsExtraction(sources['include/extractAppPackage.nsh']);
    const files = sources['include/installer.nsh'].replace('!include "extractAppPackage.nsh"', () => extractor);
    const section = sources['installSection.nsh'].replace('!include installer.nsh', () => files);
    return WINDOWS_UNINSTALLER_MARKER + '!ifndef BUILD_UNINSTALLER\n!insertmacro paseodogCopyTreeFunction\n!endif\n'
        + sources['installer.nsi']
            .replace('!include "installSection.nsh"', () => section)
            .replace('!include "installUtil.nsh"', () => withWindowsUpgrade(sources['include/installUtil.nsh']))
            .replace('!include "uninstaller.nsh"', () => withWindowsRemoval(sources['uninstaller.nsh']));
}
