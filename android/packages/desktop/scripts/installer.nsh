!macro customCheckAppRunning
  Push $R0
  Push $R1
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 603
    Goto paseodog_processes_closed
  ${EndIf}
  ${If} $R0 != 0
    MessageBox MB_OK|MB_ICONSTOP "PaseoDog 실행 상태를 확인하지 못했습니다. 설치를 중단합니다. (오류 $R0)" /SD IDOK
    SetErrorLevel 1603
    Quit
  ${EndIf}

  ; 무인 설치에서는 실행 중인 작업을 임의로 중단하지 않는다.
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "PaseoDog 앱 또는 백그라운드 프로세스가 실행 중입니다.$\r$\n$\r$\n모두 종료하고 설치를 계속할까요? 진행 중인 작업이 중단되며 저장하지 않은 내용이 손실될 수 있습니다." /SD IDNO IDYES paseodog_close_processes
  SetErrorLevel 1602
  Quit

  paseodog_close_processes:
  ; 창 닫기를 먼저 요청하고 3초 뒤에도 남은 프로세스는 플러그인이 강제 종료한다.
  ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R1
  StrCpy $R1 0
  paseodog_wait_for_exit:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 603
      Goto paseodog_processes_closed
    ${EndIf}
    ${If} $R0 == 0
    ${AndIf} $R1 < 10
      Sleep 500
      IntOp $R1 $R1 + 1
      Goto paseodog_wait_for_exit
    ${EndIf}

  MessageBox MB_OK|MB_ICONSTOP "PaseoDog 프로세스를 종료하지 못해 설치를 중단합니다.$\r$\n$\r$\n설치 파일을 마우스 오른쪽 버튼으로 눌러 '관리자 권한으로 실행'한 뒤 다시 시도하세요." /SD IDOK
  SetErrorLevel 1603
  Quit

  paseodog_processes_closed:
  ${nsProcess::Unload}
  Pop $R1
  Pop $R0
!macroend
