# Linux 설치·운영·휴대폰 연결

## 1. 설치와 최초 로그인

비-root 개발 계정에서 Node.js 24, Git, npm을 준비하고 프로젝트를 고정 경로에 둡니다.

```bash
cd /home/USER/apps/paseodog
bash scripts/install.sh
~/.local/bin/paseodog auth
~/.local/bin/paseodog password
~/.local/bin/paseodog daemon restart
~/.local/bin/paseodog doctor
```

`USER`와 경로는 실제 환경에 맞춥니다. 설치는 의존성·패치·테스트·타입 검사를 통과한 뒤 플러그인을 등록합니다. npm DNS 오류나 컴파일 오류가 발생하면 중단하며, 실패한 설치를 완료 상태로 취급하지 않습니다.

`paseodog`를 짧게 사용하려면 `~/.local/bin`을 셸 PATH에 추가합니다. 이하 명령은 해당 경로가 PATH에 있다는 전제입니다.

설정은 `PASEODOG_HOME` 또는 `~/.local/share/paseodog` 아래에 있습니다. `paseodog --help`로 실제 Paseo 프로필 경로를 확인합니다. `paseodog auth`와 서버가 **같은 Unix 사용자·같은 PASEODOG_HOME**을 사용해야 합니다. 인증을 완료한 TUI는 종료하고, 일상 작업은 `paseodog run/send/attach`로 진행합니다.

기존 Paseo가 6767을 사용 중이면 설치 전에 전용 프로필을 준비한 뒤 다른 포트를 설정합니다.

```bash
node scripts/configure.mjs --trust-plugins
# 생성된 전용 paseo/config.json에서 daemon.listen을 127.0.0.1:6768 등으로 변경
bash scripts/install.sh
```

이 경로는 원래 프로필을 복사하는 절차가 아닙니다. 기존 계정 토큰을 임의 복사하지 않습니다.

## 2. 외부 휴대폰 — 릴레이

서버의 암호 설정을 마친 뒤 실행합니다.

```bash
paseodog daemon config set daemon.relay.enabled true
paseodog reload
```

Paseo PC/웹 앱에서 이 전용 호스트에 연결하고, 호스트 설정의 **Pair Device**로 페어링합니다. 휴대폰의 Paseo 앱에서 QR/연결 정보를 사용합니다. 릴레이 서비스 접속 가능 여부와 앱 버전 호환성은 실제 환경에서 확인해야 합니다.

서버에서 먼저 테스트 작업을 생성하고, 휴대폰에서 같은 agent-id의 대화·승인 요청·중단 상태가 보이는지 확인합니다. 이후 Wi-Fi를 끄고 LTE/5G에서 다시 검사합니다. QR이나 페어링 자격 증명은 공유하지 마세요.

릴레이를 끄려면 다음을 사용합니다.

```bash
paseodog daemon config set daemon.relay.enabled false
paseodog reload
```

## 3. 외부 휴대폰 — Tailscale/VPN 대안

Tailscale은 ZIP에서 설치·계정 연결하지 않습니다. 먼저 서버·휴대폰을 같은 승인된 VPN에 연결합니다. 아래 명령은 IPv4 Tailscale 주소를 사용하는 예시이며, 실제 주소가 출력되는지 먼저 확인합니다.

```bash
tailscale ip -4
# 출력된 주소를 아래 IP에 직접 대입합니다.
IP=100.x.y.z
paseodog daemon config set daemon.listen "$IP:6767"
paseodog daemon config set daemon.hostnames "[\"localhost\",\"127.0.0.1\",\"$IP\"]"
paseodog daemon restart
```

`100.x.y.z`는 실행 가능한 주소가 아니라 자리표시자입니다. 휴대폰 앱에 실제 VPN 주소와 포트·암호를 입력합니다. 기존 허용 호스트가 있으면 위 배열로 덮어쓰기 전에 보존할 항목을 포함하세요. MagicDNS 이름을 쓰려면 정확한 이름도 허용 목록에 추가합니다.

VPN ACL과 서버 방화벽에서 본인 장치만 접근하도록 제한합니다. 공인 인터페이스에 동일 포트를 열 필요가 없습니다. Tailscale/VPN 전송 암호화와 Paseo의 인증은 별개이므로 둘 다 유지하세요.

선택적으로 Paseo의 웹 UI를 사용하려면 다음을 실행합니다. 웹 정적 파일이 설치된 배포물인지 실제로 확인해야 합니다.

```bash
paseodog daemon config set features.webUi.enabled true
paseodog daemon restart
```

## 4. SSH와 휴대폰에서 같은 작업

```bash
cd ~/dev/test-repository
paseodog run --no-wait "읽기 전용으로 프로젝트를 검토해줘"
paseodog ls
paseodog attach <agent-id>
paseodog send <agent-id> --no-wait "테스트 실패 원인을 확인해줘"
paseodog stop <agent-id>
```

`attach` 연결이 끊어진 것과 서버의 작업 중단은 다릅니다. 실제 계속 실행되는지는 수용 검사에서 확인합니다. **Paseo agent-id가 원격 제어의 기준**이며 Mixdog 내부 세션 ID를 대신 넣지 않습니다.

기본 모드에서는 모든 도구가 1회 승인을 요청합니다. 승인 대기 중 휴대폰이 사라지면 120초 뒤 거절합니다. `stop`은 향후 실행을 중단하지만 이미 수정한 파일이나 외부 요청을 롤백하지 않습니다.

## 5. systemd 사용자 서비스 및 작업별 cgroup

PaseoDog는 각 Mixdog 작업 세션을 별도의 `systemd-run --user --scope` cgroup에 생성합니다. 서버에서 먼저 `systemctl --user show-environment`를 검사하세요. 이 사용자 매니저가 없으면 프로세스 그룹 우회로 실행하지 않고 실패합니다. systemd 없는 Docker 실행은 현재 지원하지 않습니다.


서비스 파일 생성은 서버에서 명시적으로 실행합니다. 설치 스크립트는 systemd를 자동 활성화하지 않습니다.

```bash
cd /설치/경로/paseodog
node scripts/service.mjs --install
paseodog daemon stop
systemctl --user daemon-reload
systemctl --user enable --now paseodog.service
systemctl --user status paseodog.service
journalctl --user -u paseodog.service -n 100 --no-pager
```

로그아웃 후에도 사용자 서비스를 유지하려면 관리자가 해당 사용자의 lingering을 설정해야 합니다. 예:

```bash
sudo loginctl enable-linger USER
```

Linux에서는 실행 중인 systemd **사용자** 매니저가 반드시 필요합니다. 터미널에서 `systemctl --user show-environment`가 정상 종료되는지 먼저 확인하세요. 불가능한 컨테이너·제한 환경에서는 에이전트를 시작하지 않으며, 컨테이너의 프로세스 관리자만으로 무단 우회하지 마세요. 서버 로그아웃 후에도 유지하려면 관리자가 `loginctl enable-linger <계정명>`을 설정해야 할 수 있습니다. **관리형 `daemon start`와 systemd의 foreground `serve`를 동시에 실행하지 마세요.** 재부팅 뒤 프로필·자격 증명 접근·모델 실행·휴대폰 재연결을 각각 확인해야 합니다.

## 6. 진단

```bash
paseodog doctor
paseodog provider diagnostic paseodog --json
paseodog plugin logs paseodog-provider
paseodog plugin ls
```

`doctor`는 실제 모델 요청을 보내지 않으며 인증 성공도 보장하지 않습니다. 엔진 stderr는 토큰 유출 가능성 때문에 기본적으로 휴대폰 타임라인에 전달하지 않습니다. 원인 확인은 테스트 저장소에서 직접 `paseodog auth` 또는 live-smoke를 실행하고, 로그를 외부로 보내기 전 반드시 비밀값을 제거합니다.

| 증상 | 대응 |
|---|---|
| `EAI_AGAIN`, npm 다운로드 실패 | 서버 DNS·프록시·방화벽 확인 후 설치 재실행 |
| Node 지원 버전 오류 | Node 24를 설치하고 launcher·서비스를 다시 생성 |
| host-policy patch missing | `node scripts/patch-mixdog.mjs` 후 `--check` |
| source hash mismatch | 버전을 강제로 무시하지 말고 원본 변경을 검토 |
| Session already owned | 동일 세션을 소유한 연결/프로세스 확인; 실행 중 잠금 삭제 금지 |
| lock initializing/damaged | 서버 정지·백업·소유 프로세스 종료 확인 뒤 수동 복구 |
| System prompt changed | 기존 문맥을 억지 재사용하지 않고 새 세션 생성 |
| prior outcome uncertain | 파일·Git diff·외부 작업 결과 확인 후 새로운 message ID의 지시 전송 |
| 실계정 테스트 인증 실패 | 같은 전용 프로필·Unix 사용자에서 로그인 확인 |

## 7. 백업·업데이트·롤백

관리형 데몬 또는 systemd를 먼저 정지합니다. `PASEODOG_HOME` 전체를 권한 0700/0600을 보존하는 비공개 저장소에 백업합니다. 인증 토큰이 포함되므로 프로젝트 ZIP이나 GitHub에 넣지 않습니다. 코드와 데이터 백업은 별도로 관리합니다.

상위 패키지 버전을 변경하려면 SDK 타입 검사, 실제 런타임 테스트, 권한·중단·복원·휴대폰 수용 검사를 다시 실행합니다. Mixdog 패치 해시는 의도적으로 자동 갱신하지 않습니다. 첫 인터넷 설치 후 생성된 세 개의 `package-lock.json`을 검토하고 프로젝트에 커밋합니다.

롤백 시 서비스를 정지하고 이전 코드·정확한 의존성·그 버전의 데이터 백업을 함께 복원합니다. 이 버전의 journal v2를 starter v1에 그대로 읽히게 하지 않습니다. 삭제나 롤백 스크립트가 사용자 프로젝트 파일을 자동 제거하지 않도록 운영하세요.
## rc.4 Android terminal typing/cursor

The native terminal of the upstream Paseo Android app has an outstanding
Samsung Keyboard input issue. PaseoDog's Linux update does **not** replace the
Android APK. For a no-build alternative use **Settings → Diagnostics → Use
legacy terminal renderer**, reopen the terminal, and retest; a separate SSH
client is another bypass for command-line work. A reviewed opt-in client source
patch and controlled Android test matrix are described in
[`ANDROID-TERMINAL.md`](ANDROID-TERMINAL.md).

When a journal error occurs during a running turn, do not assume that stopping
or failing a turn undid file changes. If `containment-unconfirmed` appears,
stop assigning work to that host, verify the actual systemd scope and its
cgroup population, inspect `git diff`, and recover only once the scope is empty.
