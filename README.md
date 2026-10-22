# PaseoDog

## [⬇ 최신 릴리즈 다운로드 — Android · Windows · Linux](https://github.com/moveju112/paseodog/releases/latest)

모든 파일은 릴리즈 이름과 같은 하나의 버전(예: `1.0.0-rc.7.11052`)을 씁니다.

| 플랫폼 | 파일 |
|---|---|
| Android (arm64) | `PaseoDog-<버전>-arm64-v8a.apk` |
| Windows (x64) | `PaseoDog-Setup-<버전>-x64.exe` |
| Linux (x64, Debian·Ubuntu) | `PaseoDog-<버전>-amd64.deb` |
| Linux (x64, 기타 배포판) | `PaseoDog-<버전>-x86_64.AppImage` |

Linux 서버(또는 Windows PC)의 데몬이 Mixdog 엔진을 실행하고, 휴대폰·PC 앱·웹에서 같은 세션을 제어합니다. 앱만으로는 동작하지 않으니 먼저 데몬을 설치하세요.

## 1. 데몬 설치 (Linux 서버)

필요: Node.js `^22.19.0` 또는 `>=24`, Git, npm, systemd 사용자 세션(일반 SSH 로그인). root가 아닌 사용자로 설치합니다.

```bash
git clone https://github.com/moveju112/paseodog.git
cd paseodog
bash scripts/install.sh        # TRUST 입력 → 의존성 설치, 검사, 데몬 시작, 플러그인 등록
```

설치가 끝나면 계정과 접속 암호를 설정하고 점검합니다.

```bash
~/.local/bin/paseodog auth             # 모델 계정 로그인(또는 API 키) 후 종료
~/.local/bin/paseodog password         # 앱 접속 암호
~/.local/bin/paseodog daemon restart
~/.local/bin/paseodog doctor           # 설치 점검(모델 호출 없음)
```

- 데몬 관리: `paseodog daemon status`, `paseodog daemon stop`, `paseodog start`
- 기본 접속 주소는 `127.0.0.1:6767`(서버 내부 전용)입니다.
- 설치한 폴더를 옮기면 `bash scripts/install.sh`를 다시 실행하세요.

### 부팅 시 자동 시작 (선택)

```bash
node scripts/service.mjs --install     # ~/.config/systemd/user/paseodog.service 작성
~/.local/bin/paseodog daemon stop
systemctl --user daemon-reload
systemctl --user enable --now paseodog.service
sudo loginctl enable-linger "$USER"    # 로그아웃 후에도 유지하려면
```

### 업데이트

```bash
cd paseodog
git pull
bash scripts/install.sh
```

### Windows 데몬 (시험 지원)

필요: Node.js `^22.19.0` 또는 `>=24`, Git, npm, .NET Framework 4.x(Windows 10/11 기본 포함). 관리자 권한 없이 일반 사용자로 설치합니다.

```powershell
git clone https://github.com/moveju112/paseodog.git
cd paseodog
node scripts/install.mjs           # TRUST 입력 → 의존성 설치, 검사, 데몬 시작, 플러그인 등록
```

- 상태와 런처는 `%LOCALAPPDATA%\paseodog`에 저장됩니다. `%LOCALAPPDATA%\paseodog\bin`을 사용자 PATH에 추가하면 `paseodog auth`, `paseodog password`, `paseodog doctor`를 바로 실행할 수 있습니다.
- 세션마다 엔진과 셸 하위 프로세스를 Job Object로 묶어, 세션을 중지하면 남은 프로세스까지 함께 종료합니다. 격리 헬퍼는 처음 설치할 때 기본 `csc.exe`로 빌드됩니다.
- 로그인할 때 자동으로 시작하려면 `node scripts/service.mjs --install`을 실행하세요(사용자 Run 키 등록).
- 루트 테스트는 POSIX 도구가 필요해서 Windows 설치 중에는 건너뜁니다. 업데이트는 `git pull` 후 `node scripts/install.mjs`를 다시 실행하세요.

## 2. 앱 설치

- **Android**: `.apk`를 받아 설치합니다. 이후 업데이트는 앱 설정에서 받습니다.
- **Windows**: `.exe`를 실행해 설치합니다. 코드서명이 없어서 SmartScreen 경고가 뜨면 **추가 정보 → 실행**을 누르세요.
- **Linux**: `sudo apt install ./PaseoDog-<버전>-amd64.deb`, 또는 AppImage에 실행 권한을 주고 실행합니다(`chmod +x PaseoDog-<버전>-x86_64.AppImage`).

## 3. 앱을 데몬에 연결

외부망(휴대폰·다른 PC)에서는 서버에서 릴레이를 켠 뒤 앱의 호스트 설정에서 **Pair Device**로 연결합니다.

```bash
~/.local/bin/paseodog daemon config set daemon.relay.enabled true
~/.local/bin/paseodog daemon restart
~/.local/bin/paseodog daemon pair      # 페어링 QR 코드·링크 출력
```

같은 VPN(Tailscale 등) 안이라면 릴레이 대신 서버 VPN 주소로 직접 연결해도 됩니다.

라이선스: Apache-2.0 (`NOTICE` 참고).
