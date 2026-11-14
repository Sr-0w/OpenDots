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

    @Test fun approvalSummariesAreSplitIntoTitleAndDetails() {
        val s = app.dot.opendots.ui.splitApprovalSummary("GitHub — robin@example.com · Pousser une branche · commit 100f9b4271509a9a826ac4de535d182960079cd2 · {\"repo\":\"Sr-0w/OpenDots\",\"set_upstream\":true}")
        assertEquals("GitHub — robin@example.com", s.context)
        assertEquals("Pousser une branche", s.title)
        assertEquals(listOf("commit" to "100f9b427150", "repo" to "Sr-0w/OpenDots", "set_upstream" to "true"), s.details)
        assertEquals("Send it", app.dot.opendots.ui.splitApprovalSummary("Send it").title)
        assertEquals("Validation : GitHub", app.dot.opendots.ui.shortEventTitle("Validation : GitHub · {\"a\":1}"))
    }

    @Test fun decodesAVncSessionAndSendsInputOnlyWhenAsked() {
        val server = java.io.ByteArrayOutputStream().apply {
            write("RFB 003.008\n".toByteArray())
            write(byteArrayOf(1, 1))                      // one security type: None
            write(byteArrayOf(0, 0, 0, 0))                // security result: OK
            write(byteArrayOf(0, 2, 0, 1))                // 2 x 1 framebuffer
            write(ByteArray(16)); write(ByteArray(4))     // server pixel format, empty name
            write(byteArrayOf(0, 0, 0, 1))                // framebuffer update, one rectangle
            write(byteArrayOf(0, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 0)) // x, y, w, h, Raw
            write(byteArrayOf(0x00, 0xF8.toByte(), 0x1F, 0x00))    // RGB565 little endian: red, blue
        }.toByteArray()
        val sent = ArrayList<ByteArray>()
        val rects = ArrayList<List<Int>>()
        var size = 0 to 0
        var frames = 0
        app.dot.opendots.data.RfbSession(server.inputStream(), { sent += it }, "secret", object : app.dot.opendots.data.RfbSink {
            override fun resize(width: Int, height: Int) { size = width to height }
            override fun rect(x: Int, y: Int, width: Int, height: Int, pixels: IntArray) { rects += pixels.toList() }
            override fun copy(srcX: Int, srcY: Int, x: Int, y: Int, width: Int, height: Int) = Unit
            override fun frame() { frames++ }
        }).also { it.run(); it.pointer(1, 0, 1); it.key(app.dot.opendots.data.RfbSession.keysymOf('a'.code), true) }
        assertEquals(2 to 1, size)
        assertEquals(listOf(listOf(0xFFFF0000.toInt(), 0xFF0000FF.toInt())), rects)
        assertEquals(1, frames)
        assertEquals("RFB 003.008\n", sent.first().decodeToString())
        // Watching sends only set-up and update requests; pointer (5) and key (4) events appear only once asked for.
        assertEquals(listOf(1, 1, 0, 2, 3, 3, 5, 4), sent.drop(1).map { it[0].toInt() })
        assertEquals(listOf(5, 1, 0, 1, 0, 0), sent[sent.size - 2].map { it.toInt() })
        assertEquals(0x61, sent.last()[7].toInt())
        assertEquals(16, app.dot.opendots.data.RfbSession.vncResponse(ByteArray(16) { it.toByte() }, "secret").size)
    }

    @Test fun sharedScreenshotsAndMarkdownImagesBecomeImages() {
        val message = parseMessage(obj("""{"id":"m","role":"assistant","parts":[
            {"type":"tool-share_screenshot","toolCallId":"a","state":"output-available","input":{},"output":{"ok":true,"status":"attached","url":"/api/attachments/x","filename":"capture.jpg","mediaType":"image/jpeg"}},
            {"type":"tool-share_screenshot","toolCallId":"b","state":"output-available","input":{},"output":{"ok":false,"status":"not_found","error":"expirée"}},
            {"type":"text","text":"La voici."}
        ]}"""))!!
        val view = presentAssistantTurn(message)
        assertEquals("/api/attachments/x", (view.bubbles[0] as Bubble.Image).file.url)
        assertEquals(1, view.tools.size)
        val blocks = parseMarkdown("Essai :\n![Bureau](/api/computer/screenshots/abc?agentId=ag_1)\n[Ouvrir la capture](/api/computer/screenshots/abc?agentId=ag_1)")
        assertEquals(MdBlock.Paragraph("Essai :"), blocks[0])
        assertEquals(MdBlock.Image("Bureau", "/api/computer/screenshots/abc?agentId=ag_1"), blocks[1])
        assertTrue(blocks[2] is MdBlock.Paragraph)
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
