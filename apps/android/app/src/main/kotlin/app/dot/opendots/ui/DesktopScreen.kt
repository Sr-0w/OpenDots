package app.dot.opendots.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material.icons.automirrored.outlined.KeyboardReturn
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.KeyboardTab
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.text.input.ImeAction
import app.dot.design.components.DotIconButton
import app.dot.design.components.DotTextField
import app.dot.design.rememberDotHaptics
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotShapes
import app.dot.design.DotSpacing
import app.dot.design.components.BackButton
import app.dot.design.components.ButtonStyle
import app.dot.design.components.DotButton
import app.dot.design.components.DotPrimaryButton
import app.dot.design.components.DotSpinner
import app.dot.design.components.DotTopBar
import app.dot.design.components.EmptyState
import app.dot.opendots.AppState
import app.dot.opendots.R
import app.dot.opendots.data.Agent
import app.dot.opendots.data.DesktopStatus
import app.dot.opendots.data.RfbSession
import app.dot.opendots.data.RfbSink
import kotlinx.coroutines.launch
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import okio.Pipe
import okio.buffer
import kotlin.concurrent.thread

private sealed interface Feed {
    data object Connecting : Feed
    data object Live : Feed
    data class Lost(val reason: String) : Feed
}

/** The live framebuffer of one companion's desktop. Pixels are written on the reader thread, drawn on the UI thread. */
private class DesktopFeed(private val app: AppState, private val agentId: String, private val password: String) : RfbSink {
    var state by mutableStateOf<Feed>(Feed.Connecting)
    var bitmap by mutableStateOf<Bitmap?>(null)
    var tick by mutableIntStateOf(0)
    @Volatile private var open = true
    @Volatile private var session: RfbSession? = null
    private var socket: WebSocket? = null

    fun start() {
        // The WebSocket delivers binary frames; a pipe turns them back into the byte stream RFB is.
        val pipe = Pipe(8L * 1024 * 1024)
        val sink = pipe.sink.buffer()
        socket = app.client.desktopSocket(agentId, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) { runCatching { sink.write(bytes); sink.flush() } }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { runCatching { sink.close() } }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (open) state = Feed.Lost(response?.let { "HTTP ${it.code}" } ?: t.message.orEmpty())
                runCatching { sink.close() }
            }
        })
        thread(name = "opendots-rfb", isDaemon = true) {
            try {
                RfbSession(pipe.source.buffer().inputStream(), { socket?.send(it.toByteString()) }, password, this).also { session = it }.run { open }
                if (open) state = Feed.Lost("")
            } catch (e: Exception) {
                if (open) state = Feed.Lost(e.message.orEmpty())
            }
        }
    }

    fun pointer(x: Int, y: Int, buttons: Int) { session?.pointer(x, y, buttons) }

    fun click(x: Int, y: Int, button: Int = 1) { pointer(x, y, button); pointer(x, y, 0) }

    fun type(text: String) {
        var index = 0
        while (index < text.length) {
            val codePoint = text.codePointAt(index)
            tap(RfbSession.keysymOf(codePoint))
            index += Character.charCount(codePoint)
        }
    }

    fun tap(keysym: Int) { session?.key(keysym, true); session?.key(keysym, false) }

    fun stop() {
        open = false
        socket?.close(1000, null)
    }

    override fun resize(width: Int, height: Int) { bitmap = Bitmap.createBitmap(width.coerceAtLeast(1), height.coerceAtLeast(1), Bitmap.Config.ARGB_8888) }

    override fun rect(x: Int, y: Int, width: Int, height: Int, pixels: IntArray) {
        val target = bitmap ?: return
        if (x + width <= target.width && y + height <= target.height) target.setPixels(pixels, 0, width, x, y, width, height)
    }

    override fun copy(srcX: Int, srcY: Int, x: Int, y: Int, width: Int, height: Int) {
        val target = bitmap ?: return
        if (srcX + width > target.width || srcY + height > target.height || x + width > target.width || y + height > target.height) return
        val pixels = IntArray(width * height)
        target.getPixels(pixels, 0, width, srcX, srcY, width, height)
        target.setPixels(pixels, 0, width, x, y, width, height)
    }

    override fun frame() { state = Feed.Live; tick++ }
}

/**
 * A companion's computer, live. By default you only watch (pinch to zoom, drag to pan, double-tap to reset), so looking
 * never disturbs its work. "Take control" pauses the companion's own desktop tools and turns touches into the mouse
 * (tap to click, long-press for a right click, drag to drag, two fingers to zoom and pan) with a field to type; control
 * is handed back when you say so or leave the screen.
 */
@Composable
fun DesktopScreen(app: AppState, agent: Agent, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var status by remember(agent.id) { mutableStateOf<DesktopStatus?>(null) }
    var error by remember(agent.id) { mutableStateOf<String?>(null) }
    var starting by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    val failed = stringResource(R.string.generic_error)

    LaunchedEffect(agent.id, attempt) {
        error = null
        runCatching { app.client.desktop(agent.id) }.onSuccess { status = it }.onFailure { error = it.message?.ifBlank { null } ?: failed }
    }

    Column(Modifier.fillMaxSize().background(Dot.colors.background)) {
        DotTopBar(
            title = stringResource(R.string.computer_title, agentDisplayName(agent)),
            subtitle = stringResource(R.string.computer_live),
            navigation = { BackButton(onBack) },
        )
        Box(Modifier.weight(1f).fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars), contentAlignment = Alignment.Center) {
            val current = status
            when {
                error != null -> EmptyState(Icons.Outlined.DesktopWindows, stringResource(R.string.computer_unavailable), error.orEmpty()) {
                    DotButton(stringResource(R.string.retry), { attempt++ }, style = ButtonStyle.Secondary)
                }
                current == null -> DotSpinner(size = 24.dp)
                !current.available -> EmptyState(Icons.Outlined.DesktopWindows, stringResource(R.string.computer_unavailable), stringResource(R.string.computer_no_docker))
                !current.running || current.vncPassword == null -> EmptyState(
                    Icons.Outlined.DesktopWindows,
                    stringResource(if (current.suspended) R.string.computer_paused else R.string.computer_off),
                    stringResource(R.string.computer_off_body, agentDisplayName(agent)),
                ) {
                    DotPrimaryButton(
                        stringResource(R.string.computer_start), loading = starting,
                        onClick = {
                            starting = true
                            scope.launch {
                                runCatching { app.client.startDesktop(agent.id) }.onSuccess { status = it }.onFailure { error = it.message?.ifBlank { null } ?: failed }
                                starting = false
                            }
                        },
                    )
                }
                else -> LiveDesktop(app, agent, current, onRetry = { attempt++ })
            }
        }
    }
}

@Composable
private fun LiveDesktop(app: AppState, agent: Agent, status: DesktopStatus, onRetry: () -> Unit) {
    val feed = remember(agent.id, status.vncPassword) { DesktopFeed(app, agent.id, status.vncPassword.orEmpty()) }
    DisposableEffect(feed) { feed.start(); onDispose { feed.stop() } }
    val scope = rememberCoroutineScope()
    val haptics = rememberDotHaptics()
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var control by remember(agent.id) { mutableStateOf(status.manualControl) }
    var switching by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    val label = stringResource(R.string.computer_title, agentDisplayName(agent))
    val failed = stringResource(R.string.generic_error)

    fun setControl(enabled: Boolean) {
        switching = true
        scope.launch {
            runCatching { app.client.setDesktopControl(agent.id, enabled) }
                .onSuccess { control = enabled; if (enabled) haptics.confirm() }
                .onFailure { app.notify(it.message?.ifBlank { null } ?: failed) }
            switching = false
        }
    }
    // Never leave the companion waiting on a human who has left the screen.
    val controlNow by rememberUpdatedState(control)
    DisposableEffect(agent.id) { onDispose { if (controlNow) app.releaseDesktopControl(agent.id) } }

    when (val state = feed.state) {
        is Feed.Lost -> EmptyState(Icons.Outlined.DesktopWindows, stringResource(R.string.computer_lost), state.reason) {
            DotButton(stringResource(R.string.retry), onRetry, style = ButtonStyle.Secondary)
        }
        else -> Column(Modifier.fillMaxSize().imePadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.weight(1f).fillMaxWidth().clip(DotShapes.small)
                    .then(
                        if (control) Modifier else Modifier
                            .pointerInput(Unit) {
                                detectTransformGestures { _, pan, zoom, _ ->
                                    scale = (scale * zoom).coerceIn(1f, 6f)
                                    val limit = Offset(size.width * (scale - 1f) / 2f, size.height * (scale - 1f) / 2f)
                                    offset = Offset((offset.x + pan.x).coerceIn(-limit.x, limit.x), (offset.y + pan.y).coerceIn(-limit.y, limit.y))
                                }
                            }
                            .pointerInput(Unit) { detectTapGestures(onDoubleTap = { scale = 1f; offset = Offset.Zero }) },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                val bitmap = feed.bitmap
                if (bitmap == null || state is Feed.Connecting) DotSpinner(size = 24.dp)
                if (bitmap != null) {
                    Canvas(
                        Modifier.fillMaxWidth().padding(horizontal = DotSpacing.s)
                            .aspectRatio(bitmap.width.toFloat() / bitmap.height)
                            .graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y }
                            .border(DotSpacing.hairline * 2, if (control) Dot.colors.accent else Dot.colors.border)
                            .then(
                                if (!control) Modifier else Modifier.pointerInput(bitmap.width, bitmap.height) {
                                    // Touches are in the picture's own (unscaled) space here, so they map straight to screen pixels.
                                    fun fx(p: Offset) = (p.x / size.width * bitmap.width).toInt()
                                    fun fy(p: Offset) = (p.y / size.height * bitmap.height).toInt()
                                    awaitEachGesture {
                                        val down = awaitFirstDown(requireUnconsumed = false)
                                        val start = down.position
                                        val startedAt = down.uptimeMillis
                                        var dragging = false
                                        var transforming = false
                                        var rightClicked = false
                                        while (true) {
                                            val event = withTimeoutOrNull(if (dragging || transforming || rightClicked) Long.MAX_VALUE / 4 else viewConfiguration.longPressTimeoutMillis) { awaitPointerEvent() }
                                            if (event == null) {
                                                // Held still: a right click.
                                                rightClicked = true
                                                haptics.tick()
                                                feed.click(fx(start), fy(start), button = 4)
                                                continue
                                            }
                                            val pressed = event.changes.filter { it.pressed }
                                            if (pressed.size >= 2) {
                                                if (dragging) { feed.pointer(fx(start), fy(start), 0); dragging = false }
                                                transforming = true
                                                scale = (scale * event.calculateZoom()).coerceIn(1f, 6f)
                                                val pan = event.calculatePan() * scale
                                                val limit = Offset(size.width * (scale - 1f) / 2f, size.height * (scale - 1f) / 2f)
                                                offset = Offset((offset.x + pan.x).coerceIn(-limit.x, limit.x), (offset.y + pan.y).coerceIn(-limit.y, limit.y))
                                                event.changes.forEach { it.consume() }
                                            } else if (pressed.size == 1 && !transforming && !rightClicked) {
                                                val position = pressed[0].position
                                                if (!dragging && (position - start).getDistance() > viewConfiguration.touchSlop) {
                                                    dragging = true
                                                    feed.pointer(fx(start), fy(start), 1)
                                                }
                                                if (dragging) { feed.pointer(fx(position), fy(position), 1); pressed[0].consume() }
                                            } else if (pressed.isEmpty()) {
                                                val last = event.changes.first().position
                                                if (dragging) feed.pointer(fx(last), fy(last), 0)
                                                else if (!transforming && !rightClicked && event.changes.first().uptimeMillis - startedAt < viewConfiguration.longPressTimeoutMillis) feed.click(fx(start), fy(start))
                                                break
                                            }
                                        }
                                    }
                                },
                            )
                            .semantics { contentDescription = label },
                    ) {
                        feed.tick // redraw on every framebuffer update
                        drawImage(bitmap.asImageBitmap(), dstOffset = IntOffset.Zero, dstSize = IntSize(size.width.toInt(), size.height.toInt()), filterQuality = FilterQuality.Medium)
                    }
                }
            }
            if (control) {
                Row(Modifier.fillMaxWidth().padding(horizontal = DotSpacing.m), verticalAlignment = Alignment.CenterVertically) {
                    DotTextField(
                        typed, { typed = it }, Modifier.weight(1f), placeholder = stringResource(R.string.computer_type),
                        imeAction = ImeAction.Send, onImeAction = { feed.type(typed); typed = "" },
                    )
                    DotIconButton(Icons.AutoMirrored.Outlined.KeyboardReturn, stringResource(R.string.computer_key_enter), onClick = { if (typed.isNotEmpty()) { feed.type(typed); typed = "" } else feed.tap(RfbSession.KEY_ENTER) })
                    DotIconButton(Icons.AutoMirrored.Outlined.Backspace, stringResource(R.string.computer_key_backspace), onClick = { feed.tap(RfbSession.KEY_BACKSPACE) })
                    DotIconButton(Icons.Outlined.KeyboardTab, stringResource(R.string.computer_key_tab), onClick = { feed.tap(RfbSession.KEY_TAB) })
                    DotIconButton(Icons.Outlined.Close, stringResource(R.string.computer_key_escape), onClick = { feed.tap(RfbSession.KEY_ESCAPE) })
                }
            }
            Row(Modifier.fillMaxWidth().padding(DotSpacing.m), verticalAlignment = Alignment.CenterVertically) {
                CompanionOrb(agent, size = 18.dp)
                Spacer(Modifier.width(DotSpacing.s))
                Text(
                    if (control) stringResource(R.string.computer_you_control, agentDisplayName(agent)) else agent.stateDetail?.takeIf { agent.busy } ?: agentStateLabel(agent.state),
                    style = Dot.type.caption, color = Dot.colors.textSecondary, maxLines = 2, modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(DotSpacing.s))
                if (control) DotButton(stringResource(R.string.computer_release), { setControl(false) }, style = ButtonStyle.Secondary, loading = switching, compact = true)
                else DotPrimaryButton(stringResource(R.string.computer_take), { setControl(true) }, loading = switching, compact = true)
            }
        }
    }
}
