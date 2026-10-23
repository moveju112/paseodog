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
};

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
        + sources['installer.nsi'].replace('!include "installSection.nsh"', () => section);
}
