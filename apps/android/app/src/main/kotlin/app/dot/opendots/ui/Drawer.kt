package app.dot.opendots.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotShapes
import app.dot.design.DotSpacing
import app.dot.design.components.Hairline
import app.dot.design.components.ListRow
import app.dot.design.components.SectionLabel
import app.dot.design.components.UnreadDot
import app.dot.opendots.AppUiState
import app.dot.opendots.R
import app.dot.opendots.data.Agent

private val MARKDOWN_NOISE = Regex("[*_`#>]+")

/**
 * The side drawer: who you can talk to, then where else you can go. A graphite `surface`, calm density; the only colour
 * is each companion's own dot.
 */
@Composable
fun DrawerContent(ui: AppUiState, onSelect: (Agent) -> Unit, onTasks: () -> Unit, onApprovals: () -> Unit, onSettings: () -> Unit) {
    val c = Dot.colors
    Column(
        Modifier.fillMaxHeight().widthIn(max = 320.dp).fillMaxWidth(0.86f).background(c.surface)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start)),
    ) {
        Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = DotSpacing.gutter), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.app_name), style = Dot.type.title, color = c.textPrimary, modifier = Modifier.weight(1f).semantics { heading() })
            if (!ui.connected) Text(stringResource(R.string.reconnecting), style = Dot.type.caption, color = c.textTertiary)
        }
        SectionLabel(stringResource(R.string.companions))
        LazyColumn(Modifier.weight(1f)) {
            items(ui.agents, key = { it.id }) { agent -> CompanionRow(agent, selected = agent.id == ui.currentAgent?.id) { onSelect(agent) } }
        }
        if (ui.paused) Text(stringResource(R.string.paused_long), style = Dot.type.caption, color = c.textTertiary, modifier = Modifier.padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.s))
        Hairline()
        Spacer(Modifier.height(DotSpacing.xs))
        ListRow(stringResource(R.string.tasks), icon = Icons.Outlined.CalendarMonth, onClick = onTasks)
        ListRow(
            stringResource(R.string.approvals), icon = Icons.Outlined.Shield, onClick = onApprovals,
            trailing = if (ui.pendingApprovals.isEmpty()) null else {
                { Text(ui.pendingApprovals.size.toString(), style = Dot.type.label, color = c.accent) }
            },
        )
        ListRow(stringResource(R.string.settings), icon = Icons.Outlined.Settings, onClick = onSettings, subtitle = ui.account?.email)
        Spacer(Modifier.height(DotSpacing.xs))
    }
}

@Composable
private fun CompanionRow(agent: Agent, selected: Boolean, onClick: () -> Unit) {
    val c = Dot.colors
    val preview = when {
        agent.busy -> agent.stateDetail ?: agentStateLabel(agent.state)
        agent.state == "error" -> agentStateLabel("error")
        else -> agent.lastMessagePreview?.replace(MARKDOWN_NOISE, "")?.replace(Regex("\\s+"), " ")?.trim()?.ifBlank { null } ?: agent.description.ifBlank { stringResource(R.string.say_hello) }
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = DotSpacing.s, vertical = 1.dp)
            .clip(DotShapes.medium)
            .background(if (selected) c.surfaceRaised else androidx.compose.ui.graphics.Color.Transparent)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { this.selected = selected }
            .heightIn(min = 60.dp).padding(horizontal = DotSpacing.m, vertical = DotSpacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompanionOrb(agent, size = 40.dp)
        Spacer(Modifier.width(DotSpacing.m))
        Column(Modifier.weight(1f)) {
            Text(agentDisplayName(agent), style = if (agent.unread > 0) Dot.type.headline else Dot.type.bodyStrong, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(preview, style = Dot.type.caption, color = if (agent.state == "error") c.danger else c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (agent.unread > 0) Box(Modifier.padding(start = DotSpacing.s)) { UnreadDot() }
    }
}
