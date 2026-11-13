package app.dot.opendots.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.doubleOrNull

fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull
fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
fun JsonObject.arr(key: String): JsonArray? = this[key] as? JsonArray
fun JsonElement?.asObject(): JsonObject? = this as? JsonObject

/** Stored messages → typed messages. Unknown part types are dropped rather than failing the whole history. */
fun parseMessage(raw: JsonObject): ChatMessage? {
    val id = raw.str("id") ?: return null
    val role = raw.str("role") ?: return null
    val meta = raw.obj("metadata")?.let { runCatching { OdJson.decodeFromJsonElement<MessageMeta>(it) }.getOrNull() } ?: MessageMeta()
    val parts = raw.arr("parts").orEmpty().mapNotNull { (it as? JsonObject)?.let(::parsePart) }
    return ChatMessage(id, role, parts, meta)
}

fun parsePart(p: JsonObject): Part? {
    val type = p.str("type") ?: return null
    return when {
        type == "text" -> Part.Text(p.str("text").orEmpty())
        type == "reasoning" -> Part.Reasoning(p.str("text").orEmpty())
        type == "file" -> Part.File(p.str("url").orEmpty(), p.str("mediaType").orEmpty(), p.str("filename"))
        type == "dynamic-tool" || type.startsWith("tool-") -> Part.Tool(
            callId = p.str("toolCallId").orEmpty(),
            name = if (type == "dynamic-tool") p.str("toolName") ?: "tool" else type.removePrefix("tool-"),
            state = p.str("state") ?: "input-available",
            input = p["input"],
            output = p["output"],
            errorText = p.str("errorText"),
        )
        else -> null
    }
}

fun parseServerEvent(raw: JsonObject): ServerEvent? {
    fun <T> decode(key: String, block: (JsonElement) -> T): T? = raw[key]?.let { runCatching { block(it) }.getOrNull() }
    return when (val type = raw.str("type") ?: return null) {
        "hello" -> ServerEvent.Hello
        "agent.updated", "agent.created" -> decode("agent") { OdJson.decodeFromJsonElement<Agent>(it) }?.let(ServerEvent::AgentChanged)
        "agent.state" -> ServerEvent.AgentState(raw.str("agentId").orEmpty(), raw.str("state") ?: "available", raw.str("detail"))
        "turn.started" -> ServerEvent.TurnStarted(raw.str("agentId").orEmpty(), raw.str("conversationId").orEmpty(), raw.bool("autonomous") == true)
        "turn.finished" -> ServerEvent.TurnFinished(raw.str("agentId").orEmpty(), raw.str("conversationId").orEmpty())
        "message.created" -> ServerEvent.MessageCreated(raw.str("conversationId").orEmpty(), raw.str("agentId"), raw.str("author") ?: "agent", raw.bool("hidden") == true, raw.str("preview").orEmpty())
        "message.reaction" -> ServerEvent.MessageReaction(
            raw.str("conversationId").orEmpty(), raw.str("messageId").orEmpty(),
            decode("reactions") { OdJson.decodeFromJsonElement<List<Reaction>>(it) }.orEmpty(),
        )
        "approval.changed" -> decode("approval") { OdJson.decodeFromJsonElement<Approval>(it) }?.let(ServerEvent::ApprovalChanged)
        "request.changed" -> decode("request") { OdJson.decodeFromJsonElement<UserRequest>(it) }?.let(ServerEvent::RequestChanged)
        "draft.changed" -> decode("draft") { OdJson.decodeFromJsonElement<MailDraft>(it) }?.let(ServerEvent::DraftChanged)
        "activity.changed" -> ServerEvent.ActivityChanged(raw.str("agentId").orEmpty())
        "settings.changed" -> ServerEvent.SettingsChanged
        else -> ServerEvent.Other(type)
    }
}

fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()
