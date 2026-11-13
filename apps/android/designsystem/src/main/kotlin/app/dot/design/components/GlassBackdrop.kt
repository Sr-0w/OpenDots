package app.dot.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotSpacing

/**
 * Real backdrop blur for the Soft Frosted Glass controls.
 *
 * A screen remembers one [rememberGlassBackdrop], marks the content that scrolls *under* its glass controls with
 * [glassBackdropSource] (a sibling of the controls, never their ancestor), and passes the same state to
 * [DotFloatingCapsule] / [DotFrostedPill] / [QuietGlassSurface]. Each control blurs only the pixels behind its own
 * clipped shape and draws its translucent neutral tint on top; icons and labels stay sharp.
 */
@Composable
fun rememberGlassBackdrop(): QuietBackdrop = rememberQuietBackdrop()

fun Modifier.glassBackdropSource(state: QuietBackdrop?): Modifier = backdropSource(state)

/** Surface of a glass control: blurred backdrop + tint when [state] can blur, otherwise the opaque frosted gradient. */
@Composable
internal fun Modifier.glassSurface(state: QuietBackdrop?, pressed: Boolean): Modifier =
    if (LocalHeaderGlass.current != null) {
        // On the frosted header the band behind is already blurred: a light neutral veil reads as glass. A second live
        // blur per button would only cost frames (no double blur).
        background(headerGlassFill(pressed))
    } else if (!state.canBlur()) {
        background(frostedSurfaceBrush(pressed))
    } else {
        backdropBlur(state!!, background = Dot.colors.background, tint = glassTintBrush(pressed))
    }

/**
 * Neutral veil over the blurred backdrop: graphite in dark themes, white in light, no hue. Light enough that the moving
 * blurred content is what gives the glass its character, dark/light enough to keep icons legible on any content.
 */
@Composable
private fun glassTintBrush(pressed: Boolean): Brush = if (Dot.colors.isDark) {
    val a = if (pressed) 0.50f else 0.34f
    Brush.verticalGradient(listOf(Color(0xFF1E1E1E).copy(alpha = a), Color(0xFF121212).copy(alpha = a)))
} else {
    val a = if (pressed) 0.62f else 0.46f
    Brush.verticalGradient(listOf(Color.White.copy(alpha = a), Color(0xFFF2F2F2).copy(alpha = a)))
}

/** Glass on the frosted header (no blur of its own: the header band underneath is the blur). */
@Composable
internal fun headerGlassFill(pressed: Boolean): Color =
    if (Dot.colors.isDark) Color.White.copy(alpha = if (pressed) 0.16f else 0.09f) else Color.Black.copy(alpha = if (pressed) 0.10f else 0.05f)

/**
 * Generic floating glass container (a custom floating control that is not a pill or a capsule). Same recipe as the
 * other glass controls: low shadow, clip, blurred backdrop with the neutral tint, hairline highlight - all on one
 * [shape] so no state shows a squarer edge than another. Never use it for content blocks, rows or cards.
 */
@Composable
fun QuietGlassSurface(
    backdrop: QuietBackdrop?,
    modifier: Modifier = Modifier,
    shape: Shape = CircleShape,
    pressed: Boolean = false,
    contentAlignment: Alignment = Alignment.Center,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier
            .shadow(3.dp, shape, ambientColor = Color(0x26000000), spotColor = Color(0x33000000))
            .clip(shape)
            .glassSurface(backdrop, pressed)
            .border(DotSpacing.hairline * 2, frostedBorderBrush(), shape),
        contentAlignment = contentAlignment,
        content = content,
    )
}
