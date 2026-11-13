package app.dot.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import app.dot.design.Dot
import app.dot.design.DotColors
import app.dot.design.DotShapes
import app.dot.design.DotSpacing

/*
 * A small Markdown renderer for conversation text, drawn with Quiet tokens only (no WebView, no HTML).
 *
 * It is built for streaming: blocks are keyed by position, so while a reply grows only its last block recomposes, and
 * constructs that are still open (a code fence, bold, inline code) are rendered as if already closed, so the text never
 * flips between raw markers and formatting when the closing marker arrives.
 */

@Immutable
sealed interface MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Paragraph(val text: String) : MdBlock
    data class Code(val language: String, val code: String) : MdBlock
    data class ListItem(val depth: Int, val marker: String, val text: String) : MdBlock
    data class Quote(val text: String) : MdBlock
    data class Table(val header: List<String>, val rows: List<List<String>>) : MdBlock
    data object Rule : MdBlock
}

private val HEADING = Regex("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")
private val FENCE = Regex("^\\s{0,3}(```+|~~~+)\\s*([\\w+#.-]*)\\s*$")
private val BULLET = Regex("^(\\s*)([-*+])\\s+(.*)$")
private val ORDERED = Regex("^(\\s*)(\\d{1,9})[.)]\\s+(.*)$")
private val RULE = Regex("^\\s{0,3}([-*_])(\\s*\\1){2,}\\s*$")
private val TABLE_DIVIDER = Regex("^\\s*\\|?\\s*:?-{1,}:?\\s*(\\|\\s*:?-{1,}:?\\s*)*\\|?\\s*$")

private fun tableCells(line: String): List<String> =
    line.trim().removePrefix("|").removeSuffix("|").split(Regex("(?<!\\\\)\\|")).map { it.trim().replace("\\|", "|") }

/** Splits Markdown source into blocks. Pure and fast enough to run on every streamed delta. */
fun parseMarkdown(source: String): List<MdBlock> {
    val lines = source.replace("\r\n", "\n").split('\n')
    val out = ArrayList<MdBlock>()
    val para = StringBuilder()
    fun flush() {
        if (para.isNotBlank()) out += MdBlock.Paragraph(para.toString().trim('\n'))
        para.setLength(0)
    }
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val fence = FENCE.matchEntire(line)
        if (fence != null) {
            flush()
            val marker = fence.groupValues[1]
            val code = StringBuilder()
            i++
            while (i < lines.size && !(lines[i].trim().startsWith(marker.take(3)) && lines[i].trim().all { it == marker[0] })) {
                code.append(lines[i]).append('\n')
                i++
            }
            i++ // closing fence (or end of a reply still streaming)
            out += MdBlock.Code(fence.groupValues[2], code.toString().trimEnd('\n'))
            continue
        }
        if (line.isBlank()) { flush(); i++; continue }
        if (RULE.matches(line)) { flush(); out += MdBlock.Rule; i++; continue }
        val heading = HEADING.matchEntire(line)
        if (heading != null) {
            flush()
            out += MdBlock.Heading(heading.groupValues[1].length, heading.groupValues[2])
            i++; continue
        }
        if (line.trimStart().startsWith(">")) {
            flush()
            val quote = StringBuilder()
            while (i < lines.size && lines[i].trimStart().startsWith(">")) {
                quote.append(lines[i].trimStart().removePrefix(">").removePrefix(" ")).append('\n')
                i++
            }
            out += MdBlock.Quote(quote.toString().trim('\n'))
            continue
        }
        if ('|' in line && i + 1 < lines.size && TABLE_DIVIDER.matches(lines[i + 1]) && '-' in lines[i + 1]) {
            flush()
            val header = tableCells(line)
            val rows = ArrayList<List<String>>()
            i += 2
            while (i < lines.size && '|' in lines[i] && lines[i].isNotBlank()) { rows += tableCells(lines[i]); i++ }
            out += MdBlock.Table(header, rows)
            continue
        }
        val bullet = BULLET.matchEntire(line)
        val ordered = if (bullet == null) ORDERED.matchEntire(line) else null
        if (bullet != null || ordered != null) {
            flush()
            val m = (bullet ?: ordered)!!
            val depth = (m.groupValues[1].replace("\t", "    ").length / 2).coerceAtMost(4)
            val text = StringBuilder(m.groupValues[3])
            i++
            // Lazy continuation lines belong to the item.
            while (i < lines.size && lines[i].isNotBlank() && lines[i].startsWith("  ") &&
                BULLET.matchEntire(lines[i]) == null && ORDERED.matchEntire(lines[i]) == null && FENCE.matchEntire(lines[i]) == null
            ) { text.append('\n').append(lines[i].trim()); i++ }
            out += MdBlock.ListItem(depth, if (bullet != null) "•" else "${m.groupValues[2]}.", text.toString())
            continue
        }
        if (para.isNotEmpty()) para.append('\n')
        para.append(line)
        i++
    }
    flush()
    return out
}

@Immutable
internal data class MdInlineStyle(val code: SpanStyle, val link: TextLinkStyles)

private fun inlineStyle(c: DotColors) = MdInlineStyle(
    code = SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 0.9.em, background = c.surfaceRaised),
    link = TextLinkStyles(SpanStyle(color = c.accent, textDecoration = TextDecoration.Underline)),
)

private val BARE_URL = Regex("^https?://[^\\s<>()\\[\\]]+[^\\s<>()\\[\\].,;:!?'\"]")

/** Inline Markdown to an [AnnotatedString]. Unclosed emphasis and code run to the end of the text (see file comment). */
internal fun parseInline(text: String, style: MdInlineStyle): AnnotatedString = buildAnnotatedString { appendInline(text, style) }

private fun AnnotatedString.Builder.appendInline(text: String, style: MdInlineStyle) {
    var i = 0
    val n = text.length
    fun wordChar(index: Int) = index in 0 until n && text[index].isLetterOrDigit()
    while (i < n) {
        val ch = text[i]
        when {
            ch == '\\' && i + 1 < n && text[i + 1] in "\\`*_{}[]()#+-.!~|>" -> { append(text[i + 1]); i += 2 }
            ch == '`' -> {
                val ticks = text.substring(i).takeWhile { it == '`' }.length
                val close = text.indexOf("`".repeat(ticks), i + ticks)
                val end = if (close < 0) n else close
                pushStyle(style.code)
                append(' '); append(text.substring(i + ticks, end).trim()); append(' ')
                pop()
                i = if (close < 0) n else close + ticks
            }
            (ch == '*' || ch == '_') && i + 1 < n && text[i + 1] == ch -> {
                val marker = "$ch$ch"
                if (ch == '_' && wordChar(i - 1)) { append(marker); i += 2 } else {
                    val close = text.indexOf(marker, i + 2)
                    val end = if (close < 0) n else close
                    if (end == i + 2) { append(marker); i += 2 } else {
                        pushStyle(SpanStyle(fontWeight = FontWeight.SemiBold))
                        appendInline(text.substring(i + 2, end), style)
                        pop()
                        i = if (close < 0) n else close + 2
                    }
                }
            }
            ch == '~' && i + 1 < n && text[i + 1] == '~' -> {
                val close = text.indexOf("~~", i + 2)
                if (close < 0) { append("~~"); i += 2 } else {
                    pushStyle(SpanStyle(textDecoration = TextDecoration.LineThrough))
                    appendInline(text.substring(i + 2, close), style)
                    pop()
                    i = close + 2
                }
            }
            (ch == '*' || ch == '_') && i + 1 < n && !text[i + 1].isWhitespace() && !(ch == '_' && wordChar(i - 1)) -> {
                var close = i + 1
                while (true) {
                    close = text.indexOf(ch, close)
                    if (close < 0) break
                    val doubled = close + 1 < n && text[close + 1] == ch
                    if (doubled) { close += 2; continue }
                    if (!text[close - 1].isWhitespace() && !(ch == '_' && wordChar(close + 1))) break
                    close++
                }
                if (close < 0) { append(ch); i++ } else {
                    pushStyle(SpanStyle(fontStyle = FontStyle.Italic))
                    appendInline(text.substring(i + 1, close), style)
                    pop()
                    i = close + 1
                }
            }
            ch == '[' -> {
                val closeLabel = text.indexOf(']', i + 1)
                val openUrl = if (closeLabel > 0 && closeLabel + 1 < n && text[closeLabel + 1] == '(') closeLabel + 1 else -1
                val closeUrl = if (openUrl > 0) text.indexOf(')', openUrl) else -1
                if (closeUrl > 0) {
                    val url = text.substring(openUrl + 1, closeUrl).trim().substringBefore(' ')
                    val safe = url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")
                    if (safe) pushLink(LinkAnnotation.Url(url, style.link))
                    appendInline(text.substring(i + 1, closeLabel), style)
                    if (safe) pop()
                    i = closeUrl + 1
                } else { append(ch); i++ }
            }
            ch == 'h' && !wordChar(i - 1) && (text.startsWith("http://", i) || text.startsWith("https://", i)) -> {
                val url = BARE_URL.find(text.substring(i))?.value
                if (url == null) { append(ch); i++ } else {
                    pushLink(LinkAnnotation.Url(url, style.link)); append(url); pop()
                    i += url.length
                }
            }
            else -> { append(ch); i++ }
        }
    }
}

private fun gapBefore(previous: MdBlock?, block: MdBlock): Dp = when {
    previous == null -> 0.dp
    block is MdBlock.Heading -> DotSpacing.xl
    previous is MdBlock.ListItem && block is MdBlock.ListItem -> 6.dp
    previous is MdBlock.Heading -> DotSpacing.s
    else -> DotSpacing.m
}

/** Renders Markdown [text] with Quiet typography. [onCopyCode] adds a copy action to code blocks. */
@Composable
fun DotMarkdown(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = Dot.type.body,
    color: Color = Dot.colors.textPrimary,
    onCopyCode: ((String) -> Unit)? = null,
) {
    val blocks = remember(text) { parseMarkdown(text) }
    val c = Dot.colors
    val inline = remember(c) { inlineStyle(c) }
    Column(modifier) {
        blocks.forEachIndexed { index, block ->
            key(index) {
                val gap = gapBefore(blocks.getOrNull(index - 1), block)
                if (gap > 0.dp) Spacer(Modifier.height(gap))
                MdBlockView(block, style, color, inline, onCopyCode)
            }
        }
    }
}

@Composable
private fun MdText(source: String, style: TextStyle, color: Color, inline: MdInlineStyle, modifier: Modifier = Modifier) {
    val annotated = remember(source, inline) { parseInline(source, inline) }
    Text(annotated, style = style, color = color, modifier = modifier)
}

@Composable
private fun MdBlockView(block: MdBlock, style: TextStyle, color: Color, inline: MdInlineStyle, onCopyCode: ((String) -> Unit)?) {
    val c = Dot.colors
    when (block) {
        is MdBlock.Paragraph -> MdText(block.text, style, color, inline)
        is MdBlock.Heading -> MdText(
            block.text,
            when (block.level) { 1 -> Dot.type.title; 2 -> Dot.type.title.copy(fontSize = Dot.type.title.fontSize * 0.9f); else -> Dot.type.headline },
            color, inline, Modifier.semantics { heading() },
        )
        is MdBlock.Code -> DotCodeBlock(block.code, title = block.language.ifBlank { null }, onCopy = onCopyCode?.let { copy -> { copy(block.code) } })
        is MdBlock.ListItem -> Row(Modifier.padding(start = (block.depth * 16).dp)) {
            Text(block.marker, style = style, color = c.textTertiary, modifier = Modifier.width(if (block.marker == "•") 16.dp else 26.dp))
            MdText(block.text, style, color, inline, Modifier.weight(1f))
        }
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(2.dp).fillMaxHeight().clip(DotShapes.pill).background(c.borderStrong))
            MdText(block.text, style, c.textSecondary, inline, Modifier.padding(start = DotSpacing.m))
        }
        MdBlock.Rule -> Hairline(Modifier.padding(vertical = DotSpacing.xs))
        is MdBlock.Table -> MdTable(block, inline)
    }
}

@Composable
private fun MdTable(table: MdBlock.Table, inline: MdInlineStyle) {
    val c = Dot.colors
    val columns = maxOf(table.header.size, table.rows.maxOfOrNull { it.size } ?: 0)
    val wide = columns > 3
    Column(
        Modifier
            .then(if (wide) Modifier.horizontalScroll(rememberScrollState()) else Modifier.fillMaxWidth())
            .clip(DotShapes.medium)
            .border(DotSpacing.hairline * 2, c.border, DotShapes.medium),
    ) {
        @Composable
        fun line(cells: List<String>, header: Boolean) {
            Row(if (header) Modifier.background(c.surface) else Modifier) {
                for (col in 0 until columns) {
                    MdText(
                        cells.getOrElse(col) { "" },
                        if (header) Dot.type.label else Dot.type.callout,
                        if (header) c.textSecondary else c.textPrimary,
                        inline,
                        (if (wide) Modifier.width(148.dp) else Modifier.weight(1f)).padding(horizontal = DotSpacing.m, vertical = DotSpacing.s),
                    )
                }
            }
        }
        line(table.header, header = true)
        table.rows.forEach { row -> Hairline(); line(row, header = false) }
    }
}
