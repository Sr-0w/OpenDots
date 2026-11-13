package app.dot.opendots.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement

/**
 * Rebuilds one assistant message from the server's UI message stream (the Vercel AI SDK "UI message chunk" protocol:
 * `start`, `text-start/-delta/-end`, `reasoning-*`, `tool-input-*`, `tool-output-*`, `file`, `finish`, `error`…).
 *
 * The server replays a turn from its first chunk when a client (re)connects, so an assembler always starts empty and
 * the message it produces replaces any earlier copy with the same id.
 */
class TurnAssembler(private val fallbackId: String) {
    private var id: String = fallbackId
    private var meta = MessageMeta()
    private val parts = ArrayList<Part>()
    private val textIndex = HashMap<String, Int>()
    private val reasoningIndex = HashMap<String, Int>()
    private val toolIndex = HashMap<String, Int>()
    private val toolInputText = HashMap<String, StringBuilder>()
    private var stepStart = 0

    var error: String? = null
        private set
    var finished = false
        private set

    fun snapshot(): ChatMessage = ChatMessage(id, "assistant", parts.toList(), meta)

    /** Applies [chunk]; returns true when the visible message changed. */
    fun accept(chunk: JsonObject): Boolean {
        when (chunk.str("type")) {
            "start" -> {
                chunk.str("messageId")?.let { id = it }
                mergeMeta(chunk.obj("messageMetadata"))
            }
            "message-metadata", "finish" -> {
                mergeMeta(chunk.obj("messageMetadata"))
                if (chunk.str("type") == "finish") finished = true
            }
            "start-step" -> stepStart = parts.size
            "reset-step" -> {
                while (parts.size > stepStart) parts.removeAt(parts.lastIndex)
                listOf(textIndex, reasoningIndex, toolIndex).forEach { map -> map.values.removeAll { it >= stepStart } }
            }
            "text-start" -> { textIndex[chunk.str("id").orEmpty()] = parts.size; parts += Part.Text("") }
            "text-delta" -> {
                val key = chunk.str("id").orEmpty()
                val at = textIndex.getOrPut(key) { parts += Part.Text(""); parts.lastIndex }
                parts[at] = Part.Text((parts[at] as Part.Text).text + chunk.str("delta").orEmpty())
            }
            "reasoning-start" -> { reasoningIndex[chunk.str("id").orEmpty()] = parts.size; parts += Part.Reasoning("") }
            "reasoning-delta" -> {
                val key = chunk.str("id").orEmpty()
                val at = reasoningIndex.getOrPut(key) { parts += Part.Reasoning(""); parts.lastIndex }
                parts[at] = Part.Reasoning((parts[at] as Part.Reasoning).text + chunk.str("delta").orEmpty())
            }
            "tool-input-start" -> tool(chunk) { it.copy(state = "input-streaming") }
            "tool-input-delta" -> {
                toolInputText.getOrPut(chunk.str("toolCallId").orEmpty()) { StringBuilder() }.append(chunk.str("inputTextDelta").orEmpty())
                return false
            }
            "tool-input-available" -> tool(chunk) { it.copy(state = "input-available", input = chunk["input"]) }
            "tool-input-error" -> tool(chunk) { it.copy(state = "output-error", input = chunk["input"], errorText = chunk.str("errorText")) }
            "tool-output-available" -> tool(chunk) { it.copy(state = "output-available", output = chunk["output"]) }
            "tool-output-error" -> tool(chunk) { it.copy(state = "output-error", errorText = chunk.str("errorText")) }
            "tool-output-denied" -> tool(chunk) { it.copy(state = "output-error", errorText = "denied") }
            "file" -> parts += Part.File(chunk.str("url").orEmpty(), chunk.str("mediaType").orEmpty(), null)
            "error" -> error = chunk.str("errorText") ?: "error"
            "abort" -> finished = true
            else -> return false
        }
        return true
    }

    private inline fun tool(chunk: JsonObject, update: (Part.Tool) -> Part.Tool) {
        val callId = chunk.str("toolCallId").orEmpty()
        val at = toolIndex[callId]
        if (at == null) {
            toolIndex[callId] = parts.size
            parts += update(Part.Tool(callId, chunk.str("toolName") ?: "tool", "input-streaming"))
        } else {
            parts[at] = update(parts[at] as Part.Tool)
        }
    }

    private fun mergeMeta(raw: JsonObject?) {
        if (raw == null) return
        val next = runCatching { OdJson.decodeFromJsonElement<MessageMeta>(raw) }.getOrNull() ?: return
        meta = meta.copy(
            kind = next.kind ?: meta.kind,
            agentId = next.agentId ?: meta.agentId,
            event = next.event ?: meta.event,
            createdAt = next.createdAt ?: meta.createdAt,
            setup = next.setup || meta.setup,
            replyTo = next.replyTo ?: meta.replyTo,
            workedMs = next.workedMs ?: meta.workedMs,
        )
    }
}
