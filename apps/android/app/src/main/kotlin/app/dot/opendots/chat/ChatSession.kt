package app.dot.opendots.chat

import app.dot.opendots.data.ApiException
import app.dot.opendots.data.Attachment
import app.dot.opendots.data.ChatMessage
import app.dot.opendots.data.MessageMeta
import app.dot.opendots.data.OpenDotsClient
import app.dot.opendots.data.Part
import app.dot.opendots.data.Reaction
import app.dot.opendots.data.ReplyRef
import app.dot.opendots.data.ServerEvent
import app.dot.opendots.data.TurnAssembler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

enum class ChatStatus { Ready, Submitted, Streaming }

data class ChatUiState(
    val loading: Boolean = true,
    val messages: List<ChatMessage> = emptyList(),
    val status: ChatStatus = ChatStatus.Ready,
    val error: String? = null,
    val loadError: String? = null,
    val cursor: Long? = null,
    val loadingOlder: Boolean = false,
    /** The connection dropped while a turn was running; catching up. */
    val reconnecting: Boolean = false,
    /** The last message could not be delivered to the server. */
    val notSent: Boolean = false,
) {
    val busy: Boolean get() = status != ChatStatus.Ready
    /** Waiting for the companion's first visible output. */
    val waiting: Boolean get() = status == ChatStatus.Submitted || (status == ChatStatus.Streaming && messages.lastOrNull()?.isUser == true)
}

/**
 * One companion's conversation: history, the live turn, and everything the user can do to it. It follows the same rules
 * as the web client: a turn belongs to the server (it keeps running when nobody listens), so the session only ever
 * *follows* a stream, and re-reads history whenever the server says a turn finished.
 */
class ChatSession(
    val agentId: String,
    private val client: OpenDotsClient,
    private val scope: CoroutineScope,
    private val onUnauthorized: () -> Unit = {},
) {
    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    private var conversationId: String? = null
    private var streamJob: Job? = null
    private var loaded = false
    private var olderLoaded = false

    fun open() {
        if (loaded) { scope.launch { resync(); markRead() }; return }
        loaded = true
        scope.launch {
            try {
                val history = client.messages(agentId)
                conversationId = history.conversationId
                _state.update { it.copy(loading = false, messages = history.messages, cursor = history.cursor, loadError = null) }
                if (history.active) follow(resume = true)
                markRead()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                loaded = false
                fail(e)
                _state.update { it.copy(loading = false, loadError = e.message ?: "") }
            }
        }
    }

    fun loadOlder() {
        val cursor = _state.value.cursor ?: return
        if (_state.value.loadingOlder) return
        _state.update { it.copy(loadingOlder = true) }
        scope.launch {
            try {
                val older = client.messages(agentId, before = cursor)
                olderLoaded = true
                _state.update { s ->
                    val known = s.messages.mapTo(HashSet()) { it.id }
                    s.copy(messages = older.messages.filterNot { it.id in known } + s.messages, cursor = older.cursor, loadingOlder = false)
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                _state.update { it.copy(loadingOlder = false) }
            }
        }
    }

    fun send(text: String, files: List<Attachment> = emptyList(), replyTo: ReplyRef? = null, answer: JsonObject? = null) {
        val id = "msg_" + UUID.randomUUID().toString().replace("-", "")
        val parts = buildList<Part> {
            if (text.isNotBlank()) add(Part.Text(text.trim()))
            files.forEach { add(Part.File(it.url, it.mediaType, it.filename)) }
        }
        if (parts.isEmpty()) return
        val mine = ChatMessage(id, "user", parts, MessageMeta(kind = "chat", replyTo = replyTo, answer = answer))
        streamJob?.cancel()
        _state.update { it.copy(messages = it.messages + mine, status = ChatStatus.Submitted, error = null, notSent = false) }
        follow(resume = false) { client.chat(agentId, id, text.trim(), files, replyTo, answer) }
    }

    fun stop() {
        streamJob?.cancel()
        _state.update { it.copy(status = ChatStatus.Ready) }
        scope.launch {
            runCatching { client.stop(agentId) }
            delay(300)
            resync()
        }
    }

    fun dismissError() = _state.update { it.copy(error = null, notSent = false) }

    fun react(messageId: String, emoji: String) {
        _state.update { s ->
            s.copy(messages = s.messages.map { m ->
                if (m.id != messageId) m else {
                    val mine = m.meta.reactions.any { it.emoji == emoji && it.actor == "user" }
                    val next = if (mine) m.meta.reactions.filterNot { it.emoji == emoji && it.actor == "user" } else m.meta.reactions + Reaction(emoji, "user")
                    m.copy(meta = m.meta.copy(reactions = next))
                }
            })
        }
        scope.launch {
            try { setReactions(messageId, client.react(messageId, emoji).reactions) } catch (e: Exception) {
                if (e is CancellationException) throw e
                resync()
            }
        }
    }

    fun onEvent(event: ServerEvent) {
        val conversation = conversationId ?: return
        when (event) {
            is ServerEvent.TurnStarted -> if (event.conversationId == conversation && event.autonomous && !_state.value.busy) {
                // An autonomous wake-up: fetch the triggering event, then follow the turn.
                scope.launch { resync(); follow(resume = true) }
            }
            is ServerEvent.MessageCreated -> if (event.conversationId == conversation && event.author == "agent" && !event.hidden) scope.launch { resync() }
            is ServerEvent.MessageReaction -> if (event.conversationId == conversation) setReactions(event.messageId, event.reactions)
            is ServerEvent.TurnFinished -> if (event.conversationId == conversation) scope.launch { delay(300); resync(); markRead() }
            else -> Unit
        }
    }

    /** Re-reads history. While a turn streams, the streamed message and unsent local messages are kept on top of it. */
    suspend fun resync(allowFollow: Boolean = true) {
        if (!loaded) return
        try {
            val history = client.messages(agentId)
            conversationId = history.conversationId
            _state.update { s ->
                val remote = history.messages.mapTo(HashSet()) { it.id }
                // Pages the user scrolled back to stay above the freshly read window.
                val older = if (olderLoaded && s.messages.any { it.id in remote }) s.messages.takeWhile { it.id !in remote } else emptyList()
                val streaming = if (s.busy) s.messages.lastOrNull { !it.isUser } else null
                val pending = if (s.busy) s.messages.filter { it.id !in remote && it.id != streaming?.id && it !in older } else emptyList()
                val base = history.messages.filter { it.id != streaming?.id }
                s.copy(messages = older + base + pending + listOfNotNull(streaming), cursor = if (older.isEmpty()) history.cursor else s.cursor, loadError = null)
            }
            if (allowFollow && history.active && !_state.value.busy) follow(resume = true)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            fail(e)
        }
    }

    private fun follow(resume: Boolean, source: () -> kotlinx.coroutines.flow.Flow<JsonObject> = { client.resume(agentId) }) {
        streamJob?.cancel()
        streamJob = scope.launch {
            val assembler = TurnAssembler("live_" + UUID.randomUUID())
            var sawChunk = false
            try {
                source().collect { chunk ->
                    if (!sawChunk) { sawChunk = true; _state.update { it.copy(status = ChatStatus.Streaming) } }
                    if (assembler.accept(chunk)) {
                        val live = assembler.snapshot()
                        if (live.parts.isNotEmpty()) upsert(live)
                    }
                    assembler.error?.let { message -> _state.update { it.copy(error = message) } }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e)
                when {
                    // The server answered with an error: that is a real failure.
                    e is ApiException -> if (!resume || sawChunk) _state.update { it.copy(error = e.message ?: "") }
                    // The connection dropped while following a turn. The turn belongs to the server and keeps running:
                    // this is a sync problem, not "the companion couldn't answer". Catch up quietly.
                    resume || sawChunk -> { reconnect(); return@launch }
                    // The message itself may never have reached the server: say so.
                    else -> _state.update { it.copy(error = e.message ?: "", notSent = true) }
                }
            }
            _state.update { it.copy(status = ChatStatus.Ready) }
            resync(allowFollow = sawChunk)
            markRead()
        }
    }

    /** After a dropped connection: re-read history and rejoin the turn if it is still running, with a short backoff. */
    private suspend fun reconnect() {
        _state.update { it.copy(status = ChatStatus.Ready, reconnecting = true) }
        var wait = 1_000L
        repeat(6) {
            delay(wait)
            wait = (wait * 2).coerceAtMost(8_000L)
            val history = try { client.messages(agentId) } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (e is ApiException) { fail(e); _state.update { it.copy(reconnecting = false) }; return }
                null
            }
            if (history != null) {
                _state.update { it.copy(reconnecting = false) }
                resync(allowFollow = true)
                markRead()
                return
            }
        }
        // Still offline: the app-wide reconnection will resync this conversation when the server is reachable again.
        _state.update { it.copy(reconnecting = false) }
    }

    private fun upsert(message: ChatMessage) = _state.update { s ->
        val at = s.messages.indexOfLast { it.id == message.id }
        s.copy(messages = if (at < 0) s.messages + message else s.messages.toMutableList().also { it[at] = message.copy(meta = message.meta.copy(reactions = it[at].meta.reactions)) })
    }

    private fun setReactions(messageId: String, reactions: List<Reaction>) = _state.update { s ->
        s.copy(messages = s.messages.map { if (it.id == messageId) it.copy(meta = it.meta.copy(reactions = reactions)) else it })
    }

    private suspend fun markRead() { runCatching { client.markRead(agentId) } }

    private fun fail(e: Exception) { if (e is ApiException && e.status == 401) onUnauthorized() }
}
