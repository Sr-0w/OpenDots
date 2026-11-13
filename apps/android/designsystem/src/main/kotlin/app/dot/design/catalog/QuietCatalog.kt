package app.dot.design.catalog

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotShapes
import app.dot.design.DotSpacing
import app.dot.design.DotTheme
import app.dot.design.ThemeMode
import app.dot.design.components.Avatar
import app.dot.design.components.BackButton
import app.dot.design.components.ButtonStyle
import app.dot.design.components.DotButton
import app.dot.design.components.DotCapsuleButton
import app.dot.design.components.DotCapsuleDivider
import app.dot.design.components.DotCard
import app.dot.design.components.DotCodeBlock
import app.dot.design.components.DotComposer
import app.dot.design.components.DotDisclosure
import app.dot.design.components.DotDotsLoader
import app.dot.design.components.DotFilterChip
import app.dot.design.components.DotFloatingCapsule
import app.dot.design.components.DotFrostedPill
import app.dot.design.components.DotIconButton
import app.dot.design.components.DotLinearProgress
import app.dot.design.components.DotMarkdown
import app.dot.design.components.DotPrimaryButton
import app.dot.design.components.DotQuote
import app.dot.design.components.DotReactionChip
import app.dot.design.components.DotSpinner
import app.dot.design.components.DotSwitch
import app.dot.design.components.DotTextField
import app.dot.design.components.DotThinking
import app.dot.design.components.DotTopBar
import app.dot.design.components.DotUserBubble
import app.dot.design.components.DotWorkStep
import app.dot.design.components.EmptyState
import app.dot.design.components.FrostedHeaderLayout
import app.dot.design.components.Hairline
import app.dot.design.components.ListRow
import app.dot.design.components.SectionLabel
import app.dot.design.components.UnreadDot
import app.dot.design.components.backdropSource
import app.dot.design.components.rememberQuietBackdrop

/*
 * The Quiet UI control screen: every token and component on one scrolling page, under the real frosted header and two
 * floating glass controls. It is the page to open on a device to judge the blur (slow and fast scroll, theme changes,
 * rotation, 120 Hz) and the previews to open in the IDE for Light, Dark and OLED. Sample text is deliberately not
 * localized: this is a developer surface.
 */

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun QuietCatalogScreen(onBack: () -> Unit) {
    val backdrop = rememberQuietBackdrop()
    val c = Dot.colors
    Box(Modifier.fillMaxSize().background(c.background)) {
        FrostedHeaderLayout(
            backdrop,
            header = {
                DotTopBar(
                    title = "Quiet UI", subtitle = "Tokens · components · glass",
                    navigation = { Box(Modifier.padding(start = DotSpacing.s)) { BackButton(onBack) } },
                    actions = { Box(Modifier.padding(end = DotSpacing.s)) { DotIconButton(Icons.Outlined.Search, "Search", onClick = {}) } },
                )
            },
        ) { padding ->
            LazyColumn(Modifier.fillMaxSize().backdropSource(backdrop), contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = 120.dp)) {
                item { SectionLabel("Colour") }
                item {
                    FlowRow(Modifier.padding(horizontal = DotSpacing.gutter), horizontalArrangement = Arrangement.spacedBy(DotSpacing.s), verticalArrangement = Arrangement.spacedBy(DotSpacing.s)) {
                        listOf(
                            "background" to c.background, "surface" to c.surface, "surfaceRaised" to c.surfaceRaised, "border" to c.border, "borderStrong" to c.borderStrong,
                            "textPrimary" to c.textPrimary, "textSecondary" to c.textSecondary, "textTertiary" to c.textTertiary,
                            "accent" to c.accent, "accentFill" to c.accentFill, "star" to c.star, "danger" to c.danger, "success" to c.success,
                        ).forEach { (name, color) -> Swatch(name, color) }
                    }
                }
                item { SectionLabel("Type", Modifier.padding(top = DotSpacing.l)) }
                item {
                    Column(Modifier.padding(horizontal = DotSpacing.gutter), verticalArrangement = Arrangement.spacedBy(DotSpacing.s)) {
                        Text("Display 26/32", style = Dot.type.display, color = c.textPrimary)
                        Text("Title 19/25", style = Dot.type.title, color = c.textPrimary)
                        Text("Headline 15/21 semibold", style = Dot.type.headline, color = c.textPrimary)
                        Text("Body 15/23. Long-form reading text stays calm and legible at any font scale.", style = Dot.type.body, color = c.textPrimary)
                        Text("Callout 14/20 for secondary lines", style = Dot.type.callout, color = c.textSecondary)
                        Text("Label 13/18 medium", style = Dot.type.label, color = c.textSecondary)
                        Text("Caption 12/16", style = Dot.type.caption, color = c.textTertiary)
                        Text("OVERLINE 11/14", style = Dot.type.overline, color = c.textTertiary)
                    }
                }
                item { SectionLabel("Buttons", Modifier.padding(top = DotSpacing.l)) }
                item {
                    FlowRow(Modifier.padding(horizontal = DotSpacing.gutter), horizontalArrangement = Arrangement.spacedBy(DotSpacing.s)) {
                        DotPrimaryButton("Confirm", {})
                        DotButton("Secondary", {}, style = ButtonStyle.Secondary)
                        DotButton("Ghost", {}, style = ButtonStyle.Ghost)
                        DotButton("Delete", {}, style = ButtonStyle.Danger, icon = Icons.Outlined.DeleteOutline)
                        DotPrimaryButton("Loading", {}, loading = true)
                        DotPrimaryButton("Disabled", {}, enabled = false)
                    }
                }
                item { SectionLabel("Selection", Modifier.padding(top = DotSpacing.l)) }
                item {
                    var chip by remember { mutableStateOf(1) }
                    var on by remember { mutableStateOf(true) }
                    Column(Modifier.padding(horizontal = DotSpacing.gutter)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(DotSpacing.s), verticalAlignment = Alignment.CenterVertically) {
                            listOf("System", "Light", "Dark", "OLED").forEachIndexed { i, label -> DotFilterChip(label, chip == i, { chip = i }, radio = true) }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DotSpacing.l)) {
                            DotSwitch(on, { on = it })
                            DotReactionChip("👍", 2, selected = true, onClick = {})
                            DotReactionChip("👀", 1, selected = false, onClick = {})
                            UnreadDot()
                            Avatar("Ada Lovelace", "ada@example.com")
                        }
                    }
                }
                item { SectionLabel("Inputs", Modifier.padding(top = DotSpacing.l)) }
                item {
                    var text by remember { mutableStateOf("") }
                    var message by remember { mutableStateOf("") }
                    Column(Modifier.padding(horizontal = DotSpacing.gutter), verticalArrangement = Arrangement.spacedBy(DotSpacing.m)) {
                        DotTextField(text, { text = it }, label = "Label above, never floating", placeholder = "Placeholder", supporting = "Supporting text")
                        DotComposer(message, { message = it }, onSend = { message = "" }, placeholder = "Write to Ari…", leading = { DotIconButton(Icons.Outlined.Add, "Attach", onClick = {}, tint = c.textSecondary) })
                    }
                }
                item { SectionLabel("Conversation", Modifier.padding(top = DotSpacing.l)) }
                item {
                    var open by remember { mutableStateOf(true) }
                    Column(Modifier.padding(horizontal = DotSpacing.gutter), verticalArrangement = Arrangement.spacedBy(DotSpacing.l)) {
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                            DotUserBubble {
                                DotQuote("Ari", "Done. You'll get it every Friday at 5pm.")
                                Text("Count the TypeScript lines in the shared workspace.", style = Dot.type.body, color = c.textPrimary)
                            }
                        }
                        DotMarkdown("**12,418 lines** across `163` files.\n\n- Server: 7,902\n- Web: 4,516\n\n```bash\nfind . -name '*.ts' | xargs wc -l | tail -1\n```\n\n| Package | Lines |\n|---|---|\n| server | 7,902 |\n| web | 4,516 |")
                        DotDisclosure("Worked for 12 s", open, { open = !open }, detail = "2 actions") {
                            DotWorkStep(Icons.Outlined.Search, "Searches “Node.js 24 release notes”")
                            DotWorkStep(Icons.Outlined.Terminal, "$ find . -name '*.ts' | xargs wc -l", monospace = true)
                            DotWorkStep(Icons.Outlined.Terminal, "$ exit 1", failed = true, monospace = true)
                        }
                        DotThinking("Thinking…")
                        DotCard(Modifier.fillMaxWidth(), emphasized = true) {
                            Text("Send the email to claire@example.com", style = Dot.type.bodyStrong, color = c.textPrimary)
                            Text("Waiting for your approval", style = Dot.type.caption, color = c.textSecondary)
                            Spacer(Modifier.height(DotSpacing.m))
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                DotButton("Refuse", {}, style = ButtonStyle.Secondary, compact = true)
                                Spacer(Modifier.width(DotSpacing.s))
                                DotPrimaryButton("Approve", {}, compact = true)
                            }
                        }
                        DotCodeBlock("$ pnpm build\n✓ built in 4.2s", title = "terminal", onCopy = {})
                    }
                }
                item { SectionLabel("Loading", Modifier.padding(top = DotSpacing.l)) }
                item {
                    Row(Modifier.padding(horizontal = DotSpacing.gutter), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DotSpacing.xl)) {
                        DotSpinner()
                        DotDotsLoader()
                        DotLinearProgress(modifier = Modifier.width(120.dp))
                    }
                }
                item { SectionLabel("Rows", Modifier.padding(top = DotSpacing.l)) }
                item {
                    Column {
                        ListRow("Settings row", subtitle = "Flat, separated by hairlines", icon = Icons.Outlined.Edit, onClick = {})
                        Hairline(inset = DotSpacing.gutter)
                        ListRow("Another row", icon = Icons.Outlined.Archive, onClick = {})
                    }
                }
                item { EmptyState(Icons.Outlined.Inbox, "Nothing here yet", "Empty states are one glyph, a title and one human sentence.") }
                // Colour bands: something vivid to scroll under the glass, so the blur and its neutral tint can be judged.
                item { SectionLabel("Backdrop test", Modifier.padding(top = DotSpacing.l)) }
                items(24) { index ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.xs), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(40.dp).clip(DotShapes.circle).background(Color.hsv(index * 15f, 0.55f, 0.85f)))
                        Spacer(Modifier.width(DotSpacing.m))
                        Column(Modifier.weight(1f)) {
                            Text("Scroll me under the header · $index", style = Dot.type.bodyStrong, color = c.textPrimary)
                            Text("Text must blur progressively, with no band, no flicker and no tint shift.", style = Dot.type.caption, color = c.textSecondary)
                        }
                    }
                }
            }
        }
        // Floating glass controls: each blurs only what is behind its own shape.
        Row(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = DotSpacing.xl), horizontalArrangement = Arrangement.spacedBy(DotSpacing.m), verticalAlignment = Alignment.CenterVertically) {
            DotFloatingCapsule(backdrop = backdrop) {
                DotCapsuleButton(Icons.Outlined.Archive, "Archive", {})
                DotCapsuleDivider()
                DotCapsuleButton(Icons.Outlined.DeleteOutline, "Delete", {})
                DotCapsuleDivider()
                DotCapsuleButton(Icons.Outlined.MoreHoriz, "More", {})
            }
            DotFrostedPill(Icons.Outlined.ArrowDownward, {}, label = "Latest", backdrop = backdrop)
        }
    }
}

@Composable
private fun Swatch(name: String, color: Color) {
    Column(Modifier.width(96.dp)) {
        Box(Modifier.fillMaxWidth().height(40.dp).clip(DotShapes.small).background(color).border(DotSpacing.hairline * 2, Dot.colors.borderStrong, DotShapes.small))
        Text(name, style = Dot.type.caption, color = Dot.colors.textSecondary, maxLines = 1)
    }
}

@Preview(name = "Quiet · Light", widthDp = 390, heightDp = 1800)
@Composable
private fun QuietLightPreview() = DotTheme(ThemeMode.LIGHT) { QuietCatalogScreen {} }

@Preview(name = "Quiet · Dark", widthDp = 390, heightDp = 1800)
@Composable
private fun QuietDarkPreview() = DotTheme(ThemeMode.DARK) { QuietCatalogScreen {} }

@Preview(name = "Quiet · OLED", widthDp = 390, heightDp = 1800)
@Composable
private fun QuietOledPreview() = DotTheme(ThemeMode.OLED) { QuietCatalogScreen {} }
