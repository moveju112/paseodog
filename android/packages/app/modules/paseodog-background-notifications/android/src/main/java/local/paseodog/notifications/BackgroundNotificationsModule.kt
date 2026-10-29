package local.paseodog.notifications

import android.app.NotificationManager
import android.content.Intent
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaseodogBackgroundNotifications")

    AsyncFunction("start") {
      val context = requireNotNull(appContext.reactContext as? ReactContext)
      check(context.lifecycleState == LifecycleState.RESUMED) {
        "백그라운드 알림 서비스는 앱이 열린 상태에서만 시작할 수 있습니다."
      }
      check(context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()) {
        "Android 알림 권한이 필요합니다."
      }
      context.startForegroundService(Intent(context, BackgroundNotificationsService::class.java))
      Unit
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") {
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, BackgroundNotificationsService::class.java))
      }
      Unit
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("waitUntilStopped") { generation: String, promise: Promise ->
      BackgroundNotificationsService.waitUntilStopped(generation, promise)
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, BackgroundNotificationsService::class.java))
      }
    }
  }
}
