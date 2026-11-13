package app.dot.opendots.ui

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import app.dot.design.components.DotBottomSheet
import app.dot.design.components.DotCapsuleButton
import app.dot.design.components.DotFloatingCapsule
import app.dot.design.components.Hairline
import app.dot.design.components.dotShimmer
import app.dot.opendots.chat.presentAssistantTurn
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.toClipEntry
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.dot.design.Dot
import app.dot.design.DotShapes
import app.dot.design.DotSpacing
import app.dot.design.components.ButtonStyle
import app.dot.design.components.DotButton
import app.dot.design.components.DotCard
import app.dot.design.components.DotComposer
import app.dot.design.components.DotFrostedPill
import app.dot.design.components.DotIconButton
import app.dot.design.components.DotQuote
import app.dot.design.components.DotSpinner
import app.dot.design.components.DotThinking
import app.dot.design.components.EmptyState
import app.dot.design.R as DesignR
import app.dot.design.components.FrostedHeaderLayout
import app.dot.design.components.UnreadDot
import app.dot.design.components.backdropSource
import app.dot.design.components.rememberQuietBackdrop
import app.dot.design.rememberReducedMotion
import app.dot.opendots.AppState
import app.dot.opendots.AppUiState
import app.dot.opendots.R
import app.dot.opendots.chat.ChatUiState
import app.dot.opendots.data.Agent
import app.dot.opendots.data.Attachment
import app.dot.opendots.data.IMAGE_MAX_COUNT
import app.dot.opendots.data.ReplyRef
import app.dot.opendots.data.readImageForUpload
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private class PendingImage(val uri: Uri) {
    var attachment by mutableStateOf<Attachment?>(null)
    var failed by mutableStateOf(false)
}

@Composable
fun ChatScreen(app: AppState, ui: AppUiState, agent: Agent, onOpenDrawer: () -> Unit, onOpenCompanion: () -> Unit) {
    val session = remember(agent.id) { app.session(agent.id) }
    LaunchedEffect(session) { session.open() }
    val chat by session.state.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val backdrop = rememberQuietBackdrop()
    val listState = remember(agent.id) { androidx.compose.foundation.lazy.LazyListState() }
    var draft by rememberSaveable(agent.id) { mutableStateOf("") }
    var reply by remember(agent.id) { mutableStateOf<ReplyRef?>(null) }
    val images = remember(agent.id) { mutableStateListOf<PendingImage>() }
    var workSheet by remember(agent.id) { mutableStateOf(false) }
    val copied = stringResource(R.string.copied)
    val uploadFailed = stringResource(R.string.upload_failed)

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(IMAGE_MAX_COUNT)) { uris ->
        uris.take(IMAGE_MAX_COUNT - images.size).forEach { uri ->
            val pending = PendingImage(uri).also(images::add)
            scope.launch {
                try {
                    val encoded = readImageForUpload(context, uri)
                    pending.attachment = app.client.uploadImage(encoded.bytes, encoded.filename, encoded.mediaType)
                } catch (e: Exception) {
                    if (e is kotlin.coroutines.cancellation.CancellationException) throw e
                    pending.failed = true
                    app.notify(e.message?.takeIf { it.isNotBlank() } ?: uploadFailed)
                }
            }
        }
    }

    val env = remember(ui.agents, ui.approvals, ui.requests, ui.drafts, chat.busy, session) {
        MessageEnv(
            agents = ui.agents, approvals = ui.approvals, requests = ui.requests, drafts = ui.drafts, busy = chat.busy,
            resolveUrl = app.client::resolve,
            onCopy = { text -> scope.launch { clipboard.setClipEntry(ClipData.newPlainText("OpenDots", text).toClipEntry()); if (android.os.Build.VERSION.SDK_INT < 33) app.notify(copied) } },
            onReply = { reply = it },
            onReact = session::react,
            onDecide = { id, approve -> app.decide(id, approve) },
            onAnswer = { requestId, answers, summary ->
                session.send(summary, answer = buildJsonObject { put("requestId", requestId); put("answers", answers) })
            },
            onNeedRequest = app::ensureRequest,
            onNeedDraft = app::ensureDraft,
            onOpenWeb = { ui.serverUrl.takeIf { it.isNotBlank() }?.let { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } } },
            onOpenImage = { url -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } },
            onShowWork = { workSheet = true },
        )
    }

    // Newest first: the list is laid out from the bottom, so a growing reply stays anchored without any scroll jump.
    val rows = remember(chat.messages) { chat.messages.asReversed() }
    val lastAssistantId = remember(chat.messages) { chat.messages.lastOrNull { !it.isUser && it.meta.kind != "event" }?.id }
    val atLatest by remember(listState) { derivedStateOf { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 200 } }

    // Sending always brings the conversation back to the latest message.
    val newestUserId = chat.messages.lastOrNull { it.isUser }?.id
    LaunchedEffect(newestUserId) { if (newestUserId != null) listState.scrollToItem(0) }
    // Older history loads when the user nears the top.
    LaunchedEffect(listState, chat.cursor) {
        if (chat.cursor == null) return@LaunchedEffect
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last ->
            if (last >= listState.layoutInfo.totalItemsCount - 4) session.loadOlder()
        }
    }

    Column(Modifier.fillMaxSize().background(Dot.colors.background)) {
        Box(Modifier.weight(1f)) {
            FrostedHeaderLayout(
                backdrop = backdrop,
                header = { ChatHeader(agent, ui, onOpenDrawer, onOpenCompanion, onOpenWork = { workSheet = true }) },
            ) { padding ->
                val direction = LocalLayoutDirection.current
                // In landscape the navigation bar or a display cutout can sit beside the content.
                val sideInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal).asPaddingValues()
                LazyColumn(
                    state = listState,
                    reverseLayout = true,
                    verticalArrangement = Arrangement.Top,
                    contentPadding = PaddingValues(
                        start = DotSpacing.gutter + sideInsets.calculateStartPadding(direction),
                        end = DotSpacing.gutter + sideInsets.calculateEndPadding(direction),
                        top = padding.calculateTopPadding(), bottom = DotSpacing.l,
                    ),
                    modifier = Modifier.fillMaxSize().backdropSource(backdrop),
                ) {
                    chat.error?.let { message ->
                        item(key = "error") { TurnError(agentDisplayName(agent), message, session::dismissError, Modifier.padding(top = DotSpacing.xl)) }
                    }
                    // The thread only shows *that* the companion works and on what; the detail lives in the work panel.
                    if (chat.busy) item(key = "live") {
                        val step = liveStepLabel(chat.messages.lastOrNull())
                        LiveStatus(
                            agent,
                            label = step?.first ?: agent.stateDetail ?: (agentStateLabel(if (agent.state == "available") "thinking" else agent.state) + "…"),
                            actions = step?.second ?: 0,
                            onClick = { workSheet = true },
                            modifier = Modifier.padding(top = DotSpacing.l),
                        )
                    }
                    items(rows, key = { it.id }, contentType = { if (it.isUser) 0 else 1 }) { message ->
                        MessageItem(
                            message, env,
                            streaming = chat.busy && message.id == rows.firstOrNull()?.id && !message.isUser,
                            showActions = message.id == lastAssistantId,
                            modifier = Modifier.padding(top = DotSpacing.l).widthIn(max = 720.dp),
                        )
                    }
                    if (chat.loadingOlder) item(key = "older") {
                        Box(Modifier.fillMaxWidth().padding(DotSpacing.l), contentAlignment = Alignment.Center) { DotSpinner() }
                    }
                }
            }

            when {
                chat.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { DotSpinner(size = 24.dp) }
                chat.loadError != null && chat.messages.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(Icons.Outlined.ErrorOutline, stringResource(R.string.load_failed), chat.loadError.orEmpty()) {
                        DotButton(stringResource(R.string.retry), session::open, style = ButtonStyle.Secondary)
                    }
                }
                chat.messages.isEmpty() && !chat.busy -> EmptyConversation(agent, Modifier.align(Alignment.Center))
            }

            val reduced = rememberReducedMotion()
            androidx.compose.animation.AnimatedVisibility(
                visible = !atLatest,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = DotSpacing.m),
                enter = if (reduced) fadeIn() else fadeIn() + scaleIn(initialScale = 0.9f),
                exit = if (reduced) fadeOut() else fadeOut() + scaleOut(targetScale = 0.9f),
            ) {
                DotFrostedPill(
                    Icons.Outlined.ArrowDownward, onClick = { scope.launch { listState.animateScrollToItem(0) } },
                    contentDescription = stringResource(DesignR.string.ds_scroll_to_latest), backdrop = backdrop,
                )
            }
        }

        if (workSheet) WorkSheet(agent, chat, env) { workSheet = false }

        // The composer sits on the page itself: a stable surface, no blur and no gradient band underneath.
        val ready = images.all { it.attachment != null || it.failed }
        Box(
            Modifier.fillMaxWidth()
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))
                .padding(horizontal = DotSpacing.m).padding(bottom = DotSpacing.s),
            contentAlignment = Alignment.Center,
        ) {
            DotComposer(
                value = draft,
                onValueChange = { draft = it },
                modifier = Modifier.widthIn(max = 720.dp),
                placeholder = if (agent.named) stringResource(R.string.write_to, agent.name) else stringResource(R.string.write_to_companion),
                busy = chat.busy,
                canSend = ready && (draft.isNotBlank() || images.any { it.attachment != null }),
                onStop = session::stop,
                onSend = {
                    session.send(draft, images.mapNotNull { it.attachment }, reply)
                    draft = ""; reply = null; images.clear()
                },
                header = if (reply == null && images.isEmpty()) null else {
                    {
                        reply?.let { target ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                DotQuote(if (target.role == "user") stringResource(R.string.you) else agentDisplayName(agent), target.preview, Modifier.weight(1f))
                                DotIconButton(Icons.Outlined.Close, stringResource(R.string.cancel_reply), onClick = { reply = null }, tint = Dot.colors.textSecondary)
                            }
                        }
                        if (images.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = DotSpacing.xs), horizontalArrangement = Arrangement.spacedBy(DotSpacing.s)) {
                            images.forEach { image -> ImageThumb(image) { images.remove(image) } }
                        }
                    }
                },
                leading = {
                    DotIconButton(
                        Icons.Outlined.Add, stringResource(R.string.attach_image),
                        onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        tint = Dot.colors.textSecondary, enabled = images.size < IMAGE_MAX_COUNT,
                    )
                },
            )
        }
    }
}

/**
 * The conversation header floats on the progressive blur: navigation on one side, the companion's own controls on the
 * other, and in the middle the companion itself - its dot, with its name on a small glass pill underneath.
 */
@Composable
private fun ChatHeader(agent: Agent, ui: AppUiState, onOpenDrawer: () -> Unit, onOpenCompanion: () -> Unit, onOpenWork: () -> Unit) {
    val c = Dot.colors
    val elsewhere = ui.agents.any { it.id != agent.id && it.unread > 0 } || ui.pendingApprovals.isNotEmpty()
    val name = agentDisplayName(agent)
    val status = when {
        !ui.connected -> stringResource(R.string.reconnecting)
        agent.state == "error" -> agentStateLabel("error")
        ui.paused -> stringResource(R.string.paused_short)
        else -> null
    }
    Box(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.statusBars).padding(horizontal = DotSpacing.m, vertical = 6.dp)) {
        Box(Modifier.align(Alignment.TopStart)) {
            DotIconButton(Icons.Outlined.Menu, stringResource(R.string.menu), onClick = onOpenDrawer)
            if (elsewhere) UnreadDot(Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = 9.dp))
        }
        Column(
            Modifier.align(Alignment.TopCenter).padding(horizontal = 112.dp).clip(DotShapes.large)
                .clickable(role = Role.Button, onClickLabel = stringResource(R.string.companion_details), onClick = onOpenCompanion),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            CompanionOrb(agent, size = 48.dp)
            Row(
                Modifier.padding(top = 4.dp).clip(DotShapes.pill)
                    .background(c.surfaceRaised.copy(alpha = 0.92f))
                    .border(DotSpacing.hairline * 2, c.border, DotShapes.pill)
                    .padding(horizontal = DotSpacing.m, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(name, style = Dot.type.label, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false).semantics { heading() })
                if (status != null) Text("  ·  $status", style = Dot.type.caption, color = if (agent.state == "error" && ui.connected) c.danger else c.textTertiary, maxLines = 1)
            }
        }
        DotFloatingCapsule(Modifier.align(Alignment.TopEnd)) {
            DotCapsuleButton(Icons.Outlined.Checklist, stringResource(R.string.work), onOpenWork)
            DotCapsuleButton(Icons.Outlined.Tune, stringResource(R.string.companion_details), onOpenCompanion)
        }
    }
}

/** While the companion works: its dot, animated, and one sentence saying what it is doing right now. Opens the work panel. */
@Composable
private fun LiveStatus(agent: Agent, label: String, actions: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.clip(DotShapes.pill).clickable(role = Role.Button, onClickLabel = stringResource(R.string.show_work), onClick = onClick)
            .heightIn(min = 40.dp).padding(end = DotSpacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompanionOrb(parseAgentColor(agent.color), size = 22.dp, state = if (agent.busy) agent.state else "thinking", named = agent.named)
        Spacer(Modifier.width(DotSpacing.s + 2.dp))
        Text(label, style = Dot.type.callout, color = Dot.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false).dotShimmer())
        if (actions > 0) Text("  ·  " + pluralStringResource(R.plurals.actions, actions, actions), style = Dot.type.caption, color = Dot.colors.textTertiary, maxLines = 1)
    }
}

/** The work panel: what the companion reasoned and which tools it used, turn by turn, each folded by default. */
@Composable
private fun WorkSheet(agent: Agent, chat: ChatUiState, env: MessageEnv, onDismiss: () -> Unit) {
    val turns = remember(chat.messages) {
        chat.messages.filter { !it.isUser && it.meta.kind != "event" }.map { it to presentAssistantTurn(it) }.filter { it.second.hasWork }.asReversed()
    }
    val streamingId = if (chat.busy) chat.messages.lastOrNull()?.takeIf { !it.isUser }?.id else null
    DotBottomSheet(onDismiss) {
        Text(stringResource(R.string.work_title, agentDisplayName(agent)), style = Dot.type.title, color = Dot.colors.textPrimary, modifier = Modifier.padding(horizontal = DotSpacing.gutter, vertical = DotSpacing.s).semantics { heading() })
        if (turns.isEmpty()) {
            EmptyState(Icons.Outlined.Checklist, stringResource(R.string.work_empty_title), stringResource(R.string.work_empty_body))
        } else LazyColumn(contentPadding = PaddingValues(start = DotSpacing.gutter, end = DotSpacing.gutter, bottom = DotSpacing.xxl)) {
            items(turns, key = { it.first.id }) { (message, turn) ->
                TurnWorkDisclosure(message, turn, streaming = message.id == streamingId, env = env, initiallyOpen = message.id == streamingId)
                Hairline()
            }
        }
    }
}

@Composable
private fun EmptyConversation(agent: Agent, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = DotSpacing.xxxl), horizontalAlignment = Alignment.CenterHorizontally) {
        CompanionOrb(agent, size = 72.dp)
        Spacer(Modifier.size(DotSpacing.xl))
        Text(
            if (agent.named) stringResource(R.string.empty_named_title, agent.name) else stringResource(R.string.empty_new_title),
            style = Dot.type.title, color = Dot.colors.textPrimary, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.size(DotSpacing.s))
        Text(
            if (agent.named) agent.description.ifBlank { stringResource(R.string.empty_named_body) } else stringResource(R.string.empty_new_body),
            style = Dot.type.callout, color = Dot.colors.textSecondary, textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun TurnError(name: String, message: String, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    DotCard(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.ErrorOutline, null, Modifier.padding(top = 2.dp).size(18.dp), tint = Dot.colors.danger)
            Spacer(Modifier.width(DotSpacing.m))
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.turn_failed, name), style = Dot.type.bodyStrong, color = Dot.colors.textPrimary)
                if (message.isNotBlank()) Text(message, style = Dot.type.caption, color = Dot.colors.textSecondary, maxLines = 6, overflow = TextOverflow.Ellipsis)
            }
            DotIconButton(Icons.Outlined.Close, stringResource(R.string.close), onClick = onDismiss, tint = Dot.colors.textSecondary)
        }
    }
}

@Composable
private fun ImageThumb(image: PendingImage, onRemove: () -> Unit) {
    val c = Dot.colors
    val remove = stringResource(R.string.remove_image)
    Box(Modifier.size(64.dp)) {
        AsyncImage(
            model = image.uri, contentDescription = stringResource(R.string.attached_image), contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().clip(DotShapes.medium).border(DotSpacing.hairline * 2, if (image.failed) c.danger else c.border, DotShapes.medium),
        )
        if (image.attachment == null && !image.failed) {
            Box(Modifier.fillMaxSize().clip(DotShapes.medium).background(c.scrim), contentAlignment = Alignment.Center) { DotSpinner(size = 18.dp, color = Color.White) }
        }
        Box(
            Modifier.align(Alignment.TopEnd).size(28.dp).clip(DotShapes.circle).clickable(role = Role.Button, onClick = onRemove).semantics { contentDescription = remove },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(20.dp).clip(DotShapes.circle).background(c.inverse), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Close, null, Modifier.size(13.dp), tint = c.onInverse)
            }
        }
    }
}
