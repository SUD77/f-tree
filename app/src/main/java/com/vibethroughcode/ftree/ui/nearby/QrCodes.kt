package com.vibethroughcode.ftree.ui.nearby

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.EncodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.NotFoundException
import com.google.zxing.ChecksumException
import com.google.zxing.FormatException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.encoder.Encoder

/**
 * The two things the app does with a QR code, kept free of Android types so a JVM test reaches them.
 *
 * A code carries connection details and never payload — `ftree://nearby/v1?…`, a hundred-odd
 * characters — so one-way scanning covers transfers in both directions: the code establishes the
 * channel, not who sends. Error correction is M: a phone held at an angle to a laptop screen with a
 * reflection across it is the ordinary case, and M recovers from about fifteen percent damage while
 * keeping the modules large enough to scan from arm's length.
 */
object QrCodes {

    /** The code as rows of dark (true) and light modules, without the quiet zone. */
    fun modules(text: String): Array<BooleanArray> {
        val matrix = Encoder.encode(text, ErrorCorrectionLevel.M, emptyMap<EncodeHintType, Any>()).matrix
        return Array(matrix.height) { y -> BooleanArray(matrix.width) { x -> matrix.get(x, y).toInt() == 1 } }
    }

    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.CHARACTER_SET to "UTF-8",
    )

    /**
     * Reads a code out of a greyscale image, or returns null.
     *
     * [luminance] is one byte per pixel, row after row, [rowStride] bytes apart — exactly the Y
     * plane a camera frame arrives in, so nothing is converted or copied on the way. A frame with no
     * code in it is the ordinary case, dozens of times a second, and is not an error.
     */
    fun decode(luminance: ByteArray, width: Int, height: Int, rowStride: Int = width): String? {
        val source = PlanarLuminance(luminance, rowStride, width, height)
        return try {
            QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source)), hints).text
        } catch (_: NotFoundException) {
            null
        } catch (_: ChecksumException) {
            null
        } catch (_: FormatException) {
            null
        }
    }

    /**
     * A view onto a Y plane whose rows may be padded, as camera buffers usually are. ZXing's own
     * PlanarYUVLuminanceSource does the same with more options than a camera frame needs.
     */
    private class PlanarLuminance(
        private val data: ByteArray,
        private val stride: Int,
        width: Int,
        height: Int,
    ) : LuminanceSource(width, height) {
        override fun getRow(y: Int, row: ByteArray?): ByteArray {
            val out = if (row == null || row.size < width) ByteArray(width) else row
            System.arraycopy(data, y * stride, out, 0, width)
            return out
        }

        override fun getMatrix(): ByteArray {
            if (stride == width) return data.copyOf(width * height)
            val out = ByteArray(width * height)
            for (y in 0 until height) System.arraycopy(data, y * stride, out, y * width, width)
            return out
        }
    }
}
