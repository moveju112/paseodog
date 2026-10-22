import java.lang.ref.WeakReference

open class Activity(val localClassName: String)
class AppCompatActivity(name: String) : Activity(name)
enum class EventName { ACTIVITY_ENTERS_FOREGROUND }

class Manager {
  var activity: AppCompatActivity? = null
  fun onHostResume(next: AppCompatActivity) { activity = next }
}
class Registry(private val manager: Manager) {
  val registrations = mutableListOf<AppCompatActivity?>()
  var foregrounds = 0
  fun registerActivityContracts() { registrations.add(manager.activity) }
  fun post(event: EventName) { foregrounds++ }
}
class Runtime(val registry: Registry)
class Harness {
  var currentActivity: Activity? = null
  val activityResultsManager = Manager()
  val hostingRuntimeContext = Runtime(Registry(activityResultsManager))
  // FIELDS
  // RESUME
  fun hostDestroyed() { hostWasDestroyed = true }
}

// 실제 AppContext의 필드·메서드를 삽입해 Activity 재생성 시 등록 대상과 횟수를 실행 검증한다.
fun main() {
  val context = Harness()
  val registry = context.hostingRuntimeContext.registry
  val first = AppCompatActivity("first")
  context.currentActivity = first
  context.onHostResume()
  check(registry.registrations.isEmpty())
  context.onHostResume()
  check(registry.registrations.isEmpty())

  // React onHostDestroy 없이 Activity만 재생성되는 오류 경로.
  val second = AppCompatActivity("second")
  context.currentActivity = second
  context.onHostResume()
  check(registry.registrations == listOf(second)) { "Configuration relaunch did not register the new Activity" }
  context.onHostResume()
  check(registry.registrations.size == 1) { "Ordinary resume registered duplicate contracts" }

  context.hostDestroyed()
  val third = AppCompatActivity("third")
  context.currentActivity = third
  context.onHostResume()
  check(registry.registrations == listOf(second, third)) { "Registration used a stale Activity" }

  // 오래된 Activity가 GC돼도 재생성 감지를 잃지 않는다.
  val field = Harness::class.java.getDeclaredField("resumedActivity")
  field.isAccessible = true
  (field.get(context) as WeakReference<*>).clear()
  val fourth = AppCompatActivity("fourth")
  context.currentActivity = fourth
  context.onHostResume()
  check(registry.registrations == listOf(second, third, fourth))

  val foregrounds = registry.foregrounds
  context.currentActivity = null
  context.onHostResume()
  check(registry.foregrounds == foregrounds)
  println("Activity relaunch: initial/resume/configuration/host-destroy/GC/null cases OK")
}
