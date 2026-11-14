package app.dot.opendots.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(message: String, val status: Int) : IOException(message)

/** Normalises what a person types ("opendots.example.com", "localhost:4317") into the server's base URL. */
fun normalizeServerUrl(input: String): HttpUrl? {
    val trimmed = input.trim().trimEnd('/')
    if (trimmed.isEmpty()) return null
    val local = Regex("^(localhost|127\\.0\\.0\\.1|10\\.0\\.2\\.2)(:\\d+)?(/.*)?$").matches(trimmed)
    val withScheme = if ("://" in trimmed) trimmed else (if (local) "http://" else "https://") + trimmed
    val url = withScheme.toHttpUrlOrNull() ?: return null
    return url.newBuilder().encodedPath("/").query(null).fragment(null).build()
}

/**
 * The OpenDots engine, as seen from a native client. It speaks the same HTTP API as the web app (`/api/...`): a session
 * cookie for identity, the `x-opendots-client` header on every call, server-sent events for realtime, and the AI SDK
 * UI-message stream for a companion's turn.
 */
class OpenDotsClient(private val store: SessionStore, baseClient: OkHttpClient = OkHttpClient()) {

    private val jar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            val session = cookies.lastOrNull { it.name == COOKIE } ?: return
            store.sessionCookie = if (session.value.isEmpty() || session.expiresAt < System.currentTimeMillis()) null else session.value
        }

        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            val base = baseUrl ?: return emptyList()
            val value = store.sessionCookie ?: return emptyList()
            // Only ever sent to the server the user chose.
            if (url.host != base.host || url.port != base.port || url.scheme != base.scheme) return emptyList()
            return listOf(Cookie.Builder().name(COOKIE).value(value).domain(url.host).path("/").build())
        }
    }

    /** Shared with the image loader so attachments are fetched with the session. */
    val http: OkHttpClient = baseClient.newBuilder()
        .cookieJar(jar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("x-opendots-client", "1").build()) }
        .build()

    /** Streams stay open for as long as a turn runs; the server pings the event stream every 20 s. */
    private val streaming: OkHttpClient = http.newBuilder().readTimeout(0, TimeUnit.SECONDS).build()

    val baseUrl: HttpUrl? get() = store.serverUrl?.toHttpUrlOrNull()
    val hasSession: Boolean get() = store.sessionCookie != null

    /** Absolute URL of a server path such as `/api/attachments/abc`. */
    fun resolve(path: String): String = if (path.startsWith("http") || path.startsWith("data:")) path else (baseUrl?.resolve(path)?.toString() ?: path)

    private fun url(path: String): HttpUrl = (baseUrl ?: throw ApiException("No server", 0)).resolve("/api$path") ?: throw ApiException("Bad path", 0)

    private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) { cont.resume(response) }
        })
    }

    private suspend fun raw(method: String, path: String, body: RequestBody? = null): JsonElement {
        val request = Request.Builder().url(url(path)).method(method, body ?: if (method == "GET") null else EMPTY).build()
        http.newCall(request).await().use { response ->
            val text = response.body.string()
            val json = if (text.isBlank()) JsonObject(emptyMap()) else runCatching { OdJson.parseToJsonElement(text) }.getOrElse { JsonObject(emptyMap()) }
            if (!response.isSuccessful) throw ApiException(json.asObject()?.str("error") ?: "HTTP ${response.code}", response.code)
            return json
        }
    }

    private suspend fun json(method: String, path: String, body: JsonElement? = null): JsonElement =
        raw(method, path, body?.toString()?.toRequestBody(JSON))

    private suspend inline fun <reified T> get(path: String): T = OdJson.decodeFromJsonElement(json("GET", path))

    // --- Server & account ------------------------------------------------------------

    /** Checks that [candidate] really is an OpenDots engine, then adopts it. */
    suspend fun connect(candidate: HttpUrl): MeResponse {
        val previous = store.serverUrl
        if (previous != candidate.toString()) store.sessionCookie = null
        store.serverUrl = candidate.toString()
        return try { me() } catch (e: Exception) { store.serverUrl = previous; throw e }
    }

    suspend fun me(): MeResponse = get("/auth/me")

    suspend fun signIn(email: String, password: String, register: Boolean): Account {
        val body = buildJsonObject { put("email", email.trim()); put("password", password) }
        return OdJson.decodeFromJsonElement<AccountResponse>(json("POST", if (register) "/auth/register" else "/auth/login", body)).account
    }

    suspend fun signOut() {
        runCatching { json("POST", "/auth/logout") }
        store.sessionCookie = null
    }

    fun forgetSession() { store.sessionCookie = null }

    suspend fun bootstrap(): Bootstrap = get("/bootstrap")
    suspend fun saveOpenRouterKey(key: String) { json("POST", "/onboarding/key", buildJsonObject { put("key", key.trim()) }) }
    suspend fun openRouterModels(): List<ModelInfo> = get("/models/openrouter")
    /** Models of one provider: "openrouter" or "codex" (ChatGPT sign-in, configured from the web app). */
    suspend fun models(provider: String): List<ModelInfo> = get("/models/$provider")
    suspend fun completeOnboarding(model: String, timezone: String) {
        json("POST", "/onboarding/complete", buildJsonObject {
            putJsonObject("model") { put("provider", "openrouter"); put("model", model) }
            put("timezone", timezone)
        })
    }

    suspend fun settings(): ServerSettings = get("/settings")
    suspend fun setPaused(paused: Boolean) { json("PUT", "/settings", buildJsonObject { put("paused", paused) }) }

    // --- Companions ---------------------------------------------------------------------

    suspend fun agents(): List<Agent> = get("/agents")
    suspend fun markRead(agentId: String) { json("POST", "/agents/$agentId/read") }
    suspend fun stop(agentId: String) { json("POST", "/agents/$agentId/stop") }

    suspend fun updateAgent(agentId: String, patch: JsonObject): Agent = OdJson.decodeFromJsonElement(json("PATCH", "/agents/$agentId", patch))

    data class History(val conversationId: String, val messages: List<ChatMessage>, val cursor: Long?, val active: Boolean)

    suspend fun messages(agentId: String, before: Long? = null): History {
        val root = json("GET", "/agents/$agentId/messages" + (before?.let { "?before=$it" } ?: "")).asObject() ?: JsonObject(emptyMap())
        return History(
            conversationId = root.str("conversationId").orEmpty(),
            messages = root.arr("messages").orEmpty().mapNotNull { (it as? JsonObject)?.let(::parseMessage) },
            cursor = root.num("cursor")?.toLong(),
            active = root.bool("active") == true,
        )
    }

    suspend fun react(messageId: String, emoji: String): ReactionResult =
        OdJson.decodeFromJsonElement(json("POST", "/messages/$messageId/reactions", buildJsonObject { put("emoji", emoji) }))

    // --- Approvals, forms, drafts, activities ---------------------------------------------

    suspend fun approvals(status: String? = null): List<Approval> = get("/approvals" + (status?.let { "?status=$it" } ?: ""))
    suspend fun decide(approvalId: String, approve: Boolean): DecisionResult =
        OdJson.decodeFromJsonElement(json("POST", "/approvals/$approvalId", buildJsonObject { put("decision", if (approve) "approve" else "reject") }))

    suspend fun userRequest(id: String): UserRequest = get("/requests/$id")
    suspend fun draft(id: String): MailDraft = get("/mail/drafts/$id")

    suspend fun activities(): List<Activity> = get("/activities")
    suspend fun setActivityEnabled(id: String, enabled: Boolean): Activity =
        OdJson.decodeFromJsonElement(json("PATCH", "/activities/$id", buildJsonObject { put("enabled", enabled) }))
    suspend fun runActivity(id: String) { json("POST", "/activities/$id/run") }
    suspend fun deleteActivity(id: String) { json("DELETE", "/activities/$id") }

    // --- Companion computer -------------------------------------------------------------------

    suspend fun desktop(agentId: String): DesktopStatus = get("/computer/desktop?agentId=$agentId")
    suspend fun startDesktop(agentId: String): DesktopStatus =
        OdJson.decodeFromJsonElement(json("POST", "/computer/desktop/start?agentId=$agentId", buildJsonObject { put("notify", false) }))

    /** Human control: while it is on, the companion's own desktop tools wait instead of acting. */
    suspend fun setDesktopControl(agentId: String, enabled: Boolean) {
        json("POST", "/computer/desktop/control?agentId=$agentId", buildJsonObject { put("enabled", enabled) })
    }

    /**
     * The companion's screen as a VNC stream, relayed by the server over an authenticated WebSocket. The server only
     * accepts it from its own origin, so the Origin header is the server's.
     */
    fun desktopSocket(agentId: String, listener: okhttp3.WebSocketListener): okhttp3.WebSocket {
        val base = baseUrl ?: throw ApiException("No server", 0)
        val origin = "${base.scheme}://${base.host}" + if (base.port == HttpUrl.defaultPort(base.scheme)) "" else ":${base.port}"
        return streaming.newWebSocket(Request.Builder().url(url("/computer/vnc?agentId=$agentId")).header("Origin", origin).build(), listener)
    }

    // --- Attachments ------------------------------------------------------------------------

    suspend fun uploadImage(bytes: ByteArray, filename: String, mediaType: String): Attachment {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", filename, bytes.toRequestBody(mediaType.toMediaType()))
            .build()
        return OdJson.decodeFromJsonElement(raw("POST", "/attachments", body))
    }

    // --- Streams ------------------------------------------------------------------------------

    /** Sends one user message and follows the companion's turn. */
    fun chat(agentId: String, messageId: String, text: String, files: List<Attachment>, replyTo: ReplyRef?, answer: JsonObject?): Flow<JsonObject> {
        val message = buildJsonObject {
            put("id", messageId)
            put("role", "user")
            put("parts", buildJsonArray {
                if (text.isNotBlank()) add(buildJsonObject { put("type", "text"); put("text", text) })
                files.forEach { file -> add(buildJsonObject { put("type", "file"); put("url", file.url); put("filename", file.filename); put("mediaType", file.mediaType) }) }
            })
            putJsonObject("metadata") {
                put("kind", "chat")
                if (replyTo != null) put("replyTo", OdJson.encodeToJsonElement(replyTo))
                if (answer != null) put("answer", answer)
            }
        }
        val body = buildJsonObject { put("message", message) }.toString().toRequestBody(JSON)
        return sse(Request.Builder().url(url("/agents/$agentId/chat")).post(body).build())
    }

    /** Joins the turn currently running for [agentId], replayed from its first chunk. Empty when nothing is running. */
    fun resume(agentId: String): Flow<JsonObject> = sse(Request.Builder().url(url("/agents/$agentId/stream")).build())

    /** The account's realtime events. Completes when the connection drops; the caller reconnects. */
    fun events(): Flow<ServerEvent> = callbackFlow {
        val call = streaming.newCall(Request.Builder().url(url("/events")).header("Accept", "text/event-stream").build())
        val worker = Thread {
            try {
                call.execute().use { response ->
                    if (!response.isSuccessful) throw ApiException("HTTP ${response.code}", response.code)
                    readSse(response) { data -> (runCatching { OdJson.parseToJsonElement(data) }.getOrNull() as? JsonObject)?.let(::parseServerEvent)?.let { trySend(it) } }
                }
                close()
            } catch (e: Exception) { close(e) }
        }
        worker.start()
        awaitClose { call.cancel() }
    }

    private fun sse(request: Request): Flow<JsonObject> = callbackFlow {
        val call = streaming.newCall(request)
        val worker = Thread {
            try {
                call.execute().use { response ->
                    if (response.code == 204) return@use
                    if (!response.isSuccessful) {
                        val text = runCatching { response.body.string() }.getOrDefault("")
                        val error = (runCatching { OdJson.parseToJsonElement(text) }.getOrNull() as? JsonObject)?.str("error")
                        throw ApiException(error ?: "HTTP ${response.code}", response.code)
                    }
                    readSse(response) { data -> (runCatching { OdJson.parseToJsonElement(data) }.getOrNull() as? JsonObject)?.let { trySend(it) } }
                }
                close()
            } catch (e: Exception) { close(e) }
        }
        worker.start()
        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)

    private fun readSse(response: Response, onData: (String) -> Unit) {
        val source = response.body.source()
        val data = StringBuilder()
        while (true) {
            val line = source.readUtf8Line() ?: break
            when {
                line.isEmpty() -> {
                    if (data.isNotEmpty()) { val payload = data.toString(); data.setLength(0); if (payload != "[DONE]") onData(payload) }
                }
                line.startsWith("data:") -> { if (data.isNotEmpty()) data.append('\n'); data.append(line.removePrefix("data:").removePrefix(" ")) }
            }
        }
    }

    private companion object {
        const val COOKIE = "opendots_session"
        val JSON = "application/json".toMediaType()
        val EMPTY = ByteArray(0).toRequestBody(null)
    }
}

