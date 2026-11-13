package app.dot.opendots

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onAllNodesWithText
import kotlinx.coroutines.flow.StateFlow

@Composable
fun StateFlow<AppUiState>.collectAsStateForTest(): AppUiState { val value by collectAsState(); return value }

fun ComposeTestRule.onAllNodesWithTextCompat(text: String): Boolean =
    onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
