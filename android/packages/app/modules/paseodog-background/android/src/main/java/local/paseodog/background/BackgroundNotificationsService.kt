package local.paseodog.background

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class BackgroundNotificationsService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(NotificationManager::class.java)
    val channelId = "paseodog-background"
    manager.createNotificationChannel(NotificationChannel(
      channelId, "작업 중 연결 유지", NotificationManager.IMPORTANCE_LOW
    ))
    val notification = Notification.Builder(this, channelId)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("PaseoDog 작업 진행 중")
      .setContentText("다른 앱을 사용하는 동안에도 완료 알림을 받을 수 있도록 연결을 유지합니다.")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      notification.setContentIntent(PendingIntent.getActivity(
        this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      ))
    }
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(7102, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
    } else {
      startForeground(7102, notification.build())
    }
    // 강제 종료나 프로세스 종료 후 사용자가 모르는 사이에 서비스를 재시작하지 않는다.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
