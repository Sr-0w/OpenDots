package app.dot.design.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import app.dot.design.Dot
import app.dot.design.DotShapes
import app.dot.design.DotSpacing

/** Quiet bottom sheet: neutral `surface`, 28dp top corners, a small grabber, the theme's scrim. No glass. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DotBottomSheet(onDismiss: () -> Unit, modifier: Modifier = Modifier, skipPartiallyExpanded: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    val c = Dot.colors
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = modifier,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = skipPartiallyExpanded),
        shape = DotShapes.sheet,
        containerColor = c.surface,
        contentColor = c.textPrimary,
        tonalElevation = 0.dp,
        scrimColor = c.scrim,
        dragHandle = {
            Box(Modifier.padding(top = DotSpacing.m, bottom = DotSpacing.s).size(width = 36.dp, height = 4.dp).clip(DotShapes.pill).background(c.borderStrong))
        },
        content = content,
    )
}

/**
 * Quiet dialog: a decision, stated once. Title, one short message, the confirming action as a solid button and the
 * way out as a ghost. Pass [destructive] when confirming removes something.
 */
@Composable
fun DotDialog(
    title: String,
    onDismiss: () -> Unit,
    confirmLabel: String,
    onConfirm: () -> Unit,
    dismissLabel: String,
    modifier: Modifier = Modifier,
    message: String? = null,
    destructive: Boolean = false,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val c = Dot.colors
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = modifier.widthIn(max = 360.dp).fillMaxWidth().dotSurfaceEnter(),
            shape = DotShapes.dialog,
            color = c.surface,
            contentColor = c.textPrimary,
            border = BorderStroke(DotSpacing.hairline * 2, c.border),
        ) {
            Column(Modifier.padding(DotSpacing.xl)) {
                Text(title, style = Dot.type.title, color = c.textPrimary)
                if (message != null) {
                    Spacer(Modifier.height(DotSpacing.s))
                    Text(message, style = Dot.type.callout, color = c.textSecondary)
                }
                if (content != null) {
                    Spacer(Modifier.height(DotSpacing.l))
                    content()
                }
                Spacer(Modifier.height(DotSpacing.xl))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                    DotButton(dismissLabel, onDismiss, style = ButtonStyle.Ghost)
                    Spacer(Modifier.width(DotSpacing.s))
                    if (destructive) DotButton(confirmLabel, onConfirm, style = ButtonStyle.Danger) else DotPrimaryButton(confirmLabel, onConfirm)
                }
            }
        }
    }
}
