# PaseoDog

## [최신 다운로드 — Windows · Linux · Android](https://github.com/moveju112/paseodog/releases/latest)

같은 릴리즈의 파일은 모두 같은 버전(예: `1.0.0-rc.7.11052`)을 사용합니다.

| 플랫폼 | 받을 파일 |
|---|---|
| Windows x64 | `PaseoDog-Setup-<버전>-x64.exe` |
| Ubuntu·Debian x64 | `PaseoDog-<버전>-amd64.deb` |
| 기타 Linux x64 | `PaseoDog-<버전>-x86_64.AppImage` |
| Android arm64 | `PaseoDog-<버전>-arm64-v8a.apk` |

## PC에서 시작

1. Windows는 `.exe`를 실행합니다. 코드서명이 없어 SmartScreen 경고가 표시될 수 있습니다.
2. Ubuntu·Debian은 `sudo apt install ./PaseoDog-<버전>-amd64.deb`로 설치합니다.
   AppImage는 `chmod +x PaseoDog-<버전>-x86_64.AppImage` 후 실행합니다. 배포판에 따라 FUSE가 필요합니다.
3. 앱에서 로컬 엔진 설정을 확인합니다. Mixdog·플러그인·데몬이 포함되어 별도 Node.js·Git·서버 설치가 필요 없습니다.
4. 호스트 설정의 **계정 연결**에서 Claude·Codex 구독 계정에 로그인하거나 API 키를 등록합니다.

에이전트와 도구는 현재 사용자 권한으로 실행됩니다.
Linux는 `systemd --user`, Windows는 .NET Framework 4.x(Windows 10/11 기본 포함)가 필요합니다.
기존 수동 설치 데몬·계정 설정이 있으면 그대로 사용합니다.

## 휴대폰 연결

Android APK를 설치하고, 실행 중인 PC 앱의 호스트 설정에서 **Pair Device**로 연결합니다.
외부망에서는 호스트의 릴레이를 켜거나 같은 VPN(Tailscale 등)을 사용합니다.
폰만으로 엔진을 실행하지는 않습니다. 이후 업데이트는 앱 설정에서 받습니다.

## 서버에 데몬만 설치

PC 앱 없이 서버·VM을 쓸 때만 필요합니다.
필요: Node.js `^22.19.0` 또는 `>=24`, Git, npm. root가 아닌 사용자로 설치합니다.

```bash
git clone https://github.com/moveju112/paseodog.git
cd paseodog
bash scripts/install.sh             # TRUST 확인
~/.local/bin/paseodog auth          # 모델 계정 로그인 또는 API 키
~/.local/bin/paseodog password      # 앱 접속 암호
~/.local/bin/paseodog daemon restart
~/.local/bin/paseodog doctor        # 설치 점검, 추론 없음
```

기본 주소는 `127.0.0.1:6767`입니다. 데스크톱 내장 설치는 전용 `127.0.0.1:6768`을 사용합니다.
설치 폴더를 유지하세요. 업데이트는 `git pull` 후 설치 스크립트를 다시 실행합니다.
Windows 서버는 같은 저장소에서 `node scripts/install.mjs`를 실행합니다(시험 지원).
런처는 `%LOCALAPPDATA%\paseodog\bin`에 생성됩니다.

### Linux 부팅 시 자동 시작

```bash
node scripts/service.mjs --install
~/.local/bin/paseodog daemon stop
systemctl --user daemon-reload
systemctl --user enable --now paseodog.service
sudo loginctl enable-linger "$USER" # 로그아웃 후에도 유지
```

Windows는 `node scripts/service.mjs --install`로 로그인 시 자동 시작을 등록합니다.

### 서버와 앱 페어링

```bash
~/.local/bin/paseodog daemon config set daemon.relay.enabled true
~/.local/bin/paseodog daemon restart
~/.local/bin/paseodog daemon pair    # QR 코드·링크
```

APK는 공개 디버그 키 서명이며 Windows·Linux 설치파일에는 코드서명이 없습니다.
다운로드 파일의 무결성은 릴리즈의 `SHA256SUMS`로 확인할 수 있습니다.

라이선스: Apache-2.0 (`NOTICE` 참고).
