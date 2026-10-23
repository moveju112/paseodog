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
~/.local/bin/paseodog daemon pair    # 릴레이 비밀번호 입력 후 QR 코드·링크 발급
~/.local/bin/paseodog daemon pair --reset-password  # 비밀번호를 잊었을 때: 새 비밀번호·새 링크 (이전 링크 무효, 데몬 재시작)
```

PC 앱의 **Pair Device**에서도 릴레이 비밀번호를 입력한 뒤 주소를 발급합니다.
첫 발급에서 설정한 비밀번호는 재발급 때도 동일하게 입력해야 하며, 접속 기기는 주소와 비밀번호가 모두 필요합니다.
비밀번호를 잊었다면 같은 화면의 **비밀번호·주소 재설정**으로 새 비밀번호와 새 주소를 받고, 다른 기기는 새 주소로 다시 연결합니다.
비밀번호는 링크·QR에 포함되지 않습니다. `paseodog password`로 설정하는 로컬 접속 암호와는 별개입니다.

### 브라우저 연결·전용 웹 배포

PaseoDog의 기본 페어링 링크는 비밀번호 입력을 지원하는 `https://paseodog.choondoggy.com/`를 사용합니다.
기존 기본 주소 `https://app.paseo.sh`와 `https://moveju112.github.io/paseodog`는 링크 발급 시 전용 웹으로 전환하고, 별도로 지정한 웹 주소는 유지합니다.
이미 발급한 링크는 자동 변경되지 않으므로 적용 후 호스트에서 다시 조회하세요. 비밀번호를 재설정할 필요는 없습니다.
공식 Paseo 웹(`app.paseo.sh`)에는 PaseoDog의 UI 패치가 적용되지 않습니다.

Cloudflare Pages에는 `node scripts/build-web.mjs --hosting cloudflare --output <절대 출력 경로>`로 내보낸 정적 파일을 배포합니다.
프로젝트의 Custom domains에서 웹 도메인을 등록하고 해당 프로젝트의 `*.pages.dev`를 가리키는 CNAME을 연결합니다.
Cloudflare용 export는 루트 경로를 사용하며 최상위 `404.html` 없이 Pages의 SPA fallback을 사용합니다.
정적 웹만 공개하며 데몬 포트를 외부에 열지 않습니다.

GitHub Pages에 별도로 배포하려면 저장소 **Settings → Pages → Source → GitHub Actions**를 선택한 뒤,
**Actions → PaseoDog web → Run workflow → main**으로 배포합니다.
푸시·릴리즈만으로는 배포하지 않습니다.
GitHub Pages의 깊은 링크 새로고침은 `404.html`로 SPA를 표시합니다(HTTP 상태는 404).

로컬 export는 `node scripts/build-web.mjs --output <절대 출력 경로>`로 실행합니다.
기본 export는 GitHub Pages 하위 경로를 사용하며 Android·데스크톱 빌드는 바꾸지 않습니다.

APK는 공개 디버그 키 서명이며 Windows·Linux 설치파일에는 코드서명이 없습니다.
다운로드 파일의 무결성은 릴리즈의 `SHA256SUMS`로 확인할 수 있습니다.

라이선스: Apache-2.0 (`NOTICE` 참고).
