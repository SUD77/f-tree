package com.vibethroughcode.ftree.nearby

import com.vibethroughcode.ftree.nearby.wire.DeviceId
import com.vibethroughcode.ftree.nearby.wire.Dh
import com.vibethroughcode.ftree.nearby.wire.Handshake
import com.vibethroughcode.ftree.nearby.wire.NearbyProblem
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol
import com.vibethroughcode.ftree.nearby.wire.Offer
import java.io.BufferedReader
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The Kotlin implementation talking to the JavaScript one, over a real socket.
 *
 * This is the test the rest of the nearby work exists to make possible, and it is the only one that
 * can fail for the reason that matters. `docs/nearby/vectors.txt` pins every byte both sides
 * compute, and both sides have their own end-to-end tests — but a golden table is a claim that two
 * implementations *would* agree, checked by each of them alone. Until a JVM process and a Node
 * process have exchanged a file, nothing has tested the claim itself.
 *
 * What it exercises that a vector cannot: that the frames arrive in an order each side expects,
 * that neither blocks waiting for something the other has already sent, that the transcript is
 * assembled identically when each side is hashing what it *actually* wrote and read rather than
 * what a test handed it, and that the two counters stay in step across a stream the network is free
 * to split anywhere.
 *
 * **Loopback is the protocol, not the router.** An access point that drops an unfamiliar multicast
 * group, guest Wi-Fi with client isolation, a phone that walks out of range — none of those are
 * reachable from here, and they stay a manual checklist. What is reachable from here is every byte
 * of the conversation.
 *
 * Skipped, not failed, where `node` is not on the path: a machine that cannot run half the test has
 * nothing to say about it, and a red build on a developer's laptop for a missing toolchain teaches
 * people to ignore red builds. **Except in CI**, which sets `FTREE_REQUIRE_NODE=1`: there a skip
 * would be this test passing by not running, on the one machine whose green everybody trusts.
 */
class CrossLanguageTransferTest {

    @get:Rule
    val folder = TemporaryFolder()

    private class SocketChannel(private val socket: Socket) : NearbyChannel {
        override val input: InputStream get() = socket.getInputStream()
        override val output: OutputStream get() = socket.getOutputStream()
        override val remoteAddress: String get() = socket.inetAddress?.hostAddress.orEmpty()
        override fun close() {
            runCatching { socket.close() }
        }
    }

    private class Recorder : NearbyTransferListener {
        @Volatile var sas: String? = null
        @Volatile var offer: Offer? = null
        @Volatile var problem: NearbyProblem? = null

        override fun onCode(sas: String) {
            this.sas = sas
        }

        override fun onOffer(offer: Offer) {
            this.offer = offer
        }

        override fun onFailed(
            problem: NearbyProblem,
            importProblem: com.vibethroughcode.ftree.transfer.ImportProblem?,
        ) {
            this.problem = problem
        }
    }

    private fun identity(seed: Byte) = object : NearbySelf {
        override val deviceId = DeviceId(ByteArray(16) { seed })
        override val displayName = "Kotlin $seed"
    }

    /** One `node` process, with its output collected line by line as it arrives. */
    private class NodePeer(val process: Process) {
        val lines = mutableListOf<String>()
        private val reader = process.inputStream.bufferedReader()

        fun pump() = thread(isDaemon = true, name = "node-output") {
            reader.useLines { sequence ->
                sequence.forEach { line -> synchronized(lines) { lines += line } }
            }
        }

        /** Waits for a line starting with [prefix], or returns `null` once the deadline passes. */
        fun await(prefix: String, timeoutMillis: Long = TIMEOUT_MS): String? {
            val deadline = System.currentTimeMillis() + timeoutMillis
            while (System.currentTimeMillis() < deadline) {
                synchronized(lines) {
                    lines.firstOrNull { it.startsWith(prefix) }
                }?.let { return it.removePrefix(prefix).trim() }
                Thread.sleep(20)
            }
            return null
        }

        fun transcript(): String = synchronized(lines) { lines.joinToString("\n") }

        fun stop() {
            process.destroy()
            process.waitFor(5, TimeUnit.SECONDS)
        }
    }

    private fun repositoryRoot(): File {
        var directory = File(System.getProperty("user.dir"))
        while (!File(directory, "settings.gradle.kts").exists()) {
            directory = directory.parentFile ?: error("could not find the repository root")
        }
        return directory
    }

    /** The real thing: twenty-three people, twenty-seven relationships and four photographs. */
    private fun sampleTree(): File = File(repositoryRoot(), "site/playground/sample-family.ftree")

    private fun node(vararg arguments: String): NodePeer {
        val builder = ProcessBuilder(listOf(nodeCommand()) + arguments)
            .directory(File(repositoryRoot(), "desktop"))
            .redirectErrorStream(true)
        return NodePeer(builder.start()).also { it.pump() }
    }

    private fun nodeCommand(): String = if (System.getProperty("os.name").startsWith("Windows")) {
        "node.exe"
    } else {
        "node"
    }

    private fun requireNode() {
        if (System.getenv("FTREE_REQUIRE_NODE") == "1") {
            assertTrue("FTREE_REQUIRE_NODE is set and node is not on the path", nodeIsAvailable())
        } else {
            assumeTrue("node is not on the path", nodeIsAvailable())
        }
    }

    private fun nodeIsAvailable(): Boolean = try {
        ProcessBuilder(nodeCommand(), "--version")
            .redirectErrorStream(true)
            .start()
            .waitFor(10, TimeUnit.SECONDS)
    } catch (_: Exception) {
        false
    }

    // ---------------------------------------------------------------------------------------

    @Test
    fun `a Kotlin sender and a JavaScript receiver exchange a real family`() {
        requireNode()

        val arrived = folder.newFile("arrived.ftree")
        val peer = node("nearby/peer.js", "receive", "--auto", "--out", arrived.absolutePath)

        try {
            val port = peer.await("PORT ")?.toIntOrNull()
            assertNotNull("the JavaScript peer never bound a port:\n${peer.transcript()}", port)

            val tree = sampleTree()
            val recorder = Recorder()
            val transfer = NearbySendTransfer(
                identity = identity(1),
                outgoing = OutgoingFile(
                    file = tree,
                    peopleCount = 23,
                    relationshipCount = 27,
                    photoCount = 4,
                    suggestedFileName = "sample-family.ftree",
                ),
                listener = recorder,
            )

            // Confirms the code as soon as this side derives one. The assertion that the two sides
            // derived the *same* one is below, against what the JavaScript printed.
            thread(isDaemon = true, name = "confirm") {
                val deadline = System.currentTimeMillis() + TIMEOUT_MS
                while (System.currentTimeMillis() < deadline && recorder.sas == null) {
                    Thread.sleep(10)
                }
                transfer.confirmCode(true)
            }

            val socket = Socket()
            socket.connect(InetSocketAddress("127.0.0.1", port!!), NearbyProtocol.CONNECT_TIMEOUT_MS)
            val problem = transfer.run(SocketChannel(socket))

            assertNull("the Kotlin sender failed: $problem\n${peer.transcript()}", problem)

            // The two languages derived the same six digits from the same conversation. If this
            // holds, they interoperate; if it ever stops holding, two people compare two screens,
            // see different numbers, and correctly conclude that something is wrong.
            val theirs = peer.await("CODE ")
            assertNotNull("the JavaScript peer never showed a code:\n${peer.transcript()}", theirs)
            assertEquals("the two implementations derived different codes", recorder.sas, theirs)

            val reported = peer.await("DONE ")
            assertNotNull("the JavaScript peer never finished:\n${peer.transcript()}", reported)

            val expected = MessageDigest.getInstance("SHA-256")
                .digest(tree.readBytes())
                .joinToString("") { "%02x".format(it) }
            assertEquals("what arrived is not what was sent", expected, reported)
            assertArrayEquals(tree.readBytes(), arrived.readBytes())
        } finally {
            peer.stop()
        }
    }

    @Test
    fun `a JavaScript sender and a Kotlin receiver exchange a real family`() {
        requireNode()

        // The other direction, which is a different code path on both sides and not a symmetry that
        // can be assumed: the receiver holds the long-lived key and answers, the sender opens the
        // conversation and streams.
        val tree = sampleTree()
        val arrived = folder.newFile("arrived.ftree")

        val beaconPrivate = Dh.generatePrivate()
        val beaconPublic = Dh.publicOf(beaconPrivate)
        val recorder = Recorder()

        val server = ServerSocket()
        server.reuseAddress = true
        server.bind(InetSocketAddress("127.0.0.1", 0))

        var receiveProblem: NearbyProblem? = null
        lateinit var receiver: NearbyReceiveTransfer

        val serving = thread(name = "kotlin-receiver") {
            val client = server.accept()
            arrived.outputStream().use { sink ->
                receiver = NearbyReceiveTransfer(
                    identity = identity(2),
                    beaconPrivateKey = beaconPrivate,
                    beaconPublicKey = beaconPublic,
                    sink = sink,
                    listener = recorder,
                )
                // Accepts as soon as the offer arrives, the way `--auto` does on the other side.
                thread(isDaemon = true, name = "accept") {
                    val deadline = System.currentTimeMillis() + TIMEOUT_MS
                    while (System.currentTimeMillis() < deadline && recorder.offer == null) {
                        Thread.sleep(10)
                    }
                    receiver.accept()
                }
                receiveProblem = receiver.run(SocketChannel(client))
            }
            if (receiveProblem == null) receiver.finish(null)
        }

        val peer = node(
            "nearby/peer.js",
            "send",
            "--auto",
            "--file",
            tree.absolutePath,
            "--to",
            "127.0.0.1:${server.localPort}",
            "--people",
            "23",
            "--relationships",
            "27",
            "--photos",
            "4",
        )

        try {
            serving.join(TIMEOUT_MS)
            assertTrue("the Kotlin receiver did not finish:\n${peer.transcript()}", !serving.isAlive)
            assertNull("the Kotlin receiver failed: $receiveProblem\n${peer.transcript()}", receiveProblem)

            val theirs = peer.await("CODE ")
            assertNotNull("the JavaScript sender never showed a code:\n${peer.transcript()}", theirs)
            assertEquals("the two implementations derived different codes", recorder.sas, theirs)

            // The offer crossed a language boundary intact, counts and all.
            val offer = recorder.offer
            assertNotNull("no offer reached the Kotlin receiver", offer)
            assertEquals(23, offer!!.peopleCount)
            assertEquals(27, offer.relationshipCount)
            assertEquals(4, offer.photoCount)
            assertEquals(tree.length(), offer.totalBytes)

            assertArrayEquals(tree.readBytes(), arrived.readBytes())
        } finally {
            peer.stop()
            runCatching { server.close() }
        }
    }

    private companion object {
        const val TIMEOUT_MS = 60_000L
    }
}
