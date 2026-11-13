package app.dot.opendots.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.ManageAccounts
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.Webhook
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.dot.opendots.R
import app.dot.opendots.data.Activity
import app.dot.opendots.data.Agent
import app.dot.opendots.data.Part
import app.dot.opendots.data.asObject
import app.dot.opendots.data.str
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private val TIME = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
private val DATE_TIME = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)

/** "14:32" today, "12 Nov 2026, 14:32" otherwise; empty when [iso] is missing or malformed. */
fun formatWhen(iso: String?): String {
    val instant = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    val local = instant.atZone(ZoneId.systemDefault())
    return if (local.toLocalDate() == LocalDate.now()) TIME.format(local) else DATE_TIME.format(local)
}

fun hostOf(url: String?): String = runCatching { java.net.URI(url.orEmpty()).host.orEmpty().removePrefix("www.") }.getOrDefault("")

@Composable
fun agentDisplayName(agent: Agent?): String = if (agent != null && agent.named) agent.name else stringResource(R.string.new_companion)

@Composable
fun agentStateLabel(state: String): String = stringResource(
    when (state) {
        "sleeping" -> R.string.state_sleeping
        "awake" -> R.string.state_awake
        "thinking" -> R.string.state_thinking
        "working" -> R.string.state_working
        "collaborating" -> R.string.state_collaborating
        "waiting" -> R.string.state_waiting
        "done" -> R.string.state_done
        "error" -> R.string.state_error
        else -> R.string.state_available
    },
)

class ToolLabel(val title: String, val icon: ImageVector, val monospace: Boolean = false)

/** A readable sentence for a tool call, so nobody has to parse tool names (same wording as the web app). */
@Composable
fun toolLabel(part: Part.Tool): ToolLabel {
    val input = part.input.asObject()
    val output = part.outputObject
    fun arg(key: String) = input?.str(key)?.takeIf { it.isNotBlank() }
    @Composable fun s(id: Int) = stringResource(id)
    @Composable fun s(id: Int, value: String) = stringResource(id, value)
    return when (part.name) {
        "agent_get_profile" -> ToolLabel(s(R.string.tool_profile_read), Icons.Outlined.ManageAccounts)
        "agent_update_profile" -> ToolLabel(arg("name")?.let { s(R.string.tool_takes_name, it) } ?: s(R.string.tool_profile_update), Icons.Outlined.AutoAwesome)
        "agent_update_instructions" -> ToolLabel(s(R.string.tool_instructions), Icons.Outlined.ManageAccounts)
        "agent_configure_model" -> ToolLabel(arg("model")?.let { s(R.string.tool_model, it) } ?: s(R.string.tool_model_change), Icons.Outlined.Psychology)
        "agent_update_permissions" -> ToolLabel(s(R.string.tool_permissions), Icons.Outlined.Key)
        "agent_list" -> ToolLabel(s(R.string.tool_team_read), Icons.Outlined.SmartToy)
        "agent_create" -> ToolLabel(arg("name")?.let { s(R.string.tool_creates, it) } ?: s(R.string.tool_creates_companion), Icons.Outlined.SmartToy)
        "team_send_message" -> ToolLabel(arg("to")?.let { s(R.string.tool_writes_to, it) } ?: s(R.string.tool_contacts), Icons.AutoMirrored.Outlined.Chat)
        "memory_remember" -> ToolLabel(s(R.string.tool_remember), Icons.Outlined.Psychology)
        "memory_update" -> ToolLabel(s(R.string.tool_memory_update), Icons.Outlined.Psychology)
        "memory_forget" -> ToolLabel(s(R.string.tool_forget), Icons.Outlined.Psychology)
        "memory_search" -> ToolLabel(s(R.string.tool_memory_search), Icons.Outlined.Psychology)
        "activity_create" -> {
            val kind = arg("kind")
            val icon = when (kind) { "watch" -> Icons.Outlined.Visibility; "webhook" -> Icons.Outlined.Webhook; else -> Icons.Outlined.CalendarMonth }
            ToolLabel(arg("title")?.let { s(if (kind == "watch") R.string.tool_watch else R.string.tool_schedule, it) } ?: s(R.string.tool_activity_create), icon)
        }
        "activity_list" -> ToolLabel(s(R.string.tool_activity_list), Icons.Outlined.CalendarMonth)
        "activity_update" -> ToolLabel(s(R.string.tool_activity_update), Icons.Outlined.CalendarMonth)
        "activity_delete" -> ToolLabel(s(R.string.tool_activity_delete), Icons.Outlined.CalendarMonth)
        "web_search" -> ToolLabel(arg("query")?.let { s(R.string.tool_search, it.take(50)) } ?: s(R.string.tool_search_web), Icons.Outlined.Search)
        "web_fetch" -> ToolLabel(s(R.string.tool_reads, output?.str("title")?.take(40) ?: hostOf(arg("url")).ifBlank { s(R.string.tool_a_page) }), Icons.Outlined.Language)
        "datetime" -> ToolLabel(s(R.string.tool_datetime), Icons.Outlined.Schedule)
        "computer_screenshot" -> ToolLabel(s(R.string.tool_screenshot), Icons.Outlined.Visibility)
        "computer_request_setup" -> ToolLabel(s(R.string.tool_computer_setup), Icons.Outlined.Terminal)
        "computer_action" -> ToolLabel(s(R.string.tool_computer_action), Icons.Outlined.Terminal)
        "shell_exec" -> ToolLabel("$ " + arg("command").orEmpty().lineSequence().firstOrNull().orEmpty().take(60), Icons.Outlined.Terminal, monospace = true)
        "ask_user" -> ToolLabel(s(R.string.tool_asks), Icons.Outlined.QuestionAnswer)
        "connection_request_setup" -> ToolLabel(s(R.string.tool_connection), Icons.Outlined.Extension)
        "skill_use" -> ToolLabel(s(R.string.tool_skill_use, arg("name").orEmpty()), Icons.Outlined.AutoAwesome)
        "skill_save" -> ToolLabel(s(R.string.tool_skill_save, arg("name").orEmpty()), Icons.Outlined.AutoAwesome)
        "mail_list_accounts" -> ToolLabel(s(R.string.tool_mail_accounts), Icons.Outlined.MailOutline)
        "mail_search" -> ToolLabel(arg("from")?.let { s(R.string.tool_mail_search_from, it) } ?: s(R.string.tool_mail_search), Icons.Outlined.MailOutline)
        "mail_read" -> ToolLabel(output?.str("subject")?.let { s(R.string.tool_reads, it.take(40)) } ?: s(R.string.tool_mail_read), Icons.Outlined.MailOutline)
        "mail_prepare" -> ToolLabel(s(R.string.tool_mail_prepare), Icons.Outlined.MailOutline)
        "approval_respond" -> ToolLabel(s(if (arg("decision") == "reject") R.string.tool_relays_refusal else R.string.tool_relays_approval), Icons.Outlined.Key)
        else -> if (part.name.startsWith("mcp_")) ToolLabel(part.name.removePrefix("mcp_").replace('_', ' '), Icons.Outlined.Extension)
        else ToolLabel(part.name.replace('_', ' '), Icons.Outlined.Build)
    }
}

fun eventIcon(type: String?): ImageVector = when (type) {
    "schedule" -> Icons.Outlined.CalendarMonth
    "watch" -> Icons.Outlined.Visibility
    "webhook" -> Icons.Outlined.Webhook
    "mail" -> Icons.Outlined.MailOutline
    "agent_reply", "agent_message" -> Icons.AutoMirrored.Outlined.Chat
    "approval" -> Icons.Outlined.Key
    else -> Icons.Outlined.Notifications
}

/** When a scheduled task runs, in a few words. */
@Composable
fun activitySummary(activity: Activity): String {
    val base = when (activity.kind) {
        "watch" -> stringResource(R.string.task_watch, hostOf(activity.watch?.url).ifBlank { activity.watch?.url.orEmpty() })
        "webhook" -> stringResource(R.string.task_webhook)
        "mail" -> stringResource(R.string.task_mail)
        else -> when (activity.schedule?.type) {
            "once" -> stringResource(R.string.task_once, formatWhen(activity.schedule.at))
            "interval" -> { val m = (activity.schedule.minutes ?: 0.0).toInt(); pluralStringResource(R.plurals.task_interval, m, m) }
            "cron" -> stringResource(R.string.task_cron, activity.schedule.expr.orEmpty())
            else -> stringResource(R.string.task_schedule)
        }
    }
    val next = formatWhen(activity.nextRunAt).takeIf { it.isNotEmpty() && activity.enabled && activity.schedule?.type != "once" }
    return if (next != null) base + " · " + stringResource(R.string.task_next, next) else base
}
