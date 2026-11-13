package app.dot.opendots.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.dot.design.Dot
import app.dot.design.DotShapes
import app.dot.design.DotSpacing
import app.dot.design.components.ButtonStyle
import app.dot.design.components.DotButton
import app.dot.design.components.DotCheckbox
import app.dot.design.components.DotPrimaryButton
import app.dot.design.components.DotSpinner
import app.dot.design.components.DotTextField
import app.dot.design.components.EmptyState
import app.dot.design.components.SearchField
import app.dot.opendots.AppState
import app.dot.opendots.AppUiState
import app.dot.opendots.R
import app.dot.opendots.data.ModelInfo

@Composable
private fun formError(raw: String?): String? = when (raw) {
    null -> null
    AppState.INVALID_URL -> stringResource(R.string.server_invalid)
    else -> raw.ifBlank { stringResource(R.string.generic_error) }
}

/** The calm frame of every "before the conversation" screen: one orb, one title, one sentence, then the form. */
@Composable
private fun Gate(title: String, body: String, scroll: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    Box(
        Modifier.fillMaxSize().background(Dot.colors.background).windowInsetsPadding(WindowInsets.safeDrawing.union(WindowInsets.ime)),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier.widthIn(max = 440.dp).fillMaxWidth()
                .then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                .padding(horizontal = DotSpacing.xxl).padding(top = 56.dp, bottom = DotSpacing.xxl),
        ) {
            CompanionOrb(Dot.colors.inverse, size = 44.dp, named = false)
            Spacer(Modifier.height(DotSpacing.xxl))
            Text(title, style = Dot.type.display, color = Dot.colors.textPrimary, modifier = Modifier.semantics { heading() })
            Spacer(Modifier.height(DotSpacing.s))
            Text(body, style = Dot.type.body, color = Dot.colors.textSecondary)
            Spacer(Modifier.height(DotSpacing.xxl))
            content()
        }
    }
}

@Composable
fun StartingScreen() {
    Box(Modifier.fillMaxSize().background(Dot.colors.background), contentAlignment = Alignment.Center) { DotSpinner(size = 24.dp) }
}

@Composable
fun ServerScreen(app: AppState, ui: AppUiState) {
    var url by rememberSaveable { mutableStateOf(ui.serverUrl) }
    Gate(stringResource(R.string.server_title), stringResource(R.string.server_body)) {
        DotTextField(
            url, { url = it }, label = stringResource(R.string.server_address), placeholder = "opendots.example.com",
            keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, onImeAction = { app.chooseServer(url) },
            isError = ui.formError != null, supporting = formError(ui.formError) ?: stringResource(R.string.server_hint),
        )
        Spacer(Modifier.height(DotSpacing.xl))
        DotPrimaryButton(stringResource(R.string.continue_), { app.chooseServer(url) }, Modifier.fillMaxWidth(), enabled = url.isNotBlank(), loading = ui.busy)
    }
}

@Composable
fun UnreachableScreen(app: AppState, ui: AppUiState, message: String) {
    Box(Modifier.fillMaxSize().background(Dot.colors.background).windowInsetsPadding(WindowInsets.safeDrawing), contentAlignment = Alignment.Center) {
        EmptyState(Icons.Outlined.CloudOff, stringResource(R.string.unreachable_title), stringResource(R.string.unreachable_body, ui.serverUrl) + if (message.isBlank()) "" else "\n$message") {
            Row {
                DotButton(stringResource(R.string.change_server), app::changeServer, style = ButtonStyle.Ghost)
                Spacer(Modifier.padding(DotSpacing.xs))
                DotPrimaryButton(stringResource(R.string.retry), app::start)
            }
        }
    }
}

@Composable
fun SignInScreen(app: AppState, ui: AppUiState, registrationOpen: Boolean) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var register by rememberSaveable { mutableStateOf(false) }
    val submit = { if (email.isNotBlank() && password.isNotEmpty()) app.signIn(email, password, register) }
    Gate(stringResource(if (register) R.string.register_title else R.string.sign_in_title), stringResource(R.string.sign_in_body, ui.serverUrl.removePrefix("https://").removePrefix("http://").trimEnd('/'))) {
        DotTextField(email, { email = it }, label = stringResource(R.string.email), keyboardType = KeyboardType.Email, contentType = ContentType.EmailAddress + ContentType.Username)
        Spacer(Modifier.height(DotSpacing.l))
        DotTextField(
            password, { password = it }, label = stringResource(R.string.password), password = true,
            contentType = if (register) ContentType.NewPassword else ContentType.Password,
            imeAction = ImeAction.Go, onImeAction = submit,
            isError = ui.formError != null, supporting = formError(ui.formError) ?: if (register) stringResource(R.string.password_hint) else null,
        )
        Spacer(Modifier.height(DotSpacing.xl))
        DotPrimaryButton(stringResource(if (register) R.string.create_account else R.string.sign_in), submit, Modifier.fillMaxWidth(), enabled = email.isNotBlank() && password.isNotEmpty(), loading = ui.busy)
        Spacer(Modifier.height(DotSpacing.s))
        if (registrationOpen) DotButton(stringResource(if (register) R.string.have_account else R.string.no_account), { register = !register }, Modifier.fillMaxWidth(), style = ButtonStyle.Ghost)
        DotButton(stringResource(R.string.change_server), app::changeServer, Modifier.fillMaxWidth(), style = ButtonStyle.Ghost)
    }
}

@Composable
fun OnboardingScreen(app: AppState, ui: AppUiState, keyConfigured: Boolean) {
    if (!keyConfigured) {
        var key by rememberSaveable { mutableStateOf("") }
        Gate(stringResource(R.string.onboarding_key_title), stringResource(R.string.onboarding_key_body)) {
            DotTextField(
                key, { key = it.trim() }, label = stringResource(R.string.openrouter_key), placeholder = "sk-or-…", password = true,
                imeAction = ImeAction.Go, onImeAction = { if (key.length >= 10) app.saveKey(key) },
                isError = ui.formError != null, supporting = formError(ui.formError) ?: stringResource(R.string.openrouter_key_hint),
            )
            Spacer(Modifier.height(DotSpacing.xl))
            DotPrimaryButton(stringResource(R.string.continue_), { app.saveKey(key) }, Modifier.fillMaxWidth(), enabled = key.length >= 10, loading = ui.busy)
            Spacer(Modifier.height(DotSpacing.s))
            DotButton(stringResource(R.string.sign_out), app::signOut, Modifier.fillMaxWidth(), style = ButtonStyle.Ghost)
        }
        return
    }
    var models by remember { mutableStateOf<List<ModelInfo>?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { app.models() }.onSuccess { list -> models = list.filter { it.tools } }.onFailure { loadError = it.message.orEmpty() }
    }
    val shown = remember(models, query) {
        val q = query.trim().lowercase()
        models.orEmpty().filter { q.isEmpty() || q in it.id.lowercase() || q in it.name.lowercase() }.take(80)
    }
    Gate(stringResource(R.string.onboarding_model_title), stringResource(R.string.onboarding_model_body), scroll = false) {
        SearchField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = stringResource(R.string.search_models))
        Spacer(Modifier.height(DotSpacing.m))
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                loadError != null -> Text(formError(loadError).orEmpty(), style = Dot.type.callout, color = Dot.colors.danger)
                models == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { DotSpinner(size = 24.dp) }
                else -> LazyColumn {
                    items(shown, key = { it.id }) { model ->
                        val isSelected = model.id == selected
                        Row(
                            Modifier.fillMaxWidth().clip(DotShapes.medium).background(if (isSelected) Dot.colors.surfaceRaised else Color.Transparent)
                                .selectable(isSelected, role = Role.RadioButton) { selected = model.id }
                                .heightIn(min = 56.dp).padding(horizontal = DotSpacing.m, vertical = DotSpacing.s),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(model.name.ifBlank { model.id }, style = Dot.type.bodyStrong, color = Dot.colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(model.id, style = Dot.type.caption.copy(fontFamily = FontFamily.Monospace), color = Dot.colors.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            DotCheckbox(isSelected, Modifier.padding(start = DotSpacing.m))
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(DotSpacing.m))
        formError(ui.formError)?.let { Text(it, style = Dot.type.caption, color = Dot.colors.danger, modifier = Modifier.padding(bottom = DotSpacing.s)) }
        DotPrimaryButton(stringResource(R.string.meet_companion), { selected?.let(app::finishOnboarding) }, Modifier.fillMaxWidth(), enabled = selected != null, loading = ui.busy)
    }
}
