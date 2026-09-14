/*
 * Discovery on a machine with more than one network, as tables rather than as machines.
 *
 * Nobody running this suite has a Hyper-V switch, a VPN and a Docker bridge on the same laptop on
 * purpose, and multi-homing cannot be tested honestly on one loopback anyway. What can be pinned is
 * everything decided before a packet leaves: which adapters count, where each beacon goes, which
 * address the code on screen names -- and that the sends go out one adapter at a time.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  lanInterfaces, directedBroadcast, beaconTargets, pickAddress, isVirtualInterface,
} = require('./interfaces');
const { Discovery } = require('./discovery');
const protocol = require('./protocol');

const v4 = (address, netmask, extra = {}) => ({ address, netmask, family: 'IPv4', internal: false, ...extra });
const v6 = (address) => ({ address, netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false });

/** This laptop, as it was when the bug was reported: Wi-Fi plus three kinds of bridge. */
const LINUX_LAPTOP = {
  lo: [v4('127.0.0.1', '255.0.0.0', { internal: true })],
  wlp0s20f3: [v4('192.168.29.40', '255.255.255.0'), v6('fe80::1c2b:3a4d')],
  docker0: [v4('172.17.0.1', '255.255.0.0')],
  'br-aed240775d27': [v4('172.18.0.1', '255.255.0.0')],
  virbr0: [v4('192.168.122.1', '255.255.255.0')],
};

/** A Windows desktop with the adapters that make broadcast leave by the wrong door. */
const WINDOWS_DESKTOP = {
  Ethernet: [v4('10.0.4.23', '255.255.252.0')],
  'vEthernet (WSL)': [v4('172.29.64.1', '255.255.240.0')],
  'VirtualBox Host-Only Network': [v4('192.168.56.1', '255.255.255.0')],
  'Loopback Pseudo-Interface 1': [v4('127.0.0.1', '255.0.0.0', { internal: true })],
  'Wi-Fi': [v4('203.0.113.9', '255.255.255.0')], // a public address: never a nearby network
};

test('only a real LAN adapter counts: not loopback, not a bridge, not public, not IPv6', () => {
  assert.deepStrictEqual(lanInterfaces(LINUX_LAPTOP).map((l) => l.name), ['wlp0s20f3']);
  assert.deepStrictEqual(lanInterfaces(WINDOWS_DESKTOP).map((l) => l.name), ['Ethernet']);
});

test('the adapters that are a machine talking to itself are recognised by name', () => {
  for (const name of ['docker0', 'br-aed240775d27', 'virbr0', 'veth3f2a', 'vmnet8', 'vboxnet0',
    'vEthernet (Default Switch)', 'VirtualBox Host-Only Network', 'VMware Network Adapter VMnet1',
    'tun0', 'wg0', 'tailscale0', 'utun3']) {
    assert.ok(isVirtualInterface(name), name);
  }
  for (const name of ['wlp0s20f3', 'eth0', 'enp3s0', 'en0', 'Ethernet', 'Wi-Fi', 'wlan0']) {
    assert.ok(!isVirtualInterface(name), name);
  }
});

test('each adapter announces to its own subnet-directed broadcast', () => {
  assert.strictEqual(directedBroadcast('192.168.29.40', '255.255.255.0'), '192.168.29.255');
  assert.strictEqual(directedBroadcast('10.0.4.23', '255.255.252.0'), '10.0.7.255');
  assert.strictEqual(directedBroadcast('172.16.5.4', '255.240.0.0'), '172.31.255.255');
  assert.strictEqual(directedBroadcast('169.254.10.20', '255.255.0.0'), '169.254.255.255');
  // Point-to-point and host routes have no broadcast address to send to.
  assert.strictEqual(directedBroadcast('10.1.2.3', '255.255.255.255'), null);
  assert.strictEqual(directedBroadcast('10.1.2.2', '255.255.255.254'), null);
});

test('a beacon goes to the group and the directed broadcast, from every LAN adapter', () => {
  const twoLans = {
    eth0: [v4('10.0.0.8', '255.255.255.0')],
    wlan0: [v4('192.168.1.20', '255.255.255.0')],
  };
  const targets = beaconTargets(lanInterfaces(twoLans), { group: protocol.MULTICAST_GROUP });
  assert.deepStrictEqual(targets, [
    { via: '10.0.0.8', address: protocol.MULTICAST_GROUP },
    { via: '10.0.0.8', address: '10.0.0.255' },
    { via: '192.168.1.20', address: protocol.MULTICAST_GROUP },
    { via: '192.168.1.20', address: '192.168.1.255' },
  ]);
  // Never the limited broadcast while an adapter qualifies: it leaves by the default route.
  assert.ok(!targets.some((t) => t.address === '255.255.255.255'));
});

test('with no adapter that qualifies, it announces the way it always did', () => {
  const targets = beaconTargets(lanInterfaces({ lo: LINUX_LAPTOP.lo }), { group: protocol.MULTICAST_GROUP });
  assert.deepStrictEqual(targets, [
    { via: null, address: protocol.MULTICAST_GROUP },
    { via: null, address: '255.255.255.255' },
  ]);
});

test('the code on screen names the adapter the OS routes through, or the likeliest LAN', () => {
  const both = lanInterfaces({
    eth1: [v4('10.8.0.2', '255.255.255.0')],
    wlan0: [v4('192.168.1.20', '255.255.255.0')],
    eth2: [v4('169.254.7.7', '255.255.0.0')],
  });
  assert.strictEqual(pickAddress(both, '10.8.0.2'), '10.8.0.2');
  // A routed address that is not a LAN adapter -- a bridge, a VPN -- is not believed.
  assert.strictEqual(pickAddress(both, '172.17.0.1'), '192.168.1.20');
  assert.strictEqual(pickAddress(both), '192.168.1.20');
  assert.strictEqual(pickAddress(lanInterfaces({ e: [v4('169.254.7.7', '255.255.0.0')] })), '169.254.7.7');
  assert.strictEqual(pickAddress([]), null);
  // And on the laptop in the report, never the Docker bridge.
  assert.strictEqual(pickAddress(lanInterfaces(LINUX_LAPTOP)), '192.168.29.40');
});

test('discovery joins on every adapter and sends from each in turn, re-reading them each time', async () => {
  // A fake socket that records what it was asked, and completes each send a moment later -- the way
  // a real one does, which is what makes the order of option-then-send matter.
  const calls = [];
  const socket = {
    addMembership: (group, via) => calls.push(`join ${via ?? 'default'}`),
    setMulticastInterface: (via) => calls.push(`from ${via}`),
    send: (datagram, port, address, done) => {
      calls.push(`send ${address}`);
      setTimeout(done, 5);
    },
  };
  let table = { wlan0: [v4('192.168.1.20', '255.255.255.0')] };
  const discovery = new Discovery({
    identity: { deviceId: Buffer.alloc(16, 1), displayName: 'Quiet Heron' },
    interfaces: () => lanInterfaces(table),
  });
  discovery.socket = socket;

  discovery.query();
  discovery.query();
  await discovery.sending;
  assert.deepStrictEqual(calls, [
    'join 192.168.1.20',
    'from 192.168.1.20', `send ${protocol.MULTICAST_GROUP}`, 'from 192.168.1.20', 'send 192.168.1.255',
    'from 192.168.1.20', `send ${protocol.MULTICAST_GROUP}`, 'from 192.168.1.20', 'send 192.168.1.255',
  ], 'a second send began before the first had left');

  // Ethernet plugged in after the dialog opened: joined and used on the next beat.
  calls.length = 0;
  table = { ...table, eth0: [v4('10.0.0.8', '255.255.255.0')] };
  discovery.query();
  await discovery.sending;
  assert.deepStrictEqual(calls.slice(0, 2), ['join 10.0.0.8', 'from 10.0.0.8']);
  assert.ok(calls.includes('send 10.0.0.255'));
  discovery.socket = null;
});
