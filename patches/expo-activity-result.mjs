export const EXPO_ACTIVITY_RESULT_VERSION = '3.0.30';
export const EXPO_ACTIVITY_RESULT_FILE = 'android/src/main/java/expo/modules/kotlin/AppContext.kt';
export const EXPO_ACTIVITY_RESULT_BLOB = '1c125e6f827fac1db85052293be44de2381970b9';
export const EXPO_ACTIVITY_RESULT_EDITS = [
    ['  private var hostWasDestroyed = false',
        '  private var hostWasDestroyed = false\n  private var resumedActivity: WeakReference<Activity>? = null'],
    [`    // We need to re-register activity contracts when reusing AppContext with new Activity after host destruction.
    if (hostWasDestroyed) {
      hostWasDestroyed = false
      hostingRuntimeContext.registry.registerActivityContracts()
    }

    activityResultsManager.onHostResume(activity)`,
    `    // PASEODOG_ACTIVITY_RESULT: configuration relaunches can skip React onHostDestroy.
    val activityChanged = resumedActivity != null && resumedActivity?.get() !== activity
    resumedActivity = WeakReference(activity)

    // Publish the new Activity before registration: withActivityAvailable otherwise uses the old one.
    activityResultsManager.onHostResume(activity)
    if (hostWasDestroyed || activityChanged) {
      hostWasDestroyed = false
      hostingRuntimeContext.registry.registerActivityContracts()
    }`],
];

// 전체 원본 해시 검증을 위해 이번 생명주기 패치만 역순으로 제거한다.
export function withoutExpoActivityResult(source) {
    for (const [before, after] of [...EXPO_ACTIVITY_RESULT_EDITS].reverse()) {
        source = source.replace(after, () => before);
    }
    return source;
}

// 검토된 AppContext의 두 단일 앵커만 변경한다.
export function withExpoActivityResult(source) {
    for (const [before, after] of EXPO_ACTIVITY_RESULT_EDITS) {
        if (source.split(before).length !== 2) throw new Error('Expo activity result anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
