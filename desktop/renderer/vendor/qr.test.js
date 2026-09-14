/*
 * The vendored QR encoder: that it is still upstream's, and that it still draws what it drew.
 *
 * A QR encoder that is wrong does not fail to draw. It draws a code that scans cleanly as a
 * *different string* -- and in a pairing flow a phone that reads the wrong address or the wrong
 * token is the worst available failure, invisible to anybody looking at the screen. So three
 * checks, each for a different way of being wrong:
 *
 *   1. The file is byte-for-byte the upstream release its header names. Anybody "fixing" it fails
 *      here, and anybody updating it has to say which version and which hash.
 *   2. Vector 15 of docs/nearby-protocol.md, "QR modules": one fixed link, the one `vectors.txt`
 *      already pins as `qrlink | encode`, drawn to exactly the matrix in docs/nearby/qr-golden.txt.
 *      That matrix was checked when it was recorded by two decoders that share no code with this
 *      encoder or with each other -- zxing-cpp and jsQR 1.4.0 -- and both read it back as the link,
 *      byte for byte, at error correction level M, version 8.
 *   3. The format information in that matrix, decoded from the standard's own BCH code rather than
 *      from anything the encoder says about itself, names level M -- the level the page asks for.
 *
 * The golden is its own file rather than a case in `vectors.txt`, which the Kotlin suite writes.
 * Two encoders may choose different masks for the same text and both be right, so what the Android
 * side should hold it to is not "ZXing draws these modules" but "ZXing *reads* these modules as the
 * link" -- which is the agreement that matters when a phone points its camera at this screen.
 */

import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { qrMatrix, qrPath, qrSvg, QUIET_ZONE, ERROR_CORRECTION } from '../qr-picture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(here, 'qr.js'));

/** qrcode-generator 1.5.2's `qrcode.js`, as published to npm and served by jsDelivr. */
const UPSTREAM_SHA256 = '18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780';

/** The file as the page loads it: a classic script, defining a global. */
function loadEncoder() {
  const sandbox = {};
  vm.runInNewContext(SOURCE.toString('utf8'), sandbox);
  assert.strictEqual(typeof sandbox.qrcode, 'function', 'the vendored file no longer defines qrcode');
  return sandbox.qrcode;
}

/** The fixed link: the one the cross-language vectors already pin, read from them. */
function vectorLink() {
  const vectors = readFileSync(path.join(here, '..', '..', '..', 'docs', 'nearby', 'vectors.txt'), 'utf8');
  const line = vectors.split('\n').find((l) => l.startsWith('qrlink | encode |'));
  assert.ok(line, 'vectors.txt no longer has a qrlink encode case');
  return line.split(' | ')[2].trim();
}

/**
 * `docs/nearby/qr-golden.txt`: the link on the first line, then one row of modules per line, `1`
 * dark and `0` light, quiet zone left out. A plain file rather than a constant here so the Android
 * suite can read the same one and prove its own decoder reads the desktop's code as the link.
 */
function golden() {
  const [link, ...rows] = readFileSync(
    path.join(here, '..', '..', '..', 'docs', 'nearby', 'qr-golden.txt'), 'utf8',
  ).trimEnd().split('\n');
  return { link, rows };
}

const draw = (matrix) => matrix.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));

test('the vendored encoder is upstream\'s, byte for byte, and says which upstream', () => {
  // Everything after the provenance comment is the published file. The comment is ours; the rest
  // is not ours to edit.
  const text = SOURCE.toString('latin1');
  const end = text.indexOf('*/\n');
  assert.ok(end > 0 && text.startsWith('/*'), 'the provenance comment is gone from the top of qr.js');
  const header = text.slice(0, end);
  const upstream = SOURCE.subarray(end + 3);

  const actual = crypto.createHash('sha256').update(upstream).digest('hex');
  assert.strictEqual(actual, UPSTREAM_SHA256, 'vendor/qr.js has been edited below its header');
  assert.ok(header.includes(UPSTREAM_SHA256), 'the header does not record the hash of what it vendors');
  assert.match(header, /qrcode-generator 1\.5\.2/);
  assert.match(header, /github\.com\/kazuhikoarase\/qrcode-generator/);
  // And the upstream licence notice is still where upstream put it.
  assert.match(upstream.toString('utf8', 0, 400), /Copyright \(c\) 2009 Kazuhiko Arase[\s\S]*MIT license/);
});

test('vector 15: the fixed link draws exactly the recorded matrix', () => {
  const { link, rows } = golden();
  // The golden is of the link the cross-language vectors already pin, not a second fixed string.
  assert.strictEqual(link, vectorLink(), 'qr-golden.txt is of a different link from vectors.txt');
  assert.ok(rows.every((row) => row.length === rows.length && /^[01]+$/.test(row)),
    'qr-golden.txt is not a square of 1s and 0s');

  const matrix = qrMatrix(loadEncoder(), link);
  assert.strictEqual(matrix.length, rows.length, 'the symbol changed size, so it changed version');
  assert.deepStrictEqual(draw(matrix), rows);
});

/**
 * The fifteen format bits around the top-left finder, in the order the standard reads them, and the
 * second copy split between the other two finders. From ISO/IEC 18004 section 7.9 -- read off the
 * picture, not asked of the encoder.
 */
function formatBits(matrix) {
  const n = matrix.length;
  const at = (row, col) => (matrix[row][col] ? 1 : 0);
  const first = [];
  for (let col = 0; col <= 5; col += 1) first.push(at(8, col));
  first.push(at(8, 7), at(8, 8), at(7, 8));
  for (let row = 5; row >= 0; row -= 1) first.push(at(row, 8));
  const second = [];
  for (let row = n - 1; row >= n - 7; row -= 1) second.push(at(row, 8));
  for (let col = n - 8; col <= n - 1; col += 1) second.push(at(8, col));
  const value = (bits) => bits.reduce((acc, bit) => (acc << 1) | bit, 0);
  return [value(first), value(second)];
}

/** The format word for five data bits: BCH(15,5) with generator 0x537, masked with 0x5412. */
function formatWord(data) {
  let remainder = data << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (remainder & (1 << bit)) remainder ^= 0x537 << (bit - 10);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

test('the format information in the matrix names the error correction the page asks for', () => {
  const matrix = qrMatrix(loadEncoder(), vectorLink());
  const [first, second] = formatBits(matrix);
  assert.strictEqual(first, second, 'the two copies of the format information disagree');

  const data = [...Array(32).keys()].find((candidate) => formatWord(candidate) === first);
  assert.notStrictEqual(data, undefined, `0x${first.toString(16)} is not a valid format word`);
  // The two level bits: 01 is L, 00 is M, 11 is Q, 10 is H.
  const level = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' }[data >> 3];
  assert.strictEqual(level, ERROR_CORRECTION);

  // And the one module the standard says is always dark, beside the lower-left finder.
  const version = (matrix.length - 17) / 4;
  assert.strictEqual(matrix[4 * version + 9][8], true);
});

test('the picture keeps the four-module quiet zone the standard asks for', () => {
  // A scanner that cannot find the edge of the code does not read it, so the margin is part of the
  // symbol. Asserted on what is drawn, not on the constant.
  const matrix = qrMatrix(loadEncoder(), vectorLink());
  const svg = qrSvg(matrix, { label: 'Code for Quiet Heron' });
  const extent = matrix.length + 2 * QUIET_ZONE;
  assert.match(svg, new RegExp(`viewBox="0 0 ${extent} ${extent}"`));
  assert.strictEqual(QUIET_ZONE, 4);

  const starts = [...qrPath(matrix).matchAll(/M(\d+) (\d+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
  assert.strictEqual(Math.min(...starts.map(([x]) => x)), QUIET_ZONE);
  assert.strictEqual(Math.min(...starts.map(([, y]) => y)), QUIET_ZONE);
  // Dark on white in either theme: many scanners never try an inverted code.
  assert.match(svg, /<rect [^>]*fill="#ffffff"/);
  assert.match(svg, /<path [^>]*fill="#000000"/);
});

test('every dark module is drawn once and no light one is', () => {
  const matrix = qrMatrix(loadEncoder(), vectorLink());
  const painted = matrix.map((row) => row.map(() => false));
  for (const [, x, y, run] of qrPath(matrix).matchAll(/M(\d+) (\d+)h(\d+)/g)) {
    for (let c = 0; c < Number(run); c += 1) {
      const row = Number(y) - QUIET_ZONE;
      const col = Number(x) - QUIET_ZONE + c;
      assert.strictEqual(painted[row][col], false, `module ${row},${col} painted twice`);
      painted[row][col] = true;
    }
  }
  assert.deepStrictEqual(draw(painted), draw(matrix));
});

test('a link that is not ASCII is refused rather than quietly re-encoded', () => {
  // The encoder's default byte conversion is Latin-1. A nearby link is ASCII by construction --
  // the name is percent-encoded -- so anything else is a bug upstream of here, and drawing it would
  // put a different string in the code than the one on screen.
  assert.throws(() => qrMatrix(loadEncoder(), 'ftree://nearby/v1?n=Ankit’s'), /ASCII/);
});
