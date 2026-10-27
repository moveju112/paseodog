# 이 PC의 PaseoDog 로컬 규칙 (예시)

이 파일을 `config/rules.local.md`로 복사해 이 기기에 맞게 채운다. 복사본은 Git·릴리즈 소스에서 제외된다.
경로·설정 위치만 적고 비밀번호·토큰·키 내용은 적지 않는다.
공통 승인·안전·배포 절차는 `AI_RULES.md`와 `docs/ai-rules/tasks/RELEASE.md`를 따른다.

## 기본 산출물

- 배포 요청 시 이 기기에서 만드는 대상: 예) Android `arm64-v8a` APK, Linux deb
- 데몬 업데이터 위치(이 기기에서 데몬을 운영하는 경우): 예) `~/.local/share/paseodog-updater`, `paseodog-update.service`

## 빌드 캐시와 리소스

- 빌드 캐시: 예) `/data/tmp/<user>/paseodog-build-cache-<unique>`. 릴리즈마다 `--cache-root`로 재사용한다.
- 릴리즈 호스트 프로필: 예) `<빌드 캐시>/host-profile.json`
- Metro worker 수: 예) `--metro-workers 2` (메모리가 부족한 기기)

## Android SDK

- Gradle 실행 시 `ANDROID_HOME`: 예) `~/Android/Sdk`

## 서명

- 서명 키 경로: 예) `secrets/signing/<keystore 파일>` (프로젝트 루트 기준, gitignore 대상)
- 키가 없으면 멈추고 보고한다. 새 키를 임의로 만들지 않는다.
