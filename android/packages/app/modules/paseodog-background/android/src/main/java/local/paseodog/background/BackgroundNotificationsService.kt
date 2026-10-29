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
    // 기존 채널의 소리·진동 설정은 변경할 수 없으므로 별도 무음 채널을 사용한다.
    val channelId = "paseodog-background-silent"
    val channel = NotificationChannel(
      channelId, "백그라운드 연결 상태 (무음)", NotificationManager.IMPORTANCE_LOW
    ).apply {
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
    val notification = Notification.Builder(this, channelId)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("PaseoDog 연결 유지")
      .setContentText("완료 알림을 받기 위해 백그라운드 연결을 유지합니다.")
      .setDefaults(0)
      .setSound(null)
      .setVibrate(null)
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
