import assert from 'node:assert/strict';
import test from 'node:test';
import { hostName, servedNames } from '../lib/hosts.js';

test('hostName takes the host from a Host header and refuses anything else', () => {
  assert.equal(hostName('localhost:8080'), 'localhost');
  assert.equal(hostName('LocalHost'), 'localhost');
  assert.equal(hostName('127.0.0.1:8080'), '127.0.0.1');
  assert.equal(hostName('[::1]:8080'), '[::1]');
  assert.equal(hostName('evil.example:8080'), 'evil.example');
  // A name that only starts or ends like a local one is a different name.
  assert.equal(hostName('127.0.0.1.evil.example'), '127.0.0.1.evil.example');
  assert.equal(hostName('localhost.evil.example:80'), 'localhost.evil.example');

  assert.equal(hostName(undefined), null);
  assert.equal(hostName(''), null);
  assert.equal(hostName('evil.example@localhost'), null);
  assert.equal(hostName('localhost/evil.example'), null);
  assert.equal(hostName('localhost:8080:9'), null);
  assert.equal(hostName('localhost:port'), null);
  assert.equal(hostName('local host'), null);
});

const INTERFACES = {
  lo0: [{ address: '127.0.0.1' }, { address: '::1' }, { address: 'fe80::1%lo0' }],
  en0: [{ address: '192.168.1.20' }, { address: 'FD00:0:0:0:0:0:0:20' }],
};

test('servedNames is the loopback names and the listen address', () => {
  assert.deepEqual([...servedNames('127.0.0.1', INTERFACES, 'studio')].sort(),
    ['127.0.0.1', '[::1]', 'localhost']);
  const lan = servedNames('192.168.1.20', INTERFACES, 'studio');
  assert.ok(lan.has('192.168.1.20'));
  assert.ok(lan.has('localhost'));
  // Only the address it was told to listen on, not the machine's others.
  assert.ok(!lan.has('[fd00::20]'));
  assert.ok(!lan.has('studio'));
  assert.ok(servedNames('fd00:0::20', INTERFACES, 'studio').has('[fd00::20]'));
  assert.ok(servedNames('Studio.Local', INTERFACES, 'studio').has('studio.local'));
});

test('servedNames on every interface is each address and the machine name', () => {
  for (const listen of ['0.0.0.0', '::', '0:0:0:0:0:0:0:0', '']) {
    const names = servedNames(listen, INTERFACES, 'Studio');
    for (const name of ['localhost', '127.0.0.1', '[::1]', '192.168.1.20', '[fd00::20]',
      'studio', 'studio.local'])
      assert.ok(names.has(name), `${name} when listening on "${listen}"`);
    assert.ok(!names.has('0.0.0.0'));
    assert.ok(!names.has('evil.example'));
  }
  const dotted = servedNames('0.0.0.0', INTERFACES, 'studio.lan');
  assert.ok(dotted.has('studio.lan'));
  assert.ok(!dotted.has('studio.lan.local'));
});
