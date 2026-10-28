package local.paseodog.background

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaseodogBackgroundNotifications")
    Function("setActive") { active: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      val intent = Intent(context, BackgroundNotificationsService::class.java)
      if (active) context.startForegroundService(intent) else context.stopService(intent)
      Unit
    }
    OnDestroy {
      appContext.reactContext?.let {
        it.stopService(Intent(it, BackgroundNotificationsService::class.java))
      }
    }
  }
}
