package app.dot.opendots.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotMotion
import app.dot.design.rememberReducedMotion
import app.dot.opendots.data.Agent

fun parseAgentColor(hex: String): Color =
    runCatching { Color(android.graphics.Color.parseColor(if (hex.startsWith("#")) hex else "#$hex")) }.getOrDefault(Color(0xFF888888))

/**
 * A companion's face: the OpenDots "dot" - a softly shaded sphere in the companion's own colour with two eyes. This is
 * the one place a companion's colour appears; it never tints the conversation. While the companion works the eyes blink
 * slowly (still when system animations are off); an error shows a small danger mark.
 */
@Composable
fun CompanionOrb(color: Color, modifier: Modifier = Modifier, size: Dp = 36.dp, state: String = "available", named: Boolean = true) {
    val active = state in Agent.BUSY_STATES
    val reduced = rememberReducedMotion()
    val blink = if (active && !reduced) {
        val transition = rememberInfiniteTransition(label = "orb")
        val value by transition.animateFloat(1f, 0.25f, infiniteRepeatable(tween(900, easing = DotMotion.standard), RepeatMode.Reverse), label = "blink")
        value
    } else 1f
    val eye = remember(color) { if (color.luminance() > 0.55f) Color(0xFF111111) else Color.White }
    val danger = Dot.colors.danger
    val page = Dot.colors.background
    Canvas(modifier.size(size)) {
        val d = this.size.minDimension
        drawCircle(
            Brush.radialGradient(
                0f to lerp(color, Color.White, 0.22f), 0.55f to color, 1f to lerp(color, Color.Black, 0.22f),
                center = Offset(d * 0.34f, d * 0.28f), radius = d * 0.85f,
            ),
        )
        val eyeW = d * 0.12f
        val eyeH = d * (if (named) 0.2f else 0.16f) * blink
        val gap = d * 0.16f
        val top = d * 0.48f - eyeH / 2
        for (x in listOf(d / 2 - gap / 2 - eyeW, d / 2 + gap / 2)) {
            drawRoundRect(eye, topLeft = Offset(x, top), size = Size(eyeW, eyeH), cornerRadius = CornerRadius(eyeW / 2))
        }
        if (state == "error") {
            val r = d * 0.15f
            drawCircle(page, radius = r + d * 0.05f, center = Offset(d - r, d - r))
            drawCircle(danger, radius = r, center = Offset(d - r, d - r))
        }
    }
}

@Composable
fun CompanionOrb(agent: Agent, modifier: Modifier = Modifier, size: Dp = 36.dp) =
    CompanionOrb(parseAgentColor(agent.color), modifier, size, agent.state, agent.named)
