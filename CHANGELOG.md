# Changelog

## 1.0.0-rc.7 - 2026-10-21

- Windows 업그레이드가 고장 난 이전 제거기를 반복 실행하며 프로세스 종료 경고를 띄우던 경로를 수정한다. 이번 빌드의 제거기로 이전 파일을 정리하고, 긴 경로의 이동·복원·제거를 지원하며 실제 정리 실패는 별도로 표시한다.

- 연결된 호스트의 PaseoDog 데몬 릴리즈를 확인해 클라이언트 업데이트와 별도 알림을 표시한다. 구형 데몬·조회 실패는 버전 확인 필요로 구분하며, 데몬을 자동 업데이트하거나 재시작하지 않는다(Android·PC·전용 웹 공통).

- Windows 설치 중 해당 설치 폴더에서 실행 중인 앱·내장 실행파일을 확인하고, 사용자 동의 후 강제 종료하여 설치를 계속한다. 설치기 자신·상위 설치기와 다른 설치 폴더의 프로세스는 제외한다. 종료 확인 실패 시 설치를 중단하며 무인 설치에서는 작업을 임의로 종료하지 않는다.

- Windows 설치·업데이트에서 긴 경로의 내장 의존성을 빠뜨리던 Shell 파일 복사를 Win32 확장 경로 복사로 교체한다. 복사 실패 시 파일과 오류 코드를 표시하고, 실패를 무시한 채 설치를 완료하지 않는다. 앱 실행파일에도 PaseoDog 아이콘·제품 정보를 적용한다.

- 설정 제어 프로세스의 표준입출력 오류를 처리하고 종료된 이전 프로세스의 이벤트를 새 연결과 분리한다. 저장 결과가 불확실한 요청은 자동 재전송하지 않으며, EPIPE 회귀 테스트와 CI 의존성·패치 검증을 보강한다.

- Markdown 표는 글꼴·내용을 측정해 짧은 숫자 열을 좁히고 긴 열에 남은 폭을 배분한다. 채팅·파일 미리보기와 Android·PC·웹에서 행별 열 경계를 유지한다.
- 모바일 사용자 메시지의 복사 버튼을 오른쪽 화면 가장자리에서 12px 안쪽으로 옮기고 본문 폭과 PC 배치는 유지한다.
- Android 화면 재생성 시 Expo 사진 선택기 등록을 현재 Activity에 다시 연결한다. 이전 Activity를 참조하던 등록 순서를 고치고 MainActivity의 강제 호스트 파괴 우회는 제거한다.

- 접힌 진행 기록 카드의 미리보기·여백까지 펼치기 영역을 넓히고 전송한 이미지 썸네일을 48px에서 96px로 확대한다. 입력 중 첨부 크기는 유지한다.
- 모양 → 테마에 뉴트럴 펄·소프트 린넨을 추가한다. 선택한 시안의 배경·말풍선·입력창·강조색을 Android·PC·전용 웹에 동일하게 적용하며 기존 테마와 선택값은 유지한다.
- 모바일 응답은 아이콘·닉네임 아래에서 본문 전체 너비를 사용하고 채팅 좌우 여백을 줄인다. PC 너비에서는 기존 배치를 유지한다.
- 이전 Claude 사용량 고정 항목을 전용 Mixdog 보고서의 같은 기간에 연결해 표시 선택을 보존한다.
- 에이전트 생성 시 기존 ID 덮어쓰기를 거부하고 편집 revision 충돌을 검사한다. 원본 조회 전·실패 후에는 저장을 막으며 모델 경로 검증이 끝나기 전에는 본문을 쓰지 않는다.
- 실제 세션 생성에 연결되지 않은 자동 Worktree 격리·정리·접두사 설정을 앱과 전용 웹에서 숨기고 해당 저장 요청을 거부한다. 기존 작업 폴더 실행과 Paseo의 명시적 Worktree 선택은 유지한다.

- 메시지 되돌리기는 정상 완료된 유일한 텍스트 대화만 허용한다. 실패·중복·일부 기록 누락은 거절하고, 중단된 되돌리기는 영속 마커로 감지해 자동 재실행·불일치 세션 재개를 막는다. 시각 기반 메시지 단위 파일 복구는 제거하고 체크포인트 기반 세션 도구 Undo/Redo를 유지한다.
- 압축 요약 전용 모델은 선택한 공급자로 전달하며 기본값 복원도 현재 세션에 적용한다. 절대 버퍼 토큰의 0(비율 기준)을 허용하고 효과 없는 메모리 추출 제한 시간 설정은 숨긴다. Recap 설명을 백그라운드 메모리 사이클로 바로잡는다(Android·PC·전용 웹 공통).
- Review 모드의 읽기 전용 `find`를 승인 경로에 연결한다. 스킬 선택 시 편집 본문을 함께 갱신하고 읽기 실패 시 덮어쓰기를 막는다. 파일 복구 버튼은 네이티브 복구 가능 상태에 맞춰 활성화한다.

- 압축 여유 버퍼의 앱 비율(0.2)과 엔진 퍼센트(20) 단위를 맞춘다. 기존 15·20·30% 선택값은 비율 키로 이관하고 엔진 상한에 맞춰 10·20·25% 선택지를 제공한다. 20% 버퍼는 실제 컨텍스트 한도의 80%에서 자동 압축을 시작하며, 요약 모델·모델 변경 압축·유휴 정리 설정은 유지한다.

- 빌드 시 Android 네이티브 전체 삭제와 Metro 강제 초기화, npm 패키징의 무조건적인 clean을 제거한다. 플랫폼별 캐시를 재사용하고 웹 준비 즉시 PC 패키징을 시작하며, 사용하지 않는 네이티브 실행파일의 복사와 기본 tar.gz 생성을 생략한다. 서명·무결성 검사·R8 최적화는 유지한다.
- 실제 APK·Linux·Windows 동시 빌드에서 확인된 메모리 압박 종료를 방지하도록 무거운 작업은 최대 두 개로 제한한다. APK와 PC 작업 하나는 겹치되 Linux·Windows 패키징은 순차 실행한다.
- 실제 IPC 통합 테스트의 대기 시간을 기존 RPC·부팅·턴 처리 예산에 맞춘다. 실제 처리 제한과 기록 동기화는 유지하고, 정상적인 연속 RPC가 합계 2초를 넘는 회귀 사례를 추가한다.
- 앱·전용 데몬 웹에서 접속 링크를 열면 연결 실패를 기다리지 않고 기존 링크·비밀번호 입력창을 먼저 보여 준다. 사용자가 제출하고 호스트를 확인해야 연결·저장하며, 취소 시 연결하지 않는다. 비밀번호 없는 호스트와 비밀번호 포함 링크도 기존 제출 동작을 유지한다. 외부 `app.paseo.sh` 호스팅 웹은 변경하지 않는다.
- Android·iOS 대화 화면에서 접힌 진행 기록 등으로 최근 페이지가 화면보다 짧아 스크롤할 수 없을 때도 이전 기록을 자동 조회한다. 화면·내용 측정이 끝난 뒤에만 시작하고 중복 요청·실패 후 자동 반복은 막는다. 웹·PC는 기존 휠·터치 페이지 이동을 유지한다.

- 사용자 메시지의 되돌리기 메뉴(대화·파일·둘 다)를 PaseoDog 세션에서도 사용할 수 있게 한다. 대화는 Mixdog 원본 절단으로 해당 메시지부터 모델 기록과 화면 기록을 함께 지우고, 파일은 해당 턴 이후의 변경을 최신 턴부터 복구한다. 이미지·명령·에이전트 전달·추가 지시 메시지, 압축으로 모델 대화에서 빠진 메시지, 같은 내용이 뒤에 다시 나오는 메시지는 되돌리지 않고 거절한다. 응답 중에는 실행하지 않고, Review 모드에서는 파일을 복구하지 않는다. 데몬이 되돌린 턴을 다시 그리지 않도록 원본 해시 검증 패치와 공유 서버 원본에 같은 처리를 추가한다(Android·데스크톱·웹 공통, 기존 메뉴 사용).

- AI 사용량·에이전트 분석 창을 정리한다. 창·탭·화면 제목이 겹치던 머리글을 하나로 줄이고, 사용량은 요약 → OAuth 한도 → 토큰 추이·구성 → 제공자·모델 → 에이전트·Effort 순으로 배치한다. 모델·Effort 지표는 칸마다 라벨을 반복하던 칩 대신 머리글 한 줄의 정렬된 표로 보여 준다. 실행 현황 세션 카드는 상태 배지와 모델·추론·모드·컨텍스트 항목으로 묶는다(플러그인 UI, Android·데스크톱·웹 공통).

- 데스크톱 설치 파일(.deb·AppImage·Windows 설치형) 압축을 최대에서 보통으로 바꿔 패키징 시간을 줄인다. 설치 파일 크기는 다소 커진다.

- 대화 집중형 레이아웃을 적용한다. 연녹색 사용자 말풍선, 도우미 아바타·닉네임, 타임라인형 진행 기록과 정돈된 입력창을 Android·데스크톱·웹에 함께 제공한다. 설정의 채팅에서 도우미 닉네임을 변경할 수 있고 기본값과 빈 값은 `Dog`다.

- 릴레이 주소 발급과 접속에 별도 비밀번호를 필수로 요구한다. 첫 발급에서 설정한 암호는 해시로만 저장하고 재발급 때 확인하며 주소·QR에는 포함하지 않는다. 무비밀번호 릴레이 허용을 제거하고 로컬 접속 인증은 유지한다(Android·데스크톱·웹·CLI 공통).

- 릴레이 비밀번호를 잊었을 때 PC의 Pair Device(“비밀번호·주소 재설정”) 또는 `paseodog daemon pair --reset-password`로 새 비밀번호와 새 주소를 함께 설정한다. 데몬 키를 교체해 이전 주소·비밀번호를 모두 무효화하고 호스트가 잠시 재시작되며, 손상된 비밀번호 파일도 복구한다. Paseo Hub에 연결된 호스트는 해제 전까지 재설정을 거부한다. 재시작 중에도 발급한 주소를 계속 표시하고, 주소 입력창은 비밀번호를 비워도 제출해 비밀번호 없는 호스트·비밀번호가 들어 있는 직접 연결 링크를 막지 않는다. CLI의 비밀번호 발급 요청 대기 시간을 늘려 느린 기기에서 발급 성공을 실패로 표시하지 않는다(Android·데스크톱·웹·CLI 공통).

- 워크플로의 네이티브 기본값과 미지정 설정을 `사용 안 함`으로 통일한다. 이 상태에서는 `WORKFLOW.md`를 읽거나 대화 지침에 추가하지 않는다. 명시적으로 선택한 다른 워크플로는 유지한다. 앱의 `사용 안 함`은 문서 편집기를 열지 않고 바로 선택하며 잘못된 기본 템플릿 안내를 수정한다(공유 앱·웹 플러그인 공통).

- 토큰 절감 설정의 중복 Auto-Effort 스위치를 제거한다. 자동 추론은 채팅 입력창의 effort 선택에서 계속 사용하며, 기존 설정값은 바꾸지 않는다(Android·데스크톱 공통 원본; 웹 설정에는 이미 중복 스위치가 없음).
- Windows·Linux 데스크톱에 대상 OS용 Mixdog 엔진·네이티브 도구·PaseoDog 플러그인을 포함한다. 첫 실행 권한 확인 후 전용 로컬 데몬을 설정하며, 별도 Node·Git·서버 설치 없이 기존 계정 연결 화면에서 로그인할 수 있다. 기존 수동 서버·계정·플러그인 등록은 보존한다.
- 릴리즈 태그·APK·설치파일·AppImage·업데이트 표시에 공통 버전 `1.0.0-rc.7.<빌드 번호>`를 사용하고 Linux AppImage를 .deb와 함께 배포한다.

- 사이드바 최근 목록에서 분할 화면으로 함께 열린 세션이 둘 이상 보이면, 그중 가장 최근 세션 아래에 나머지를 붙이고, 들여쓰기·아이콘 없이 옅은 파란 박스와 왼쪽 강조선으로 한 묶음임을 표시한다. 최근 목록에서 세션을 누르면 그 세션을 보여 주는 칸의 강조 테두리가 0.4초씩 두 번 깜빡인다(간격 0.12초, 총 0.92초). 다시 누르면 처음부터 재생한다(Android·데스크톱 공통 원본, 최근 목록은 웹 번들에 없음).
- 공급자 연결이 끊겨 `[System Error] Provider connection closed`로 끝난 마지막 턴 아래에 "이어서 진행하기" 버튼을 표시한다. 누를 때만 같은 세션에 "이어서 진행" 메시지를 한 번 보내며, 실패해도 자동으로 다시 보내지 않는다. 읽기 전용 화면에는 표시하지 않는다(공유 앱 원본·웹 번들 패치 공통).
- 펼친 "추론·진행 기록" 박스 맨 아래에 접기 버튼을 추가한다. 긴 기록을 끝까지 읽은 뒤 위로 올라가지 않고 접을 수 있다. 한국어 응답 제목은 "답변" 대신 "응답"으로 표시한다(공유 앱 원본·웹 번들 패치 공통, 이전 렌더러 주입본은 해시 검증 후 교체).
- Windows에서도 데몬을 설치·실행할 수 있게 한다(시험 지원). 설치는 공통 Node 설치 스크립트(`scripts/install.mjs`, Linux는 `install.sh`가 호출)로 합치고, 상태는 `%LOCALAPPDATA%\paseodog`, 런처는 `paseodog.cmd`를 쓴다. 세션 엔진은 .NET Framework 기본 `csc.exe`로 빌드한 헬퍼가 Job Object(`KILL_ON_JOB_CLOSE`)에 묶어 실행해, 세션 중지·크래시 때 셸 하위 프로세스까지 종료한다. 자동 시작은 사용자 Run 키로 등록한다. CLI는 npm `.bin` 래퍼 대신 Node로 진입 파일을 직접 실행한다.
- 사이드바 쿼터 요약(막대·도넛)의 공급자 순서를 Claude → Codex로 바꾼다. 이전 순서 패치가 적용된 데몬 웹 UI도 원본 해시 검증을 거쳐 새 순서로 교체한다(공유 앱 원본·웹 번들 패치 공통).
- README를 릴리즈 다운로드 링크와 설치법만 남기도록 정리한다. 플랫폼별 파일, 데몬 설치·자동 시작·업데이트, 앱 연결 방법을 적는다.
- Windows x64 데스크톱을 설치형(NSIS `.exe`)으로만 다시 함께 배포한다. 최대 압축 zip은 빌드 시간(약 9분)에 비해 이점이 없어 대상에서 뺀다. Linux에서 교차 빌드하며 Windows용 런타임 바이너리(sherpa-onnx 로컬 음성 인식, 플러그인 컴파일용 esbuild)를 포함한다.
- 새 작업공간 이름이 첫 대화가 끝난 뒤 AI 대화 제목(첫 요청 요약)으로 바뀌거나 덧붙던 문제를 고친다. 대화 자동 제목은 세션 제목에만 적용하고 작업공간 이름은 프로젝트 이름을 유지한다. 이전 패치가 설치된 데몬도 원본 해시 검증을 거쳐 교체한다(공유 서버 원본·데몬 패치 공통). 이미 바뀐 이름은 되돌리지 않는다.
- 사이드바 쿼터(막대·도넛)가 눌러서 사용량 창을 열 때만 갱신되던 문제를 고친다. usage_widget 폴링 주기처럼 보는 동안 2분마다 다시 조회한다. 강제 갱신이 아니므로 실제 공급자 조회는 데몬의 5분 캐시가 호스트 전체에서 묶는다(공유 앱 원본·웹 번들 패치 공통).
- 사이드바 최근 세션 목록에서 열어서 확인한 완료 세션(회색 체크)은 체크 없이 표시한다. 안 읽은 완료(초록 체크)는 세션을 열면 사라진다. 작업공간·고정 목록 표시는 그대로다(Android·데스크톱 공통 원본, 최근 목록은 웹 번들에 없음).
- 로컬 음성 인식(받아쓰기·음성 모드) 기본 모델을 영어 전용 Parakeet v2에서 SenseVoice Small int8(한국어·영어·중국어·일본어·광둥어 자동 감지, 약 160MB)로 바꾼다. 무료·오프라인이며 첫 사용 시 데몬이 모델을 내려받는다. 설정에 모델을 직접 지정한 경우는 그대로 유지한다(공유 서버 원본·고정 데몬 해시 검증 패치 공통).
- 앱의 GitHub·Discord 외부 링크 버튼을 제거한다. 대상은 홈·설정 하단의 Star·Upstream Sponsor·Upstream Community, 시작 화면의 `PaseoDog · GitHub` 링크, 시작 오류 화면의 `Open GitHub issue`·`Docs`, 변경 내역 시트의 외부 링크다(공유 앱 원본·웹 번들 패치 공통). GitHub PR·클론 연동과 릴리즈 업데이트 경로는 유지한다.
- Mixdog 엔진을 1.3.1로 올린다. 사용량 한도에 걸린 모델의 다음 모델 전환, 재시작 후 대기 메시지·첨부 보존, 취소 후 자식 프로세스 정리, Auto effort judge v7이 포함된다. 기존 로컬 패치는 1.3.1 원본 해시로 다시 고정하고, 턴 전 워크플로 갱신 패치는 새 `stagePolicy` 구조에 맞춰 이식했다.
- 토큰·OAuth 사용량 화면을 보는 동안 2분마다 자동 갱신한다. 호스트가 여러 클라이언트의 OAuth 실시간 조회를 약 2분에 1회로 묶고, 이전 값으로 대체된 실패는 75초~10분 지수 백오프로 늦춘다. 수동 새로고침은 백오프를 무시하되 15초 간격을 지킨다(usage_widget 방식, 웹·Linux·Windows·Android 공통).
- 사용량 옵션(톱니)에 `Sidebar style`(Bars/Donuts)을 추가한다. Donuts를 고르면 사이드바 쿼터를 창마다 사용률 링·공급자 아이콘·짧은 이름과 초기화까지 남은 시간(`0:53`, `6D`)으로 표시한다. 기본값은 기존 막대다(웹 번들 패치·공유 앱 원본 공통). 도넛 줄은 가운데 정렬하고 하단 행 컨테이너 여백까지 포함해 상하 여백을 없앴으며, 데스크톱·웹에서 마우스를 올리면 usage_widget 툴팁처럼 공급자당 한 줄(`Claude: 5H 31% / 7D 64%`, 계정 이메일이 붙어도 줄바꿈 없음)로 사용량을 보여 준다.
- 같은 세션의 모델·프로바이더·Fast·컨텍스트 한도를 네이티브 `setRoute`로 변경한다. 기본 Main 모델과 세션 ID는 유지한다.
- 같은 모델에서 컨텍스트 한도를 바꿀 때 선택값만 바뀌고 실제 세션은 이전 한도를 유지하던 네이티브 결함을 원본 해시 검증 패치로 수정한다.
- 세션 도구에서 대화 계승, 턴·파일별 Undo/Redo, 실제 모델 메시지 조회를 제공한다. 복구는 명시적 확인과 네이티브 revision 검사를 거친다.
- 확인된 quota 실패의 계속하기·재개 예약·취소를 제공한다. 기존 명령과 불확실한 실행은 재전송하지 않으며 연결 종료 뒤 예약을 자동 복원하지 않는다.
- 전용 프로필의 MCP 관리·OAuth, 스킬 추가·수정·재로딩, 플러그인 설치·갱신·활성화·삭제 화면을 연결한다.
- 컨텍스트 윈도우 툴팁(데스크톱·웹 hover, 모바일 시트)에 Mixdog과 같은 "컨텍스트 압축" 버튼을 추가한다. 프로바이더가 `compact` 명령을 광고할 때만 보이고, 턴 실행 중·연결 끊김에는 비활성화된다.
- 수동 compact를 Mixdog 채팅의 `recoverAgent: true` 호출과 일치시킨다. 로컬 규칙 정리와 필요할 때만 수행하는 모델 요약은 원본 엔진이 담당한다.
- 기능 UI는 Android·Linux·Windows·web의 공통 플러그인 소스에 적용한다. 배포 산출물 대상은 Galaxy S25 arm64-v8a와 Linux다.
- 컨텍스트 윈도우 시트·hover 카드의 "컨텍스트 압축" 버튼을 강조 채움·아이콘·가운데 정렬로 바꿔 잘 보이게 한다(Android·iOS·데스크톱 공통 원본).
- 진행 중인 턴에서 단계가 메시지 끝에서야 붙는 공급자도, 도구가 뒤따르지 않은 마지막 본문은 진행 기록 대신 답변 자리에 바로 흘려 표시한다. 뒤이어 도구가 시작되거나 `commentary`로 확정되면 진행 기록으로 옮긴다. 추론 숨기기 모드는 기존 규칙을 유지한다(Android·iOS·데스크톱·데몬 웹 UI 공통).
- 탭 전환 행의 직접 닫기(X) 버튼을 되살린다. "…" 메뉴의 닫기 항목과 같은 동작을 쓰며 행 선택으로 전파되지 않는다(Android·iOS·데스크톱·웹 공통 원본).
- Android에서 화면 크기·글꼴·언어·멀티윈도 같은 설정 변경으로 화면이 재생성된 뒤 이미지 첨부가 `Attempting to launch an unregistered ActivityResultLauncher`로 실패하던 문제를 고친다. expo의 비동기 `onDestroy` 대신 재생성 시 React 호스트 파괴를 동기 통지해 이미지 선택 계약을 새 화면에 다시 등록한다(Android 전용 네이티브 설정 플러그인).
- 릴리즈 빌드의 Metro 캐시를 보존하고 공통 패키지 중복 빌드를 제거한다. 서버·CLI를 포함한 TypeScript 패키지는 삭제·설정 변경·불완전 출력에 안전한 증분 빌드를 사용하며, 데몬 웹 UI는 최대 품질을 유지한 검증된 압축 캐시를 재사용한다.

## 1.0.0-rc.6 - 2026-10-19

- 모바일 `탭 전환` 시트 제목 오른쪽에 새 에이전트 `+` 버튼을 추가한다. 시트를 닫고 현재 작업공간에 새 초안을 열며 기존 세션은 유지한다.

- Linux 데스크톱 업데이트에 누락된 `resources/icon.png`를 PaseoDog 브랜드 자산으로 설치해 실행 창의 기본 아이콘 대체를 방지한다.

- 좌측 호스트 설정 메뉴에 누락된 `에이전트` 항목을 복구한다. 기존 도구 활성화·시스템 프롬프트·오케스트레이션 스킬·에이전트 프로필 화면으로 연결한다(웹·Linux·Windows·Android 공통).

- 설정 → 채팅의 "추론 숨기기"(기본 꺼짐)를 켜면 중간 안내·추론·도구 행과 그 여백을 숨기고, 작업 완료 후 최종 답변만 표시한다. 승인 요청·오류·모델 추론·네이티브 기록은 유지한다(웹·Linux·Windows·Android 공유 표시 경로).

- 출력 스타일에 형식 지시를 주입하지 않는 `default` 항목을 추가한다. 기존 스타일 선택과 미설정 시 기본 동작은 유지한다.

- 데스크톱 자동 업데이트 확인이 꺼진 상태를 “최신”으로 표시하지 않고 수동 업데이트 안내로 구분한다.

- 사이드바의 워크트리 스크립트 설정 권유 팁을 숨기고 프로젝트 설정 기능은 유지한다.

- 새 작업공간은 프로젝트명을 임시 이름으로 쓰고, PaseoDog 응답 완료 후 최근 대화의 대상·목표를 요약해 세션·사이드바 제목을 자동 갱신한다. 같은 목표의 구현·검증·배포·후속 수정은 기존 제목을 유지하도록 제목 생성기에 지시한다. 수동 이름과 출처가 불명확한 기존 이름은 보호하고, 오래된 결과·보관·실패·취소·종료는 재적용하지 않는다. 기존 Mixdog `title-agent` 경로로 완료당 짧은 별도 호출이 추가되며 설정 비활성화·실패·시간 초과 시 기존 이름을 유지한다.
- 사이드바 A안: 진행 링·완료 체크·입력 대기 느낌표로 구분한다. 상태 배지나 추가 행은 넣지 않고 프로젝트 아이콘의 코너 표시에도 같은 의미를 적용한다. Claude 사용량 카탈로그의 로고 누락을 고치고 도넛 내부 아이콘은 Codex 파랑·Claude 주황으로 표시한다. 사용률 링의 기존 경고·위험 색은 유지한다(웹·데스크톱·Android·iOS 공통 원본).
- 채팅 A안: 공급자가 명시한 `commentary`·`final_answer`와 메시지 경계를 보존해 추론·중간 안내·도구를 기본 접힘 기록으로 묶고 답변은 별도 제목 아래 표시한다. 작업 중에는 마지막 진행 안내 한 줄을 보여 주고, 승인·오류·실패·취소 도구는 접힌 기록 밖에 둔다. 기존 추론 숨기기 설정과 모델의 대화·컨텍스트는 유지하며, 이미 합쳐 저장된 옛 본문을 의미 추측으로 재분할하지 않는다.

- 사이드바 쿼터 요약의 공급자 순서를 응답 도착 순서와 무관하게 Claude → Codex로 고정하고, 주간 창 짧은 이름 `wk`를 `7D`로 표시한다. 쿼터 값·창 구분·5H 표시는 유지한다(웹·데스크톱·Android 공통).

- 오케스트레이션을 단독 실행·에이전트 협업으로 단순화하고 입력창 권한 선택 옆에 호스트 전체 협업 스위치를 추가한다. 이전 저장 모드는 협업으로 호환하며 승인 정책·비활성 에이전트·네이티브 대화 내용은 유지한다.

- 도구 런타임의 취약한 MCP SDK·AI SDK·Markdown·UUID 하위 의존성을 보안 수정 버전으로 고정한다. Paseo·Mixdog 기반 버전과 검토한 원본 해시는 유지한다.

- 실제 실행 중 지시를 네이티브 영속 입력 큐에 연결해 기존 턴을 취소하지 않고 A+B로 처리한다.
- 기본 워크플로우 미사용, 모델 미선택 저장 차단, 숙련도 선택 UI를 PaseoDog 경로에 적용한다.
- 데스크톱 업데이트 준비 단계에서 제품 버전·기반 버전·입력 패치를 항상 함께 적용하고 상위 제품의 자동 업데이트로 덮이지 않게 한다.

## 1.0.0-rc.5 - 2026-10-19

- PaseoDog 자체 버전과 기반 버전을 분리해 관리한다. 기반: Paseo CLI/SDK 0.11.4, Mixdog 엔진 1.2.6.
- CLI와 엔진의 제품 버전은 루트 `package.json`을 재사용하고 `paseodog --version`에 기반 버전도 표시한다.
- Claude 사용량을 Mixdog 인증 갱신·캐시 경로로 연결하고 토큰·비용·모델 통계와 OAuth 할당량 화면을 추가한다.
- 워크플로우 사용 안 함과 빈 본문 저장을 지원하고 미지원 steering 요청을 전송하기 전에 Paseo의 기존 대체 경로로 연결한다.
- SDK 타입 검사와 로컬 회귀 검사, 실제 사용량 조회는 검증했으며 휴대폰 실기기·유료 모델 호출 검증은 별도다.

## Android 11013 / integration refresh

- Pin Paseo CLI/SDK to 0.11.4 and Mixdog to 1.2.6, preserving reviewed source-hash gates and explicit per-call approvals.
- Backport SSH permission acknowledgement and both sides of Korean terminal snapshot restoration; retain the existing Android input-order patch.
- Split custom Android host settings into accounts, workflows, token controls, instruction loading and agents; use a login modal and unchanged native workflow/agent bodies.
- Selectively backport streaming reconnect reconciliation and Korean terminal copying without adopting the beta navigation redesign.
- Keep real-device, subscription-account and production acceptance explicitly unverified; dependency audit warnings remain disclosed.

## 1.0.0-rc.4 - 2026-10-12

- Avoid unhandled rejections and silent containment failure when journal flush
  and native scope kill both fail. Mark the accepted turn uncertain; stop sending
  its callbacks; emit failure/containment notices; bound the kill confirmation.
- Add deterministic regressions for rejected/thrown/hung/successful cleanup.
- Provide an opt-in, exact-upstream-blob Paseo Android input patch (Samsung-style
  callback reordering, Backspace and Hangul) with synthetic contract tests.
  **Does not update APKs or prove physical cursor pixel alignment.**
- Add upstream-source patch compilation check to SDK CI.

## 1.0.0-rc.3 - 2026-10-12

- Make package security tests operate exclusively on isolated temporary source copies; never delete real source tree state.
- Observe worker `exit` rather than only stream `close` and immediately settle uncertain RPCs.
- Require a separate Linux systemd user scope/cgroup per session, fail closed without systemd --user, and verify cgroup population is empty after stop.
- Refuse native text resets because the pinned Paseo adapter cannot retract previously displayed deltas; enforce monotonic assistant snapshots.
- Commit exact CI-produced npm lockfiles, use `npm ci` for all dependencies and verify integrity in CI.
- Add real-process, scope contract, replay and package-isolation regression tests.
- Still requires a real systemd host / model / mobile acceptance run before production.

## 1.0.0-rc.2 - 2026-10-12

- Fix pinned Paseo SDK readonly capability typecheck failure (TS4104).
- Scope worker callbacks, identity and tool approval to their originating turn; deny late approval callbacks.
- Bound IPC tool previews before serialization, preserving original Mixdog model context.
- Launch separate Unix process groups and terminate descendants on crash, timeout, or force-stop.
- Report unexpected worker death to Paseo; reject new turns until explicit reopen.
- Isolate Mixdog state directories against ambient environment overrides and reject reserved session variables.
- Treat release MANIFEST.sha256 as an explicit allowlist to exclude accidental runtime credentials.
- Include actual native compaction token usage deltas in UI and journal accounting.
- Honor global CLI options before run; keep default PaseoDog provider unless explicitly overridden.
- Release journal locks on recovery write failure; reject mismatched native model/provider before inference.
- Reject unsupported initial session settings, add regression tests and CI native installation checks.

## 1.0.0-rc.1 - 2026-10-11

- Replace the starter's in-process runtime sketch with a per-session process host.
- Preserve native Mixdog history through versioned bridge persistence and a durable
  receipt ledger; reject ambiguous recovery instead of automatically replaying work.
- Add session environment/MCP/system instruction propagation and actual native route
  retention, with isolation from ordinary Paseo/Mixdog profiles.
- Add a source-hash-gated native beforeSessionAsk hook and explicit tool approval policy.
- Add bounded permissions, interrupt escalation, stable streaming IDs, native reset
  semantics, safe result projection, bounded replay, process locks and UTF-8 framing.
- Supply SSH launcher, dependency installer, private configuration, diagnostics,
  systemd generator, explicit-cost live smoke, CI and source packaging with hashes.
- Add 71 local tests including actual child-process and disk-journal integration paths.
- Retain RC status: npm registry DNS was unavailable, installed SDK/native package
  execution and actual Linux server/mobile acceptance have not been completed here.
- No custom APK/IPA, no complete upstream source/binary bundle and no benchmark promise.
