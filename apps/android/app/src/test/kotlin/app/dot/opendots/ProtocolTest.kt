package app.dot.opendots

import app.dot.design.components.MdBlock
import app.dot.design.components.parseMarkdown
import app.dot.opendots.chat.Bubble
import app.dot.opendots.chat.cleanModelText
import app.dot.opendots.chat.presentAssistantTurn
import app.dot.opendots.data.OdJson
import app.dot.opendots.data.Part
import app.dot.opendots.data.TurnAssembler
import app.dot.opendots.data.normalizeServerUrl
import app.dot.opendots.data.parseMessage
import app.dot.opendots.data.parseServerEvent
import app.dot.opendots.data.ServerEvent
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    private fun obj(json: String) = OdJson.parseToJsonElement(json) as JsonObject

    @Test fun assemblesAStreamedTurn() {
        val turn = TurnAssembler("fallback")
        listOf(
            """{"type":"start","messageId":"msg_1","messageMetadata":{"agentId":"a1","createdAt":"2026-11-13T10:00:00Z"}}""",
            """{"type":"start-step"}""",
            """{"type":"reasoning-start","id":"r"}""", """{"type":"reasoning-delta","id":"r","delta":"Let me look."}""", """{"type":"reasoning-end","id":"r"}""",
            """{"type":"tool-input-start","toolCallId":"c1","toolName":"web_search"}""",
            """{"type":"tool-input-available","toolCallId":"c1","toolName":"web_search","input":{"query":"node 24"}}""",
            """{"type":"tool-output-available","toolCallId":"c1","output":{"ok":true,"results":[]}}""",
            """{"type":"text-start","id":"t"}""", """{"type":"text-delta","id":"t","delta":"Hel"}""", """{"type":"text-delta","id":"t","delta":"lo"}""", """{"type":"text-end","id":"t"}""",
            """{"type":"finish","messageMetadata":{"workedMs":4200}}""",
        ).forEach { turn.accept(obj(it)) }
        val message = turn.snapshot()
        assertEquals("msg_1", message.id)
        assertEquals("a1", message.meta.agentId)
        assertEquals(4200L, message.meta.workedMs)
        assertTrue(turn.finished)
        val view = presentAssistantTurn(message)
        assertEquals(listOf(Bubble.Text("text-2", "Hello")), view.bubbles)
        assertEquals("Let me look.", view.reasoning)
        assertEquals("output-available", view.tools.single().state)
    }

    @Test fun toolErrorsAndStreamErrorsAreKept() {
        val turn = TurnAssembler("x")
        turn.accept(obj("""{"type":"tool-input-available","toolCallId":"c","toolName":"shell_exec","input":{"command":"ls"}}"""))
        turn.accept(obj("""{"type":"tool-output-error","toolCallId":"c","errorText":"boom"}"""))
        turn.accept(obj("""{"type":"error","errorText":"model failed"}"""))
        assertTrue((turn.snapshot().parts.single() as Part.Tool).failed)
        assertEquals("model failed", turn.error)
    }

    @Test fun splitsStoredTurnsLikeTheWebApp() {
        val message = parseMessage(obj("""{"id":"m","role":"assistant","metadata":{"reactions":[{"emoji":"👍","actor":"user"}]},"parts":[
            {"type":"step-start"},
            {"type":"tool-text_user","toolCallId":"a","state":"output-available","input":{"text":"On it."},"output":{"ok":true}},
            {"type":"tool-mail_prepare","toolCallId":"b","state":"output-available","input":{},"output":{"ok":true,"draftId":"d1","approvalId":"ap1"}},
            {"type":"tool-shell_exec","toolCallId":"c","state":"output-available","input":{"command":"ls"},"output":{"ok":false,"error":"denied"}},
            {"type":"text","text":"<silence/>"},
            {"type":"file","mediaType":"image/jpeg","url":"/api/attachments/x"}
        ]}"""))!!
        val view = presentAssistantTurn(message)
        assertEquals(2, view.bubbles.size)
        assertEquals("On it.", (view.bubbles[0] as Bubble.Text).text)
        assertEquals("mail_prepare", view.actions.single().name)
        assertEquals(1, view.failures)
        assertEquals("👍", message.meta.reactions.single().emoji)
    }

    @Test fun stripsLeakedToolSyntaxButKeepsMarkdown() {
        assertEquals("Line one\n\n- item", cleanModelText("Line one\n\n- item"))
        assertFalse("to=functions" in cleanModelText("Sure. <|start|>to=functions.web_search {\"q\":1}"))
    }

    @Test fun parsesServerEvents() {
        assertEquals(ServerEvent.Hello, parseServerEvent(obj("""{"type":"hello"}""")))
        val state = parseServerEvent(obj("""{"type":"agent.state","agentId":"a1","state":"working","detail":"Reads a page"}""")) as ServerEvent.AgentState
        assertEquals("working", state.state)
        assertTrue(parseServerEvent(obj("""{"type":"something.new"}""")) is ServerEvent.Other)
    }

    @Test fun normalizesServerAddresses() {
        assertEquals("https://dots.example.com/", normalizeServerUrl("dots.example.com/").toString())
        assertEquals("http://localhost:4317/", normalizeServerUrl("localhost:4317").toString())
        assertEquals("https://dots.example.com/", normalizeServerUrl("https://dots.example.com/app?x=1").toString())
        assertNull(normalizeServerUrl("   "))
    }

    @Test fun markdownBlocksIncludingAnOpenFence() {
        val blocks = parseMarkdown("# Title\n\nSome **bold** text\nsecond line\n\n- one\n- two\n  1. nested\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```kotlin\nval x = 1")
        assertEquals(MdBlock.Heading(1, "Title"), blocks[0])
        assertEquals(MdBlock.Paragraph("Some **bold** text\nsecond line"), blocks[1])
        assertEquals(MdBlock.ListItem(0, "•", "one"), blocks[2])
        assertEquals(MdBlock.ListItem(1, "1.", "nested"), blocks[4])
        assertEquals(MdBlock.Table(listOf("a", "b"), listOf(listOf("1", "2"))), blocks[5])
        assertEquals(MdBlock.Code("kotlin", "val x = 1"), blocks[6])
    }
}
