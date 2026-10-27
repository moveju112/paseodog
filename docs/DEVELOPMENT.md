# 개발 환경 준비

데몬을 설치하지 않고 소스 체크아웃에서 검사·테스트를 실행하는 절차입니다.
`scripts/install.mjs`는 같은 의존성 단계 뒤에 전용 데몬 시작과 플러그인 등록까지 하므로 개발용 준비로 쓰지 않습니다.
CI의 `unit` 작업(`.github/workflows/ci.yml`)이 이 절차의 기준입니다.

## 요구 사항

- Linux, Node 24 LTS(또는 22.19+), npm, git, python3, `flock`
- 테스트·릴리즈 스크래치 루트 `/data/tmp/ubuntu`: 현재 테스트 하네스와 일부 테스트가 이 경로를 고정으로 사용합니다.

```bash
sudo install -d -o "$USER" /data/tmp/ubuntu
```

## Windows에서 clone할 때

`AGENTS.md`와 `CLAUDE.md`는 `AI_RULES.md`를 가리키는 심볼릭 링크입니다.
심볼릭 링크가 꺼진 Git for Windows로 clone하면 두 파일이 경로 한 줄짜리 일반 파일이 되어 에이전트가 규칙을 읽지 못합니다.
개발자 모드를 켜고 `git clone -c core.symlinks=true ...`로 clone하세요.

## 의존성 설치

잠금 파일 버전만 설치합니다. `npm install`은 새 버전을 해석할 수 있으므로 쓰지 않습니다.

```bash
npm --prefix tools ci
node scripts/prepare-paseo-web-ui.mjs
# Mixdog 정리 훅이 하위 설치 파일을 지우므로 하위 훅부터 순서대로 실행합니다 (scripts/install.mjs의 engineInstallSteps와 동일).
npm --prefix engine ci --install-strategy=nested --ignore-scripts
for p in mixdog/node_modules/@huggingface/transformers/node_modules/onnxruntime-web/node_modules/protobufjs \
    mixdog/node_modules/onnxruntime-node mixdog/node_modules/tesseract.js mixdog; do
    npm --prefix "engine/node_modules/$p" run postinstall
done
npm --prefix plugin ci
# --ignore-scripts: Android 워크스페이스의 lefthook이 루트 저장소에 Git 훅을 설치하지 않게 합니다.
npm --prefix android ci --ignore-scripts
npm --prefix android run build:protocol
```

릴리즈 웹 검사 테스트까지 실행하려면 `android/node_modules/.bin/playwright install --with-deps --only-shell chromium`도 필요합니다.

## 고정 패치 적용

```bash
for patch in mixdog paseo-usage paseo-steer paseo-agent-messages paseo-assistant-phase \
    paseo-workspace-name paseo-session-titles paseo-local-stt paseo-relay-password paseo-composer; do
    node "scripts/patch-${patch}.mjs" && node "scripts/patch-${patch}.mjs" --check
done
```

pull 뒤 `Mixdog <버전> required; found <버전>` 오류가 나면 고정 버전이 바뀐 것입니다. 위 engine 설치와 `patch-mixdog` 단계를 다시 실행하세요.

## 검사와 테스트

```bash
npm run check
npm test                                  # 전체 root 테스트
npm test -- --files tests/a.test.mjs,...  # 변경 범위 테스트
npm run typecheck                         # plugin TypeScript
```

변경 종류별 필요한 검사는 [CODING_RULES](ai-rules/CODING_RULES.md)를 따릅니다.
`npm run test:live`, `npm run test:native`처럼 실제 모델을 호출하는 smoke는 과금이 발생할 수 있어 기본 검사에 포함하지 않습니다.

## 로컬 규칙

기기별 실행 설정(빌드 캐시, Android SDK, 서명 키 위치 등)은 Git에서 제외된 `config/rules.local.md`에 둡니다.
[`config/local-rules.example.md`](../config/local-rules.example.md)를 복사해 채우고, 비밀번호·키 내용은 적지 않습니다.
