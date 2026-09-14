package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.BEACON_MAX_NAME_BYTES
import java.text.Normalizer

/**
 * What a device calls itself on a network, and what to do with what it calls itself back.
 *
 * Pure, and tested on the JVM, because both halves are the kind of thing that is obviously fine
 * until it is not: the default leaks a real name, and the sanitiser is the only thing standing
 * between a stranger's text and a list somebody is about to tap.
 */
object NearbyNames {

    /**
     * Sixteen of each, indexed by the first two bytes of the device id, so the same device is
     * always the same creature and two devices rarely collide.
     */
    private val ADJECTIVES = listOf(
        "Quiet", "Amber", "Brisk", "Copper", "Dusty", "Early", "Fernwood", "Golden",
        "Hollow", "Inky", "Jasper", "Kindly", "Linen", "Mellow", "Northern", "Olive",
    )

    private val CREATURES = listOf(
        "Heron", "Swift", "Otter", "Marten", "Finch", "Badger", "Kestrel", "Hare",
        "Plover", "Vole", "Linnet", "Stoat", "Curlew", "Shrew", "Teal", "Wren",
    )

    /**
     * A name for a device whose owner has not chosen one.
     *
     * Deliberately **not** `Build.MODEL`, and not the machine's hostname. Consumer device names are
     * overwhelmingly "Ankit's Galaxy" or "priya-macbook", and a default that used one would
     * broadcast a real person's name, in clear, to every stranger on a café network, twice a second,
     * for as long as the screen was open. The person would never be told that is what the default
     * did. "Quiet Heron" tells another device in the room apart just as well.
     */
    fun friendlyName(deviceId: ByteArray): String {
        require(deviceId.size >= 2) { "device id too short" }
        val adjective = ADJECTIVES[(deviceId[0].toInt() and 0xFF) % ADJECTIVES.size]
        val creature = CREATURES[(deviceId[1].toInt() and 0xFF) % CREATURES.size]
        return "$adjective $creature"
    }

    /**
     * A name from the network, made safe to draw.
     *
     * This is attacker-controlled text on its way into a list the user is about to tap, so the
     * order matters:
     *
     * - **Bidirectional overrides and isolates are stripped.** This is the one that is not
     *   cosmetic. Left in, a device can name itself so that it *renders* as another device's name
     *   — the whole point of choosing the right row in a list is then gone.
     * - Control characters go, because a newline in a name breaks the row it is drawn in.
     * - NFC, so two spellings of the same name compare and draw the same way.
     * - Truncated to the wire limit **on a codepoint boundary**, so a cut never produces half a
     *   character.
     *
     * Returns `null` when nothing survives, which the caller replaces with [friendlyName]. An empty
     * name is not drawn as an empty row.
     */
    fun sanitise(raw: String): String? {
        val stripped = buildString(raw.length) {
            for (character in raw) {
                when {
                    character.isBidiControl() -> Unit
                    character.isControlCharacter() -> append(' ')
                    else -> append(character)
                }
            }
        }
        val normalised = Normalizer.normalize(stripped, Normalizer.Form.NFC)
            .replace(Regex("\\s+"), " ")
            .trim()
        return truncateToBytes(normalised, BEACON_MAX_NAME_BYTES).takeIf { it.isNotEmpty() }
    }

    /**
     * At most [maxBytes] of UTF-8, cut between codepoints.
     *
     * Cutting a `ByteArray` at a fixed index would split a multi-byte character, and a name that is
     * half a character is a name that decodes to a replacement glyph on the other device. Surrogate
     * pairs count as one, so an emoji is kept or dropped whole.
     */
    fun truncateToBytes(value: String, maxBytes: Int): String {
        if (value.toByteArray(Charsets.UTF_8).size <= maxBytes) return value
        val out = StringBuilder()
        var used = 0
        var index = 0
        while (index < value.length) {
            val codePoint = value.codePointAt(index)
            val width = Character.charCount(codePoint)
            val piece = value.substring(index, index + width)
            val cost = piece.toByteArray(Charsets.UTF_8).size
            if (used + cost > maxBytes) break
            out.append(piece)
            used += cost
            index += width
        }
        return out.toString().trim()
    }

    /**
     * The embedding and override characters, `U+202A`-`U+202E`, and the isolates,
     * `U+2066`-`U+2069`.
     *
     * Written as escapes deliberately: these characters are invisible, so a literal here would be
     * a line nobody could read, review, or notice had been edited.
     */
    private fun Char.isBidiControl(): Boolean =
        this in '\u202A'..'\u202E' || this in '\u2066'..'\u2069'

    /** C0 and C1. Whitespace among them becomes a space, and the caller collapses runs of it. */
    private fun Char.isControlCharacter(): Boolean =
        this < '\u0020' || this in '\u007F'..'\u009F'
}
