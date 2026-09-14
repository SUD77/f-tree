package com.vibethroughcode.ftree.ui.nearby

import androidx.annotation.StringRes
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.nearby.wire.NearbyProblem
import com.vibethroughcode.ftree.nearby.wire.QrLink

/**
 * What a person is told when a transfer stops, one sentence per reason.
 *
 * An exhaustive `when` rather than a table, so a reason added to [NearbyProblem] does not compile
 * until somebody has written what it means. The protocol's tests pin the numbers and the layout;
 * they cannot catch what the person is *told*, which is where the two implementations are likeliest
 * to drift — this and `desktop/renderer`'s equivalent are the two lists to keep in step.
 */
object NearbyMessages {

    @StringRes
    fun message(problem: NearbyProblem): Int = when (problem) {
        NearbyProblem.PROTOCOL_TOO_NEW -> R.string.nearby_problem_protocol_too_new
        NearbyProblem.PROTOCOL_TOO_OLD -> R.string.nearby_problem_protocol_too_old
        NearbyProblem.NOT_A_NEARBY_PEER -> R.string.nearby_problem_not_a_peer
        NearbyProblem.MALFORMED_FRAME -> R.string.nearby_problem_malformed
        NearbyProblem.FRAME_TOO_LARGE -> R.string.nearby_problem_malformed
        NearbyProblem.UNEXPECTED_MESSAGE -> R.string.nearby_problem_unexpected
        NearbyProblem.BAD_PUBLIC_KEY -> R.string.nearby_problem_bad_key
        NearbyProblem.WRONG_DEVICE -> R.string.nearby_problem_wrong_device
        NearbyProblem.BAD_PAIRING -> R.string.nearby_problem_bad_pairing
        NearbyProblem.DECRYPT_FAILED -> R.string.nearby_problem_decrypt
        NearbyProblem.CODES_DID_NOT_MATCH -> R.string.nearby_problem_codes_differ
        NearbyProblem.KEY_NOT_AS_PROMISED -> R.string.nearby_problem_key_not_promised
        NearbyProblem.DECLINED -> R.string.nearby_problem_declined
        NearbyProblem.TIMED_OUT -> R.string.nearby_problem_timed_out
        NearbyProblem.CANCELLED -> R.string.nearby_problem_cancelled
        NearbyProblem.CONNECTION_LOST -> R.string.nearby_problem_connection_lost
        NearbyProblem.TOO_LARGE -> R.string.nearby_problem_too_large
        NearbyProblem.NO_SPACE -> R.string.nearby_problem_no_space
        NearbyProblem.TRANSFER_INCOMPLETE -> R.string.nearby_problem_incomplete
        NearbyProblem.CONTENT_MISMATCH -> R.string.nearby_problem_mismatch
        NearbyProblem.TREE_FORMAT_TOO_NEW -> R.string.nearby_problem_tree_too_new
        NearbyProblem.IMPORT_REFUSED -> R.string.nearby_problem_import_refused
        NearbyProblem.NETWORK -> R.string.nearby_problem_network
        NearbyProblem.PERMISSION -> R.string.nearby_problem_permission
        NearbyProblem.BUSY -> R.string.nearby_problem_busy
        NearbyProblem.UNKNOWN -> R.string.nearby_problem_unknown
    }

    /**
     * The reasons that mean somebody may be in the middle, rather than that something went wrong.
     *
     * These are drawn as a warning and never offer "try again": retrying on the same network is
     * exactly what the person in the middle would want. A decline, a timeout or a dropped Wi-Fi
     * connection is ordinary, and dressing it as an attack would teach people to ignore the real one.
     */
    fun isAlarming(problem: NearbyProblem): Boolean = problem in ALARMING

    private val ALARMING = setOf(
        NearbyProblem.CODES_DID_NOT_MATCH,
        NearbyProblem.KEY_NOT_AS_PROMISED,
        NearbyProblem.DECRYPT_FAILED,
        NearbyProblem.WRONG_DEVICE,
        NearbyProblem.BAD_PUBLIC_KEY,
    )

    /**
     * The six digits as a screen reader should say them: one at a time.
     *
     * Left alone, TalkBack reads `483027` as "four hundred eighty-three thousand and twenty-seven",
     * which cannot be compared against another screen reading the same number some other way.
     */
    fun spokenDigits(sas: String): String = sas.toCharArray().joinToString(" ")

    /** Grouped three and three, the way a number is easiest to hold while looking between screens. */
    fun groupedDigits(sas: String): String =
        if (sas.length == 6) "${sas.substring(0, 3)} ${sas.substring(3)}" else sas

    /**
     * Reads what somebody typed as the other device's address: `a.b.c.d:port`, private only.
     * Returns null for anything else, so the screen can say what it expected.
     */
    fun parseAddress(text: String): Pair<String, Int>? {
        val trimmed = text.trim()
        val colon = trimmed.lastIndexOf(':')
        if (colon <= 0) return null
        val address = trimmed.substring(0, colon)
        val port = trimmed.substring(colon + 1).toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
        if (!QrLink.isPrivateAddress(address)) return null
        return address to port
    }
}
