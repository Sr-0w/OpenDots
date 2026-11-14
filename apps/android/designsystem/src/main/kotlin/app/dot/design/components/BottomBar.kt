package app.dot.design.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotMotion
import app.dot.design.DotSpacing
import app.dot.design.rememberDotHaptics
import app.dot.design.rememberReducedMotion

@Immutable
class DotBottomBarItem(val icon: ImageVector, val label: String, val badge: Boolean = false)

/**
 * The quiet bottom navigation of top-level pages: the page colour, a hairline on top, an outlined glyph and a label per
 * destination. The selected one is simply the primary text colour; an accent dot marks something waiting. It is a
 * stable surface - never glass, never blurred: Quiet only frosts the top of the screen.
 */
@Composable
fun DotBottomBar(items: List<DotBottomBarItem>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val c = Dot.colors
    val haptics = rememberDotHaptics()
    val reduced = rememberReducedMotion()
    Column(modifier.fillMaxWidth().background(c.background)) {
        Hairline()
        Row(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).selectableGroup()) {
            items.forEachIndexed { index, item ->
                val tint by animateColorAsState(if (index == selected) c.textPrimary else c.textTertiary, DotMotion.fastSpec(reduced), label = "tab")
                Column(
                    Modifier.weight(1f).heightIn(min = 56.dp)
                        .selectable(index == selected, role = Role.Tab) { if (index != selected) { haptics.tick(); onSelect(index) } }
                        .padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box {
                        Icon(item.icon, null, Modifier.size(22.dp), tint = tint)
                        if (item.badge) UnreadDot(Modifier.align(Alignment.TopEnd).padding(start = 18.dp), size = 7.dp)
                    }
                    Text(item.label, style = Dot.type.caption, color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = DotSpacing.xxs))
                }
            }
        }
    }
}
