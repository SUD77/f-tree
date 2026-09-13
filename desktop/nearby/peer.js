#!/usr/bin/env node
/*
 * One nearby peer, on a terminal.
 *
 * This exists so the two implementations can be made to talk to each other. Everything else in the
 * project checks that they *would* agree — the golden vectors pin every byte of the handshake, and
 * both sides have their own end-to-end tests — but until a Kotlin process and a Node process have
 * actually exchanged a file, the interoperability claim rests on a table rather than on a socket.
 *
 * It is also the quickest way to try the feature by hand while the interfaces do not exist yet:
 *
 *   node nearby/peer.js receive --out /tmp/arrived.ftree
 *   node nearby/peer.js send --file ../site/playground/sample-family.ftree --to 127.0.0.1:54321
 *
 * The output is line-oriented and dull on purpose, because a test parses it:
 *
 *   PORT <n>          a receiver has bound and is listening
 *   CODE <digits>     the six digits this side derived
 *   OFFER <json>      what the sender says it is about to send
 *   DONE <sha256>     the transfer finished; the digest is of what actually crossed
 *   FAIL <name>       it did not finish, and this is why
 *
 * `--auto` answers the prompts, which is what a test wants and what a person does not.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const { NearbyIdentity } = require('./identity');
const { NearbyServer } = require('./server');
const { NearbySender } = require('./client');
const { problemName } = require('./problems');
const protocol = require('./protocol');

function say(line) {
  process.stdout.write(`${line}\n`);
}

function parseArguments(argv) {
  const options = { auto: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--auto') options.auto = true;
    else if (token.startsWith('--')) {
      options[token.slice(2)] = argv[i + 1];
      i += 1;
    } else if (!options.mode) options.mode = token;
  }
  return options;
}

/** A scratch directory for the device id, so running this never touches a real installation. */
function scratchIdentity(named) {
  const directory = named ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ftree-peer-'));
  fs.mkdirSync(directory, { recursive: true });
  return new NearbyIdentity(directory);
}

async function receive(options) {
  const out = options.out ?? path.join(os.tmpdir(), `nearby-received-${Date.now()}.ftree`);
  const identity = scratchIdentity(options.state);
  const beaconKey = identity.startAdvertising();
  const sink = fs.createWriteStream(out);
  const digest = crypto.createHash('sha256');

  const server = new NearbyServer({ identity, beaconKey, sink });
  const port = await server.listen('127.0.0.1');
  say(`PORT ${port}`);

  server.on('transfer', (transfer) => {
    if (options.token) transfer.pairingToken = Buffer.from(options.token, 'hex');

    transfer.on('code', (sas) => say(`CODE ${sas}`));
    transfer.on('offer', (offer) => {
      say(`OFFER ${JSON.stringify({
        peopleCount: offer.peopleCount,
        relationshipCount: offer.relationshipCount,
        photoCount: offer.photoCount,
        totalBytes: Number(offer.totalBytes),
        suggestedFileName: offer.suggestedFileName,
        sha256: offer.sha256.toString('hex'),
      })}`);
      if (options.auto) transfer.accept();
    });
    transfer.on('progress', ({ received }) => {
      if (options.verbose) say(`PROGRESS ${received}`);
    });
    transfer.on('complete', () => {
      sink.end(() => {
        // Hashed from the file on disk rather than from the stream, so what is reported is what a
        // reader would actually open -- the same thing the importer is about to be handed.
        digest.update(fs.readFileSync(out));
        say(`DONE ${digest.digest('hex')}`);
        transfer.verified(null);
      });
    });
    transfer.on('finished', (problem) => {
      if (problem) say(`FAIL ${problemName(problem.problem)}`);
      server.close();
      // A short grace period so the last frame reaches the peer before the process exits.
      setTimeout(() => process.exit(problem ? 1 : 0), 100);
    });
  });
}

async function send(options) {
  const [address, port] = (options.to ?? '127.0.0.1:0').split(':');
  const identity = scratchIdentity(options.state);

  const sender = new NearbySender({
    identity,
    filePath: options.file,
    counts: {
      people: Number(options.people ?? 0),
      relationships: Number(options.relationships ?? 0),
      photos: Number(options.photos ?? 0),
    },
    suggestedFileName: options.name ?? path.basename(options.file),
    pairedByQr: Boolean(options.token),
    pairingToken: options.token ? Buffer.from(options.token, 'hex') : null,
  });

  const offer = await sender.prepare();
  say(`OFFER ${JSON.stringify({
    totalBytes: Number(offer.totalBytes),
    sha256: offer.sha256.toString('hex'),
  })}`);

  sender.on('code', (sas) => {
    say(`CODE ${sas}`);
    if (options.auto) sender.confirmCode(true);
  });
  sender.on('progress', ({ sent }) => {
    if (options.verbose) say(`PROGRESS ${sent}`);
  });
  sender.on('finished', (problem) => {
    if (problem) say(`FAIL ${problemName(problem.problem)}`);
    else say(`DONE ${offer.sha256.toString('hex')}`);
    setTimeout(() => process.exit(problem ? 1 : 0), 100);
  });

  sender.connect(address, Number(port));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.mode === 'receive') await receive(options);
  else if (options.mode === 'send') await send(options);
  else {
    process.stderr.write(
      'usage: peer.js receive [--out FILE] [--auto]\n' +
        '       peer.js send --file FILE --to HOST:PORT [--auto]\n',
    );
    process.exit(2);
  }
}

main().catch((error) => {
  say(`FAIL ${error.message}`);
  process.exit(1);
});

module.exports = { parseArguments, protocol };
