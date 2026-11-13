package app.dot.opendots.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/** Limits shared with the server (`IMAGE_MAX_COUNT`, `IMAGE_MAX_BYTES` in packages/shared). */
const val IMAGE_MAX_COUNT = 6
private const val IMAGE_MAX_BYTES = 10 * 1024 * 1024
private const val COMFORTABLE_BYTES = 4 * 1024 * 1024
private val DIRECT_TYPES = setOf("image/jpeg", "image/png", "image/webp", "image/gif")

class EncodedImage(val bytes: ByteArray, val mediaType: String, val filename: String)

/**
 * Reads a picked image for upload. Small images in a format the server accepts go through untouched; anything large or
 * exotic (HEIC…) is decoded, scaled to at most 2560 px and re-encoded as JPEG so it always fits the 10 MB limit.
 */
suspend fun readImageForUpload(context: Context, uri: Uri): EncodedImage = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val type = resolver.getType(uri) ?: "image/jpeg"
    val raw = resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("unreadable")
    if (type in DIRECT_TYPES && raw.size <= COMFORTABLE_BYTES) {
        return@withContext EncodedImage(raw, type, "image." + type.substringAfter('/').replace("jpeg", "jpg"))
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2560) sample *= 2
    val bitmap = BitmapFactory.decodeByteArray(raw, 0, raw.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: error("undecodable")
    var quality = 88
    var bytes: ByteArray
    do {
        bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
        quality -= 12
    } while (bytes.size > IMAGE_MAX_BYTES && quality > 30)
    bitmap.recycle()
    EncodedImage(bytes, "image/jpeg", "image.jpg")
}
