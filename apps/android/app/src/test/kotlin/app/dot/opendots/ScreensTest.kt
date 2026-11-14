package app.dot.opendots

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import app.dot.design.DotTheme
import app.dot.design.ThemeMode
import app.dot.design.catalog.QuietCatalogScreen
import app.dot.opendots.data.MemorySessionStore
import app.dot.opendots.data.OpenDotsClient
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Drives the real app (AppState, OpenDotsClient, every screen) against a fake OpenDots engine that speaks the real HTTP
 * API, and writes a PNG of each screen to app/build/shots for a visual check. Blur itself needs a device (RenderEffect
 * is not rendered here); everything else - layout, themes, protocol - is exercised for real.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = android.app.Application::class, qualifiers = "w411dp-h891dp-xxhdpi")
class ScreensTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val server = MockWebServer()
    private val posts = CopyOnWriteArrayList<Pair<String, String>>()
    private val out = File("build/shots").apply { mkdirs() }
    private var onboarded = true
    private var signedIn = true

    private val agents = """[
      {"id":"a1","name":"Ari","named":true,"color":"#7C6CF2","description":"Concise and a bit playful.","effectiveModel":{"provider":"openrouter","model":"anthropic/claude-sonnet-5.5"},"state":"available","lastMessagePreview":"12,418 lines across 163 files.","unread":0,"mainConversationId":"c1"},
      {"id":"a2","name":"Venty","named":true,"color":"#E9A23B","description":"Handles job search emails.","effectiveModel":{"provider":"openrouter","model":"openai/gpt-5"},"state":"working","stateDetail":"Reads an email","unread":2,"mainConversationId":"c2"},
      {"id":"a3","name":"Dev","named":true,"color":"#35B58A","effectiveModel":{"provider":"openrouter","model":"openai/gpt-5"},"state":"error","unread":0,"mainConversationId":"c3"}]"""
    private val history = """{"conversationId":"c1","cursor":null,"active":false,"messages":[
      {"id":"m1","role":"user","metadata":{"kind":"chat"},"parts":[{"type":"text","text":"Every Friday at 5pm, send me a recap of what we did this week."}]},
      {"id":"m2","role":"assistant","metadata":{"agentId":"a1","workedMs":3200},"parts":[
        {"type":"tool-activity_create","toolCallId":"t1","state":"output-available","input":{"title":"Weekly recap","kind":"schedule"},"output":{"ok":true}},
        {"type":"text","text":"Done. You'll get it **every Friday at 5pm**. You can pause or edit it under *Scheduled tasks*."}]},
      {"id":"m3","role":"assistant","metadata":{"kind":"event","event":{"type":"schedule","title":"Weekly recap"},"createdAt":"2026-11-06T17:00:00Z"},"parts":[{"type":"text","text":"Scheduled run."}]},
      {"id":"m4","role":"user","metadata":{"kind":"chat","reactions":[{"emoji":"👍","actor":"a1"}]},"parts":[{"type":"text","text":"Count the TypeScript lines in the shared workspace, and reply to Claire that Thursday works."}]},
      {"id":"m5","role":"assistant","metadata":{"agentId":"a1","workedMs":12400,"reactions":[{"emoji":"👀","actor":"user"}]},"parts":[
        {"type":"reasoning","text":"Two tasks: count lines with find and wc, then draft the reply."},
        {"type":"tool-shell_exec","toolCallId":"t2","state":"output-available","input":{"command":"find . -name '*.ts' | xargs wc -l | tail -1"},"output":{"ok":true,"exit_code":0,"stdout":"12418 total"}},
        {"type":"tool-mail_search","toolCallId":"t3","state":"output-available","input":{"from":"Claire"},"output":{"ok":true}},
        {"type":"text","text":"**12,418 lines** across `163` files.\n\n| Package | Lines |\n|---|---|\n| server | 7,902 |\n| web | 4,516 |\n\n```bash\nfind . -name '*.ts' | xargs wc -l\n```\n\nI drafted the reply to Claire:"},
        {"type":"tool-mail_send","toolCallId":"t4","state":"output-available","input":{},"output":{"ok":true,"status":"pending_approval","approvalId":"ap1","summary":"Send an email to claire@example.com"}}]}
    ]}"""
    private val approvals = """[{"id":"ap1","agentId":"a1","conversationId":"c1","action":"mail.send","summary":"GitHub — robin@example.com · Pousser (git push) une branche depuis l'ordinateur du compagnon · commit 100f9b4271509a9a826ac4de535d182960079cd2 · {\"repo\":\"Sr-0w/OpenDots\",\"branch\":\"fix/team-tools\",\"set_upstream\":true}","status":"pending","createdAt":"2026-11-13T09:00:00Z"}]"""
    private val activities = """[
      {"id":"act1","agentId":"a1","title":"Weekly recap","kind":"schedule","schedule":{"type":"cron","expr":"0 17 * * 5"},"enabled":true,"nextRunAt":"2026-11-13T17:00:00Z"},
      {"id":"act2","agentId":"a2","title":"Watch: monitor price","kind":"watch","watch":{"url":"https://shop.example.com/monitor","mode":"contains"},"enabled":false}]"""

    @Before fun start() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath.removePrefix("/api")
                if (request.method != "GET") {
                    posts += path to (request.body?.utf8() ?: "")
                    if (request.headers["x-opendots-client"] != "1") return json("""{"error":"Client non reconnu"}""", 403)
                }
                return when {
                    path == "/auth/me" -> json(if (signedIn) """{"account":{"id":"usr_1","email":"robin@example.com","role":"admin"},"registrationOpen":true}""" else """{"account":null,"registrationOpen":true}""")
                    path == "/auth/login" -> { signedIn = true; MockResponse.Builder().code(200).addHeader("Set-Cookie", "opendots_session=tok123; Path=/; HttpOnly").body("""{"account":{"id":"usr_1","email":"robin@example.com","role":"admin"}}""").build() }
                    path == "/bootstrap" -> json("""{"onboarded":$onboarded,"openrouterConfigured":true,"paused":false}""")
                    path == "/agents" -> json(agents)
                    path == "/approvals" -> json(approvals)
                    path == "/activities" -> json(activities)
                    path == "/agents/a1/messages" -> json(history)
                    path == "/agents/a1/stream" -> MockResponse.Builder().code(204).build()
                    path == "/agents/a1/chat" -> MockResponse.Builder().code(200).addHeader("Content-Type", "text/event-stream").body(
                        listOf(
                            """{"type":"start","messageId":"m9","messageMetadata":{"agentId":"a1"}}""",
                            """{"type":"text-start","id":"t"}""", """{"type":"text-delta","id":"t","delta":"Hi "}""", """{"type":"text-delta","id":"t","delta":"there, streamed reply."}""", """{"type":"text-end","id":"t"}""",
                            """{"type":"finish"}""", "[DONE]",
                        ).joinToString("") { "data: $it\n\n" },
                    ).build()
                    path == "/events" -> MockResponse.Builder().code(200).addHeader("Content-Type", "text/event-stream").body("data: {\"type\":\"hello\"}\n\n").build()
                    path == "/approvals/ap1" -> json("""{"ok":true,"status":"executed","error":null}""")
                    path.endsWith("/read") -> json("""{"ok":true}""")
                    else -> json("""{"error":"Introuvable"}""", 404)
                }
            }
        }
        server.start()
    }

    @After fun stop() { server.close() }

    private fun json(body: String, code: Int = 200) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    private fun launch(mode: ThemeMode, cookie: String? = "tok123", server: Boolean = true): AppState {
        val store = MemorySessionStore(serverUrl = if (server) this.server.url("/").toString() else null, sessionCookie = cookie)
        val app = AppState(store, OpenDotsClient(store))
        compose.setContent { DotTheme(mode) { OpenDotsRoot(app, app.state.collectAsStateForTest()) } }
        return app
    }

    private fun shoot(name: String) {
        compose.waitForIdle()
        val view = compose.activity.window.decorView
        val bitmap = Bitmap.createBitmap(view.width.coerceAtLeast(1), view.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))
        File(out, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun waitFor(text: String) = compose.waitUntil(10_000) { compose.onAllNodesWithTextCompat(text) }

    private fun conversation(mode: ThemeMode, name: String) {
        launch(mode)
        waitFor("12,418 lines")
        shoot("chat-$name")
    }

    @Test fun conversationDark() = conversation(ThemeMode.DARK, "dark")
    @Test fun conversationOled() = conversation(ThemeMode.OLED, "oled")
    @Test fun conversationLight() = conversation(ThemeMode.LIGHT, "light")

    @Test fun sendingStreamsAReplyAndApprovingReachesTheServer() {
        val app = launch(ThemeMode.DARK)
        waitFor("12,418 lines")
        compose.onNodeWithContentDescription("Write to Ari…").performTextInput("Hello")
        compose.onNodeWithContentDescription("Send").performClick()
        compose.waitUntil(10_000) { posts.any { it.first == "/agents/a1/chat" } }
        val sent = posts.first { it.first == "/agents/a1/chat" }.second
        assertTrue(sent, "\"role\":\"user\"" in sent && "\"text\":\"Hello\"" in sent)
        compose.waitUntil(10_000) { app.session("a1").state.value.messages.any { it.id == "m9" } || posts.any { it.first == "/agents/a1/read" } }
        compose.onNodeWithText("Approve").performClick()
        compose.waitUntil(10_000) { posts.any { it.first == "/approvals/ap1" } }
        assertEquals("""{"decision":"approve"}""", posts.first { it.first == "/approvals/ap1" }.second)
    }

    @Test fun workStaysOutOfTheThreadAndOpensInItsPanel() {
        launch(ThemeMode.DARK)
        waitFor("12,418 lines")
        assertTrue(!compose.onAllNodesWithTextCompat("Worked for"))
        assertTrue(!compose.onAllNodesWithTextCompat("set_upstream"))
        waitFor("Pousser (git push)")
        compose.onNodeWithContentDescription("Work").performClick()
        waitFor("Worked for 12 s")
        shoot("work-dark")
    }

    private fun tab(label: String) = compose.onNode(hasText(label) and isSelectable()).performClick()

    @Test fun pagesReplaceTheDrawer() {
        launch(ThemeMode.DARK)
        waitFor("I drafted the reply")
        // Back from a conversation leads to the full-screen Companions page.
        compose.onNodeWithContentDescription("Companions").performClick()
        waitFor("Venty")
        waitFor("Reads an email")
        shoot("companions-dark")
        tab("Tasks")
        waitFor("Weekly recap")
        shoot("tasks-dark")
        tab("Approvals")
        waitFor("Pousser (git push)")
        shoot("approvals-dark")
        tab("Settings")
        waitFor("OLED black")
        shoot("settings-dark")
        // Android back from a tab returns to Companions, and a companion opens its conversation.
        compose.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        waitFor("Venty")
        compose.onNodeWithText("Ari").performClick()
        waitFor("I drafted the reply")
        compose.onNodeWithContentDescription("Companion details").performClick()
        waitFor("Read public web pages")
        waitFor("anthropic/claude-sonnet-5.5")
        shoot("profile-dark")
    }

    @Test fun signInThenEnter() {
        signedIn = false
        launch(ThemeMode.LIGHT, cookie = null)
        waitFor("Welcome back")
        shoot("signin-light")
        compose.onNodeWithContentDescription("Email").performTextInput("robin@example.com")
        compose.onNodeWithContentDescription("Password").performTextInput("correct horse battery")
        compose.onNodeWithText("Sign in").performClick()
        waitFor("12,418 lines")
        val request = posts.first { it.first == "/auth/login" }.second
        assertTrue(request, "robin@example.com" in request)
    }

    @Test fun firstLaunchAsksForTheServer() {
        launch(ThemeMode.OLED, cookie = null, server = false)
        waitFor("Connect to OpenDots")
        shoot("server-oled")
    }

    private fun catalog(mode: ThemeMode) {
        compose.setContent { DotTheme(mode) { QuietCatalogScreen {} } }
        shoot("catalog-${mode.name.lowercase()}")
    }

    @Test fun catalogLight() = catalog(ThemeMode.LIGHT)
    @Test fun catalogDark() = catalog(ThemeMode.DARK)
    @Test fun catalogOled() = catalog(ThemeMode.OLED)
}
