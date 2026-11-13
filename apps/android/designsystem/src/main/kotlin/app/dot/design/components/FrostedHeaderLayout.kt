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
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import app.dot.design.rememberReducedMotion

internal data class HeaderGlass(val backdrop: QuietBackdrop?)

/** Short ease-out below the header: everything under the header itself is fully frosted. */
private val FADE = 40.dp

/** Extra top inset for the list, so at rest its first row sits past most of the fade. */
private val LIST_INSET = 24.dp

internal val LocalHeaderGlass = staticCompositionLocalOf<HeaderGlass?> { null }

/**
 * Content scrolls behind a transparent header. The frost starts at the screen's top, covers the measured header and
 * eases out over [FADE] below it; the header's own controls are never part of the blur source. Apply [content]'s
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
    val initial = with(density) { WindowInsets.statusBars.getTop(this).toDp() } + 64.dp
    val width = LocalConfiguration.current.screenWidthDp
    var headerHeight by remember(density, width) { mutableStateOf(initial) }
    var expandedHeight by remember(density, width) { mutableStateOf(initial) }
    Box(modifier.fillMaxSize()) {
        content(PaddingValues(top = (if (reserveExpandedHeight) expandedHeight else headerHeight) + LIST_INSET))
        val total = expandedHeight + FADE
        val visible by animateDpAsState(headerHeight, tween(if (rememberReducedMotion()) 0 else 220), label = "headerBlur")
        TopEdgeFade(
            backdrop, 1f, Modifier.align(Alignment.TopCenter),
            height = total,
            solidUntil = (visible / total).coerceIn(0f, 1f),
            fadeLength = FADE / total,
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
