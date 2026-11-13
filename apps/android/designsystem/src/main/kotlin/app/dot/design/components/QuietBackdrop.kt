package app.dot.design.components

import android.os.Build
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.runtime.Immutable
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
import dev.chrisbanes.haze.HazeProgressive
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
 * A blur that weakens along the vertical axis: full strength down to [fullUntil] (px from the top of the surface), then
 * easing to no blur at all at [clearAt]. Where the strength reaches zero the surface shows the content exactly as it is
 * underneath, so an untinted progressive blur needs no mask and has no visible lower edge.
 */
@Immutable
data class BlurFade(val fullUntil: Float, val clearAt: Float)

/**
 * Draws the backdrop behind this element: blurred by [radius] over an opaque [background] (so transparent pixels of the
 * source never read as black), optionally veiled by a neutral [tint], shaped by the alpha [mask] and/or weakened
 * progressively by [fade]. This element's own content stays sharp on top.
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
    fade: BlurFade? = null,
): Modifier = composed {
    val input = remember(backdrop) { HazeInput.Sources(backdrop.haze) }
    val style = remember(background, tint, mask, radius, fade) {
        val progressive = fade?.let {
            HazeProgressive.verticalGradient(easing = FadeEasing, startY = it.fullUntil, startIntensity = 1f, endY = it.clearAt, endIntensity = 0f)
        }
        HazeBlurStyle {
            blurEnabled(true)
            blurRadius(radius)
            noiseFactor(0f)
            backgroundColor(background)
            colorEffects(if (tint != null) listOf(HazeColorEffect.tint(tint)) else emptyList())
            mask(mask)
            progressive(progressive)
        }
    }
    hazeBlur(input = input, style = style)
}

/** Nearly linear, softened at both ends: the blur thins out evenly over its whole fade, with no knee and no late drop. */
private val FadeEasing = CubicBezierEasing(0.25f, 0.1f, 0.75f, 0.9f)
