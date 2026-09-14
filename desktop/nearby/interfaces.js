/*
 * Which of this machine's networks a nearby device could be on, and where to announce on each.
 *
 * Pure: it is handed `os.networkInterfaces()` rather than calling it, so the awkward machines -- a
 * laptop with Docker bridges, a Windows box with Hyper-V and a VPN adapter -- are rows in a test
 * table instead of machines somebody has to own.
 *
 * Those machines are the reason this exists. Joining the multicast group with no interface named
 * joins it on the OS default only, and a datagram sent to the group or to 255.255.255.255 leaves by
 * whichever adapter routing prefers. On a multi-homed machine that is routinely the wrong one --
 * a `vEthernet` switch, `docker0`, a VPN -- and discovery then finds nothing, silently, while the
 * Wi-Fi the other device is actually on is never used.
 */

const { isPrivateAddress } = require('./qrlink');

/**
 * Adapters that are a machine talking to itself: container bridges, VM host networks, VPN tunnels.
 *
 * Their addresses are private, so the address rule alone would keep them -- Docker's default bridge
 * is 172.17.0.1, squarely inside 172.16/12. Nobody in the room is on one, so announcing there is
 * noise and, worse, putting one of their addresses in the QR code would send a phone to a network
 * that does not exist outside this machine. Matched on the names the OS gives them; a genuine LAN
 * adapter is never called any of these.
 */
const VIRTUAL = [
  /^docker/i, /^br-/i, /^virbr/i, /^veth/i, /^vmnet/i, /^vboxnet/i, /^lxcbr/i, /^lxdbr/i,
  /^cni/i, /^podman/i, /^flannel/i, /^cali/i, /^tun/i, /^tap/i, /^wg/i, /^tailscale/i, /^zt/i,
  /^utun/i, /^awdl/i, /^llw/i, /^bridge\d/i,
  /vEthernet/i, /Hyper-V/i, /VirtualBox/i, /VMware/i, /\bWSL\b/i, /Loopback/i, /VPN/i, /TAP-/i,
];

function isVirtualInterface(name) {
  return VIRTUAL.some((pattern) => pattern.test(String(name)));
}

function toNumber(dotted) {
  return String(dotted).split('.').reduce((acc, octet) => ((acc << 8) | (Number(octet) & 0xff)) >>> 0, 0);
}

function toDotted(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');
}

/**
 * The subnet-directed broadcast address -- 192.168.29.255 for 192.168.29.40/24 -- or null.
 *
 * Directed rather than 255.255.255.255 because routing sends a directed broadcast out of the
 * adapter that owns that subnet, which is exactly the one this beacon is for; the limited broadcast
 * goes wherever the default route points. A /31 or /32 has no broadcast address at all.
 */
function directedBroadcast(address, netmask) {
  const mask = toNumber(netmask);
  if (mask === 0xffffffff || mask === 0xfffffffe) return null;
  return toDotted((toNumber(address) | ~mask) >>> 0);
}

/**
 * The adapters worth announcing on: IPv4, not loopback, a private or link-local address -- the same
 * rule a scanned code is held to -- and not a container bridge or VM switch. Each with its directed
 * broadcast. Sorted so the result does not depend on the order the OS happened to list them in.
 *
 * @param {object} table  what `os.networkInterfaces()` returns
 */
function lanInterfaces(table) {
  const found = [];
  for (const [name, entries] of Object.entries(table ?? {})) {
    if (isVirtualInterface(name)) continue;
    for (const entry of entries ?? []) {
      const ipv4 = entry.family === 'IPv4' || entry.family === 4;
      if (!ipv4 || entry.internal || !isPrivateAddress(entry.address)) continue;
      found.push({
        name,
        address: entry.address,
        netmask: entry.netmask,
        broadcast: directedBroadcast(entry.address, entry.netmask),
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}

/**
 * Where one beacon goes: the group and the directed broadcast, once per adapter, sent *from* that
 * adapter. With no adapter qualifying -- a machine on an odd network, or one this rule is wrong
 * about -- it falls back to what discovery did before: the group and the limited broadcast, through
 * whatever the OS picks. Degrading to the old behaviour is better than announcing nowhere.
 */
function beaconTargets(interfaces, { group, limitedBroadcast = '255.255.255.255' }) {
  if (!interfaces.length) {
    return [{ via: null, address: group }, { via: null, address: limitedBroadcast }];
  }
  const targets = [];
  for (const lan of interfaces) {
    targets.push({ via: lan.address, address: group });
    if (lan.broadcast) targets.push({ via: lan.address, address: lan.broadcast });
  }
  return targets;
}

/** How likely an address is to be the room's own network, best first: a home or office LAN. */
function rank(address) {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  if (address.startsWith('169.254.')) return 3;
  return 2; // 172.16/12
}

/**
 * The one address for the QR code and the typed fallback.
 *
 * `routed` is the address the OS would use for the nearby multicast group -- in practice the
 * adapter holding the default route, which is the Wi-Fi or Ethernet the machine is really on. It
 * wins when it is one of the LAN adapters. Without it, a home-style 192.168 address beats a 10/8,
 * which beats 172.16/12 (where container bridges live when a name slips past the filter), and a
 * link-local 169.254 comes last: it is what an adapter falls back to when nothing gave it an address.
 */
function pickAddress(interfaces, routed = null) {
  if (routed && interfaces.some((lan) => lan.address === routed)) return routed;
  const ordered = [...interfaces].sort((a, b) => rank(a.address) - rank(b.address));
  return ordered[0]?.address ?? null;
}

module.exports = { lanInterfaces, directedBroadcast, beaconTargets, pickAddress, isVirtualInterface };
