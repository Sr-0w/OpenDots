package app.dot.opendots.chat

import androidx.compose.runtime.Immutable
import app.dot.opendots.data.ChatMessage
import app.dot.opendots.data.Part
import app.dot.opendots.data.str

/*
 * How a stored assistant turn is shown. Port of `presentAssistantTurn` / `cleanModelText` from packages/shared, so the
 * native app and the web app split a turn the same way: visible sentences become reading text, reasoning and tool calls
 * go behind one "worked" disclosure, and cards the user must act on stay in the thread.
 */

private val LEAKED_TOOL_CALL = Regex("(?:\\{[^{}]*\\}\\s*)?(?:<\\|[a-z_]+\\|>\\s*)*to=functions\\.[\\w.-]+(?:\\s*<\\|[a-z_]+\\|>[\\w ]*)*\\s*(?:\\{[^{}]*\\})?", RegexOption.IGNORE_CASE)
private val CONTROL_TOKEN = Regex("<\\|(?:start|end|message|channel|constrain|call|return)\\|>")
private val SILENCE = Regex("^\\s*<(silence|no[_-]?reply)\\s*/?>\\s*$", RegexOption.IGNORE_CASE)

/** Some models leak raw tool-call syntax into their text; strip it before display. Markdown layout is left intact. */
fun cleanModelText(text: String): String {
    if ("to=functions." !in text && "<|" !in text) return text.trim()
    return text.replace(LEAKED_TOOL_CALL, " ").replace(CONTROL_TOKEN, "").trim()
}

fun isSilence(text: String): Boolean = SILENCE.matches(text)

private val ACTION_TOOLS = setOf("ask_user", "connection_request_setup", "computer_request_setup", "mail_prepare")

/** A card the user must act on: it stays in the thread instead of the worked panel. */
fun Part.Tool.isAction(): Boolean {
    if (state != "output-available") return false
    val out = outputObject ?: return false
    if (failed) return false
    if (name == "team_send_message" && out.str("status") == "sent") return true
    if (name in ACTION_TOOLS) return true
    return out.str("status") == "pending_approval"
}

@Immutable
sealed interface Bubble {
    val key: String
    data class Text(override val key: String, val text: String) : Bubble
    data class Image(override val key: String, val file: Part.File) : Bubble
}

@Immutable
data class AssistantTurn(
    val bubbles: List<Bubble>,
    val tools: List<Part.Tool>,
    val reasoning: String,
    val actions: List<Part.Tool>,
) {
    val hasWork: Boolean get() = tools.isNotEmpty() || reasoning.isNotBlank()
    val failures: Int get() = tools.count { it.failed }
    val isEmpty: Boolean get() = bubbles.isEmpty() && !hasWork && actions.isEmpty()
    val plainText: String get() = bubbles.filterIsInstance<Bubble.Text>().joinToString("\n\n") { it.text }
}

fun presentAssistantTurn(message: ChatMessage): AssistantTurn {
    val bubbles = ArrayList<Bubble>()
    val tools = ArrayList<Part.Tool>()
    val actions = ArrayList<Part.Tool>()
    val reasoning = StringBuilder()
    message.parts.forEachIndexed { index, part ->
        when (part) {
            is Part.Text -> cleanModelText(part.text).takeIf { it.isNotEmpty() && !isSilence(it) }?.let { bubbles += Bubble.Text("text-$index", it) }
            is Part.Tool -> when {
                part.name == "text_user" -> cleanModelText(part.input?.let { (it as? kotlinx.serialization.json.JsonObject)?.str("text") }.orEmpty())
                    .takeIf { it.isNotEmpty() && !isSilence(it) }?.let { bubbles += Bubble.Text("text-$index", it) }
                part.name == "share_screenshot" && part.state == "output-available" && !part.failed && part.outputObject?.str("status") == "attached" && part.outputObject?.str("url") != null ->
                    bubbles += Bubble.Image("image-$index", Part.File(part.outputObject!!.str("url")!!, part.outputObject!!.str("mediaType") ?: "image/jpeg", part.outputObject!!.str("filename")))
                part.isAction() -> actions += part
                else -> tools += part
            }
            is Part.File -> if (part.mediaType.startsWith("image/")) bubbles += Bubble.Image("image-$index", part)
            is Part.Reasoning -> if (part.text.isNotBlank()) { if (reasoning.isNotEmpty()) reasoning.append("\n\n"); reasoning.append(part.text.trim()) }
        }
    }
    return AssistantTurn(bubbles, tools, reasoning.toString(), actions)
}

/** Text of a user message, without silence markers. */
fun ChatMessage.userText(): String =
    parts.filterIsInstance<Part.Text>().map { it.text }.filterNot(::isSilence).joinToString("\n").trim()
