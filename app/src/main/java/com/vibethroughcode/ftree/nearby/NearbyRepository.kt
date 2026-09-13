package com.vibethroughcode.ftree.nearby

import com.vibethroughcode.ftree.nearby.wire.Beacon
import com.vibethroughcode.ftree.nearby.wire.Dh
import com.vibethroughcode.ftree.nearby.wire.Handshake
import com.vibethroughcode.ftree.nearby.wire.NearbyPlatform
import com.vibethroughcode.ftree.nearby.wire.NearbyProblem
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol
import com.vibethroughcode.ftree.nearby.wire.Offer
import com.vibethroughcode.ftree.transfer.ImportProblem
import java.io.File
import java.math.BigInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Where a transfer has got to, as one value, so the screen can never show two things at once.
 *
 * Modelled on [com.vibethroughcode.ftree.update.UpdateState], which solved the same problem for the
 * updater: a sealed state rather than a handful of booleans that can disagree.
 */
sealed interface NearbyState {
    /** The setting is off. Nothing is bound and nothing is listening. */
    data object Disabled : NearbyState

    /** Visible and looking, with nothing in progress. */
    data class Browsing(val peers: List<NearbyPeer>) : NearbyState

    data class Connecting(val peer: NearbyPeer) : NearbyState

    /** Both devices should be showing [sas]; somebody has to say whether they match. */
    data class ConfirmingCode(val sas: String, val sending: Boolean) : NearbyState

    /** Something has arrived and is waiting to be accepted. The counts are the sender's claim. */
    data class Reviewing(val offer: Offer, val fromName: String) : NearbyState

    data class Sending(val done: Long, val total: Long) : NearbyState
    data class Receiving(val done: Long, val total: Long) : NearbyState

    /** The bytes are whole and written; the caller now runs the existing import. */
    data class Arrived(val file: File, val suggestedFileName: String) : NearbyState

    data object Sent : NearbyState

    data class Failed(
        val problem: NearbyProblem,
        val importProblem: ImportProblem? = null,
    ) : NearbyState
}

/**
 * Nearby sharing, as the rest of the app sees it.
 *
 * Shaped on [com.vibethroughcode.ftree.update.UpdateRepository], including the property that
 * matters most: **every path that opens a socket runs through
 * [NearbyPreferences.enabled] first.** With the setting off this class will not bind a port, join a
 * group or send a datagram even if something asks it to — which is what makes "no network unless
 * you turn it on" a property of the code rather than of the screen that draws the toggle.
 *
 * It owns no sockets itself. [NearbyTransport] does, and an instrumented test substitutes a fake
 * for it so the whole receive flow can be driven on an emulator, which cannot do multicast at all.
 */
class NearbyRepository(
    private val preferences: NearbyPreferences,
    private val identity: NearbyIdentity,
    private val transport: NearbyTransport,
    private val downloadDirectory: File,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
) {

    private val _state = MutableStateFlow<NearbyState>(
        if (preferences.enabled.value) NearbyState.Browsing(emptyList()) else NearbyState.Disabled,
    )
    val state: StateFlow<NearbyState> = _state.asStateFlow()

    private val peerTable = PeerTable()
    private val _peers = MutableStateFlow<List<NearbyPeer>>(emptyList())
    val peers: StateFlow<List<NearbyPeer>> = _peers.asStateFlow()

    private var visible = false
    private var beaconPrivate: BigInteger? = null
    private var beaconPublic: BigInteger? = null
    private var sweeper: Job? = null

    private var sending: NearbySendTransfer? = null
    private var receiving: NearbyReceiveTransfer? = null
    private var partFile: File? = null

    /**
     * Becomes visible, or stops.
     *
     * The keypair is minted here and thrown away on the way out. Reusing it across an advertising
     * session is a bounded trade worth naming: if it were extracted afterwards, recordings made
     * during that session could be read. Per-connection keys still differ, because the sender's is
     * fresh every time and both ends contribute a nonce.
     */
    fun setVisible(wanted: Boolean) {
        if (!preferences.enabled.value) {
            // The guard. Nothing below this line runs with the setting off.
            _state.value = NearbyState.Disabled
            return
        }
        if (wanted == visible) return

        if (!wanted) {
            stop()
            return
        }

        val private = Dh.generatePrivate()
        val public = Dh.publicOf(private)
        beaconPrivate = private
        beaconPublic = public

        val port = transport.startReceiving { channel -> onIncoming(channel) }

        transport.startDiscovery { beacon, address ->
            if (beacon.messageType == NearbyProtocol.BEACON_GOODBYE) {
                peerTable.gone(beacon.deviceId)
            } else if (beacon.speakable && isAllowed(beacon)) {
                peerTable.seen(beacon, address, clock())
            }
            _peers.value = peerTable.list()
            publishBrowsing()
        }

        transport.startAnnouncing(
            Beacon.announce(
                platform = NearbyPlatform.ANDROID,
                flags = NearbyProtocol.SUPPORTED_FLAGS,
                tcpPort = port,
                deviceId = identity.deviceId,
                keyFingerprint = Handshake.beaconFingerprint(identity.deviceId.bytes, public),
                displayName = identity.displayName,
            ),
        )
        transport.query()

        sweeper = scope.launch(Dispatchers.Default) {
            while (isActive) {
                kotlinx.coroutines.delay(NearbyProtocol.PEER_SWEEP_INTERVAL_MS)
                if (peerTable.sweep(clock()).isNotEmpty()) {
                    _peers.value = peerTable.list()
                    publishBrowsing()
                }
            }
        }

        visible = true
        publishBrowsing()
    }

    /** Called when the screen closes, and when the master switch goes off. */
    fun stop() {
        sweeper?.cancel()
        sweeper = null
        transport.stopAnnouncing()
        transport.stopDiscovery()
        transport.stopReceiving()
        peerTable.clear()
        _peers.value = emptyList()
        beaconPrivate = null
        beaconPublic = null
        visible = false
        sending?.cancel()
        receiving?.cancel()
        sending = null
        receiving = null
        _state.value = if (preferences.enabled.value) {
            NearbyState.Browsing(emptyList())
        } else {
            NearbyState.Disabled
        }
    }

    fun onEnabledChanged(enabled: Boolean) {
        if (!enabled) stop()
        _state.value = if (enabled) NearbyState.Browsing(emptyList()) else NearbyState.Disabled
    }

    /** The person at this screen said the two codes matched, or did not. */
    fun confirmCode(matched: Boolean) {
        sending?.confirmCode(matched)
    }

    fun acceptIncoming() {
        receiving?.accept()
    }

    fun declineIncoming() {
        receiving?.decline()
    }

    fun cancel() {
        sending?.cancel()
        receiving?.cancel()
    }

    /**
     * Sends a `.ftree` the caller has already exported to a file.
     *
     * A file rather than a live export, so the size and the digest are known before anything is
     * offered — and, the reason that actually matters, so no database transaction is held open
     * across a network for minutes.
     */
    fun send(peer: NearbyPeer, outgoing: OutgoingFile, pairingToken: ByteArray = Handshake.NO_TOKEN) {
        if (!preferences.enabled.value) {
            _state.value = NearbyState.Disabled
            return
        }
        _state.value = NearbyState.Connecting(peer)

        scope.launch(Dispatchers.IO) {
            val transfer = NearbySendTransfer(
                identity = identity,
                outgoing = outgoing,
                pairedByQr = !pairingToken.contentEquals(Handshake.NO_TOKEN),
                pairingToken = pairingToken,
                expectedFingerprint = peer.keyFingerprint,
                listener = object : NearbyTransferListener {
                    override fun onCode(sas: String) {
                        _state.value = NearbyState.ConfirmingCode(sas, sending = true)
                    }

                    override fun onProgress(done: Long, total: Long) {
                        _state.value = NearbyState.Sending(done, total)
                    }

                    override fun onFailed(problem: NearbyProblem, importProblem: ImportProblem?) {
                        _state.value = NearbyState.Failed(problem, importProblem)
                    }
                },
            )
            sending = transfer

            val channel = try {
                transport.connect(peer.address, peer.port, NearbyProtocol.CONNECT_TIMEOUT_MS)
            } catch (_: Exception) {
                _state.value = NearbyState.Failed(NearbyProblem.NETWORK)
                sending = null
                return@launch
            }

            val problem = transfer.run(channel)
            if (problem == null) {
                preferences.remember(peer.key)
                _state.value = NearbyState.Sent
            }
            sending = null
        }
    }

    /** Called once the importer has read what arrived, so the sender learns whether it was readable. */
    fun importFinished(problem: ImportProblem?) {
        receiving?.finish(problem)
        receiving = null
        partFile = null
    }

    private fun onIncoming(channel: NearbyChannel) {
        scope.launch(Dispatchers.IO) {
            // `.part` until it is whole, then renamed — the same pattern `UpdateClient.download`
            // uses, and for the same reason: a half-written file that looks finished is worse than
            // no file at all.
            downloadDirectory.mkdirs()
            val part = File(downloadDirectory, "nearby-${clock()}.ftree.part")
            partFile = part

            val busy = receiving != null || sending != null
            var failed = false

            val transfer = part.outputStream().use { sink ->
                val t = NearbyReceiveTransfer(
                    identity = identity,
                    beaconPrivateKey = beaconPrivate ?: return@use null,
                    beaconPublicKey = beaconPublic ?: return@use null,
                    sink = sink,
                    busy = busy,
                    listener = object : NearbyTransferListener {
                        override fun onCode(sas: String) {
                            _state.value = NearbyState.ConfirmingCode(sas, sending = false)
                        }

                        override fun onOffer(offer: Offer) {
                            val name = peerTable.list()
                                .firstOrNull { it.address == channel.remoteAddress }
                                ?.displayName
                                ?: ""
                            _state.value = NearbyState.Reviewing(offer, name)
                        }

                        override fun onProgress(done: Long, total: Long) {
                            _state.value = NearbyState.Receiving(done, total)
                        }

                        override fun onFailed(problem: NearbyProblem, importProblem: ImportProblem?) {
                            failed = true
                            _state.value = NearbyState.Failed(problem, importProblem)
                        }
                    },
                )
                receiving = t
                val problem = t.run(channel)
                failed = failed || problem != null
                t
            }

            if (transfer == null || failed) {
                // Nothing partial is left for somebody to find later and try to open.
                part.delete()
                partFile = null
                receiving = null
                runCatching { channel.close() }
                return@launch
            }

            val whole = File(downloadDirectory, part.name.removeSuffix(".part"))
            if (!part.renameTo(whole)) {
                part.delete()
                _state.value = NearbyState.Failed(NearbyProblem.NO_SPACE)
                receiving = null
                return@launch
            }
            partFile = whole
            _state.value = NearbyState.Arrived(
                file = whole,
                suggestedFileName = transfer.incomingOffer?.suggestedFileName ?: whole.name,
            )
        }
    }

    /**
     * Whether a device is one this phone will answer.
     *
     * With *devices I have used* switched on, a device that has never completed a transfer here is
     * not listed. It is a filter on this side and not a promise about the other: the beacon is
     * still public, and anybody on the network still sees it. What it does is keep a list somebody
     * is about to tap short and familiar.
     */
    private fun isAllowed(beacon: Beacon): Boolean =
        !preferences.trustedOnly.value || beacon.deviceId.hex() in preferences.trusted.value

    private fun publishBrowsing() {
        if (_state.value is NearbyState.Browsing) _state.value = NearbyState.Browsing(_peers.value)
    }
}
