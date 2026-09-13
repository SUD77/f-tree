package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.transfer.ImportProblem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Every message, round-tripped, plus the numbering both languages have to agree on. */
class MessagesTest {

    private val deviceId = DeviceId(ByteArray(16) { (it * 5).toByte() })
    private val digest = ByteArray(32) { (it + 3).toByte() }

    @Test
    fun `hello round-trips`() {
        val hello = Hello(
            platform = NearbyPlatform.ANDROID,
            flags = NearbyProtocol.FLAG_ACCEPTS_TREE,
            deviceId = deviceId,
            displayName = "Quiet Heron",
        )
        assertEquals(hello, Hello.decode(hello.encode()))
    }

    @Test
    fun `hello ack round-trips`() {
        val ack = HelloAck(
            chosenVersion = 1,
            platform = NearbyPlatform.LINUX,
            flags = NearbyProtocol.FLAG_ACCEPTS_TREE,
            deviceId = deviceId,
            displayName = "Amber Swift",
        )
        assertEquals(ack, HelloAck.decode(ack.encode()))
    }

    @Test
    fun `a greeting with the wrong role is refused`() {
        // Otherwise a receiver could answer as a sender, and the two would both sit waiting.
        val hello = Hello(
            platform = NearbyPlatform.ANDROID,
            flags = 0,
            deviceId = deviceId,
            displayName = "Quiet Heron",
        )
        assertThrows(NearbyFailure::class.java) { HelloAck.decode(hello.encode()) }
    }

    @Test
    fun `a greeting without the magic is not a nearby peer`() {
        val broken = Hello(
            platform = NearbyPlatform.ANDROID,
            flags = 0,
            deviceId = deviceId,
            displayName = "x",
        ).encode()
        broken[0] = 0
        val failure = assertThrows(NearbyFailure::class.java) { Hello.decode(broken) }
        assertEquals(NearbyProblem.NOT_A_NEARBY_PEER, failure.problem)
    }

    @Test
    fun `a greeting with trailing bytes still reads`() {
        val hello = Hello(
            platform = NearbyPlatform.ANDROID,
            flags = 0,
            deviceId = deviceId,
            displayName = "Quiet Heron",
        )
        assertEquals(hello, Hello.decode(hello.encode() + ByteArray(16) { 9 }))
    }

    @Test
    fun `a key message round-trips`() {
        val key = KeyMessage(ByteArray(256) { (it % 251).toByte() }, ByteArray(32) { it.toByte() })
        assertEquals(key, KeyMessage.decode(key.encode()))
        assertEquals(288, key.encode().size)
    }

    @Test
    fun `a key message does not print its key`() {
        val key = KeyMessage(ByteArray(256) { 7 }, ByteArray(32) { 8 })
        assertEquals("KeyMessage(256-byte public key)", key.toString())
    }

    @Test
    fun `an offer round-trips, including a large byte count`() {
        // Four gigabytes does not fit in an Int. A file that size would be refused on the size
        // check, but it must survive being read before it can be refused.
        val offer = Offer(
            peopleCount = 148,
            relationshipCount = 300,
            photoCount = 87,
            totalBytes = 5_000_000_000L,
            sha256 = digest,
            treeFormatVersion = 1,
            suggestedFileName = "Kumar-family.ftree",
        )
        assertEquals(offer, Offer.decode(offer.encode()))
    }

    @Test
    fun `an offer with no suggested name round-trips`() {
        val offer = Offer(1, 0, 0, 10, digest, 1, "")
        assertEquals(offer, Offer.decode(offer.encode()))
    }

    @Test
    fun `end round-trips`() {
        val end = End(123_456_789_012L, digest)
        assertEquals(end, End.decode(end.encode()))
    }

    @Test
    fun `a result round-trips both ways`() {
        assertEquals(Result(true, null), Result.decode(Result(true, null).encode()))
        val refused = Result(false, ImportProblem.NOT_AN_ARCHIVE)
        assertEquals(refused, Result.decode(refused.encode()))
    }

    @Test
    fun `every abort reason survives the wire`() {
        for (problem in NearbyProblem.entries) {
            assertEquals(Abort(problem), Abort.decode(Abort(problem).encode()))
        }
    }

    @Test
    fun `an abort reason this build does not know reads as unknown`() {
        // A later release may stop for a reason that did not exist when this one was written.
        assertEquals(NearbyProblem.UNKNOWN, Abort.decode(byteArrayOf(0x5E)).problem)
        assertEquals(NearbyProblem.UNKNOWN, Abort.decode(ByteArray(0)).problem)
    }

    @Test
    fun `no two problems share a wire number`() {
        // The numbers are written down rather than taken from the ordinal precisely so they can be
        // reordered safely — which only works if they are unique.
        val codes = NearbyProblem.entries.map { it.code }
        assertEquals(codes.size, codes.toSet().size)
    }

    @Test
    fun `every import problem has a number, and it round-trips`() {
        for (problem in ImportProblem.entries) {
            val code = ImportProblemCodes.codeOf(problem)
            assertTrue(code > 0)
            assertEquals(problem, ImportProblemCodes.problemOf(code))
        }
        assertEquals(null, ImportProblemCodes.problemOf(0))
    }

    @Test
    fun `a hostile name in a greeting cannot render as another device`() {
        val hello = Hello(
            platform = NearbyPlatform.ANDROID,
            flags = 0,
            deviceId = deviceId,
            displayName = "Ankit‮phone",
        )
        val decoded = Hello.decode(hello.encode())
        assertTrue(decoded.displayName.none { it in '‪'..'‮' })
    }

    @Test
    fun `a greeting with an empty name falls back rather than travelling blank`() {
        val hello = Hello(
            platform = NearbyPlatform.ANDROID,
            flags = 0,
            deviceId = deviceId,
            displayName = "",
        )
        assertNotEquals("", Hello.decode(hello.encode()).displayName)
    }
}
