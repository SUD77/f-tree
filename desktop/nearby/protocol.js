/*
 * Every number the two nearby implementations have to agree on.
 *
 * A port of `nearby/wire/NearbyProtocol.kt`, and deliberately the same shape in the same order, so
 * a reviewer can put the two files side by side and read down. A constant that lives anywhere else
 * is a constant that can drift without anybody noticing until two people are looking at two
 * different six-digit codes.
 *
 * The reasoning behind each value is in `docs/nearby-protocol.md`. What is here is the values.
 */

/** "FTRE". On the beacon and on the first frame, so a wrong port is diagnosed and not parsed. */
const MAGIC = Buffer.from([0x46, 0x54, 0x52, 0x45]);

/** This wire protocol. Not the `.ftree` document version, which moves independently. */
const VERSION = 1;
const MIN_VERSION = 1;

// Discovery ---------------------------------------------------------------------------------

const MULTICAST_GROUP = '239.255.70.84';
const BROADCAST_ADDRESS = '255.255.255.255';
const BEACON_PORT = 50737;
const MULTICAST_TTL = 1;

const ANNOUNCE_INTERVAL_MS = 2000;
const ANNOUNCE_BURST_MS = [0, 250, 750];
const QUERY_ANSWER_JITTER_MS = 150;
const QUERY_ANSWER_MIN_GAP_MS = 500;
const PEER_EXPIRY_MS = 7000;
const PEER_SWEEP_INTERVAL_MS = 1000;
const GOODBYE_COUNT = 3;
const GOODBYE_GAP_MS = 40;

const BEACON_HEADER_SIZE = 37;
const BEACON_MAX_NAME_BYTES = 64;
const BEACON_MAX_SIZE = BEACON_HEADER_SIZE + BEACON_MAX_NAME_BYTES;

const BEACON_ANNOUNCE = 1;
const BEACON_GOODBYE = 2;
const BEACON_QUERY = 3;

// Frames ------------------------------------------------------------------------------------

const MAX_PLAINTEXT = 65536;
const GCM_TAG_BYTES = 16;
const MAX_FRAME_BODY = 1 + MAX_PLAINTEXT + GCM_TAG_BYTES;
const FRAME_HEADER_SIZE = 5;

const TYPE_HELLO = 0x01;
const TYPE_HELLO_ACK = 0x02;
const TYPE_KEY = 0x03;
const TYPE_KEY_ACK = 0x04;
const TYPE_OFFER = 0x10;
const TYPE_ACCEPT = 0x11;
const TYPE_DECLINE = 0x12;
const TYPE_DATA = 0x20;
const TYPE_END = 0x21;
const TYPE_RESULT = 0x22;
const TYPE_ABORT = 0x7f;

/** Reserved for a later merge-sync conversation. A version 1 build refuses the whole range. */
const RESERVED_TYPE_MIN = 0x30;
const RESERVED_TYPE_MAX = 0x3f;

const ROLE_SENDER = 1;
const ROLE_RECEIVER = 2;

// Capability bits ---------------------------------------------------------------------------

const FLAG_ACCEPTS_TREE = 1 << 0;
const FLAG_MERGE_SYNC = 1 << 1;
const FLAG_RESUME = 1 << 2;
const FLAG_COMPRESSED_FRAMES = 1 << 3;
const FLAG_PAIRED_BY_QR = 1 << 8;

const SUPPORTED_FLAGS = FLAG_ACCEPTS_TREE | FLAG_PAIRED_BY_QR;

// Key agreement -----------------------------------------------------------------------------

/** RFC 3526 group 14, the 2048-bit MODP prime. Compiled in, never sent. */
const DH_PRIME_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E08' +
  '8A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B' +
  '302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9' +
  'A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE6' +
  '49286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8' +
  'FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C' +
  '180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718' +
  '3995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFF' +
  'FFFFFFFF';

const DH_GENERATOR = 2;
const DH_PUBLIC_BYTES = 256;

/**
 * 256 bits, not 2048.
 *
 * The group is worth about 110 bits, so a longer exponent protects nothing and costs roughly eight
 * times the modular exponentiation.
 */
const DH_PRIVATE_BITS = 256;

const HANDSHAKE_NONCE_BYTES = 32;
const PAIRING_TOKEN_BYTES = 16;
const KEY_FINGERPRINT_BYTES = 8;

// Domain separation. ASCII, no terminator, never changed without a version bump. -------------

const LABEL_BEACON_KEY = 'f-tree/nearby/1/beacon-key';
const LABEL_TRANSCRIPT = 'f-tree/nearby/1/transcript';
const LABEL_SENDER_TO_RECEIVER = 'f-tree/nearby/1/s2r';
const LABEL_RECEIVER_TO_SENDER = 'f-tree/nearby/1/r2s';
const LABEL_SAS = 'f-tree/nearby/1/sas';
const LABEL_KEY_COMMITMENT = 'f-tree/nearby/1/key-commitment';

/** A whole SHA-256: this is a binding promise, not a label, so none of it is thrown away. */
const KEY_COMMITMENT_BYTES = 32;

const SESSION_KEY_BYTES = 32;
const SAS_RAW_BYTES = 8;

/**
 * A BigInt, because the reduction is over a 64-bit value.
 *
 * Every 64-bit quantity in this protocol is a BigInt on this side: a Number loses precision above
 * 2^53, and `vectors.txt` carries a nonce at exactly that sequence so the mistake fails loudly
 * rather than in one case out of every few million.
 */
const SAS_MODULUS = 1000000n;
const SAS_DIGITS = 6;

// Encryption --------------------------------------------------------------------------------

const AES_KEY_BYTES = 32;
const GCM_TAG_BITS = GCM_TAG_BYTES * 8;
const NONCE_BYTES = 12;

const DIRECTION_SENDER_TO_RECEIVER = 1;
const DIRECTION_RECEIVER_TO_SENDER = 2;

// Timeouts ----------------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS = 10000;
const HANDSHAKE_FRAME_TIMEOUT_MS = 15000;
const USER_DECISION_TIMEOUT_MS = 120000;
const TRANSFER_IDLE_TIMEOUT_MS = 30000;
const RESULT_WAIT_TIMEOUT_MS = 60000;
const HANDSHAKE_COOLDOWN_MS = 3000;

const MAX_OFFER_BYTES = 512 * 1024 * 1024;
const OFFER_MAX_NAME_BYTES = 96;
const PAIRING_TOKEN_LIFETIME_MS = 5 * 60000;

// The QR link -------------------------------------------------------------------------------

const QR_SCHEME = 'ftree';
const QR_HOST = 'nearby';
const QR_PATH = '/v1';

module.exports = {
  MAGIC,
  VERSION,
  MIN_VERSION,
  MULTICAST_GROUP,
  BROADCAST_ADDRESS,
  BEACON_PORT,
  MULTICAST_TTL,
  ANNOUNCE_INTERVAL_MS,
  ANNOUNCE_BURST_MS,
  QUERY_ANSWER_JITTER_MS,
  QUERY_ANSWER_MIN_GAP_MS,
  PEER_EXPIRY_MS,
  PEER_SWEEP_INTERVAL_MS,
  GOODBYE_COUNT,
  GOODBYE_GAP_MS,
  BEACON_HEADER_SIZE,
  BEACON_MAX_NAME_BYTES,
  BEACON_MAX_SIZE,
  BEACON_ANNOUNCE,
  BEACON_GOODBYE,
  BEACON_QUERY,
  MAX_PLAINTEXT,
  GCM_TAG_BYTES,
  MAX_FRAME_BODY,
  FRAME_HEADER_SIZE,
  TYPE_HELLO,
  TYPE_HELLO_ACK,
  TYPE_KEY,
  TYPE_KEY_ACK,
  TYPE_OFFER,
  TYPE_ACCEPT,
  TYPE_DECLINE,
  TYPE_DATA,
  TYPE_END,
  TYPE_RESULT,
  TYPE_ABORT,
  RESERVED_TYPE_MIN,
  RESERVED_TYPE_MAX,
  ROLE_SENDER,
  ROLE_RECEIVER,
  FLAG_ACCEPTS_TREE,
  FLAG_MERGE_SYNC,
  FLAG_RESUME,
  FLAG_COMPRESSED_FRAMES,
  FLAG_PAIRED_BY_QR,
  SUPPORTED_FLAGS,
  DH_PRIME_HEX,
  DH_GENERATOR,
  DH_PUBLIC_BYTES,
  DH_PRIVATE_BITS,
  HANDSHAKE_NONCE_BYTES,
  PAIRING_TOKEN_BYTES,
  KEY_FINGERPRINT_BYTES,
  LABEL_BEACON_KEY,
  LABEL_TRANSCRIPT,
  LABEL_SENDER_TO_RECEIVER,
  LABEL_RECEIVER_TO_SENDER,
  LABEL_SAS,
  LABEL_KEY_COMMITMENT,
  KEY_COMMITMENT_BYTES,
  SESSION_KEY_BYTES,
  SAS_RAW_BYTES,
  SAS_MODULUS,
  SAS_DIGITS,
  AES_KEY_BYTES,
  GCM_TAG_BITS,
  NONCE_BYTES,
  DIRECTION_SENDER_TO_RECEIVER,
  DIRECTION_RECEIVER_TO_SENDER,
  CONNECT_TIMEOUT_MS,
  HANDSHAKE_FRAME_TIMEOUT_MS,
  USER_DECISION_TIMEOUT_MS,
  TRANSFER_IDLE_TIMEOUT_MS,
  RESULT_WAIT_TIMEOUT_MS,
  HANDSHAKE_COOLDOWN_MS,
  MAX_OFFER_BYTES,
  OFFER_MAX_NAME_BYTES,
  PAIRING_TOKEN_LIFETIME_MS,
  QR_SCHEME,
  QR_HOST,
  QR_PATH,
};
