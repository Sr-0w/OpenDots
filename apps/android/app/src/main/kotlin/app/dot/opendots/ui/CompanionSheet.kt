package app.dot.opendots.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotSpacing
import app.dot.design.components.DotBottomSheet
import app.dot.design.components.DotPrimaryButton
import app.dot.design.components.DotSwitch
import app.dot.design.components.DotTextField
import app.dot.design.components.Hairline
import app.dot.design.components.SectionLabel
import app.dot.design.rememberDotHaptics
import app.dot.opendots.R
import app.dot.opendots.data.Agent
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/** Who this companion is and what it may do. Identity normally changes by talking to it; this is the direct route. */
@Composable
fun CompanionSheet(agent: Agent, onDismiss: () -> Unit, onUpdate: (JsonObject) -> Unit) {
    val c = Dot.colors
    var name by rememberSaveable(agent.id, agent.name) { mutableStateOf(if (agent.named) agent.name else "") }
    DotBottomSheet(onDismiss) {
        Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = DotSpacing.l)) {
            Row(Modifier.padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.s), verticalAlignment = Alignment.CenterVertically) {
                CompanionOrb(agent, size = 56.dp)
                Spacer(Modifier.width(DotSpacing.l))
                Column(Modifier.weight(1f)) {
                    Text(agentDisplayName(agent), style = Dot.type.title, color = c.textPrimary, modifier = Modifier.semantics { heading() })
                    Text(agent.stateDetail?.takeIf { agent.busy } ?: agentStateLabel(agent.state), style = Dot.type.caption, color = if (agent.state == "error") c.danger else c.textSecondary)
                }
            }
            if (agent.description.isNotBlank()) Text(agent.description, style = Dot.type.callout, color = c.textSecondary, modifier = Modifier.padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.s))

            Row(Modifier.padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.m), verticalAlignment = Alignment.Bottom) {
                DotTextField(name, { name = it.take(40) }, Modifier.weight(1f), label = stringResource(R.string.name), imeAction = ImeAction.Done)
                Spacer(Modifier.width(DotSpacing.m))
                DotPrimaryButton(stringResource(R.string.save), { onUpdate(buildJsonObject { put("name", name.trim()) }) }, enabled = name.isNotBlank() && name.trim() != agent.name)
            }

            SectionLabel(stringResource(R.string.model))
            Text(agent.effectiveModel.model, style = Dot.type.callout.copy(fontFamily = FontFamily.Monospace), color = c.textPrimary, modifier = Modifier.padding(horizontal = DotSpacing.gutter))
            Text(
                stringResource(if (agent.model == null) R.string.model_default else R.string.model_own),
                style = Dot.type.caption, color = c.textTertiary, modifier = Modifier.padding(horizontal = DotSpacing.gutter).padding(bottom = DotSpacing.m),
            )
            Hairline()

            SectionLabel(stringResource(R.string.permissions), Modifier.padding(top = DotSpacing.s))
            val p = agent.permissions
            listOf(
                Triple("web", R.string.perm_web, p.web),
                Triple("mail", R.string.perm_mail, p.mail),
                Triple("shell", R.string.perm_shell, p.shell),
                Triple("computer", R.string.perm_computer, p.computer),
                Triple("connectors", R.string.perm_connectors, p.connectors),
                Triple("manageMemory", R.string.perm_memory, p.manageMemory),
                Triple("manageActivities", R.string.perm_activities, p.manageActivities),
                Triple("messageAgents", R.string.perm_team, p.messageAgents),
            ).forEach { (key, label, value) ->
                SwitchRow(stringResource(label), null, value) { on -> onUpdate(buildJsonObject { putJsonObject("permissions") { put(key, on) } }) }
            }
            Text(stringResource(R.string.permissions_note), style = Dot.type.caption, color = c.textTertiary, modifier = Modifier.padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.s))
        }
    }
}

/** A setting with a switch: the whole row toggles (one 48dp+ target, one TalkBack node), with a light haptic. */
@Composable
fun SwitchRow(title: String, subtitle: String?, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    val haptics = rememberDotHaptics()
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp)
            .toggleable(checked, enabled = enabled, role = Role.Switch) { haptics.toggle(it); onChange(it) }
            .padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = Dot.type.bodyStrong, color = Dot.colors.textPrimary)
            if (subtitle != null) Text(subtitle, style = Dot.type.caption, color = Dot.colors.textSecondary)
        }
        Spacer(Modifier.width(DotSpacing.m))
        DotSwitch(checked, null, enabled = enabled)
    }
    Spacer(Modifier.height(0.dp))
}
