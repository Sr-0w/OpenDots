package app.dot.opendots

import android.content.Intent
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.dot.design.Dot
import app.dot.design.DotMotion
import app.dot.design.DotTheme
import app.dot.design.ThemeMode
import app.dot.design.catalog.QuietCatalogScreen
import app.dot.design.components.DotSnackbar
import app.dot.design.components.LocalReduceTransparency
import app.dot.design.rememberReducedMotion
import app.dot.opendots.ui.ApprovalsScreen
import app.dot.opendots.ui.ChatScreen
import app.dot.opendots.ui.CompanionSheet
import app.dot.opendots.ui.DesktopScreen
import app.dot.opendots.ui.DrawerContent
import app.dot.opendots.ui.OnboardingScreen
import app.dot.opendots.ui.ServerScreen
import app.dot.opendots.ui.SettingsScreen
import app.dot.opendots.ui.SignInScreen
import app.dot.opendots.ui.StartingScreen
import app.dot.opendots.ui.TasksScreen
import app.dot.opendots.ui.UnreachableScreen
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val app: AppState by viewModels {
        val application = application as OpenDotsApp
        AppState.Factory(application.store, application.client)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val ui by app.state.collectAsStateWithLifecycle()
            val mode = runCatching { ThemeMode.valueOf(ui.themeMode) }.getOrDefault(ThemeMode.SYSTEM)
            val dark = when (mode) { ThemeMode.SYSTEM -> isSystemInDarkTheme(); ThemeMode.LIGHT -> false; else -> true }
            // Transparent bars in every theme: the page (or the frosted header) shows through, icons follow the theme.
            DisposableEffect(dark) {
                val style = if (dark) SystemBarStyle.dark(AndroidColor.TRANSPARENT) else SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                if (android.os.Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
                onDispose {}
            }
            DotTheme(mode) {
                CompositionLocalProvider(LocalReduceTransparency provides ui.reduceTransparency) { OpenDotsRoot(app, ui) }
            }
        }
    }
}

private enum class Screen { Chat, Tasks, Approvals, Settings, Catalog, Desktop }

@Composable
fun OpenDotsRoot(app: AppState, ui: AppUiState) {
    // Realtime only while visible.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) app.setForeground(true) else if (event == Lifecycle.Event.ON_STOP) app.setForeground(false)
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    val snackbars = remember { SnackbarHostState() }
    val failed = stringResource(R.string.generic_error)
    LaunchedEffect(app) { app.notices.collect { snackbars.showSnackbar(if (it == AppState.FAILED) failed else it) } }

    Box(Modifier.fillMaxSize().background(Dot.colors.background)) {
        when (val stage = ui.stage) {
            Stage.Starting -> StartingScreen()
            Stage.Server -> ServerScreen(app, ui)
            is Stage.Unreachable -> UnreachableScreen(app, ui, stage.message)
            is Stage.SignIn -> SignInScreen(app, ui, stage.registrationOpen)
            is Stage.Onboarding -> OnboardingScreen(app, ui, stage.keyConfigured)
            Stage.Main -> MainScreens(app, ui)
        }
        SnackbarHost(
            snackbars,
            Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)).padding(bottom = 76.dp),
        ) { DotSnackbar(it) }
    }
}


@Composable
private fun MainScreens(app: AppState, ui: AppUiState) {
    var screen by rememberSaveable { mutableStateOf(Screen.Chat) }
    var companionSheet by rememberSaveable { mutableStateOf(false) }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val context = LocalContext.current
    val reduced = rememberReducedMotion()
    val openWeb = { ui.serverUrl.takeIf { it.isNotBlank() }?.let { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } }; Unit }

    fun go(next: Screen) { scope.launch { drawer.close() }; screen = next }

    // Predictive back: the system animates these; they only decide where "back" leads.
    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }
    BackHandler(enabled = screen != Screen.Chat && !drawer.isOpen) { screen = if (screen == Screen.Catalog) Screen.Settings else Screen.Chat }

    AnimatedContent(
        targetState = screen,
        transitionSpec = {
            if (reduced) fadeIn(DotMotion.spec(0)) togetherWith fadeOut(DotMotion.spec(0)) else {
                val forward = targetState.ordinal > initialState.ordinal
                (fadeIn(DotMotion.mediumSpec(easing = DotMotion.decelerate)) + slideInHorizontally(DotMotion.mediumSpec()) { if (forward) it / 12 else -it / 12 }) togetherWith
                    (fadeOut(DotMotion.fastSpec(easing = DotMotion.accelerate)) + slideOutHorizontally(DotMotion.fastSpec()) { if (forward) -it / 12 else it / 12 })
            }
        },
        label = "screen",
    ) { current ->
        when (current) {
            Screen.Chat -> ModalNavigationDrawer(
                drawerState = drawer,
                scrimColor = Dot.colors.scrim,
                drawerContent = {
                    DrawerContent(
                        ui,
                        onSelect = { agent -> app.selectAgent(agent.id); scope.launch { drawer.close() } },
                        onTasks = { go(Screen.Tasks) }, onApprovals = { go(Screen.Approvals) }, onSettings = { go(Screen.Settings) },
                    )
                },
            ) {
                val agent = ui.currentAgent
                if (agent == null) StartingScreen() else {
                    ChatScreen(app, ui, agent, onOpenDrawer = { keyboard?.hide(); scope.launch { drawer.open() } }, onOpenCompanion = { companionSheet = true })
                    if (companionSheet) CompanionSheet(agent, { companionSheet = false }, onOpenComputer = { companionSheet = false; screen = Screen.Desktop }) { patch -> app.updateAgent(agent.id, patch) }
                }
            }
            Screen.Tasks -> TasksScreen(app, ui) { screen = Screen.Chat }
            Screen.Approvals -> ApprovalsScreen(app, ui) { screen = Screen.Chat }
            Screen.Settings -> SettingsScreen(app, ui, onBack = { screen = Screen.Chat }, onOpenCatalog = { screen = Screen.Catalog }, onOpenWeb = openWeb)
            Screen.Catalog -> QuietCatalogScreen(onBack = { screen = Screen.Settings })
            Screen.Desktop -> ui.currentAgent?.let { DesktopScreen(app, it) { screen = Screen.Chat } } ?: StartingScreen()
        }
    }
}

