package app.dot.opendots

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.dot.opendots.chat.ChatSession
import app.dot.opendots.data.Account
import app.dot.opendots.data.Activity
import app.dot.opendots.data.Agent
import app.dot.opendots.data.ApiException
import app.dot.opendots.data.Approval
import app.dot.opendots.data.MailDraft
import app.dot.opendots.data.ModelInfo
import app.dot.opendots.data.OpenDotsClient
import app.dot.opendots.data.ServerEvent
import app.dot.opendots.data.SessionStore
import app.dot.opendots.data.UserRequest
import app.dot.opendots.data.normalizeServerUrl
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import java.util.TimeZone
import kotlin.coroutines.cancellation.CancellationException

/** Where the app is in its journey from "no server" to "talking to a companion". */
sealed interface Stage {
    data object Starting : Stage
    /** No server chosen yet, or the chosen one must be changed. */
    data object Server : Stage
    /** The chosen server did not answer. */
    data class Unreachable(val message: String) : Stage
    data class SignIn(val registrationOpen: Boolean) : Stage
    data class Onboarding(val keyConfigured: Boolean) : Stage
    data object Main : Stage
}

data class AppUiState(
    val stage: Stage = Stage.Starting,
    val serverUrl: String = "",
    val account: Account? = null,
    val agents: List<Agent> = emptyList(),
    val currentAgentId: String? = null,
    val approvals: Map<String, Approval> = emptyMap(),
    val requests: Map<String, UserRequest> = emptyMap(),
    val drafts: Map<String, MailDraft> = emptyMap(),
    val activities: List<Activity>? = null,
    val connected: Boolean = true,
    val paused: Boolean = false,
    val busy: Boolean = false,
    val formError: String? = null,
    val themeMode: String = "SYSTEM",
    val reduceTransparency: Boolean = false,
) {
    val currentAgent: Agent? get() = agents.firstOrNull { it.id == currentAgentId } ?: agents.firstOrNull()
    val pendingApprovals: List<Approval> get() = approvals.values.filter { it.status == "pending" }.sortedByDescending { it.createdAt }
}

/**
 * The single source of truth of the app: session, companions, and everything the server pushes. Screens render
 * [state] and call methods; nothing else talks to [client].
 */
class AppState(private val store: SessionStore, val client: OpenDotsClient) : ViewModel() {

    private val _state = MutableStateFlow(AppUiState(serverUrl = store.serverUrl.orEmpty(), themeMode = store.themeMode, reduceTransparency = store.reduceTransparency, currentAgentId = store.lastAgentId))
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    /** One-line messages for the snackbar (failures of actions the user just took). */
    private val _notices = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val notices: SharedFlow<String> = _notices.asSharedFlow()

    private val sessions = HashMap<String, ChatSession>()
    private var eventsJob: Job? = null
    private var foreground = true

    init { start() }

    // --- Journey ------------------------------------------------------------------------

    fun start() {
        if (store.serverUrl == null) { setStage(Stage.Server); return }
        setStage(Stage.Starting)
        viewModelScope.launch {
            try {
                val me = client.me()
                if (me.account == null) { client.forgetSession(); setStage(Stage.SignIn(me.registrationOpen)) } else enter(me.account)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                setStage(Stage.Unreachable(e.message.orEmpty()))
            }
        }
    }

    private suspend fun enter(account: Account) {
        _state.update { it.copy(account = account) }
        val boot = client.bootstrap()
        if (!boot.onboarded) { setStage(Stage.Onboarding(boot.openrouterConfigured)); return }
        val agents = client.agents().filterNot { it.archived }
        _state.update { s ->
            s.copy(
                stage = Stage.Main, agents = agents, paused = boot.paused, formError = null, busy = false,
                currentAgentId = s.currentAgentId?.takeIf { id -> agents.any { it.id == id } } ?: agents.firstOrNull()?.id,
            )
        }
        runCatching { client.approvals() }.onSuccess { list -> _state.update { s -> s.copy(approvals = list.associateBy { it.id }) } }
        listen()
    }

    fun chooseServer(input: String) = form {
        val url = normalizeServerUrl(input) ?: throw IllegalArgumentException(INVALID_URL)
        val me = client.connect(url)
        _state.update { it.copy(serverUrl = url.toString()) }
        if (me.account == null) setStage(Stage.SignIn(me.registrationOpen)) else enter(me.account)
    }

    fun changeServer() {
        stopListening()
        setStage(Stage.Server)
    }

    fun signIn(email: String, password: String, register: Boolean) = form { enter(client.signIn(email, password, register)) }

    fun signOut() {
        stopListening()
        sessions.clear()
        viewModelScope.launch {
            client.signOut()
            _state.update { it.copy(account = null, agents = emptyList(), approvals = emptyMap(), requests = emptyMap(), drafts = emptyMap(), activities = null) }
            start()
        }
    }

    fun saveKey(key: String) = form {
        client.saveOpenRouterKey(key)
        setStage(Stage.Onboarding(keyConfigured = true))
    }

    suspend fun models(): List<ModelInfo> = client.openRouterModels()

    fun finishOnboarding(model: String) = form {
        client.completeOnboarding(model, TimeZone.getDefault().id)
        enter(_state.value.account ?: client.me().account ?: throw ApiException("Session expired", 401))
    }

    private fun form(block: suspend () -> Unit) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, formError = null) }
        viewModelScope.launch {
            try { block() } catch (e: Exception) {
                if (e is CancellationException) throw e
                _state.update { it.copy(formError = e.message ?: e.javaClass.simpleName) }
            } finally { _state.update { it.copy(busy = false) } }
        }
    }

    private fun setStage(stage: Stage) = _state.update { it.copy(stage = stage, formError = null) }

    private fun unauthorized() {
        if (_state.value.stage !is Stage.Main) return
        stopListening()
        sessions.clear()
        client.forgetSession()
        start()
    }

    // --- Realtime -----------------------------------------------------------------------

    /** The event stream only runs while the app is visible: companions keep working on the server either way. */
    fun setForeground(visible: Boolean) {
        foreground = visible
        if (_state.value.stage !is Stage.Main) return
        if (visible) { listen(); refresh() } else stopListening()
    }

    private fun stopListening() { eventsJob?.cancel(); eventsJob = null }

    private fun listen() {
        if (eventsJob?.isActive == true || !foreground) return
        eventsJob = viewModelScope.launch {
            var backoff = 1_000L
            while (true) {
                try {
                    client.events().collect { event ->
                        if (event is ServerEvent.Hello) {
                            if (!_state.value.connected) refresh()
                            _state.update { it.copy(connected = true) }
                            backoff = 1_000L
                        }
                        onEvent(event)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (e is ApiException && e.status == 401) { unauthorized(); return@launch }
                }
                _state.update { it.copy(connected = false) }
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(15_000L)
            }
        }
    }

    private fun onEvent(event: ServerEvent) {
        when (event) {
            is ServerEvent.AgentChanged -> _state.update { s ->
                val rest = s.agents.filterNot { it.id == event.agent.id }
                val agents = if (event.agent.archived) rest else if (rest.size == s.agents.size) s.agents + event.agent else s.agents.map { if (it.id == event.agent.id) event.agent else it }
                s.copy(agents = agents, currentAgentId = s.currentAgentId?.takeIf { id -> agents.any { it.id == id } } ?: agents.firstOrNull()?.id)
            }
            is ServerEvent.AgentState -> _state.update { s -> s.copy(agents = s.agents.map { if (it.id == event.agentId) it.copy(state = event.state, stateDetail = event.detail) else it }) }
            is ServerEvent.MessageCreated -> if (!event.hidden && event.agentId != null) _state.update { s ->
                s.copy(agents = s.agents.map { a ->
                    if (a.id != event.agentId) a else a.copy(
                        lastMessagePreview = event.preview.ifBlank { a.lastMessagePreview },
                        unread = if (event.author != "user" && a.id != s.currentAgentId) a.unread + 1 else a.unread,
                    )
                })
            }
            is ServerEvent.ApprovalChanged -> _state.update { it.copy(approvals = it.approvals + (event.approval.id to event.approval)) }
            is ServerEvent.RequestChanged -> _state.update { it.copy(requests = it.requests + (event.request.id to event.request)) }
            is ServerEvent.DraftChanged -> _state.update { it.copy(drafts = it.drafts + (event.draft.id to event.draft)) }
            is ServerEvent.ActivityChanged -> if (_state.value.activities != null) loadActivities()
            ServerEvent.SettingsChanged -> viewModelScope.launch { runCatching { client.bootstrap() }.onSuccess { boot -> _state.update { it.copy(paused = boot.paused) } } }
            else -> Unit
        }
        sessions.values.forEach { it.onEvent(event) }
    }

    /** Catches up after the event stream was down (background, network loss). */
    fun refresh() {
        viewModelScope.launch {
            try {
                val agents = client.agents().filterNot { it.archived }
                val approvals = client.approvals()
                _state.update { it.copy(agents = agents, approvals = approvals.associateBy { a -> a.id }) }
                _state.value.currentAgentId?.let { sessions[it]?.resync() }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (e is ApiException && e.status == 401) unauthorized()
            }
        }
    }

    // --- Companions -----------------------------------------------------------------------

    fun session(agentId: String): ChatSession =
        sessions.getOrPut(agentId) { ChatSession(agentId, client, viewModelScope, ::unauthorized) }

    fun selectAgent(agentId: String) {
        store.lastAgentId = agentId
        _state.update { s -> s.copy(currentAgentId = agentId, agents = s.agents.map { if (it.id == agentId) it.copy(unread = 0) else it }) }
    }

    fun updateAgent(agentId: String, patch: JsonObject) = act {
        val updated = client.updateAgent(agentId, patch)
        _state.update { s -> s.copy(agents = s.agents.map { if (it.id == updated.id) updated else it }) }
    }

    // --- Approvals, forms, drafts -----------------------------------------------------------

    fun decide(approvalId: String, approve: Boolean, onDone: (ok: Boolean) -> Unit = {}) {
        viewModelScope.launch {
            try {
                val result = client.decide(approvalId, approve)
                if (result.status == "failed") _notices.tryEmit(result.error ?: FAILED)
                onDone(result.status != "failed")
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                _notices.tryEmit(e.message ?: FAILED)
                onDone(false)
            }
        }
    }

    fun ensureRequest(id: String) {
        if (id in _state.value.requests) return
        viewModelScope.launch { runCatching { client.userRequest(id) }.onSuccess { r -> _state.update { it.copy(requests = it.requests + (r.id to r)) } } }
    }

    fun ensureDraft(id: String) {
        if (id in _state.value.drafts) return
        viewModelScope.launch { runCatching { client.draft(id) }.onSuccess { d -> _state.update { it.copy(drafts = it.drafts + (d.id to d)) } } }
    }

    // --- Scheduled tasks ----------------------------------------------------------------------

    fun loadActivities() {
        viewModelScope.launch { runCatching { client.activities() }.onSuccess { list -> _state.update { it.copy(activities = list) } }.onFailure { _notices.tryEmit(it.message ?: FAILED) } }
    }

    fun setActivityEnabled(id: String, enabled: Boolean) {
        _state.update { s -> s.copy(activities = s.activities?.map { if (it.id == id) it.copy(enabled = enabled) else it }) }
        act(onFailure = ::loadActivities) {
            val updated = client.setActivityEnabled(id, enabled)
            _state.update { s -> s.copy(activities = s.activities?.map { if (it.id == id) updated else it }) }
        }
    }

    fun runActivity(id: String, onStarted: () -> Unit) = act { client.runActivity(id); onStarted() }

    fun deleteActivity(id: String) = act {
        client.deleteActivity(id)
        _state.update { s -> s.copy(activities = s.activities?.filterNot { it.id == id }) }
    }

    // --- Settings -------------------------------------------------------------------------------

    fun setThemeMode(mode: String) { store.themeMode = mode; _state.update { it.copy(themeMode = mode) } }

    fun setReduceTransparency(on: Boolean) { store.reduceTransparency = on; _state.update { it.copy(reduceTransparency = on) } }

    fun setPaused(paused: Boolean) {
        _state.update { it.copy(paused = paused) }
        act(onFailure = { _state.update { it.copy(paused = !paused) } }) { client.setPaused(paused) }
    }

    fun notify(message: String) { _notices.tryEmit(message) }

    private fun act(onFailure: () -> Unit = {}, block: suspend () -> Unit) {
        viewModelScope.launch {
            try { block() } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (e is ApiException && e.status == 401) unauthorized() else { _notices.tryEmit(e.message ?: FAILED); onFailure() }
            }
        }
    }

    class Factory(private val store: SessionStore, private val client: OpenDotsClient) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AppState(store, client) as T
    }

    companion object {
        /** Sentinels the UI maps to localized text. */
        const val INVALID_URL = "invalid-url"
        const val FAILED = "failed"
    }
}
