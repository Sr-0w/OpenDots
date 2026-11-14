package app.dot.opendots.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.AddReaction
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dot.design.Dot
import app.dot.design.DotShapes
import app.dot.design.DotSpacing
import app.dot.design.components.DotCodeBlock
import app.dot.design.components.DotDisclosure
import app.dot.design.components.DotIconButton
import app.dot.design.components.DotMarkdown
import app.dot.design.components.DotMenu
import app.dot.design.components.DotMenuItem
import app.dot.design.components.DotQuote
import app.dot.design.components.DotReplyBubble
import app.dot.design.components.DotReactionChip
import app.dot.design.components.DotSpinner
import app.dot.design.components.DotUserBubble
import app.dot.design.components.DotWorkStep
import app.dot.opendots.R
import app.dot.opendots.chat.AssistantTurn
import app.dot.opendots.chat.Bubble
import app.dot.opendots.chat.presentAssistantTurn
import app.dot.opendots.chat.userText
import app.dot.opendots.data.Agent
import app.dot.opendots.data.Approval
import app.dot.opendots.data.ChatMessage
import app.dot.opendots.data.MailDraft
import app.dot.opendots.data.Part
import app.dot.opendots.data.Reaction
import app.dot.opendots.data.ReplyRef
import app.dot.opendots.data.UserRequest
import app.dot.opendots.data.arr
import app.dot.opendots.data.asObject
import app.dot.opendots.data.num
import app.dot.opendots.data.orEmpty
import app.dot.opendots.data.str
import coil3.compose.AsyncImage
import kotlinx.serialization.json.JsonObject

val QUICK_REACTIONS = listOf("👍", "❤️", "😂", "😮", "🙏", "👀")

/** Everything a message needs from the outside world. One stable object, so message rows skip recomposition. */
@Immutable
class MessageEnv(
    val agents: List<Agent>,
    val approvals: Map<String, Approval>,
    val requests: Map<String, UserRequest>,
    val drafts: Map<String, MailDraft>,
    val busy: Boolean,
    val resolveUrl: (String) -> String,
    val onCopy: (String) -> Unit,
    val onReply: (ReplyRef) -> Unit,
    val onReact: (messageId: String, emoji: String) -> Unit,
    val onDecide: (approvalId: String, approve: Boolean) -> Unit,
    val onAnswer: (requestId: String, answers: JsonObject, summary: String) -> Unit,
    val onNeedRequest: (String) -> Unit,
    val onNeedDraft: (String) -> Unit,
    val onOpenWeb: () -> Unit,
    val onOpenImage: (String) -> Unit,
    val onShowWork: () -> Unit = {},
)

@Composable
fun MessageItem(message: ChatMessage, env: MessageEnv, streaming: Boolean, showActions: Boolean, modifier: Modifier = Modifier) {
    when {
        message.meta.kind == "event" -> EventLine(message, env, modifier)
        message.isUser -> UserMessage(message, env, modifier)
        else -> AssistantMessage(message, env, streaming, showActions, modifier)
    }
}

// --- User -----------------------------------------------------------------------------------

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun UserMessage(message: ChatMessage, env: MessageEnv, modifier: Modifier) {
    val text = remember(message.parts) { message.userText() }
    val files = remember(message.parts) { message.parts.filterIsInstance<Part.File>() }
    var menu by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val answered = message.meta.answer != null
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        Box {
            DotUserBubble(
                Modifier
                    .widthIn(max = 320.dp)
                    .clip(DotShapes.large)
                    .combinedClickable(
                        interactionSource = remember { MutableInteractionSource() }, indication = null,
                        onLongClickLabel = stringResource(R.string.message_actions),
                        onLongClick = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); menu = true },
                        onClick = {},
                    ),
            ) {
                message.meta.replyTo?.let { ReplyQuote(it, env) }
                if (answered) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Check, null, Modifier.size(14.dp), tint = Dot.colors.textTertiary)
                        Spacer(Modifier.width(DotSpacing.xs))
                        Text(stringResource(R.string.answers_sent), style = Dot.type.caption, color = Dot.colors.textTertiary)
                    }
                }
                if (text.isNotEmpty()) Text(text, style = Dot.type.body, color = Dot.colors.textPrimary)
                files.forEach { file -> AttachedImage(file, env) }
            }
            MessageMenu(menu, { menu = false }, text, message.id, "user", env)
        }
        Reactions(message.id, message.meta.reactions, env)
    }
}

// --- Assistant -------------------------------------------------------------------------------

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AssistantMessage(message: ChatMessage, env: MessageEnv, streaming: Boolean, showActions: Boolean, modifier: Modifier) {
    val turn = remember(message.parts) { presentAssistantTurn(message) }
    if (turn.isEmpty && !streaming) return
    var menu by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val firstText = turn.bubbles.firstOrNull { it is Bubble.Text }?.key
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(DotSpacing.s)) {
        if (turn.bubbles.isNotEmpty()) {
            Box {
                // Each sentence the companion sends is its own bubble, like an instant-messaging thread.
                Column(
                    Modifier.fillMaxWidth(0.92f).combinedClickable(
                        interactionSource = remember { MutableInteractionSource() }, indication = null,
                        onLongClickLabel = stringResource(R.string.message_actions),
                        onLongClick = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); menu = true },
                        onClick = {},
                    ),
                    verticalArrangement = Arrangement.spacedBy(DotSpacing.xs + 2.dp),
                ) {
                    turn.bubbles.forEach { bubble ->
                        when (bubble) {
                            is Bubble.Text -> DotReplyBubble {
                                if (bubble.key == firstText) message.meta.replyTo?.let { ReplyQuote(it, env) }
                                DotMarkdown(
                                    bubble.text, onCopyCode = env.onCopy, resolveUrl = env.resolveUrl,
                                    image = { url, alt -> AttachedImage(Part.File(url, "image/*", alt.ifBlank { null }), env) },
                                )
                            }
                            is Bubble.Image -> AttachedImage(bubble.file, env)
                        }
                    }
                }
                MessageMenu(menu, { menu = false }, turn.plainText, message.id, "assistant", env, onShowWork = if (turn.hasWork) env.onShowWork else null)
            }
        }
        turn.actions.forEach { part -> ActionCard(part, message, env) }
        if (message.meta.setup) SetupHint(env)
        Reactions(message.id, message.meta.reactions, env)
        if (showActions && !streaming && turn.plainText.isNotEmpty()) {
            Row(Modifier.padding(start = 0.dp).height(40.dp), verticalAlignment = Alignment.CenterVertically) {
                val tint = Dot.colors.textTertiary
                DotIconButton(Icons.Outlined.ContentCopy, stringResource(R.string.copy), onClick = { env.onCopy(turn.plainText) }, tint = tint, modifier = Modifier.size(40.dp))
                DotIconButton(Icons.AutoMirrored.Outlined.Reply, stringResource(R.string.reply), onClick = { env.onReply(ReplyRef(message.id, turn.plainText.take(180), "assistant")) }, tint = tint, modifier = Modifier.size(40.dp))
                DotIconButton(Icons.Outlined.AddReaction, stringResource(R.string.react), onClick = { menu = true }, tint = tint, modifier = Modifier.size(40.dp))
            }
        }
    }
}

/** One turn's work (reasoning, tool calls, outputs) behind a disclosure. Lives in the work panel, never in the thread. */
@Composable
fun TurnWorkDisclosure(message: ChatMessage, turn: AssistantTurn, streaming: Boolean, env: MessageEnv, modifier: Modifier = Modifier, initiallyOpen: Boolean = false) {
    var open by rememberSaveable(message.id) { mutableStateOf(initiallyOpen) }
    val workedMs = message.meta.workedMs
    val label = when {
        streaming -> stringResource(R.string.working)
        turn.tools.isEmpty() -> stringResource(R.string.reasoning)
        workedMs != null -> { val s = (workedMs / 1000).toInt().coerceAtLeast(1); pluralStringResource(R.plurals.worked_seconds, s, s) }
        else -> stringResource(R.string.worked)
    }
    val detail = buildList {
        if (turn.tools.isNotEmpty()) add(pluralStringResource(R.plurals.actions, turn.tools.size, turn.tools.size))
        if (turn.failures > 0) add(pluralStringResource(R.plurals.errors, turn.failures, turn.failures))
        formatWhen(message.meta.createdAt).takeIf { it.isNotEmpty() }?.let(::add)
    }.joinToString(" · ").ifEmpty { null }
    DotDisclosure(
        label = label,
        expanded = open,
        onToggle = { open = !open },
        modifier = modifier,
        detail = detail,
        detailColor = if (turn.failures > 0) Dot.colors.danger else Dot.colors.textTertiary,
        leading = {
            if (streaming) DotSpinner(size = 14.dp) else Icon(Icons.Outlined.Check, null, Modifier.size(15.dp), tint = Dot.colors.textTertiary)
        },
    ) {
        if (turn.reasoning.isNotBlank()) {
            Text(turn.reasoning, style = Dot.type.caption, color = Dot.colors.textSecondary)
        }
        turn.tools.forEach { tool ->
            val label = toolLabel(tool)
            DotWorkStep(label.icon, label.title, running = streaming && tool.state.startsWith("input"), failed = tool.failed, monospace = label.monospace)
            ToolDetail(tool, env)
        }
    }
}

/** Rich output for the few tools whose result is worth reading: terminal output, search results, errors. */
@Composable
private fun ToolDetail(tool: Part.Tool, env: MessageEnv) {
    val out = tool.outputObject
    when {
        tool.failed -> (tool.errorText ?: out?.str("error"))?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = Dot.type.caption, color = Dot.colors.danger, maxLines = 6, overflow = TextOverflow.Ellipsis)
        }
        tool.name == "shell_exec" && out != null -> {
            val text = listOfNotNull(out.str("stdout")?.takeIf { it.isNotBlank() }, out.str("stderr")?.takeIf { it.isNotBlank() }).joinToString("\n")
            val exit = out.num("exit_code")?.toInt()
            if (text.isNotBlank()) DotCodeBlock(
                text.takeLast(4000),
                title = stringResource(R.string.terminal) + (exit?.let { "  ·  exit $it" } ?: ""),
                onCopy = { env.onCopy(text) },
                maxLines = 40,
            )
        }
        tool.name == "web_search" && out != null -> out.arr("results").orEmpty().take(5).forEach { item ->
            val result = item.asObject() ?: return@forEach
            val title = result.str("title").orEmpty()
            val url = result.str("url").orEmpty()
            DotMarkdown("[${title.replace("[", "(").replace("]", ")").ifBlank { url }}]($url)  ·  ${hostOf(url)}", style = Dot.type.caption, color = Dot.colors.textTertiary)
        }
    }
}

// --- Events ---------------------------------------------------------------------------------

/** What woke a companion up (a schedule, a watch, a teammate): one discreet centred line, details on tap. */
@Composable
private fun EventLine(message: ChatMessage, env: MessageEnv, modifier: Modifier) {
    val event = message.meta.event
    var open by rememberSaveable { mutableStateOf(false) }
    val text = remember(message.parts) { message.parts.filterIsInstance<Part.Text>().joinToString("\n") { it.text }.trim() }
    val from = event?.fromAgentId?.let { id -> env.agents.firstOrNull { it.id == id } }
    val c = Dot.colors
    // An exchange with a teammate is content, not a footnote: who, when, and the start of what was said.
    if (from != null && (event?.type == "agent_reply" || event?.type == "agent_message")) {
        val preview = remember(text, event.type) {
            if (event.type == "agent_reply") text.substringAfter("Sa réponse :\n", text).substringBefore("\n\nPoursuis ta tâche").trim() else text
        }
        Column(
            modifier.fillMaxWidth().clip(DotShapes.large).border(DotSpacing.hairline * 2, c.border, DotShapes.large)
                .clickable(role = Role.Button, enabled = preview.isNotEmpty()) { open = !open }
                .padding(horizontal = DotSpacing.m, vertical = 10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CompanionOrb(from, size = 16.dp)
                Spacer(Modifier.width(DotSpacing.s))
                Text(shortEventTitle(event.title) ?: agentDisplayName(from), style = Dot.type.label, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                formatWhen(message.meta.createdAt).takeIf { it.isNotEmpty() }?.let { Text("  ·  $it", style = Dot.type.caption, color = c.textTertiary, maxLines = 1) }
            }
            if (preview.isNotEmpty()) {
                Spacer(Modifier.height(DotSpacing.xs))
                Text(preview, style = Dot.type.callout, color = c.textSecondary, maxLines = if (open) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
            }
        }
        return
    }
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.heightIn(min = 40.dp).clip(DotShapes.pill).clickable(role = Role.Button, enabled = text.isNotEmpty()) { open = !open }, contentAlignment = Alignment.Center) {
            Row(
                Modifier.clip(DotShapes.pill).border(DotSpacing.hairline * 2, c.border, DotShapes.pill).padding(horizontal = DotSpacing.m, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (from != null) CompanionOrb(from, size = 14.dp) else Icon(eventIcon(event?.type), null, Modifier.size(14.dp), tint = c.textTertiary)
                Spacer(Modifier.width(DotSpacing.s))
                Text(shortEventTitle(event?.title) ?: stringResource(R.string.event), style = Dot.type.caption, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                formatWhen(message.meta.createdAt).takeIf { it.isNotEmpty() }?.let { Text("  ·  $it", style = Dot.type.caption, color = c.textTertiary, maxLines = 1) }
            }
        }
        if (open && text.isNotEmpty()) {
            Spacer(Modifier.height(DotSpacing.s))
            Text(
                text, style = Dot.type.caption, color = c.textSecondary,
                modifier = Modifier.fillMaxWidth().clip(DotShapes.medium).border(DotSpacing.hairline * 2, c.border, DotShapes.medium).padding(DotSpacing.m),
            )
        }
    }
}

// --- Shared pieces ---------------------------------------------------------------------------

@Composable
private fun ReplyQuote(reply: ReplyRef, env: MessageEnv) {
    val author = if (reply.role == "user") stringResource(R.string.you) else stringResource(R.string.companion)
    DotQuote(author, reply.preview)
}

@Composable
private fun AttachedImage(file: Part.File, env: MessageEnv) {
    val url = remember(file.url) { env.resolveUrl(file.url) }
    val label = file.filename ?: stringResource(R.string.attached_image)
    AsyncImage(
        model = url,
        contentDescription = label,
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .widthIn(max = 260.dp).heightIn(min = 48.dp, max = 260.dp)
            .clip(DotShapes.medium)
            .border(DotSpacing.hairline * 2, Dot.colors.border, DotShapes.medium)
            .clickable(role = Role.Image) { env.onOpenImage(url) },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Reactions(messageId: String, reactions: List<Reaction>, env: MessageEnv) {
    if (reactions.isEmpty()) return
    val grouped = remember(reactions) { reactions.groupBy { it.emoji } }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(DotSpacing.s)) {
        grouped.forEach { (emoji, list) ->
            DotReactionChip(emoji, list.size, selected = list.any { it.actor == "user" }, onClick = { env.onReact(messageId, emoji) })
        }
    }
}

/** Long-press menu of a message: quick reactions, copy, reply. */
@Composable
private fun MessageMenu(expanded: Boolean, onDismiss: () -> Unit, text: String, messageId: String, role: String, env: MessageEnv, onShowWork: (() -> Unit)? = null) {
    DotMenu(expanded, onDismiss) {
        Row(Modifier.padding(horizontal = DotSpacing.s)) {
            QUICK_REACTIONS.forEach { emoji ->
                Box(
                    Modifier.size(44.dp).clip(DotShapes.circle).clickable(role = Role.Button) { env.onReact(messageId, emoji); onDismiss() }.semantics { contentDescription = emoji },
                    contentAlignment = Alignment.Center,
                ) { Text(emoji, fontSize = 20.sp) }
            }
        }
        if (text.isNotEmpty()) {
            DotMenuItem(stringResource(R.string.copy), Icons.Outlined.ContentCopy) { env.onCopy(text); onDismiss() }
            DotMenuItem(stringResource(R.string.reply), Icons.AutoMirrored.Outlined.Reply) { env.onReply(ReplyRef(messageId, text.take(180), role)); onDismiss() }
        }
        if (onShowWork != null) DotMenuItem(stringResource(R.string.show_work), Icons.Outlined.Checklist) { onShowWork(); onDismiss() }
    }
}

/** An event title fits one line: no JSON payload, no commit hash. */
fun shortEventTitle(title: String?): String? {
    if (title.isNullOrBlank()) return null
    val parts = title.split(" · ").filterNot { it.trimStart().startsWith("{") || it.trimStart().startsWith("[") || COMMIT.matches(it.trim()) }
    return (if (parts.isEmpty()) title else parts.joinToString(" · ")).take(140)
}

private val COMMIT = Regex("^commit [0-9a-f]{7,}.*", RegexOption.IGNORE_CASE)

/** What the companion is doing right now, in one sentence, for the live status line. */
@Composable
fun liveStepLabel(message: ChatMessage?): Pair<String, Int>? {
    if (message == null || message.isUser) return null
    val tools = remember(message.parts) { message.parts.filterIsInstance<Part.Tool>().filter { it.name != "text_user" } }
    val running = tools.lastOrNull { it.state.startsWith("input") }
    val last = message.parts.lastOrNull()
    val title = when {
        running != null -> toolLabel(running).title
        last is Part.Reasoning -> stringResource(R.string.state_thinking) + "…"
        last is Part.Tool && last.name != "text_user" -> toolLabel(last).title
        tools.isNotEmpty() -> stringResource(R.string.writing_reply)
        else -> return null
    }
    return title to tools.size
}
