package local.paseodog.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.kotlin.Promise
import java.util.UUID

class BackgroundNotificationsService : HeadlessJsTaskService() {
  private val generation = UUID.randomUUID().toString()
  private val waiters = mutableListOf<Promise>()
  private var started = false

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // 기존 앱의 인증된 연결을 유지한다. 프로세스 재시작만으로 UI 구독을 복구했다고 간주하지 않는다.
    if (intent == null || reactContext == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (started) return START_NOT_STICKY

    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "백그라운드 알림 연결", NotificationManager.IMPORTANCE_LOW).apply {
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
      }
    )
    val launchIntent = requireNotNull(packageManager.getLaunchIntentForPackage(packageName))
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("PaseoDog 백그라운드 알림")
      .setContentText("완료·확인 요청 수신을 위해 연결을 유지합니다. 앱 설정에서 끌 수 있어요.")
      .setContentIntent(PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .build()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    started = true
    current = this
    // Foreground service만으로는 RN의 백그라운드 타이머 중지를 막지 못한다.
    // 수명이 서비스와 같은 headless task로 기존 heartbeat·재연결·로컬 알림 경로를 유지한다.
    startTask(
      HeadlessJsTaskConfig(
        "PaseodogBackgroundNotifications",
        Arguments.createMap().apply { putString("generation", generation) },
        0,
        true
      )
    )
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (current === this) current = null
    // 늦게 시작한 JS task도 generation을 확인하므로 종료 이벤트를 놓치지 않는다.
    waiters.forEach { it.resolve(null) }
    waiters.clear()
    stopForeground(STOP_FOREGROUND_REMOVE)
    // HeadlessJsTaskService가 wake lock을 해제하고 task의 Promise 완료가 RN 타이머를 해제한다.
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL_ID = "paseodog-background-connection"
    private const val NOTIFICATION_ID = 6781
    private var current: BackgroundNotificationsService? = null

    fun waitUntilStopped(generation: String, promise: Promise) {
      val service = current
      if (service == null || service.generation != generation) {
        promise.resolve(null)
      } else {
        service.waiters.add(promise)
      }
    }
  }
}
