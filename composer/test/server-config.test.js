import assert from 'node:assert/strict';
import test from 'node:test';
import { applyServerConfig } from '../public/server-config.js';

// A receiver named on the server's command line, against one saved in the
// browser.

const saved = { host: 'old-panel.local', ddpPort: 4048, serverStarted: 'a' };

test('a host on the command line wins over a saved host, once per server start', () => {
  const first = applyServerConfig(saved, { host: 'new-panel.local', ddpPort: 4049, started: 'b' }, 4048);
  assert.equal(first.settings.host, 'new-panel.local');
  assert.equal(first.settings.ddpPort, 4049);
  assert.equal(first.settings.serverStarted, 'b');
  assert.equal(first.hostChanged, true);
  // A host chosen in the page afterwards stands while the same server runs.
  const chosen = { ...first.settings, host: 'chosen.local' };
  const again = applyServerConfig(chosen, { host: 'new-panel.local', ddpPort: 4049, started: 'b' }, 4048);
  assert.equal(again.settings.host, 'chosen.local');
  assert.equal(again.hostChanged, false);
  // Started again with the same receiver named: it wins again.
  const restarted = applyServerConfig(chosen, { host: 'new-panel.local', ddpPort: 4049, started: 'c' }, 4048);
  assert.equal(restarted.settings.host, 'new-panel.local');
});

test('with no host on the command line, the saved host stands', () => {
  const result = applyServerConfig(saved, { host: '', ddpPort: 4048, started: 'b' }, 4048);
  assert.equal(result.settings.host, 'old-panel.local');
  assert.equal(result.settings.serverStarted, 'b');
  assert.equal(result.hostChanged, false);
  // Nothing saved yet: the command line's host fills it, as before.
  const empty = applyServerConfig({ host: '', ddpPort: 4048 }, { host: 'panel.local', ddpPort: 4048, started: 'b' }, 4048);
  assert.equal(empty.settings.host, 'panel.local');
  // A port chosen in the page is kept when the command line names no host.
  const port = applyServerConfig({ ...saved, ddpPort: 5000 }, { host: '', ddpPort: 4048, started: 'b' }, 4048);
  assert.equal(port.settings.ddpPort, 5000);
});

test('an older server with no start time behaves as before', () => {
  const result = applyServerConfig(saved, { host: 'new-panel.local', ddpPort: 4048 }, 4048);
  assert.equal(result.settings.host, 'old-panel.local');
  assert.equal(applyServerConfig(saved, null, 4048).settings.host, 'old-panel.local');
});
