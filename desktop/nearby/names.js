/*
 * What a device calls itself on a network, and what to do with what it calls itself back.
 *
 * A port of `nearby/wire/NearbyNames.kt`. Pure, and tested, because both halves are the kind of
 * thing that is obviously fine until it is not: the default leaks a real name, and the sanitiser is
 * the only thing standing between a stranger's text and a list somebody is about to click.
 */

const protocol = require('./protocol');

/**
 * Sixteen of each, indexed by the first two bytes of the device id, so the same device is always
 * the same creature and two devices rarely collide. The tables are identical to the Kotlin's and
 * in the same order -- the index is effectively a wire format, since both ends render the other's
 * default name from the other's device id.
 */
const ADJECTIVES = [
  'Quiet', 'Amber', 'Brisk', 'Copper', 'Dusty', 'Early', 'Fernwood', 'Golden',
  'Hollow', 'Inky', 'Jasper', 'Kindly', 'Linen', 'Mellow', 'Northern', 'Olive',
];

const CREATURES = [
  'Heron', 'Swift', 'Otter', 'Marten', 'Finch', 'Badger', 'Kestrel', 'Hare',
  'Plover', 'Vole', 'Linnet', 'Stoat', 'Curlew', 'Shrew', 'Teal', 'Wren',
];

/**
 * A name for a device whose owner has not chosen one.
 *
 * Deliberately **not** the machine's hostname, and not `Build.MODEL` on the other side. Consumer
 * device names are overwhelmingly "Ankit's Galaxy" or "priya-macbook", and a default that used one
 * would broadcast a real person's name, in clear, to every stranger on a cafe network, twice a
 * second, for as long as the screen was open. The person would never be told that is what the
 * default did. "Quiet Heron" tells another device in the room apart just as well.
 */
function friendlyName(deviceId) {
  const bytes = Buffer.from(deviceId);
  if (bytes.length < 2) throw new Error('device id too short');
  return `${ADJECTIVES[bytes[0] % ADJECTIVES.length]} ${CREATURES[bytes[1] % CREATURES.length]}`;
}

/**
 * The embedding and override characters, U+202A-U+202E, and the isolates, U+2066-U+2069.
 *
 * Written as escapes deliberately: these characters are invisible, so a literal here would be a
 * line nobody could read, review, or notice had been edited.
 */
function isBidiControl(code) {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** C0 and C1. Whitespace among them becomes a space, and the caller collapses runs of it. */
function isControlCharacter(code) {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * A name from the network, made safe to draw.
 *
 * This is attacker-controlled text on its way into a list the user is about to click, so the order
 * matters:
 *
 * - **Bidirectional overrides and isolates are stripped.** This is the one that is not cosmetic.
 *   Left in, a device can name itself so that it *renders* as another device's name -- and the
 *   whole point of choosing the right row in a list is then gone.
 * - Control characters go, because a newline in a name breaks the row it is drawn in.
 * - NFC, so two spellings of the same name compare and draw the same way.
 * - Truncated to the wire limit **on a codepoint boundary**, so a cut never produces half a
 *   character.
 *
 * Returns `null` when nothing survives, which the caller replaces with `friendlyName`. An empty
 * name is not drawn as an empty row.
 */
function sanitise(raw) {
  let stripped = '';
  for (const character of String(raw)) {
    const code = character.codePointAt(0);
    if (isBidiControl(code)) continue;
    stripped += isControlCharacter(code) ? ' ' : character;
  }
  const normalised = stripped.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const truncated = truncateToBytes(normalised, protocol.BEACON_MAX_NAME_BYTES);
  return truncated.length === 0 ? null : truncated;
}

/**
 * At most `maxBytes` of UTF-8, cut between codepoints.
 *
 * Cutting a Buffer at a fixed index would split a multi-byte character, and a name that is half a
 * character is a name that decodes to a replacement glyph on the other device. Iterating the string
 * with `for...of` walks codepoints rather than UTF-16 units, so an emoji is kept or dropped whole.
 */
function truncateToBytes(value, maxBytes) {
  const text = String(value);
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = '';
  let used = 0;
  for (const character of text) {
    const cost = Buffer.byteLength(character, 'utf8');
    if (used + cost > maxBytes) break;
    out += character;
    used += cost;
  }
  return out.trim();
}

module.exports = { friendlyName, sanitise, truncateToBytes, ADJECTIVES, CREATURES };
