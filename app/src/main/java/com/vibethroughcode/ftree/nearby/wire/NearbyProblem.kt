package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.transfer.ImportProblem

/**
 * Why a transfer stopped. Each is something the person holding the phone can act on.
 *
 * The numbers are written down rather than taken from the enum's ordinal. An ordinal is a wire
 * format nobody declared: reordering this list for readability would silently change what the other
 * device is told, and the two implementations would disagree about what "8" meant without either
 * of them changing a line that looks like protocol code.
 *
 * The shape follows [ImportProblem], which is the app's existing answer to the same question.
 */
enum class NearbyProblem(val code: Int) {

    /** Their f-tree speaks a version this one does not. The sender's side of "from a newer version". */
    PROTOCOL_TOO_NEW(0x01),
    PROTOCOL_TOO_OLD(0x02),

    /** Something answered on that port, but it was not f-tree. */
    NOT_A_NEARBY_PEER(0x03),

    MALFORMED_FRAME(0x04),
    FRAME_TOO_LARGE(0x05),

    /** The right shape at the wrong moment. Also what an unknown message type becomes. */
    UNEXPECTED_MESSAGE(0x06),

    BAD_PUBLIC_KEY(0x07),

    /** The device that answered is not the device that was discovered. */
    WRONG_DEVICE(0x08),

    /** The first encrypted frame would not open: a stale code, or somebody in between. */
    BAD_PAIRING(0x09),

    DECRYPT_FAILED(0x0A),
    CODES_DID_NOT_MATCH(0x0B),
    DECLINED(0x0C),
    TIMED_OUT(0x0D),
    CANCELLED(0x0E),
    CONNECTION_LOST(0x0F),
    TOO_LARGE(0x10),
    NO_SPACE(0x11),
    TRANSFER_INCOMPLETE(0x12),

    /** What arrived is not what was sent. */
    CONTENT_MISMATCH(0x13),

    /** This device writes a `.ftree` the other one is too old to read. */
    TREE_FORMAT_TOO_NEW(0x14),

    /** The file arrived whole and the importer still refused it; carries an [ImportProblem]. */
    IMPORT_REFUSED(0x15),

    /** A socket would not bind, multicast was unavailable, or the network went away. */
    NETWORK(0x16),

    PERMISSION(0x17),
    BUSY(0x18),

    /**
     * The key the receiver sent is not the one it promised in `HELLO_ACK`.
     *
     * An honest receiver cannot produce this; it is what a machine in the middle looks like when it
     * tries to choose its nonce after seeing the sender's, which is the only way it could make two
     * screens show the same six digits. Shown with the same alarm as [CODES_DID_NOT_MATCH].
     */
    KEY_NOT_AS_PROMISED(0x19),

    /**
     * A code this build does not recognise.
     *
     * Never shown as a number. A device running a later release may abort for a reason that did not
     * exist when this one was written, and "the other device stopped" is both true and useful,
     * where "error 27" is neither.
     */
    UNKNOWN(0xFF),
    ;

    companion object {
        private val byCode = entries.associateBy { it.code }

        /** Anything unrecognised becomes [UNKNOWN] rather than throwing. A stranger picks this byte. */
        fun fromCode(code: Int): NearbyProblem = byCode[code] ?: UNKNOWN
    }
}

/**
 * The wire numbers for [ImportProblem], so a receiver can tell a sender why its file was refused
 * and the sender can show the sentence the app already has for it.
 *
 * Written here rather than on [ImportProblem] itself to keep the transfer package free of anything
 * the network needs: the `.ftree` format does not depend on there being a network, and putting a
 * wire code on it would be the first place that stopped being true.
 */
object ImportProblemCodes {

    private val toCode = mapOf(
        ImportProblem.NOT_AN_ARCHIVE to 0x01,
        ImportProblem.NOT_A_TREE_FILE to 0x02,
        ImportProblem.FROM_A_NEWER_VERSION to 0x03,
        ImportProblem.EMPTY to 0x04,
        ImportProblem.UNREADABLE to 0x05,
    )

    private val fromCode = toCode.entries.associate { (problem, code) -> code to problem }

    fun codeOf(problem: ImportProblem): Int = toCode.getValue(problem)

    /** `0` means the import was not refused. Anything unrecognised reads as unreadable. */
    fun problemOf(code: Int): ImportProblem? =
        if (code == 0) null else fromCode[code] ?: ImportProblem.UNREADABLE
}

/** A transfer that ended for a reason worth showing. */
class NearbyFailure(
    val problem: NearbyProblem,
    val importProblem: ImportProblem? = null,
) : Exception("Nearby failed: $problem${importProblem?.let { " ($it)" } ?: ""}")
