package app.dot.design.components

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.chrisbanes.haze.HazeInput
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.blur.HazeBlurStyle
import dev.chrisbanes.haze.blur.HazeColorEffect
import dev.chrisbanes.haze.blur.hazeBlur
import dev.chrisbanes.haze.hazeSource

/**
 * Quiet's backdrop blur. Screens never talk to the blur engine: they remember one [QuietBackdrop], mark the scrolling
 * content with [backdropSource] and hand the same object to the frosted header / glass controls drawn **above** it as
 * siblings (never as ancestors, which would blur their own controls).
 *
 * The engine is Haze 2.1 (Chris Banes, Apache-2.0): the source records its content once into a graphics layer and each
 * surface draws that layer through a GPU RenderEffect, so there is no bitmap read-back and nothing is reallocated while
 * the list scrolls. Every surface owns its effect node, so several surfaces never overwrite each other's radius.
 */
@Stable
class QuietBackdrop internal constructor(internal val haze: HazeState) {
    /** RenderEffect exists from Android 12. Below, surfaces fall back to an opaque neutral fill. */
    val supported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
}

/** Kept so components shared with Dot Mail compile unchanged. */
typealias Backdrop = QuietBackdrop

@Composable
fun rememberQuietBackdrop(): QuietBackdrop = remember { QuietBackdrop(HazeState()) }

@Composable
fun rememberBackdrop(): QuietBackdrop = rememberQuietBackdrop()

/**
 * True when the user asked for less transparency (app setting): every frosted surface then becomes a plain neutral
 * fill of the same shape. Provide it once near the theme.
 */
val LocalReduceTransparency = compositionLocalOf { false }

/** Whether a surface may really blur right now: platform support, hardware canvas, and the user's preference. */
@Composable
fun QuietBackdrop?.canBlur(): Boolean =
    this != null && supported && !LocalReduceTransparency.current && LocalView.current.isHardwareAccelerated

/** Marks the content that glass and the frosted header blur. */
fun Modifier.backdropSource(backdrop: QuietBackdrop?): Modifier =
    if (backdrop == null) this else hazeSource(backdrop.haze)

/** The blur radius of every Quiet backdrop surface. */
val BackdropRadius: Dp = 28.dp

/**
 * Draws the backdrop behind this element: blurred by [radius] over an opaque [background] (so transparent pixels of the
 * source never read as black), veiled by the neutral [tint], and shaped by the alpha [mask] when given. The mask fades
 * the blur **and** its veil with one curve, so sharp content turns progressively frosted with no darker strip ahead of
 * the blur. This element's own content stays sharp on top.
 *
 * Edges use Haze's bounded treatment (clamped sampling): the blur never pulls transparent black in from outside the
 * source, which is what produces dark bands at a screen edge.
 */
fun Modifier.backdropBlur(
    backdrop: QuietBackdrop,
    background: Color,
    tint: Brush?,
    mask: Brush? = null,
    radius: Dp = BackdropRadius,
): Modifier = composed {
    val input = remember(backdrop) { HazeInput.Sources(backdrop.haze) }
    val style = remember(background, tint, mask, radius) {
        HazeBlurStyle {
            blurEnabled(true)
            blurRadius(radius)
            noiseFactor(0f)
            backgroundColor(background)
            colorEffects(if (tint != null) listOf(HazeColorEffect.tint(tint)) else emptyList())
            mask(mask)
        }
    }
    hazeBlur(input = input, style = style)
}
