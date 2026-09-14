# Security Policy

## Supported versions

f-tree ships as a single APK from GitHub Releases. Only the **latest stable release** is supported.
Pre-releases (`-beta.N`) are supported only in the sense that a report against one is welcome —
fixes land in the next release rather than being backported.

| Version | Supported |
|---|---|
| Latest stable release | ✅ |
| Older releases | ❌ — please update |
| Beta channel | ⚠️ reports welcome, fixes go forward |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's [Report a
vulnerability](https://github.com/thisisankit27/f-tree/security/advisories/new) form, which opens a
private advisory visible only to the maintainer.

Please include what you were able to do, the version you tested, and — if you have one — a proof of
concept. You will get an acknowledgement within **7 days** and, where the report is valid, an
estimate of when a fix will ship. You will be credited in the advisory and the release notes unless
you would rather not be.

## What is in scope

The parts of f-tree where a vulnerability would have real consequences:

### The updater (`update/`)

This is one of two places in the app that open a socket — the other is nearby sharing, below — and
the highest-value area to look at, because a defeated check here can install an artefact rather
than merely move a file. Before installing anything it checks, in this order:

1. the download's SHA-256 against the `digest` GitHub publishes for the asset,
2. that the archive's package name is this app,
3. that its signing certificate matches the copy already installed.

Anything that defeats one of those checks, or that causes the app to install an artefact it should
have refused, is in scope. So is any request made while the update preference is off — the
repository is supposed to refuse outright.

### Import (`transfer/`)

A `.ftree` is an untrusted ZIP from a stranger in a chat app. In scope: path traversal via entry
names, zip bombs, anything that writes outside the app's own storage, and any crafted file that
causes data loss in an existing tree. Import is meant to be additive — nothing already held is
deleted and no existing value is overwritten — so **any input that causes an import to destroy or
overwrite existing data is a security bug**, not merely a bug.

### File sharing

The exported and shared files, the `FileProvider` configuration, and the content URIs handed to
other apps. In scope: any way another app obtains a file it was not granted, or any way a shared
branch carries a person who was meant to stay behind.

### Nearby sharing (`nearby/`)

The transport that sends a `.ftree` directly to another device on the same Wi-Fi. In scope:
anything that lets family data reach a device that was never shown on screen and accepted there by
name; forging or spoofing the beacon so a device impersonates one it is not; deriving or predicting
the six-digit confirmation code without controlling the network path both devices are actually on;
replaying a QR pairing token, or using one that was never scanned; and any crash or memory-safety
issue reachable from a malformed frame, before or after the handshake completes.

**The threat model is a stranger on the same LAN, not a stranger on the internet** — the beacon is
sent with a TTL of one and does not survive a router, a typed or scanned address must be private or
link-local, and the listening socket exists only while one of the two nearby screens is open. What
such a stranger can learn from the beacon alone, without being invited to connect: a device name
(generated, unless its owner chose one — never the phone's model or the owner's name by default),
a random device id that is not the tree's `sourceTreeId`, the platform, the protocol versions and
capabilities it speaks, a public-key fingerprint, and the address and port to connect to. Not the
app version, and not whether there is a tree at all. They learn
nothing about the family a device holds — no person, no name, no count — without completing the
full encrypted handshake and then being accepted on-screen by a human who can see who they are
letting in.

The six digits are what turn "an encrypted connection" into "the encrypted connection you meant to
make": both devices derive them from the handshake, and the two people holding the screens have to
agree they match. The receiver commits to its half of the key before it has seen the sender's, so a
device sitting on the path between them cannot try key guesses until it finds one that produces a
matching code — see ["Why the receiver promises
first"](docs/nearby-protocol.md#why-the-receiver-promises-first) for the mechanism. A code mismatch
means treat the network as hostile — the app says so, and deliberately offers no "try again" —
exactly as it would for any other numeric-comparison pairing. A QR pairing skips the six digits because the token itself, never sent
over the wire, stands in for that confirmation — so a stolen photograph of somebody's QR code is
worth nothing once it expires or is used once.

### The website and browser viewer

[ftree.vibethroughcode.com](https://ftree.vibethroughcode.com/) and its
[playground](https://ftree.vibethroughcode.com/playground/). The viewer parses an untrusted ZIP in
the browser; XSS through crafted names or notes is in scope. The viewer must never upload the file
it opens.

## What is out of scope

- **Physical access to an unlocked phone.** The tree is stored in the app's own storage with no
  separate passphrase. This is a documented limitation, not a defect — see below.
- Anything requiring a rooted or already-compromised device.
- The absence of at-rest encryption beyond Android's own full-disk encryption.
- Reports that an exported `.ftree` is unencrypted. It is a plain ZIP on purpose, so the data
  outlives the app.
- Missing hardening headers on the static site, absent a demonstrated impact.
- Automated scanner output with no working proof of concept.

## Design notes a reporter should know

These are deliberate, and knowing them may save you time:

- **There is no server, account or sync.** Nearby sharing does not add one: a transfer goes
  directly between two devices, encrypted, and nothing about it is stored, relayed or reconciled
  anywhere in between. The threat surface is the app on the device, the release artefacts, the
  static site, and now the nearby transport described above.
- **Nothing leaves the device except when you deliberately send it** — to a device you can see, on
  a network you are already on, with no account and nothing in between. Two of the app's six
  permissions, `INTERNET` and `REQUEST_INSTALL_PACKAGES`, exist only for the opt-in updater; three
  more exist only for nearby sharing and do nothing while both of its screens are closed.
- **An APK signed with a different key cannot update an installed f-tree** — Android refuses it.
  The updater checks the certificate itself so that this is refused early, with an explanation,
  rather than discovered at the end of a download.
- **Verify your download.** Every release publishes a SHA-256, shown on the
  [website](https://ftree.vibethroughcode.com/) and in the GitHub release:
  `sha256sum f-tree-<version>.apk`.

## Thank you

f-tree holds something people cannot re-create if it is lost. Time spent looking at it carefully is
genuinely appreciated.
