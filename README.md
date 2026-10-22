# PaseoDog

## [⬇ 최신 릴리즈 다운로드 — Android · Linux](https://github.com/moveju112/paseodog/releases/latest)

Linux 서버에서 Mixdog 엔진을 실행하고, 휴대폰·PC·웹에서 같은 세션을 제어합니다.

## 설치

### 1. 서버 (Ubuntu/Linux)

필요: Node.js `^22.19.0` 또는 `>=24`, Git, npm, systemd 사용자 세션.

```bash
git clone https://github.com/moveju112/paseodog.git
cd paseodog
bash scripts/install.sh               # TRUST 입력
~/.local/bin/paseodog auth            # 모델 계정 로그인 후 종료
~/.local/bin/paseodog password        # 앱 접속 암호 설정
~/.local/bin/paseodog daemon restart
~/.local/bin/paseodog doctor          # 설치 점검
```

설치한 폴더를 옮기면 `bash scripts/install.sh`를 다시 실행하세요.

### 2. PC 앱 (Linux)

릴리즈에서 `.deb`를 받아 설치합니다.

```bash
sudo apt install ./PaseoDog-<버전>-amd64.deb
```

### 3. Android

릴리즈에서 `.apk`를 받아 설치합니다. 이후 업데이트는 앱 설정에서 받을 수 있습니다.

외부망에서 접속하려면 서버에서 `~/.local/bin/paseodog daemon config set daemon.relay.enabled true`를 실행한 뒤 앱의 호스트 설정에서 **Pair Device**를 누르세요.

라이선스: Apache-2.0 (`NOTICE` 참고).
