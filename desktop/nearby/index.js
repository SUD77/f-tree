/*
 * The only file `main.js` requires.
 *
 * One entry point rather than a dozen, so that the question "what can the main process do on a
 * network?" has one place to look. Everything below it is either pure or holds exactly one socket.
 *
 * Nothing here runs until `setVisible(true)`. Before that this module has no socket bound, joins no
 * multicast group, and sends nothing -- which is what makes the macOS Local Network prompt and the
 * Windows Firewall prompt arrive at the moment the person understands what they are being asked,
 * rather than the first time they open the app.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const protocol = require('./protocol');
const { NearbyIdentity } = require('./identity');
const { Discovery } = require('./discovery');
const { NearbyServer } = require('./server');
const { NearbySender } = require('./client');
const { encodeQrLink, parseQrLink, isPrivateAddress, isTestableAddress } = require('./qrlink');
const { PROBLEM, problemName, importProblemOf } = require('./problems');
const names = require('./names');

/**
 * Everything the app can do nearby, behind one object.
 *
 * The renderer never sees this. It reaches these methods through `preload.js`, the same way it
 * reaches the updater, and `refuseTheNetwork()` in the viewer session is untouched: the page still
 * cannot open a connection, nearby sharing or not.
 */
class Nearby extends EventEmitter {
  constructor({
    directory,
    displayName = null,
    downloadDirectory = null,
    // A parameter only so a test can watch a token expire without waiting five minutes.
    pairingTokenLifetimeMs = protocol.PAIRING_TOKEN_LIFETIME_MS,
  } = {}) {
    super();
    this.directory = directory;
    this.identity = new NearbyIdentity(directory, displayName);
    this.downloadDirectory = downloadDirectory ?? path.join(directory, 'nearby');
    this.discovery = null;
    this.server = null;
    this.beaconKey = null;
    this.incoming = null;
    this.outgoing = null;
    this.pairingToken = null;
    this.pairingTokenAt = 0;
    this.pairingTokenTimer = null;
    this.pairingTokenLifetimeMs = pairingTokenLifetimeMs;
  }

  get visible() {
    return this.server !== null;
  }

  get deviceName() {
    return this.identity.displayName;
  }

  setDeviceName(name) {
    // Committed when the field is done rather than per keystroke, because this string is broadcast
    // and half a name announced twice a second is not a thing anybody meant to publish.
    this.identity.chosenName = names.sanitise(name ?? '') ?? null;
    return this.identity.displayName;
  }

  /**
   * Switching visibility on binds a socket; switching it off gives it back.
   *
   * There is deliberately no "always visible". A device that announces itself while nobody is
   * looking at it is a device somebody has forgotten they configured -- and tying visibility to an
   * open screen is also why there is no background service, no notification to justify and no wake
   * lock to ask for.
   */
  async setVisible(visible) {
    if (visible === this.visible) return this.visible;
    if (!visible) {
      this.#teardown();
      this.emit('visibility', false);
      return false;
    }

    this.beaconKey = this.identity.startAdvertising();
    fs.mkdirSync(this.downloadDirectory, { recursive: true });

    this.server = new NearbyServer({
      identity: this.identity,
      beaconKey: this.beaconKey,
      sink: null,
      maxOfferBytes: protocol.MAX_OFFER_BYTES,
    });
    this.server.on('transfer', (transfer) => this.#onIncoming(transfer));

    let port;
    try {
      port = await this.server.listen();
    } catch (error) {
      this.#teardown();
      this.emit('problem', { problem: PROBLEM.NETWORK, detail: error.message });
      return false;
    }

    try {
      if (!this.discovery) await this.#startDiscovery();
      this.discovery.advertise({ tcpPort: port, keyFingerprint: this.beaconKey.fingerprint });
    } catch (error) {
      // A bound TCP port with no discovery is still usable through a QR code or a typed address,
      // which is most of the value. Saying so beats refusing to start.
      this.emit('problem', { problem: PROBLEM.NETWORK, detail: error.message });
    }

    this.emit('visibility', true);
    return true;
  }

  get browsing() {
    return this.discovery !== null;
  }

  /**
   * Looking for receivers without becoming one.
   *
   * What a sender needs is the list, and nothing else `setVisible` does: no TCP port, no beacon, no
   * key. Before this the only way to see the list was to be visible, so a desktop that was only
   * trying to *send* announced itself as a receiver while it did -- it appeared in every other
   * device's list, and a person there could pick it and connect to a screen that was not asking to
   * be sent anything. The protocol gives the two roles to two different devices for exactly this
   * reason: "who may see me" belongs to the one that has agreed to receive.
   *
   * Binds the discovery socket only. Nothing is announced, and a QUERY from here says nothing about
   * who is asking. Turning it off while visible changes nothing, because visibility owns the
   * socket then.
   */
  async setBrowsing(browsing) {
    if (!browsing) {
      if (!this.visible) this.#closeDiscovery();
      return this.browsing;
    }
    if (!this.discovery) {
      try {
        await this.#startDiscovery();
      } catch (error) {
        this.#closeDiscovery();
        this.emit('problem', { problem: PROBLEM.NETWORK, detail: error.message });
      }
    }
    return this.browsing;
  }

  async #startDiscovery() {
    this.discovery = new Discovery({ identity: this.identity });
    this.discovery.on('appeared', () => this.emit('peers', this.peers()));
    this.discovery.on('changed', () => this.emit('peers', this.peers()));
    this.discovery.on('vanished', () => this.emit('peers', this.peers()));
    await this.discovery.start();
    this.discovery.query();
  }

  #closeDiscovery() {
    if (!this.discovery) return;
    this.discovery.close();
    this.discovery = null;
    this.emit('peers', []);
  }

  peers() {
    return this.discovery ? this.discovery.peers.list() : [];
  }

  /**
   * The QR this device shows while it is visible.
   *
   * The token in it is sixteen random bytes that are **never transmitted**. Both ends mix it into
   * the key derivation, so a device that did not see this screen derives a different key and its
   * first sealed frame fails to open. That is what turns the code from a convenience into a shared
   * secret, and it is why scanning one may skip the six-digit comparison.
   */
  qrLink() {
    if (!this.visible) return null;
    if (!this.#tokenIsLive()) this.#mintPairingToken();
    const address = localAddress();
    if (!address) return null;
    return {
      text: encodeQrLink({
        address,
        port: this.server.port,
        deviceId: this.identity.deviceId,
        keyFingerprint: this.beaconKey.fingerprint,
        token: this.pairingToken,
        displayName: this.identity.displayName,
      }),
      address,
      port: this.server.port,
    };
  }

  /**
   * Sends a `.ftree` that the caller has already written.
   *
   * Bytes on disk rather than a tree in memory, and written by the renderer's own `write.js` rather
   * than by a second encoder here -- a second encoder would mean the page's verification was
   * checking something other than what goes on the wire.
   */
  async send({ filePath, counts, suggestedFileName, peerKey = null, link = null }) {
    let address;
    let port;
    let pairedByQr = false;
    let pairingToken = null;
    let expectedFingerprint = null;

    if (link) {
      const parsed = typeof link === 'string' ? parseQrLink(link) : link;
      if (!parsed) throw new Error('that is not an f-tree nearby link');
      ({ address, port } = parsed);
      pairingToken = parsed.token;
      pairedByQr = parsed.token !== null;
      expectedFingerprint = parsed.keyFingerprint;
    } else {
      const peer = this.peers().find((candidate) => candidate.key === peerKey);
      if (!peer) throw new Error('that device is no longer nearby');
      address = peer.address;
      port = peer.port;
      expectedFingerprint = peer.keyFingerprint;
    }

    if (!isTestableAddress(address)) throw new Error(`refusing to connect to ${address}`);

    const sender = new NearbySender({
      identity: this.identity,
      filePath,
      counts,
      suggestedFileName,
      pairedByQr,
      pairingToken,
      expectedFingerprint,
    });
    // Held only once it is ready to connect. A file that failed to read -- or was too large to
    // offer -- left `outgoing` set with no connection to finish it, and every later send was then
    // refused as if a transfer were already under way.
    await sender.prepare();
    this.outgoing = sender;

    // With the name the other end gave in HELLO_ACK -- already sanitised there -- because the screen
    // asks "does <name> show the same code?", and for a typed address this is the first the sender
    // hears of who answered. It is a claim, which is exactly what the comparison then checks.
    sender.on('code', (sas) => {
      this.emit('send-code', sas, { peerName: sender.peer?.displayName ?? null });
    });
    sender.on('progress', (p) => this.emit('send-progress', p));
    sender.on('finished', (problem) => {
      // Cleared before the event, so a listener that starts the next transfer is not refused.
      if (this.outgoing === sender) this.outgoing = null;
      this.emit('send-finished', problem);
    });
    sender.connect(address, port);
    return sender;
  }

  confirmSendCode(matched) {
    this.outgoing?.confirmCode(matched);
  }

  cancelSend() {
    this.outgoing?.cancel();
  }

  acceptIncoming() {
    this.incoming?.transfer.accept();
  }

  declineIncoming() {
    this.incoming?.transfer.decline();
  }

  /**
   * The person at this screen stopped a transfer that was not waiting on their answer -- while the
   * codes were up, or partway through the bytes.
   *
   * Not `declineIncoming`: a decline is an answer to an offer, and the state machine treats one
   * arriving at any other moment as a message out of place, so the sender would be told something
   * went wrong rather than that somebody chose to stop.
   */
  cancelIncoming() {
    this.incoming?.transfer.cancel();
  }

  #onIncoming(transfer) {
    // One file per transfer, written to a `.part` and renamed only once it is whole -- the same
    // pattern `UpdateClient.download` already uses, and for the same reason: a half-written file
    // that looks finished is worse than no file.
    const partPath = path.join(this.downloadDirectory, `nearby-${Date.now()}.ftree.part`);
    const sink = fs.createWriteStream(partPath);
    transfer.sink = sink;
    /*
     * A stream with no 'error' listener throws its errors, and in the main process a thrown error
     * is a native "A JavaScript error occurred" dialog over a frozen transfer. That is what a Cancel
     * in the middle of a large file produced: the `.part` was destroyed to remove it while writes
     * were still in flight, and each of those came back as ERR_STREAM_DESTROYED with nobody to hear.
     *
     * After the transfer has ended the file is being thrown away, so an error from it is expected
     * and means nothing. During one it is real -- a full disk, a folder that went away -- and becomes
     * a problem the sender is told about instead of a crash here.
     */
    sink.on('error', (error) => {
      if (transfer.finished) return;
      transfer.stopBecause(error.code === 'ENOSPC' || error.code === 'EDQUOT' ? PROBLEM.NO_SPACE : PROBLEM.CANCELLED);
    });
    // Only a token that is still live. The timer below retires an expired one and redraws the
    // screen, but between the moment it lapses and the moment that fires, "five minutes" would
    // otherwise be five minutes and however long the event loop took.
    if (this.#tokenIsLive()) {
      transfer.pairingToken = this.pairingToken;
      // Single use: the first connection that presents it spends it, and the screen shows a new one.
      transfer.onTokenUsed = () => {
        this.#forgetPairingToken();
        this.emit('qr-changed');
      };
    }

    this.incoming = { transfer, partPath, sink };

    transfer.on('code', (sas) => {
      // Whether the sender scanned travels with the code, because it changes what this screen says:
      // a scanning sender skips the comparison, so there is nobody on the other end to compare with.
      const pairedByQr = Boolean((transfer.peerHello?.flags ?? 0) & protocol.FLAG_PAIRED_BY_QR);
      this.emit('receive-code', sas, { pairedByQr, peerName: transfer.peerHello?.displayName ?? null });
    });
    transfer.on('offer', (offer) => {
      this.emit('receive-offer', { ...describeOffer(offer), peerName: transfer.peerHello?.displayName ?? null });
    });
    transfer.on('progress', (p) => this.emit('receive-progress', p));
    const finalPath = partPath.replace(/\.part$/, '');
    // Set when the transfer fails. A failure can arrive after the last byte and before the file is
    // renamed -- a sender that aborts between END and RESULT -- and a rename after that would leave a
    // whole copy of somebody's family in this folder with nothing left to remove it.
    let abandoned = false;
    transfer.on('complete', (summary) => {
      sink.end(() => {
        if (abandoned) return;
        fs.renameSync(partPath, finalPath);
        // The exact shape `tree:chooseImport` already returns, so `planImport` and the review
        // screen need no changes at all. A transfer ends where an import begins.
        this.emit('receive-complete', {
          name: summary.suggestedFileName,
          path: finalPath,
          bytes: Number(summary.bytes),
        });
      });
    });
    transfer.on('finished', (problem) => {
      this.incoming = null;
      if (!problem) return;
      abandoned = true;
      // The handle is closed *before* the file is removed, and the event waits for both. On
      // Windows a delete over an open handle fails outright rather than deferring the way POSIX
      // does, so destroying the stream and deleting in the same breath leaves the `.part` behind
      // -- which is precisely the thing this is here to prevent. `receive-finished` therefore
      // means "and there is nothing left on disk", which is what a caller needs it to mean -- under
      // either name, since a failure can land just after the rename.
      const remove = () => fs.rm(partPath, { force: true }, () => fs.rm(finalPath, { force: true }, () => {
        this.emit('receive-finished', { ...problem, problemName: problemName(problem.problem) });
      }));
      if (sink.destroyed || sink.closed) remove();
      else sink.once('close', remove).destroy();
    });
  }

  /** Called once the importer has read the file, so the sender learns whether it was readable. */
  importFinished(importProblem = null) {
    this.incoming?.transfer.verified(importProblem);
  }

  #teardown() {
    this.#closeDiscovery();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.identity.stopAdvertising();
    this.beaconKey = null;
    this.#forgetPairingToken();
  }

  #tokenIsLive() {
    return this.pairingToken !== null
      && Date.now() - this.pairingTokenAt <= this.pairingTokenLifetimeMs;
  }

  /**
   * A fresh token for the code on screen, and a timer that retires it.
   *
   * The timer is what makes "valid for five minutes" true of the *picture* and not only of the
   * check. Without it the square would go on showing a token nothing would honour, and the phone
   * pointed at it would be refused with nothing on this screen saying why. `qr-changed` asks
   * whoever is drawing the code to ask for it again, which mints the next one.
   */
  #mintPairingToken() {
    this.#forgetPairingToken();
    this.pairingToken = crypto.randomBytes(protocol.PAIRING_TOKEN_BYTES);
    this.pairingTokenAt = Date.now();
    this.pairingTokenTimer = setTimeout(() => {
      this.#forgetPairingToken();
      this.emit('qr-changed');
    }, this.pairingTokenLifetimeMs);
    this.pairingTokenTimer.unref?.();
  }

  #forgetPairingToken() {
    if (this.pairingTokenTimer) clearTimeout(this.pairingTokenTimer);
    this.pairingTokenTimer = null;
    this.pairingToken = null;
    this.pairingTokenAt = 0;
  }
}

/** The counts shown in the prompt, labelled as the sender's claim rather than as fact. */
function describeOffer(offer) {
  return {
    peopleCount: offer.peopleCount,
    relationshipCount: offer.relationshipCount,
    photoCount: offer.photoCount,
    totalBytes: Number(offer.totalBytes),
    suggestedFileName: offer.suggestedFileName,
  };
}

/**
 * This machine's address on the local network, for the QR code.
 *
 * Filtered through the same private-range rule a scanned code is held to, so a machine with a
 * public address on one interface cannot put it in a code somebody then points a phone at.
 */
function localAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (isPrivateAddress(entry.address)) return entry.address;
    }
  }
  return null;
}

/**
 * An address somebody typed, as `{ address, port }`, or null.
 *
 * `a.b.c.d:port`, and only on a private or link-local network -- the same `isPrivateAddress` a
 * scanned code is held to, so the typed fallback is not a way round the rule that nothing here ever
 * connects to the internet. Loopback is refused too: it is a test harness's address, not a device
 * in the room, and `send()` is where the harness is let through.
 */
function parseTypedAddress(text) {
  const match = /^\s*([0-9.]+):([0-9]{1,5})\s*$/.exec(String(text ?? ''));
  if (!match) return null;
  const [, address, portText] = match;
  const port = Number(portText);
  if (!isPrivateAddress(address) || port < 1 || port > 65535) return null;
  return { address, port };
}

/**
 * The importer's own refusals, by the names `importFinished` accepts -- so the shell can refuse any
 * other string the page sends rather than pass it on to be encoded as "unreadable".
 */
const IMPORT_PROBLEMS = Object.freeze([1, 2, 3, 4, 5].map(importProblemOf));

module.exports = {
  Nearby,
  localAddress,
  parseTypedAddress,
  problemName,
  IMPORT_PROBLEMS,
  MAX_OFFER_BYTES: protocol.MAX_OFFER_BYTES,
};
