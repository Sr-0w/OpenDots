package app.dot.opendots.data

import java.io.DataInputStream
import java.io.EOFException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/** Where decoded pixels go. Called on the reader thread; pixels are opaque ARGB. */
interface RfbSink {
    fun resize(width: Int, height: Int)
    fun rect(x: Int, y: Int, width: Int, height: Int, pixels: IntArray)
    fun copy(srcX: Int, srcY: Int, x: Int, y: Int, width: Int, height: Int)
    /** One framebuffer update has been fully applied. */
    fun frame()
}

class RfbException(message: String) : Exception(message)

/**
 * A minimal RFB (VNC) client: enough to watch a companion's desktop and, when the user takes over, to click and type
 * on it. It speaks RFB 3.8 with VNC authentication, asks for 16-bit pixels (half the traffic of 32-bit) and the Raw and
 * CopyRect encodings, which every server supports. It sends pointer or key events only when [pointer] or [key] is
 * called: watching alone can never disturb the companion's work.
 */
class RfbSession(input: InputStream, private val send: (ByteArray) -> Unit, private val password: String, private val sink: RfbSink) {
    private val input = DataInputStream(input)
    private var width = 0
    private var height = 0

    /** Runs until the stream ends or [isActive] turns false. Throws [RfbException] on protocol errors. */
    fun run(isActive: () -> Boolean = { true }) {
        handshake()
        requestUpdate(incremental = false)
        while (isActive()) {
            when (val type = try { input.readUnsignedByte() } catch (e: EOFException) { return }) {
                0 -> { readUpdate(); requestUpdate(incremental = true) }
                1 -> { input.skipBytes(3); val colours = input.readUnsignedShort(); input.skipFully(colours * 6) } // colour map: unused with true colour
                2 -> Unit // bell
                3 -> { input.skipBytes(3); input.skipFully(input.readInt()) } // clipboard text: ignored
                else -> throw RfbException("Unexpected server message $type")
            }
        }
    }

    /** Moves the pointer to ([x], [y]) with [buttons] held (bit 0 left, bit 2 right, bits 3/4 wheel up/down). */
    fun pointer(x: Int, y: Int, buttons: Int) {
        if (width == 0) return
        send(ByteBuffer.allocate(6).put(5).put(buttons.toByte()).putShort(x.coerceIn(0, width - 1).toShort()).putShort(y.coerceIn(0, height - 1).toShort()).array())
    }

    /** Presses or releases the key with X11 [keysym]. */
    fun key(keysym: Int, down: Boolean) {
        if (width == 0) return
        send(ByteBuffer.allocate(8).put(4).put(if (down) 1 else 0).putShort(0).putInt(keysym).array())
    }

    private fun handshake() {
        val version = ByteArray(12).also(input::readFully).decodeToString()
        if (!version.startsWith("RFB ")) throw RfbException("Not a VNC server")
        send("RFB 003.008\n".encodeToByteArray())
        val count = input.readUnsignedByte()
        if (count == 0) throw RfbException(readReason())
        val types = ByteArray(count).also(input::readFully)
        when {
            types.contains(2) -> {
                send(byteArrayOf(2))
                val challenge = ByteArray(16).also(input::readFully)
                send(vncResponse(challenge, password))
            }
            types.contains(1) -> send(byteArrayOf(1))
            else -> throw RfbException("Unsupported security types")
        }
        if (input.readInt() != 0) throw RfbException(runCatching { readReason() }.getOrDefault("Authentication failed"))
        send(byteArrayOf(1)) // shared session: never disconnect the companion's other viewers
        width = input.readUnsignedShort()
        height = input.readUnsignedShort()
        input.skipFully(16) // the server's own pixel format: replaced below
        input.skipFully(input.readInt()) // desktop name
        sink.resize(width, height)
        // 16 bits per pixel, little endian, true colour, RGB565.
        send(ByteBuffer.allocate(20).put(0).put(ByteArray(3)).put(16).put(16).put(0).put(1).putShort(31).putShort(63).putShort(31).put(11).put(5).put(0).put(ByteArray(3)).array())
        // Encodings, preferred first: CopyRect (1), Raw (0).
        send(ByteBuffer.allocate(12).put(2).put(0).putShort(2).putInt(1).putInt(0).array())
    }

    private fun readReason(): String = ByteArray(input.readInt().coerceIn(0, 4096)).also(input::readFully).decodeToString()

    private fun requestUpdate(incremental: Boolean) {
        send(ByteBuffer.allocate(10).put(3).put(if (incremental) 1 else 0).putShort(0).putShort(0).putShort(width.toShort()).putShort(height.toShort()).array())
    }

    private fun readUpdate() {
        input.skipBytes(1)
        repeat(input.readUnsignedShort()) {
            val x = input.readUnsignedShort()
            val y = input.readUnsignedShort()
            val w = input.readUnsignedShort()
            val h = input.readUnsignedShort()
            when (val encoding = input.readInt()) {
                0 -> {
                    val raw = ByteArray(w * h * 2).also(input::readFully)
                    val shorts = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                    val pixels = IntArray(w * h)
                    for (i in pixels.indices) {
                        val p = shorts.get(i).toInt() and 0xFFFF
                        val r = ((p shr 11) and 31) * 255 / 31
                        val g = ((p shr 5) and 63) * 255 / 63
                        val b = (p and 31) * 255 / 31
                        pixels[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                    }
                    sink.rect(x, y, w, h, pixels)
                }
                1 -> sink.copy(input.readUnsignedShort(), input.readUnsignedShort(), x, y, w, h)
                else -> throw RfbException("Unsupported encoding $encoding")
            }
        }
        sink.frame()
    }

    private fun DataInputStream.skipFully(count: Int) {
        var left = count
        while (left > 0) {
            val skipped = skipBytes(left)
            if (skipped <= 0) { readByte(); left-- } else left -= skipped
        }
    }

    companion object {
        const val KEY_BACKSPACE = 0xFF08
        const val KEY_TAB = 0xFF09
        const val KEY_ENTER = 0xFF0D
        const val KEY_ESCAPE = 0xFF1B

        /** X11 keysym of a character: Latin-1 maps directly, everything else through the Unicode range. */
        fun keysymOf(codePoint: Int): Int = when {
            codePoint == '\n'.code -> KEY_ENTER
            codePoint == '\t'.code -> KEY_TAB
            codePoint in 0x20..0xFF -> codePoint
            else -> 0x01000000 or codePoint
        }

        /** VNC authentication: DES-encrypt the challenge with the password as key, each key byte bit-reversed. */
        fun vncResponse(challenge: ByteArray, password: String): ByteArray {
            val key = ByteArray(8)
            password.encodeToByteArray().take(8).forEachIndexed { index, byte ->
                var reversed = 0
                for (bit in 0 until 8) if (byte.toInt() and (1 shl bit) != 0) reversed = reversed or (1 shl (7 - bit))
                key[index] = reversed.toByte()
            }
            return Cipher.getInstance("DES/ECB/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "DES")) }.doFinal(challenge)
        }
    }
}
