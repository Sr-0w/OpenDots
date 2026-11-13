package app.dot.design.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dot.design.Dot
import app.dot.design.DotMotion
import app.dot.design.DotShapes
import app.dot.design.DotSpacing
import app.dot.design.R
import app.dot.design.rememberDotHaptics
import app.dot.design.rememberReducedMotion

/*
 * Conversation components of Quiet UI. A conversation reads like instant messaging: both parties speak in quiet
 * bubbles, and work (tools, reasoning, terminal output) lives in a separate panel, behind disclosures.
 * Nothing here is glass: the only frosted element of a conversation screen is its header.
 */

/** The user's own message: the raised neutral surface, hugging the trailing edge. A card shape, never a pill. */
@Composable
fun DotUserBubble(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.clip(UserBubbleShape).background(Dot.colors.surfaceRaised).padding(horizontal = 14.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(DotSpacing.s),
        content = content,
    )
}

/** The other party's message: the quiet `surface` with a hairline, hugging the leading edge. */
@Composable
fun DotReplyBubble(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .clip(ReplyBubbleShape)
            .background(Dot.colors.surface)
            .border(DotSpacing.hairline * 2, Dot.colors.border, ReplyBubbleShape)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(DotSpacing.s),
        content = content,
    )
}

private val UserBubbleShape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomEnd = 6.dp, bottomStart = 20.dp)
private val ReplyBubbleShape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomEnd = 20.dp, bottomStart = 6.dp)

/** The message a reply refers to: a hairline rule, who said it, one line of it. */
@Composable
fun DotQuote(author: String, preview: String, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    Row(
        modifier
            .height(IntrinsicSize.Min)
            .then(if (onClick != null) Modifier.clip(DotShapes.small).clickable(role = Role.Button, onClick = onClick) else Modifier),
    ) {
        Box(Modifier.width(2.dp).fillMaxHeight().clip(DotShapes.pill).background(Dot.colors.borderStrong))
        Spacer(Modifier.width(DotSpacing.s))
        Column {
            Text(author, style = Dot.type.caption, color = Dot.colors.textTertiary, maxLines = 1)
            Text(preview, style = Dot.type.callout, color = Dot.colors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A reaction: emoji and count on a hairline pill, filled softly when it is the user's own. 48dp touch target. */
@Composable
fun DotReactionChip(emoji: String, count: Int, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Dot.colors
    val haptics = rememberDotHaptics()
    Box(
        modifier
            .heightIn(min = 40.dp)
            .toggleable(value = selected, role = Role.Checkbox, onValueChange = { haptics.toggle(it); onClick() }),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .clip(DotShapes.pill)
                .background(if (selected) c.surfaceRaised else Color.Transparent)
                .border(1.dp, if (selected) c.borderStrong else c.border, DotShapes.pill)
                .padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(emoji, fontSize = 14.sp)
            if (count > 1) {
                Spacer(Modifier.width(DotSpacing.xs))
                Text(count.toString(), style = Dot.type.caption, color = c.textSecondary)
            }
        }
    }
}

/**
 * A flat content container for things the user must look at or act on inside a conversation (an approval, a form, a
 * draft): `surface` fill, hairline outline, large radius, no elevation. [emphasized] strengthens only the outline.
 */
@Composable
fun DotCard(modifier: Modifier = Modifier, emphasized: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val c = Dot.colors
    Column(
        modifier
            .clip(DotShapes.large)
            .background(c.surface)
            .border(DotSpacing.hairline * 2, if (emphasized) c.borderStrong else c.border, DotShapes.large)
            .padding(DotSpacing.l),
        content = content,
    )
}

/**
 * A quiet line that opens to show more ("Worked for 12 s · 3 actions"). Collapsed by default: tool events and
 * reasoning are available on demand, never permanent noise. The whole line is the 48dp touch target.
 */
@Composable
fun DotDisclosure(
    label: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
    detailColor: Color = Dot.colors.textTertiary,
    leading: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Dot.colors
    val reduced = rememberReducedMotion()
    val turn by animateFloatAsState(if (expanded) 180f else 0f, DotMotion.fastSpec(reduced), label = "disclosure")
    Column(modifier) {
        Row(
            Modifier
                .clip(DotShapes.small)
                .toggleable(value = expanded, role = Role.Button, onValueChange = { onToggle() })
                .heightIn(min = 40.dp)
                .padding(end = DotSpacing.s),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (leading != null) {
                Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) { leading() }
                Spacer(Modifier.width(DotSpacing.s))
            }
            Text(label, style = Dot.type.label, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (detail != null) {
                Text("  ·  $detail", style = Dot.type.caption, color = detailColor, maxLines = 1)
            }
            Spacer(Modifier.width(DotSpacing.xs))
            Icon(Icons.Outlined.KeyboardArrowDown, null, Modifier.size(16.dp).rotate(turn), tint = c.textTertiary)
        }
        AnimatedVisibility(
            visible = expanded,
            enter = if (reduced) fadeIn(DotMotion.spec(0)) else expandVertically(DotMotion.mediumSpec()) + fadeIn(DotMotion.mediumSpec()),
            exit = if (reduced) fadeOut(DotMotion.spec(0)) else shrinkVertically(DotMotion.fastSpec()) + fadeOut(DotMotion.fastSpec()),
        ) {
            Row(Modifier.padding(top = DotSpacing.xs, bottom = DotSpacing.s).height(IntrinsicSize.Min)) {
                Box(Modifier.padding(start = 8.dp).width(DotSpacing.hairline * 2).fillMaxHeight().background(c.border))
                Column(Modifier.padding(start = DotSpacing.m), verticalArrangement = Arrangement.spacedBy(DotSpacing.s), content = content)
            }
        }
    }
}

/** One step of work inside a [DotDisclosure]: a small glyph, what happened, and whether it failed. */
@Composable
fun DotWorkStep(icon: ImageVector, title: String, modifier: Modifier = Modifier, running: Boolean = false, failed: Boolean = false, monospace: Boolean = false) {
    val c = Dot.colors
    Row(modifier.heightIn(min = 28.dp), verticalAlignment = Alignment.CenterVertically) {
        if (running) DotSpinner(size = 14.dp) else Icon(icon, null, Modifier.size(15.dp), tint = if (failed) c.danger else c.textTertiary)
        Spacer(Modifier.width(DotSpacing.s))
        Text(
            title,
            style = if (monospace) Dot.type.caption.copy(fontFamily = FontFamily.Monospace) else Dot.type.callout,
            color = if (failed) c.danger else c.textSecondary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** "Thinking…": three quiet dots and a secondary label. Used while the other party has not produced text yet. */
@Composable
fun DotThinking(label: String, modifier: Modifier = Modifier) {
    Row(modifier.heightIn(min = 32.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        DotDotsLoader()
        Spacer(Modifier.width(DotSpacing.m))
        Text(label, style = Dot.type.callout, color = Dot.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * Code and terminal output: a distinct surface that is dark in every theme family (graphite on dark/OLED, the raised
 * surface on light), monospace, scrolls sideways instead of wrapping, with an optional header line and copy action.
 */
@Composable
fun DotCodeBlock(
    code: String,
    modifier: Modifier = Modifier,
    title: String? = null,
    onCopy: (() -> Unit)? = null,
    maxLines: Int = Int.MAX_VALUE,
) {
    val c = Dot.colors
    Column(
        modifier
            .fillMaxWidth()
            .clip(DotShapes.medium)
            .background(if (c.isDark) c.surface else c.surface)
            .border(DotSpacing.hairline * 2, c.border, DotShapes.medium),
    ) {
        if (title != null || onCopy != null) {
            Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).padding(start = DotSpacing.m), verticalAlignment = Alignment.CenterVertically) {
                Text(title.orEmpty(), style = Dot.type.caption.copy(fontFamily = FontFamily.Monospace), color = c.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (onCopy != null) {
                    DotIconButton(Icons.Outlined.ContentCopy, stringResource(R.string.ds_copy_code), onClick = onCopy, tint = c.textSecondary, modifier = Modifier.size(40.dp))
                }
            }
            Hairline()
        }
        Text(
            code.trimEnd('\n'),
            style = Dot.type.caption.copy(fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 18.sp),
            color = c.textPrimary,
            softWrap = false,
            maxLines = maxLines,
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(DotSpacing.m),
        )
    }
}

/**
 * The message composer. A stable `surface` container (no blur, no glass, nothing behind it but the page): an optional
 * [header] (reply preview, attachments), a [leading] secondary action, a growing text field, and one round action -
 * solid Accent Blue "send", which becomes "stop" while the other party is working and there is nothing to send.
 */
@Composable
fun DotComposer(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    busy: Boolean = false,
    canSend: Boolean = value.isNotBlank(),
    onStop: (() -> Unit)? = null,
    enabled: Boolean = true,
    focusRequester: FocusRequester? = null,
    header: (@Composable ColumnScope.() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
) {
    val c = Dot.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val reduced = rememberReducedMotion()
    val outline by animateColorAsState(if (focused) c.borderStrong else c.border, DotMotion.fastSpec(reduced), label = "composer")
    Column(
        modifier
            .fillMaxWidth()
            .clip(ComposerShape)
            .background(c.surface)
            .border(DotSpacing.hairline * 2, outline, ComposerShape),
    ) {
        if (header != null) Column(Modifier.padding(start = DotSpacing.l, end = DotSpacing.s, top = DotSpacing.m), content = header)
        Row(Modifier.padding(horizontal = DotSpacing.xs, vertical = DotSpacing.xs), verticalAlignment = Alignment.Bottom) {
            if (leading != null) leading() else Spacer(Modifier.width(DotSpacing.m))
            Box(Modifier.weight(1f).heightIn(min = 48.dp).padding(horizontal = DotSpacing.xs, vertical = 12.dp), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, style = Dot.type.body, color = c.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    enabled = enabled,
                    textStyle = Dot.type.body.copy(color = c.textPrimary),
                    cursorBrush = SolidColor(c.accent),
                    interactionSource = interaction,
                    maxLines = 6,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
                        .semantics { if (placeholder.isNotEmpty()) contentDescription = placeholder },
                )
            }
            Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                if (busy && !canSend && onStop != null) {
                    DotStopButton(onStop)
                } else {
                    DotPrimaryButton(Icons.Outlined.ArrowUpward, stringResource(R.string.ds_send), onClick = onSend, enabled = enabled && canSend)
                }
            }
        }
    }
}

private val ComposerShape = RoundedCornerShape(28.dp)

/** "Stop": the inverse tone, not the accent - it ends work rather than confirming something. */
@Composable
private fun DotStopButton(onClick: () -> Unit) {
    val c = Dot.colors
    val haptics = rememberDotHaptics()
    val label = stringResource(R.string.ds_stop)
    Box(
        Modifier
            .size(48.dp)
            .clip(DotShapes.circle)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = ripple(bounded = true, color = c.textPrimary),
                role = Role.Button,
            ) { haptics.tick(); onClick() }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(40.dp).clip(DotShapes.circle).background(c.inverse), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Stop, null, Modifier.size(18.dp), tint = c.onInverse)
        }
    }
}
