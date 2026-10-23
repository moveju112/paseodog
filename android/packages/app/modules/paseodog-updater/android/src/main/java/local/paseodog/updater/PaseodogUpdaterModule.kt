package local.paseodog.updater

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

class PaseodogUpdaterModule : Module() {
  private val busy = AtomicBoolean(false)

  // 설치 버전 조회 및 검증된 APK 설치 화면 연결
  override fun definition() = ModuleDefinition {
    Name("PaseodogUpdater")
    Function("supportedAbis") {
      Build.SUPPORTED_ABIS.toList()
    }
    Function("installedVersion") {
      val context = requireNotNull(appContext.reactContext)
      context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode.toDouble()
    }
    Function("installedRelease") {
      val context = requireNotNull(appContext.reactContext)
      val installed = context.packageManager.getPackageInfo(context.packageName, 0)
      mapOf("version" to installed.versionName, "versionCode" to installed.longVersionCode.toDouble())
    }
    AsyncFunction("install") { url: String, expectedHash: String, version: Double ->
      check(busy.compareAndSet(false, true)) { "업데이트 작업이 이미 진행 중입니다." }
      try {
        val context = requireNotNull(appContext.reactContext)
        val manager = context.packageManager
        val installed = manager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        require(version.isFinite() && version % 1.0 == 0.0 && version > installed.longVersionCode) {
          "설치된 버전보다 최신 버전이어야 합니다."
        }
        require(Regex("https://github\\.com/moveju112/paseodog/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\\.apk").matches(url)) {
          "허용되지 않은 다운로드 주소입니다."
        }
        require(Regex("[a-f0-9]{64}").matches(expectedHash)) { "SHA-256 정보가 올바르지 않습니다." }
        if (!manager.canRequestPackageInstalls()) {
          context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          return@AsyncFunction "permission"
        }
        val directory = File(context.cacheDir, "paseodog-updates").apply { mkdirs() }
        val partial = File(directory, "download.part")
        val apk = File(directory, "update.apk")
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 30000
        connection.readTimeout = 60000
        try {
          check(connection.responseCode == 200) { "APK 다운로드 실패: HTTP ${connection.responseCode}" }
          require(connection.url.protocol == "https") { "보안 연결이 필요합니다." }
          val digest = MessageDigest.getInstance("SHA-256")
          var total = 0L
          connection.inputStream.use { input ->
            partial.outputStream().use { output ->
              val buffer = ByteArray(65536)
              while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                check(total <= 400L * 1024 * 1024) { "APK 크기 제한을 초과했습니다." }
                digest.update(buffer, 0, count)
                output.write(buffer, 0, count)
              }
            }
          }
          val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
          check(actualHash == expectedHash) { "APK 무결성 검사 실패" }
          val candidate = requireNotNull(manager.getPackageArchiveInfo(partial.path, PackageManager.GET_SIGNING_CERTIFICATES)) {
            "APK를 읽을 수 없습니다."
          }
          require(candidate.packageName == context.packageName && candidate.longVersionCode == version.toLong()) {
            "APK 패키지 또는 버전이 일치하지 않습니다."
          }
          val currentSigners = requireNotNull(installed.signingInfo).apkContentsSigners.map { it.toCharsString() }.toSet()
          val newSigners = requireNotNull(candidate.signingInfo).apkContentsSigners.map { it.toCharsString() }.toSet()
          require(currentSigners.isNotEmpty() && currentSigners == newSigners) { "APK 서명이 기존 앱과 다릅니다." }
          partial.copyTo(apk, overwrite = true)
        } finally {
          connection.disconnect()
          partial.delete()
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.paseodog.updates", apk)
        context.startActivity(Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
        "installer"
      } finally {
        busy.set(false)
      }
    }
  }
}
