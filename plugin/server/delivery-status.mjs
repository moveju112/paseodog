// 채팅에는 고정된 분류만 표시한다. 외부 오류·경로·명령행은 복제하지 않는다.
export const DELIVERY_REASONS = Object.freeze({
    'dependency-missing': '필수 의존 파일 누락',
    'android-sdk-missing': 'Android SDK 경로 누락 또는 오류',
    'preflight-failed': '배포 사전 검사 실패',
    'stage-failed': '단계 실행 실패; 해당 단계 로그 확인 필요',
});

export const DELIVERY_STAGES = Object.freeze({
    preflight: '사전 검사', verify: '검증', plan: '대상 판정',
    'build-dependencies': '앱 의존성 준비', 'build-desktop-dependencies': '데스크톱 의존성 준비',
    'build-android': 'APK 빌드', 'build-web': '데스크톱 웹 빌드',
    'build-desktop-main': '데스크톱 코드 빌드', 'build-linux': 'Linux 패키징', 'build-windows': 'Windows 패키징',
    'android-manifest': 'Android 업데이트 정보', 'github-carry': '기존 배포 파일 보존',
    'github-draft': '배포 초안', 'github-upload': '배포 업로드', 'github-publish': '배포 공개',
    'browser-export': '웹 빌드', 'pages-deploy': '웹 배포', 'web-patch': '데몬 웹 패치',
    'pc-install': 'PC 설치', 'runtime-update': '데몬 갱신', 'plugin-reload': '플러그인 재로딩',
    'pc-launch': 'PC 앱 실행',
});

export function deliveryFailureReason(error, fallback = 'stage-failed') {
    if (Object.hasOwn(DELIVERY_REASONS, error?.code)) return error.code;
    for (const child of error instanceof AggregateError ? error.errors : []) {
        const reason = deliveryFailureReason(child);
        if (reason !== 'stage-failed') return reason;
    }
    return fallback;
}
