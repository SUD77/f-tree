package com.vibethroughcode.ftree.ui.nearby

import com.vibethroughcode.ftree.nearby.wire.DeviceId
import com.vibethroughcode.ftree.nearby.wire.QrLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QrCodesTest {

    private val link = QrLink(
        address = "192.168.1.42",
        port = 49813,
        deviceId = DeviceId(ByteArray(16) { (it * 7).toByte() }),
        keyFingerprint = ByteArray(8) { (it + 1).toByte() },
        token = ByteArray(16) { (it * 11).toByte() },
        displayName = "Quiet Heron",
    )

    /** Draws modules the way a screen would: [scale] pixels each, a four-module quiet zone, black on white. */
    private fun render(modules: Array<BooleanArray>, scale: Int = 4, quiet: Int = 4): Triple<ByteArray, Int, Int> {
        val size = (modules.size + quiet * 2) * scale
        val pixels = ByteArray(size * size) { 0xFF.toByte() }
        for (y in modules.indices) for (x in modules[y].indices) {
            if (!modules[y][x]) continue
            for (dy in 0 until scale) for (dx in 0 until scale) {
                pixels[((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx] = 0
            }
        }
        return Triple(pixels, size, size)
    }

    @Test
    fun `a code this app draws is read back as the same link`() {
        // The failure that matters is not "no code appears" — it is a code that scans cleanly as a
        // different string, which nobody would notice by looking at it.
        val text = link.encode()
        val (pixels, width, height) = render(QrCodes.modules(text))
        val read = QrCodes.decode(pixels, width, height)
        assertEquals(text, read)
        assertEquals(link, QrLink.parse(read!!))
    }

    @Test
    fun `a padded camera row is read the same as a tight one`() {
        val (tight, width, height) = render(QrCodes.modules(link.encode()))
        val stride = width + 64
        val padded = ByteArray(stride * height) { 0x7F }
        for (y in 0 until height) System.arraycopy(tight, y * width, padded, y * stride, width)
        assertEquals(link.encode(), QrCodes.decode(padded, width, height, rowStride = stride))
    }

    @Test
    fun `the desktop code is read by this scanner as the link it carries`() {
        // desktop/renderer/vendor/qr.js (qrcode-generator) and ZXing are two unrelated encoders; a
        // phone scanning a laptop is the pairing this exists for, so the desktop's golden matrix
        // must decode here to exactly the link it was made from.
        val lines = goldenFile().readLines().filter { it.isNotBlank() }
        val link = lines.first()
        val modules = lines.drop(1).map { row -> BooleanArray(row.length) { row[it] == '1' } }.toTypedArray()
        val (pixels, width, height) = render(modules)
        assertEquals(link, QrCodes.decode(pixels, width, height))
        assertEquals(link, QrLink.parse(link)?.encode())
    }

    private fun goldenFile(): java.io.File {
        var directory: java.io.File? = java.io.File(System.getProperty("user.dir"))
        while (directory != null && !java.io.File(directory, "settings.gradle.kts").exists()) {
            directory = directory.parentFile
        }
        return java.io.File(directory, "docs/nearby/qr-golden.txt")
    }

    @Test
    fun `a frame with no code in it is simply nothing`() {
        val blank = ByteArray(200 * 200) { 0xFF.toByte() }
        assertNull(QrCodes.decode(blank, 200, 200))
    }
}
