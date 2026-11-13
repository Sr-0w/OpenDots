package app.dot.opendots.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotSpacing
import app.dot.design.components.ButtonStyle
import app.dot.design.components.DotButton
import app.dot.design.components.DotCard
import app.dot.design.components.DotCheckbox
import app.dot.design.components.DotDisclosure
import app.dot.design.components.DotFilterChip
import app.dot.design.components.DotPrimaryButton
import app.dot.design.components.DotTextField
import app.dot.design.components.Hairline
import app.dot.design.rememberDotHaptics
import app.dot.opendots.R
import app.dot.opendots.data.Approval
import app.dot.opendots.data.AskQuestion
import app.dot.opendots.data.ChatMessage
import app.dot.opendots.data.OdJson
import app.dot.opendots.data.Part
import app.dot.opendots.data.arr
import app.dot.opendots.data.asObject
import app.dot.opendots.data.orEmpty
import app.dot.opendots.data.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement

/** The card for a tool result the user must act on. */
@Composable
fun ActionCard(part: Part.Tool, message: ChatMessage, env: MessageEnv) {
    val out = part.outputObject ?: return
    val input = part.input.asObject()
    when {
        part.name == "team_send_message" -> {
            val to = out.str("to") ?: input?.str("to").orEmpty()
            InfoCard(Icons.AutoMirrored.Outlined.Chat, stringResource(R.string.message_sent_to, to), input?.str("message"))
        }
        part.name == "ask_user" && out.str("requestId") != null -> {
            val questions = remember(part.input) {
                input?.arr("questions").orEmpty().mapNotNull { q -> runCatching { OdJson.decodeFromJsonElement<AskQuestion>(q) }.getOrNull() }
            }
            AskUserCard(out.str("requestId")!!, input?.str("title").orEmpty(), questions, env)
        }
        part.name == "mail_prepare" && out.str("draftId") != null -> MailDraftCard(out.str("draftId")!!, out.str("approvalId"), env)
        part.name == "connection_request_setup" || part.name == "computer_request_setup" ->
            WebOnlyCard(if (part.name == "computer_request_setup") stringResource(R.string.computer_setup_title) else stringResource(R.string.connection_title), out.str("reason"), env)
        out.str("approvalId") != null -> ApprovalCard(out.str("approvalId")!!, out.str("summary"), env)
    }
}

@Composable
private fun CardHeader(icon: ImageVector, title: String, status: String?, statusColor: Color = Dot.colors.textSecondary, overline: String? = null) {
    Row(verticalAlignment = Alignment.Top) {
        Icon(icon, null, Modifier.padding(top = 2.dp).size(18.dp), tint = Dot.colors.textSecondary)
        Spacer(Modifier.width(DotSpacing.m))
        Column(Modifier.weight(1f)) {
            if (overline != null) Text(overline, style = Dot.type.caption, color = Dot.colors.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(title, style = Dot.type.bodyStrong, color = Dot.colors.textPrimary)
            if (status != null) Text(status, style = Dot.type.caption, color = statusColor)
        }
    }
}

@Composable
private fun InfoCard(icon: ImageVector, title: String, body: String?) {
    DotCard(Modifier.fillMaxWidth()) {
        CardHeader(icon, title, null)
        if (!body.isNullOrBlank()) {
            Spacer(Modifier.height(DotSpacing.s))
            Text(body.trim(), style = Dot.type.callout, color = Dot.colors.textSecondary, maxLines = 4, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun approvalStatusLabel(status: String): String = stringResource(
    when (status) {
        "approved" -> R.string.approval_approved
        "executed" -> R.string.approval_executed
        "failed" -> R.string.approval_failed
        "rejected" -> R.string.approval_rejected
        "expired" -> R.string.approval_expired
        else -> R.string.approval_pending
    },
)

/**
 * A sensitive action waiting for the user: stated plainly, then two unambiguous buttons. Nothing is triggered by a
 * swipe or an animation; the buttons lock while the decision travels to the server.
 */
@Composable
fun ApprovalCard(approvalId: String, fallbackSummary: String?, env: MessageEnv, modifier: Modifier = Modifier, approval: Approval? = env.approvals[approvalId], approveLabel: String = stringResource(R.string.approve), rejectLabel: String = stringResource(R.string.reject)) {
    val status = approval?.status ?: "pending"
    DotCard(modifier.fillMaxWidth(), emphasized = status == "pending") {
        val summary = remember(approval?.summary, fallbackSummary) { splitApprovalSummary(approval?.summary?.ifBlank { null } ?: fallbackSummary.orEmpty()) }
        CardHeader(
            Icons.Outlined.Shield,
            summary.title.ifBlank { stringResource(R.string.approval_title) },
            approvalStatusLabel(status),
            if (status == "failed") Dot.colors.danger else if (status == "executed") Dot.colors.success else Dot.colors.textSecondary,
            overline = summary.context,
        )
        if (summary.details.isNotEmpty() || summary.extra.isNotEmpty()) {
            var open by remember(approvalId) { mutableStateOf(false) }
            DotDisclosure(stringResource(R.string.details), open, { open = !open }, Modifier.padding(start = 30.dp)) {
                summary.details.forEach { (key, value) ->
                    Column {
                        Text(key, style = Dot.type.caption, color = Dot.colors.textTertiary)
                        Text(value.take(400), style = Dot.type.caption.copy(fontFamily = FontFamily.Monospace), color = Dot.colors.textPrimary)
                    }
                }
                summary.extra.forEach { Text(it, style = Dot.type.caption, color = Dot.colors.textSecondary) }
            }
        }
        approval?.error?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(DotSpacing.s))
            Text(it, style = Dot.type.caption, color = Dot.colors.danger)
        }
        if (status == "pending") DecisionButtons(approvalId, env, approveLabel, rejectLabel)
    }
}

@Composable
private fun DecisionButtons(approvalId: String, env: MessageEnv, approveLabel: String, rejectLabel: String) {
    var sent by remember(approvalId) { mutableStateOf<Boolean?>(null) }
    val haptics = rememberDotHaptics()
    Spacer(Modifier.height(DotSpacing.m))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
        DotButton(rejectLabel, { sent = false; haptics.reject(); env.onDecide(approvalId, false) }, style = ButtonStyle.Secondary, enabled = sent == null, loading = sent == false, compact = true)
        Spacer(Modifier.width(DotSpacing.s))
        DotPrimaryButton(approveLabel, { sent = true; haptics.confirm(); env.onDecide(approvalId, true) }, enabled = sent == null, loading = sent == true, compact = true)
    }
    // If the decision failed to reach the server the approval is still pending: let the user try again.
    LaunchedEffect(sent) { if (sent != null) { kotlinx.coroutines.delay(8000); sent = null } }
}

/** "Ready to send": the draft as it will go out, then Send / Discard through its approval. */
@Composable
private fun MailDraftCard(draftId: String, approvalId: String?, env: MessageEnv) {
    LaunchedEffect(draftId) { env.onNeedDraft(draftId) }
    val draft = env.drafts[draftId]
    val approval = approvalId?.let { env.approvals[it] }
    val status = draft?.status ?: "pending"
    DotCard(Modifier.fillMaxWidth(), emphasized = status == "pending") {
        CardHeader(
            Icons.Outlined.MailOutline,
            stringResource(if (status == "sent") R.string.mail_sent else R.string.mail_ready),
            when (status) { "discarded" -> stringResource(R.string.mail_discarded); "failed" -> draft?.error ?: stringResource(R.string.approval_failed); else -> null },
            if (status == "failed") Dot.colors.danger else Dot.colors.textSecondary,
        )
        if (draft != null) {
            Spacer(Modifier.height(DotSpacing.m))
            Text(stringResource(R.string.mail_to, draft.to.joinToString(", ")), style = Dot.type.caption, color = Dot.colors.textSecondary)
            if (draft.cc.isNotEmpty()) Text(stringResource(R.string.mail_cc, draft.cc.joinToString(", ")), style = Dot.type.caption, color = Dot.colors.textSecondary)
            Spacer(Modifier.height(DotSpacing.xs))
            Text(draft.subject, style = Dot.type.headline, color = Dot.colors.textPrimary)
            Spacer(Modifier.height(DotSpacing.s))
            Hairline()
            Spacer(Modifier.height(DotSpacing.s))
            Text(draft.body.trim(), style = Dot.type.callout, color = Dot.colors.textPrimary, maxLines = 12, overflow = TextOverflow.Ellipsis)
        }
        if (status == "pending" && approvalId != null && (approval == null || approval.status == "pending")) {
            DecisionButtons(approvalId, env, stringResource(R.string.send), stringResource(R.string.discard))
        }
    }
}

/** Things that need the full web app (OAuth, passwords in a secure dialog, the desktop viewer). */
@Composable
private fun WebOnlyCard(title: String, reason: String?, env: MessageEnv) {
    DotCard(Modifier.fillMaxWidth()) {
        CardHeader(Icons.Outlined.Extension, title, stringResource(R.string.web_only))
        if (!reason.isNullOrBlank()) {
            Spacer(Modifier.height(DotSpacing.s))
            Text(reason, style = Dot.type.callout, color = Dot.colors.textSecondary)
        }
        Spacer(Modifier.height(DotSpacing.m))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            DotButton(stringResource(R.string.open_web_app), env.onOpenWeb, style = ButtonStyle.Secondary, icon = Icons.AutoMirrored.Outlined.OpenInNew, compact = true)
        }
    }
}

@Composable
fun SetupHint(env: MessageEnv) {
    WebOnlyCard(stringResource(R.string.setup_title), stringResource(R.string.setup_body), env)
}

// --- Forms (ask_user) --------------------------------------------------------------------------

private const val OTHER = "__other"

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AskUserCard(requestId: String, title: String, questions: List<AskQuestion>, env: MessageEnv) {
    LaunchedEffect(requestId) { env.onNeedRequest(requestId) }
    val request = env.requests[requestId]
    val status = request?.status ?: "pending"
    val pending = status == "pending"
    val values = remember(requestId) { mutableStateMapOf<String, Any>() }
    val other = remember(requestId) { mutableStateMapOf<String, String>() }

    fun finalAnswers(): Map<String, Any> {
        val out = HashMap<String, Any>(values)
        for (q in questions) {
            val extra = other[q.id]?.trim().orEmpty()
            if (q.allowOther && extra.isNotEmpty()) {
                if (q.type == "multi_choice") out[q.id] = (out[q.id] as? List<*>).orEmpty().filterIsInstance<String>() + extra
                else if (q.type == "single_choice" && (out[q.id] == null || out[q.id] == OTHER)) out[q.id] = extra
            }
            if (out[q.id] == OTHER) out[q.id] = ""
            if (q.type == "confirm" && out[q.id] == null) out[q.id] = false
        }
        return out
    }
    val answers = finalAnswers()
    val missing = questions.any { q ->
        val v = answers[q.id]
        q.required && q.type != "confirm" && (v == null || v == "" || (v is List<*> && v.isEmpty()))
    }
    val yes = stringResource(R.string.yes)
    val no = stringResource(R.string.no)
    val none = stringResource(R.string.no_answer)

    DotCard(Modifier.fillMaxWidth(), emphasized = pending) {
        CardHeader(
            Icons.Outlined.QuestionAnswer, title.ifBlank { stringResource(R.string.form_title) },
            stringResource(when (status) { "answered" -> R.string.answers_sent; "cancelled" -> R.string.form_replaced; else -> R.string.form_waiting }),
        )
        questions.forEach { q ->
            Spacer(Modifier.height(DotSpacing.l))
            Text(q.label + if (q.required && q.type != "confirm") " *" else "", style = Dot.type.label, color = Dot.colors.textPrimary)
            Spacer(Modifier.height(DotSpacing.s))
            if (!pending) {
                val shown = request?.answers?.get(q.id)?.let(::readable)?.replace("true", yes)?.replace("false", no)
                Text(shown?.ifBlank { null } ?: none, style = Dot.type.callout, color = Dot.colors.textSecondary)
            } else when (q.type) {
                "single_choice" -> FlowRow(horizontalArrangement = Arrangement.spacedBy(DotSpacing.s)) {
                    q.options.orEmpty().forEach { option ->
                        DotFilterChip(option, selected = values[q.id] == option, onClick = { values[q.id] = option; other.remove(q.id) }, radio = true)
                    }
                }
                "multi_choice" -> FlowRow(horizontalArrangement = Arrangement.spacedBy(DotSpacing.s)) {
                    val picked = (values[q.id] as? List<*>).orEmpty().filterIsInstance<String>()
                    q.options.orEmpty().forEach { option ->
                        DotFilterChip(option, selected = option in picked, onClick = { values[q.id] = if (option in picked) picked - option else picked + option })
                    }
                }
                "confirm" -> {
                    val checked = values[q.id] == true
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(checked, role = Role.Checkbox) { values[q.id] = it },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        DotCheckbox(checked)
                        Spacer(Modifier.width(DotSpacing.m))
                        Text(if (checked) yes else no, style = Dot.type.callout, color = Dot.colors.textSecondary)
                    }
                }
                else -> DotTextField(
                    value = values[q.id] as? String ?: "",
                    onValueChange = { values[q.id] = it },
                    placeholder = q.placeholder ?: if (q.type == "date") "YYYY-MM-DD" else null,
                    singleLine = q.type != "textarea",
                    keyboardType = if (q.type == "number") KeyboardType.Decimal else KeyboardType.Text,
                    imeAction = if (q.type == "textarea") ImeAction.Default else ImeAction.Done,
                )
            }
            if (pending && q.allowOther && (q.type == "single_choice" || q.type == "multi_choice")) {
                Spacer(Modifier.height(DotSpacing.s))
                DotTextField(
                    value = other[q.id].orEmpty(),
                    onValueChange = { other[q.id] = it; if (q.type == "single_choice") values[q.id] = OTHER },
                    placeholder = stringResource(R.string.other),
                    imeAction = ImeAction.Done,
                )
            }
        }
        if (pending) {
            Spacer(Modifier.height(DotSpacing.l))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                DotPrimaryButton(
                    stringResource(R.string.send),
                    onClick = {
                        val final = finalAnswers()
                        val summary = buildString {
                            append(title)
                            questions.forEach { q ->
                                val v = final[q.id]
                                val shown = when (v) { is List<*> -> v.joinToString(", "); is Boolean -> if (v) yes else no; else -> v?.toString().orEmpty() }
                                append("\n- ").append(q.label).append(" : ").append(shown.ifBlank { none })
                            }
                        }
                        env.onAnswer(requestId, buildJsonObject { final.forEach { (k, v) -> put(k, toJson(v)) } }, summary)
                    },
                    enabled = !missing && !env.busy,
                    compact = true,
                )
            }
        }
    }
}

private fun toJson(value: Any): JsonElement = when (value) {
    is Boolean -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is List<*> -> JsonArray(value.map { JsonPrimitive(it.toString()) })
    else -> JsonPrimitive(value.toString())
}

private fun readable(value: JsonElement): String = when (value) {
    is JsonArray -> value.joinToString(", ") { readable(it) }
    is JsonPrimitive -> value.content
    is JsonObject -> value.toString()
}


class ApprovalSummary(val context: String?, val title: String, val details: List<Pair<String, String>>, val extra: List<String>)

private val COMMIT_PART = Regex("^commit ([0-9a-f]{7,})$", RegexOption.IGNORE_CASE)

/**
 * An approval summary arrives as one line ("Service — account · action · commit … · {json}"). Split it the same way as
 * the web app: the context, the action as the title, and the payload as details behind a disclosure.
 */
fun splitApprovalSummary(summary: String): ApprovalSummary {
    val details = ArrayList<Pair<String, String>>()
    val extra = ArrayList<String>()
    val text = ArrayList<String>()
    for (part in summary.split(" · ").map { it.trim() }.filter { it.isNotEmpty() }) {
        val commit = COMMIT_PART.matchEntire(part)
        when {
            part.startsWith("{") || part.startsWith("[") -> {
                val parsed = runCatching { OdJson.parseToJsonElement(part) }.getOrNull() as? JsonObject
                if (parsed == null) extra += part else parsed.forEach { (key, value) -> details += key to ((value as? JsonPrimitive)?.content ?: value.toString()) }
            }
            commit != null -> details += "commit" to commit.groupValues[1].take(12)
            else -> text += part
        }
    }
    if (text.isEmpty()) return ApprovalSummary(null, summary, emptyList(), emptyList())
    val context = text.first().takeIf { text.size > 1 && it.length <= 80 }
    val rest = if (context != null) text.drop(1) else text
    return ApprovalSummary(context, rest.first(), details, rest.drop(1) + extra)
}
