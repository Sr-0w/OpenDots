package app.dot.design.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.dot.design.rememberReducedMotion

internal data class HeaderGlass(val backdrop: QuietBackdrop?)

/** The blur is completely gone this far below the header: it stops right under the header's last element. */
private val TAIL = 10.dp

/** Share of the visible header, from the top, where the blur stays at full strength before it starts easing out. */
private const val FULL = 0.18f

/** The uniform top blur reaches a little below the status bar, then dissolves into the progressive blur over [CAP_FADE]. */
private val CAP_BELOW_STATUS_BAR = 6.dp
private val CAP_FADE = 28.dp

/** Gap between the header and the first row of the list at rest. */
private val LIST_INSET = 12.dp

/**
 * The scrolling content and the blur both extend this far above the top of the screen. A blur samples its
 * neighbourhood: at the very edge of its source there is nothing beyond to sample, so rows sliding out there make the
 * edge shimmer. With the edge pushed off screen, what is visible is always blurred from real content on both sides.
 */
private val BLEED = 56.dp

internal val LocalHeaderGlass = staticCompositionLocalOf<HeaderGlass?> { null }

/**
 * Content scrolls behind a transparent header. The blur starts above the screen's top, is strongest at the top edge and
 * eases out over the whole header, ending just below it; the header's own controls are never part of the blur source. Apply [content]'s
 * padding inside the scrolling content (LazyColumn.contentPadding or a leading Spacer), never as padding on the
 * viewport, and mark that content with `backdropSource(backdrop)`.
 *
 * The overlay keeps the tallest height the header ever had (a stable blur texture: no reallocation, no flicker); only
 * its mask follows the header actually on screen, animated over 220 ms.
 */
@Composable
fun FrostedHeaderLayout(
    backdrop: QuietBackdrop?,
    modifier: Modifier = Modifier,
    reserveExpandedHeight: Boolean = false,
    header: @Composable () -> Unit,
    content: @Composable (contentPadding: PaddingValues) -> Unit,
) {
    val density = LocalDensity.current
    val statusBar = with(density) { WindowInsets.statusBars.getTop(this).toDp() }
    val initial = statusBar + 64.dp
    val width = LocalConfiguration.current.screenWidthDp
    var headerHeight by remember(density, width) { mutableStateOf(initial) }
    var expandedHeight by remember(density, width) { mutableStateOf(initial) }
    Box(modifier.fillMaxSize()) {
        Box(Modifier.extendUp(BLEED)) {
            content(PaddingValues(top = BLEED + (if (reserveExpandedHeight) expandedHeight else headerHeight) + LIST_INSET))
        }
        val total = BLEED + expandedHeight + TAIL
        val visible by animateDpAsState(headerHeight, tween(if (rememberReducedMotion()) 0 else 220), label = "headerBlur")
        TopEdgeFade(
            backdrop, 1f, Modifier.align(Alignment.TopCenter).extendUp(BLEED),
            height = total,
            solidUntil = ((BLEED + visible * FULL) / total).coerceIn(0f, 1f),
            fadeLength = (visible * (1f - FULL) + TAIL) / total,
            // The off-screen strip, the screen edge and the status bar are always fully blurred.
            capUntil = (BLEED + statusBar + CAP_BELOW_STATUS_BAR) / total,
            capFade = CAP_FADE / total,
        )
        CompositionLocalProvider(LocalHeaderGlass provides HeaderGlass(null)) {
            Box(
                Modifier.align(Alignment.TopCenter).fillMaxWidth().onSizeChanged { size ->
                    with(density) { size.height.toDp() }.let {
                        if (headerHeight != it) headerHeight = it
                        if (it > expandedHeight) expandedHeight = it
                    }
                },
            ) { header() }
        }
    }
}

/**
 * Lays the child out [amount] taller and starts it [amount] above this slot, which keeps its own size: the extra strip
 * sits off screen above the top edge.
 */
private fun Modifier.extendUp(amount: Dp): Modifier = layout { measurable, constraints ->
    val extra = amount.roundToPx()
    val bounded = constraints.hasBoundedHeight
    val placeable = measurable.measure(
        if (bounded) constraints.copy(minHeight = constraints.minHeight + extra, maxHeight = constraints.maxHeight + extra) else constraints,
    )
    layout(placeable.width, (placeable.height - extra).coerceAtLeast(0)) { placeable.place(0, -extra) }
}
