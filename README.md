# PaseoDog · 1.0.0-rc.4

**Linux에서 Mixdog 엔진을 실행하고, Paseo의 휴대폰·PC·웹·SSH 인터페이스로 같은 작업을 제어하는 독립 통합 프로젝트입니다.**

## 배포 상태

이번 파일은 스타터가 아닌 **통합 구현과 운영 도구를 보완한 릴리스 후보(RC)**입니다. 회귀 검사 **100개 이상 통과**, JavaScript·JSON·Shell 구문 검사 통과, 실제 자식 프로세스와 디스크를 사용하는 통합 테스트를 포함합니다.

그러나 **실제 Mixdog 모델 호출, Paseo 플러그인 로딩과 세션 생성, 휴대폰 외부망 연결, 서버 재부팅 검증은 완료하지 않았습니다. (GitHub CI에서 SDK 타입 검사와 Mixdog 설치 검사는 통과해야 합니다.)** 개발 컨테이너의 npm DNS 요청이 `EAI_AGAIN`으로 실패했고, 모델 계정·휴대폰·사용자 서버가 없습니다. 컨테이너 Node는 22.16.0으로 실제 설치 대상 버전보다 낮습니다. 모의 엔진 테스트 결과를 실계정 통합 성공으로 표시하지 않습니다.

검증 근거: [`reports/PREFLIGHT-FIXES.md`](reports/PREFLIGHT-FIXES.md), [`reports/VERIFICATION.md`](reports/VERIFICATION.md). 기존 `reports/unit-tests.tap`은 rc.1 실행 기록입니다.

## 포함된 구현

| 영역 | 구현 내용 |
|---|---|
| Paseo Provider | `paseodog` 에이전트 등록, 모델 경로 선택, 세션 생성·목록·복원 |
| Mixdog 연결 | 세션별 Node 자식 프로세스, JSONL 통신, 네이티브 런타임 직접 사용 |
| 대화·작업 | 스트리밍, 도구 상태, 사용량, 수동 `/compact`, 작업 중단 |
| 권한 | 모든 도구의 1회 승인·거절, 만료 시 거절, 늦은 승인 무효화 |
| 복구 | 원자적 세션 기록, PID·시작 시각 기반 잠금, 메시지 ID 중복 실행 방지 |
| 불확실한 작업 | 중간 종료된 요청을 자동 재실행하지 않음; 파일 확인 뒤 새 지시 필요 |
| 서버 운영 | 전용 설정·인증 디렉터리, 설치·진단 스크립트, systemd 사용자 서비스 생성 |
| 검증·배포 | 단위·프로세스·디스크 통합 테스트, CI 설정, 소스 ZIP 및 SHA-256 목록 생성 |

Mixdog의 압축·도구 출력 관리·캐시 로직은 재구현하지 않고 원본 엔진에 맡깁니다. 단, 권한 경계를 검증하지 못한 네이티브 하위 에이전트·자동화·데스크톱 제어는 차단합니다. **원본과 모든 기능이 같거나 토큰이 63% 절약된다고 보장하지 않습니다.**

## 빠른 시작 — Ubuntu/Linux

필요: **Node.js 24 계열 권장**, Git, npm, 인터넷, 비-root 개발 사용자, **실행 중인 systemd 사용자 매니저(Linux)**. 지원 선언은 `^22.19.0 || >=24.0.0`입니다. Node 22.16 및 23 계열은 설치 스크립트에서 거절합니다.

프로젝트를 계속 유지할 디렉터리에 압축 해제합니다. 설치 후 경로를 옮기면 다시 설치해야 합니다.

```bash
cd paseodog
bash scripts/install.sh
```

`TRUST`를 입력하면 검증된 lockfile로 `npm ci`를 수행하고, 테스트·SDK 타입 검사·Mixdog 패치를 검사한 뒤 전용 Paseo 설정을 작성합니다. Linux에서는 systemd 사용자 scope/cgroup을 사용할 수 없으면 에이전트를 시작하지 않습니다. 작업별 하위 셸의 별도 프로세스 그룹도 같은 cgroup 안에서 종료합니다. 플러그인은 샌드박스가 아니며 현재 Unix 사용자의 파일·네트워크 권한으로 실행됩니다. 자동화 환경에서는 같은 동의를 명시하는 `--trust-plugins` 옵션을 사용할 수 있습니다.

```bash
~/.local/bin/paseodog auth
~/.local/bin/paseodog password
~/.local/bin/paseodog daemon restart
~/.local/bin/paseodog doctor
```

`auth`는 **전용 Mixdog 프로필**의 TUI를 엽니다. 계정 로그인 또는 API 키 설정을 마친 뒤 종료합니다. GUI 없는 서버의 OAuth 로그인 방식과 계정 사용 가능 여부는 제공자별로 확인해야 합니다. 인증이나 유료 호출을 설치 프로그램이 대신 진행하지 않습니다.

처음에는 테스트용 Git 저장소에서 사용합니다.

```bash
cd ~/dev/test-repository
~/.local/bin/paseodog run --no-wait "프로젝트 구조를 읽고 설명해줘. 파일은 수정하지 마."
~/.local/bin/paseodog ls
~/.local/bin/paseodog attach <agent-id>
~/.local/bin/paseodog send <agent-id> "다음으로 테스트 구성을 확인해줘."
~/.local/bin/paseodog stop <agent-id>
```

기본 모드는 읽기 도구도 승인받습니다. 앱에서 승인 카드를 처리하거나 Paseo의 권한 관리 CLI를 사용합니다. SSH와 휴대폰에서 **같은 Paseo agent-id**를 사용하세요. 동일한 네이티브 Mixdog 세션을 별도 `mixdog` CLI로 동시에 열지 마세요.

## 휴대폰 외부 연결

**기존 Paseo Android/iOS 앱**을 사용합니다. 자체 이름으로 빌드한 APK/IPA는 포함하지 않습니다.

기본값은 로컬 `127.0.0.1:6767`, 외부 릴레이 꺼짐입니다. 암호 설정 후 다음 중 하나를 명시적으로 구성합니다.

- Paseo 암호화 릴레이: `paseodog daemon config set daemon.relay.enabled true` 실행 후 앱의 호스트 설정에서 **Pair Device**를 사용합니다.
- Tailscale/VPN: 서버의 VPN IP에만 리스닝하고 허용 호스트를 설정합니다. 휴대폰도 같은 VPN에 접속합니다.

세부 명령과 재접속 검증은 [`docs/OPERATIONS.md`](docs/OPERATIONS.md)에 있습니다. 포트포워딩이나 공인망의 무인증 `0.0.0.0` 노출을 자동 설정하지 않습니다.

## 실제 계정 검증

```bash
cd /설치/경로/paseodog
node scripts/live-smoke.mjs --confirm-api-use
```

이 명령은 **실제 모델 요청 2회**를 수행해 응답과 네이티브 세션 복원을 확인합니다. API 비용 또는 구독 할당량이 사용될 수 있습니다. 모든 도구 실행은 거절합니다. 이 테스트만으로 Paseo 플러그인 로딩·실제 도구 승인·휴대폰 연결이 검증되는 것은 아닙니다. 전체 체크리스트는 [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)를 따릅니다.

## 독립 설정과 데이터

기본 데이터 루트: `~/.local/share/paseodog/`. 설치 전 `PASEODOG_HOME`으로 바꿀 수 있습니다.

```text
paseodog/
├── paseo/      # Paseo 전용 설정·기록
├── mixdog/     # Mixdog 전용 인증·원본 세션
└── sessions/   # 어댑터 기록·메시지 영수증·잠금
```

일반 `~/.paseo`, `~/.mixdog` 프로필을 덮어쓰지 않습니다. 기본 포트 6767이 다른 Paseo 인스턴스에 사용 중이면 전용 프로필의 `daemon.listen`을 변경해야 합니다. 비밀키·OAuth 토큰이 담긴 데이터 루트를 Git 또는 지원 요청에 첨부하지 마세요.

## 버전·파일 구성

Paseo `0.11.2`, Mixdog `1.0.12`를 직접 의존성으로 고정합니다. Mixdog의 특정 원본 파일 해시가 일치할 때에만 정책 콜백 패치를 적용합니다. 무조건 최신 버전으로 갱신하지 마세요.

**전체 원본 저장소, node_modules, 실행 바이너리는 ZIP에 포함하지 않습니다.** 최초 인터넷 설치 시 내려받으며, 생성된 lockfile을 검토·커밋한 뒤 이후 설치에서는 `npm ci`를 사용합니다. 검토한 lockfile이 저장소에 포함되지 않은 경우에는 모든 전이 의존성이 동결된 오프라인 배포판은 아닙니다.

```text
plugin/        Paseo Provider와 영속 기록
engine/        Mixdog 프로세스 호스트·권한 정책
bin/           사용자용 paseodog 명령
tools/         고정 버전 Paseo CLI 의존성
scripts/       설치·패치·진단·서비스·실계정 검사·압축
config/        사용자 지정 모델 경로 예시
tests/         모의 엔진 및 실제 IPC/디스크 테스트
reports/       이번 실행의 검증 결과
```

## 현재 범위에서 제외한 기능

이미지·첨부파일 입력, 실행 중 steering, 실행 중 모델 변경, Hub의 도구 사전 승인, Mixdog 네이티브 하위 에이전트·스케줄러·데스크톱 제어, 자체 브랜드 APK는 지원 완료로 선언하지 않습니다. 구현하지 않은 capability는 광고하지 않고 요청을 거절합니다. 기존 starter의 v1 영속 기록은 자동 이관하지 않으며 새 세션이 필요합니다.

토큰·성공률 비교는 `scripts/benchmark-report.mjs`로 **동일 모델·effort·작업 집합의 실제 측정값**을 입력해 계산합니다. 금액과 토큰 수는 같은 지표가 아닙니다.

## 개발

```bash
npm run check
npm test
npm run typecheck      # plugin 의존성 설치 필요
npm run package       # Python 3 필요
```

Android native 터미널 입력 수정안은 **별도 Paseo 앱 소스 패치**이며 설치된 APK를 자동으로 바꾸지 않습니다. [Android 터미널 수정과 실기기 수용 검사](docs/ANDROID-TERMINAL.md)를 참조하세요.

관련 문서: [아키텍처](docs/ARCHITECTURE.md), [운영](docs/OPERATIONS.md), [보안 경계](docs/SECURITY.md), [상위 프로젝트·패치](docs/UPSTREAM.md).

라이선스: Apache-2.0. 서드파티 라이선스 및 고지는 `NOTICE`와 각 설치된 패키지를 확인하세요.