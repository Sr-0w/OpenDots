package app.dot.opendots.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotSpacing
import app.dot.design.components.BackButton
import app.dot.design.components.ButtonStyle
import app.dot.design.components.DotButton
import app.dot.design.components.DotDialog
import app.dot.design.components.DotFilterChip
import app.dot.design.components.DotIconButton
import app.dot.design.components.DotMenu
import app.dot.design.components.DotMenuItem
import app.dot.design.components.DotSpinner
import app.dot.design.components.DotSwitch
import app.dot.design.components.DotTopBar
import app.dot.design.components.EmptyState
import app.dot.design.components.FrostedHeaderLayout
import app.dot.design.components.Hairline
import app.dot.design.components.ListRow
import app.dot.design.components.SectionLabel
import app.dot.design.components.backdropSource
import app.dot.design.components.rememberQuietBackdrop
import app.dot.design.rememberDotHaptics
import app.dot.opendots.AppState
import app.dot.opendots.AppUiState
import app.dot.opendots.BuildInfo
import app.dot.opendots.R
import app.dot.opendots.data.Activity

/** A secondary screen: content scrolling under the same frosted header as the conversation, with a Back capsule. */
@Composable
fun QuietPage(title: String, onBack: () -> Unit, content: LazyListScope.() -> Unit) {
    val backdrop = rememberQuietBackdrop()
    Box(Modifier.fillMaxSize().background(Dot.colors.background)) {
        FrostedHeaderLayout(backdrop, header = { DotTopBar(title = title, navigation = { Box(Modifier.padding(start = DotSpacing.s)) { BackButton(onBack) } }) }) { padding ->
            LazyColumn(
                Modifier.fillMaxSize().backdropSource(backdrop),
                contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + DotSpacing.xxl),
                content = content,
            )
        }
    }
}

// --- Scheduled tasks ---------------------------------------------------------------------------

@Composable
fun TasksScreen(app: AppState, ui: AppUiState, onBack: () -> Unit) {
    LaunchedEffect(Unit) { app.loadActivities() }
    val started = stringResource(R.string.task_started)
    var deleting by remember { mutableStateOf<Activity?>(null) }
    val activities = ui.activities
    QuietPage(stringResource(R.string.tasks), onBack) {
        when {
            activities == null -> item { Box(Modifier.fillMaxWidth().padding(DotSpacing.xxxl), contentAlignment = Alignment.Center) { DotSpinner(size = 24.dp) } }
            activities.isEmpty() -> item { EmptyState(Icons.Outlined.CalendarMonth, stringResource(R.string.tasks_empty_title), stringResource(R.string.tasks_empty_body)) }
            else -> ui.agents.forEach { agent ->
                val mine = activities.filter { it.agentId == agent.id }
                if (mine.isEmpty()) return@forEach
                item(key = "h-${agent.id}") {
                    Row(Modifier.padding(start = DotSpacing.gutter, top = DotSpacing.l), verticalAlignment = Alignment.CenterVertically) {
                        CompanionOrb(agent, size = 18.dp)
                        SectionLabel(agentDisplayName(agent), Modifier.padding(start = 0.dp).width(240.dp))
                    }
                }
                items(mine, key = { it.id }) { activity ->
                    TaskRow(activity, onToggle = { app.setActivityEnabled(activity.id, it) }, onRun = { app.runActivity(activity.id) { app.notify(started) } }, onDelete = { deleting = activity })
                    Hairline(inset = DotSpacing.gutter)
                }
            }
        }
    }
    deleting?.let { activity ->
        DotDialog(
            title = stringResource(R.string.task_delete_title),
            message = activity.title,
            confirmLabel = stringResource(R.string.delete), dismissLabel = stringResource(R.string.cancel),
            onConfirm = { app.deleteActivity(activity.id); deleting = null }, onDismiss = { deleting = null }, destructive = true,
        )
    }
}

@Composable
private fun TaskRow(activity: Activity, onToggle: (Boolean) -> Unit, onRun: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val haptics = rememberDotHaptics()
    Row(Modifier.fillMaxWidth().padding(start = DotSpacing.gutter, end = DotSpacing.s, top = DotSpacing.m, bottom = DotSpacing.m), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(activity.title, style = Dot.type.bodyStrong, color = if (activity.enabled) Dot.colors.textPrimary else Dot.colors.textTertiary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(activitySummary(activity), style = Dot.type.caption, color = Dot.colors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (activity.lastStatus == "error") Text(stringResource(R.string.task_last_failed), style = Dot.type.caption, color = Dot.colors.danger)
        }
        Spacer(Modifier.width(DotSpacing.m))
        DotSwitch(activity.enabled, { haptics.toggle(it); onToggle(it) })
        Box {
            DotIconButton(Icons.Outlined.MoreVert, stringResource(R.string.more), onClick = { menu = true }, tint = Dot.colors.textSecondary)
            DotMenu(menu, { menu = false }) {
                DotMenuItem(stringResource(R.string.task_run_now), Icons.Outlined.PlayArrow) { menu = false; onRun() }
                DotMenuItem(stringResource(R.string.delete), Icons.Outlined.DeleteOutline, color = Dot.colors.danger) { menu = false; onDelete() }
            }
        }
    }
}

// --- Approvals ------------------------------------------------------------------------------------

@Composable
fun ApprovalsScreen(app: AppState, ui: AppUiState, onBack: () -> Unit) {
    val env = remember(ui.approvals, ui.agents) {
        MessageEnv(ui.agents, ui.approvals, emptyMap(), emptyMap(), false, { it }, {}, {}, { _, _ -> }, { id, approve -> app.decide(id, approve) }, { _, _, _ -> }, {}, {}, {}, {})
    }
    val pending = ui.pendingApprovals
    val recent = remember(ui.approvals) { ui.approvals.values.filter { it.status != "pending" }.sortedByDescending { it.createdAt }.take(20) }
    QuietPage(stringResource(R.string.approvals), onBack) {
        if (pending.isEmpty() && recent.isEmpty()) item { EmptyState(Icons.Outlined.Shield, stringResource(R.string.approvals_empty_title), stringResource(R.string.approvals_empty_body)) }
        if (pending.isNotEmpty()) item { SectionLabel(stringResource(R.string.approvals_waiting)) }
        items(pending, key = { it.id }) { approval ->
            Column(Modifier.padding(horizontal = DotSpacing.l, vertical = DotSpacing.xs)) {
                val agent = ui.agents.firstOrNull { it.id == approval.agentId }
                Text(listOfNotNull(agent?.let { agentDisplayName(it) }, formatWhen(approval.createdAt).ifBlank { null }).joinToString(" · "), style = Dot.type.caption, color = Dot.colors.textTertiary, modifier = Modifier.padding(start = DotSpacing.xs, bottom = DotSpacing.xs))
                ApprovalCard(approval.id, null, env, approval = approval)
            }
        }
        if (recent.isNotEmpty()) item { SectionLabel(stringResource(R.string.approvals_recent), Modifier.padding(top = DotSpacing.l)) }
        items(recent, key = { it.id }) { approval ->
            ListRow(approval.summary.ifBlank { approval.action }, subtitle = approvalStatusLabel(approval.status) + formatWhen(approval.createdAt).let { if (it.isBlank()) "" else " · $it" },
                subtitleColor = if (approval.status == "failed") Dot.colors.danger else Dot.colors.textSecondary)
            Hairline(inset = DotSpacing.gutter)
        }
    }
}

// --- Settings ---------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(app: AppState, ui: AppUiState, onBack: () -> Unit, onOpenCatalog: () -> Unit, onOpenWeb: () -> Unit) {
    var confirmSignOut by remember { mutableStateOf(false) }
    QuietPage(stringResource(R.string.settings), onBack) {
        item {
            SectionLabel(stringResource(R.string.appearance))
            FlowRow(Modifier.padding(horizontal = DotSpacing.gutter), horizontalArrangement = Arrangement.spacedBy(DotSpacing.s)) {
                listOf("SYSTEM" to R.string.theme_system, "LIGHT" to R.string.theme_light, "DARK" to R.string.theme_dark, "OLED" to R.string.theme_oled).forEach { (mode, label) ->
                    DotFilterChip(stringResource(label), selected = ui.themeMode == mode, onClick = { app.setThemeMode(mode) }, radio = true)
                }
            }
            Text(stringResource(R.string.theme_oled_note), style = Dot.type.caption, color = Dot.colors.textTertiary, modifier = Modifier.padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.s))
            SwitchRow(stringResource(R.string.reduce_transparency), stringResource(R.string.reduce_transparency_note), ui.reduceTransparency, onChange = app::setReduceTransparency)
            Hairline(Modifier.padding(top = DotSpacing.s))
        }
        item {
            SectionLabel(stringResource(R.string.engine), Modifier.padding(top = DotSpacing.l))
            SwitchRow(stringResource(R.string.pause_autonomous), stringResource(R.string.pause_autonomous_note), ui.paused, onChange = app::setPaused)
            ListRow(stringResource(R.string.server), subtitle = ui.serverUrl, onClick = onOpenWeb)
            ListRow(stringResource(R.string.open_web_app), subtitle = stringResource(R.string.open_web_app_note), onClick = onOpenWeb)
            Hairline(Modifier.padding(top = DotSpacing.s))
        }
        item {
            SectionLabel(stringResource(R.string.account), Modifier.padding(top = DotSpacing.l))
            ListRow(ui.account?.email.orEmpty(), subtitle = stringResource(R.string.signed_in))
            Box(Modifier.padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.s)) {
                DotButton(stringResource(R.string.sign_out), { confirmSignOut = true }, style = ButtonStyle.Danger)
            }
            Hairline(Modifier.padding(top = DotSpacing.s))
        }
        item {
            SectionLabel(stringResource(R.string.about), Modifier.padding(top = DotSpacing.l))
            ListRow(stringResource(R.string.quiet_catalog), subtitle = stringResource(R.string.quiet_catalog_note), onClick = onOpenCatalog)
            ListRow(stringResource(R.string.version), subtitle = BuildInfo.VERSION)
            Spacer(Modifier.height(DotSpacing.l))
        }
    }
    if (confirmSignOut) DotDialog(
        title = stringResource(R.string.sign_out_title), message = stringResource(R.string.sign_out_body),
        confirmLabel = stringResource(R.string.sign_out), dismissLabel = stringResource(R.string.cancel),
        onConfirm = { confirmSignOut = false; app.signOut() }, onDismiss = { confirmSignOut = false }, destructive = true,
    )
}
