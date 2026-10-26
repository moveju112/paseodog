# 앱에서 데몬 업데이트 요청

폰·PC·웹은 인증된 호스트 연결의 `paseodog-provider/daemon-update` RPC를 공유한다.
버튼의 확인 단계에서만 변경을 요청하며 앱 업데이트와 데몬 업데이트는 별개다.
호스트 소유자가 아래 실행 계획을 준비한 Linux 호스트에서만 버튼을 제공한다.
계획이 없는 호스트·구형 데몬·다른 OS에서는 기존 릴리즈 안내만 제공한다.
현재 소스 설치에 기본 실행 계획을 만들거나 실제 업데이트를 자동 실행하지 않는다.

## 호스트 설정

전용 상태 루트의 `daemon-update/plan.json`을 호스트에서 준비한다.
상태 루트는 `PASEODOG_HOME`, 기본값은 `~/.local/share/paseodog`이다.
디렉터리는 `0700`, 설정 파일은 `0600`으로 두며 소유자는 실행 사용자 또는 root여야 한다.
인증된 연결의 사용자는 준비된 **정확한 버전 하나**만 요청할 수 있다.
이 권한을 부여할 호스트에만 설정하고, 원본 Paseo·개인 프로필을 대상으로 설정하지 않는다.

계획 형식은 다음과 같다. 경로는 실제 호스트 소유 실행기로 교체한다.

```json
{
  "target": "paseodog",
  "versionCode": 12345,
  "prepare": ["/absolute/host-owned/updater", "prepare"],
  "verify": ["/absolute/host-owned/updater", "verify"],
  "idle": ["/absolute/host-owned/updater", "idle"],
  "apply": ["/absolute/host-owned/updater", "apply"],
  "check": ["/absolute/host-owned/updater", "check"],
  "rollback": ["/absolute/host-owned/updater", "rollback"],
  "rollbackCheck": ["/absolute/host-owned/updater", "rollback-check"]
}
```

명령은 셸을 거치지 않는다. 클라이언트는 명령·경로·URL을 전달할 수 없다.
사용자 systemd와 Node가 필요하며 실행기는 데몬과 독립된 user service에서 실행된다.
호스트 소유 실행기는 다음 계약을 만족해야 한다.

| 단계 | 필수 동작 |
|---|---|
| `prepare` | 기존 서비스를 유지하면서 고정 버전 후보와 이전 실행 파일·데이터 복구본을 별도 위치에 준비한다. 공간·권한·설치 방식도 확인한다. |
| `verify` | 후보의 공식 출처·고정 해시·버전·호환성·기동 가능성과 복구본을 검증한다. 실패해도 기존 서비스를 변경하지 않는다. |
| `idle` | 전용 데몬의 모든 작업을 조회해 `[{"status":"running"}]` 형태의 JSON 배열을 출력한다. 조회 실패를 빈 배열로 바꾸지 않는다. |
| `apply` | 새 작업의 입장을 차단한 뒤 마지막 idle 확인과 graceful 교체를 수행한다. 경합으로 작업이 생겼으면 중단하거나 대기한다. 강제 종료는 금지한다. |
| `check` | 적용한 정확한 제품 버전·데몬 준비·인증된 클라이언트 연결을 검증한다. 프로세스 존재만으로 성공하지 않는다. |
| `rollback` | 이전 실행 파일·필요한 데이터를 복구하고 이전 전용 데몬을 재기동한다. 후보를 재실행하지 않는다. |
| `rollbackCheck` | 이전 제품 버전과 인증된 연결 복구를 확인한다. |

각 명령은 최대 10분이며, `idle` 대기는 최대 1시간이다.
명령 출력에는 비밀값을 넣지 않는다. 앱에는 고정된 단계별 상태만 반환한다.
`apply`가 실패하거나 결과가 불확실해도 복구를 시도하므로 복구 명령은 부분 적용을 처리해야 한다.

## 상태와 실패 처리

`request.json`은 접수·준비·작업 대기·적용·성공·실패·복구 상태를 영구 보존한다.
중복 요청은 같은 영수증을 반환한다. 통신 실패·서비스 시작 응답 유실·프로세스 종료는 재실행 허가가 아니다.
`start-unknown` 또는 중간 상태에서 멈추면 user service와 실제 설치 상태를 호스트에서 먼저 확인한다.
`rollback-failed`는 복구 완료가 아니며 수동 점검이 필요하다.

다음 업데이트를 준비할 때는 이전 user service가 종료됐는지와 실제 설치·복구 결과를 확인하고,
영수증·복구본을 보존한 뒤 `worker.lock`을 제거하고 새 버전 계획을 준비한다.
비정상 종료로 `request.lock`이 남은 경우에도 소유 실행과 변경 결과를 확인하기 전에는 제거하지 않는다.
같은 버전의 실패를 자동 재시도하거나 영수증을 삭제해 불확실한 변경을 반복하지 않는다.
