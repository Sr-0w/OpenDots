package app.dot.opendots.data

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Lenient on purpose: the server is the source of truth and grows fields between releases. */
val OdJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
}

@Serializable
data class Account(val id: String = "", val email: String = "", val role: String = "")

@Serializable
data class MeResponse(val account: Account? = null, val registrationOpen: Boolean = true)

@Serializable
data class AccountResponse(val account: Account)

@Serializable
data class ModelConfig(val provider: String = "openrouter", val model: String = "", val reasoning: String? = null, val providerOrder: List<String>? = null)

@Serializable
data class Bootstrap(
    val onboarded: Boolean = false,
    val openrouterConfigured: Boolean = false,
    val defaultModel: ModelConfig? = null,
    val paused: Boolean = false,
)

@Serializable
data class Permissions(
    val web: Boolean = true,
    val manageActivities: Boolean = true,
    val messageAgents: Boolean = true,
    val createAgents: String = "ask",
    val manageMemory: Boolean = true,
    val mail: Boolean = true,
    val connectors: Boolean = true,
    val shell: Boolean = true,
    val computer: Boolean = false,
)

@Immutable
@Serializable
data class Agent(
    val id: String,
    val name: String = "",
    val named: Boolean = false,
    val color: String = "#888888",
    val description: String = "",
    val personality: String = "",
    val instructions: String = "",
    val model: ModelConfig? = null,
    val effectiveModel: ModelConfig = ModelConfig(),
    val permissions: Permissions = Permissions(),
    val state: String = "available",
    val stateDetail: String? = null,
    val lastMessageAt: String? = null,
    val lastMessagePreview: String? = null,
    val unread: Int = 0,
    val mainConversationId: String = "",
    val archived: Boolean = false,
) {
    val busy: Boolean get() = state in BUSY_STATES
    companion object { val BUSY_STATES = setOf("awake", "thinking", "working", "collaborating") }
}

@Immutable
@Serializable
data class Approval(
    val id: String,
    val agentId: String = "",
    val conversationId: String = "",
    val action: String = "",
    val summary: String = "",
    val input: JsonElement? = null,
    val status: String = "pending",
    val error: String? = null,
    val createdAt: String = "",
)

@Serializable
data class DecisionResult(val ok: Boolean = false, val status: String = "", val error: String? = null)

@Serializable
data class Schedule(val type: String = "", val at: String? = null, val minutes: Double? = null, val expr: String? = null, val tz: String? = null)

@Serializable
data class Watch(val url: String = "", val mode: String = "changed", val value: String? = null)

@Immutable
@Serializable
data class Activity(
    val id: String,
    val agentId: String = "",
    val title: String = "",
    val kind: String = "schedule",
    val instructions: String = "",
    val schedule: Schedule? = null,
    val watch: Watch? = null,
    val enabled: Boolean = true,
    val nextRunAt: String? = null,
    val lastRunAt: String? = null,
    val lastStatus: String? = null,
    val runCount: Int = 0,
)

@Immutable
@Serializable
data class AskQuestion(
    val id: String,
    val label: String = "",
    val type: String = "text",
    val options: List<String>? = null,
    val required: Boolean = false,
    val placeholder: String? = null,
    val allowOther: Boolean = false,
)

@Immutable
@Serializable
data class UserRequest(
    val id: String,
    val agentId: String = "",
    val title: String = "",
    val questions: List<AskQuestion> = emptyList(),
    val status: String = "pending",
    val answers: JsonObject? = null,
)

@Immutable
@Serializable
data class MailDraft(
    val id: String,
    val from: String = "",
    val to: List<String> = emptyList(),
    val cc: List<String> = emptyList(),
    val subject: String = "",
    val body: String = "",
    val status: String = "pending",
    val approvalId: String? = null,
    val error: String? = null,
)

@Immutable
@Serializable
data class ModelInfo(
    val id: String,
    val name: String = "",
    val provider: String = "openrouter",
    val contextLength: Long? = null,
    val tools: Boolean = false,
    val reasoning: Boolean = false,
    val vision: Boolean = false,
)

@Serializable
data class ServerSettings(
    val openrouterKey: String? = null,
    val defaultModel: ModelConfig = ModelConfig(),
    val timezone: String = "",
    val paused: Boolean = false,
)

@Serializable
data class DesktopStatus(
    val enabled: Boolean = false,
    val available: Boolean = false,
    val running: Boolean = false,
    val suspended: Boolean = false,
    val manualControl: Boolean = false,
    val width: Int = 1280,
    val height: Int = 800,
    val vncPassword: String? = null,
)

@Serializable
data class Attachment(val id: String, val url: String, val filename: String = "image.jpg", val mediaType: String = "image/jpeg")

@Immutable
@Serializable
data class Reaction(val emoji: String, val actor: String = "user")

@Serializable
data class ReactionResult(val added: Boolean = false, val reactions: List<Reaction> = emptyList())

@Immutable
@Serializable
data class ReplyRef(val messageId: String, val preview: String = "", val role: String = "assistant")

@Immutable
@Serializable
data class EventMeta(val type: String = "system", val title: String = "", val fromAgentId: String? = null, val approvalId: String? = null)

/** Metadata attached to every message (see `MessageMetadata` in packages/shared). */
@Immutable
@Serializable
data class MessageMeta(
    val kind: String? = null,
    val agentId: String? = null,
    val event: EventMeta? = null,
    val createdAt: String? = null,
    val hidden: Boolean = false,
    val setup: Boolean = false,
    val answer: JsonObject? = null,
    val replyTo: ReplyRef? = null,
    val reactions: List<Reaction> = emptyList(),
    val workedMs: Long? = null,
)

/** One part of a message, mirroring the AI SDK's UI message parts that OpenDots stores. */
@Immutable
sealed interface Part {
    data class Text(val text: String) : Part
    data class Reasoning(val text: String) : Part
    data class File(val url: String, val mediaType: String, val filename: String?) : Part

    /** [state] is one of input-streaming, input-available, output-available, output-error. */
    data class Tool(
        val callId: String,
        val name: String,
        val state: String,
        val input: JsonElement? = null,
        val output: JsonElement? = null,
        val errorText: String? = null,
    ) : Part {
        val outputObject: JsonObject? get() = output as? JsonObject
        val failed: Boolean get() = state == "output-error" || outputObject?.bool("ok") == false
    }
}

@Immutable
data class ChatMessage(val id: String, val role: String, val parts: List<Part>, val meta: MessageMeta = MessageMeta()) {
    val isUser: Boolean get() = role == "user"
}

/** What the server tells every connected client (see `ServerEvent` in packages/shared). */
sealed interface ServerEvent {
    data object Hello : ServerEvent
    data class AgentChanged(val agent: Agent) : ServerEvent
    data class AgentState(val agentId: String, val state: String, val detail: String?) : ServerEvent
    data class TurnStarted(val agentId: String, val conversationId: String, val autonomous: Boolean) : ServerEvent
    data class TurnFinished(val agentId: String, val conversationId: String) : ServerEvent
    data class MessageCreated(val conversationId: String, val agentId: String?, val author: String, val hidden: Boolean, val preview: String) : ServerEvent
    data class MessageReaction(val conversationId: String, val messageId: String, val reactions: List<Reaction>) : ServerEvent
    data class ApprovalChanged(val approval: Approval) : ServerEvent
    data class RequestChanged(val request: UserRequest) : ServerEvent
    data class DraftChanged(val draft: MailDraft) : ServerEvent
    data class ActivityChanged(val agentId: String) : ServerEvent
    data object SettingsChanged : ServerEvent
    data class Other(val type: String) : ServerEvent
}
