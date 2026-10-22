// What the page takes from the server's /api/config: the matrix host and DDP
// port given on its command line (`--pi`, `--ddp-port`), and when it started.
//
// A host named on the command line wins once each time the server starts,
// even over a host saved in the browser; a host chosen in the page after that
// stands until the server is started again. Before this, a saved host always
// won, so a receiver named on the command line was ignored once any host had
// been saved.

// The settings after applying `config` ({ host, ddpPort, started }) to
// `settings`, whose `serverStarted` records the start last applied, and
// whether the host changed. `defaultPort` is the page's own default DDP port.
export function applyServerConfig(settings, config, defaultPort) {
  const next = { ...settings };
  const fresh = config?.started && config.started !== settings.serverStarted;
  if (fresh && config.host) {
    next.host = config.host;
    if (config.ddpPort) next.ddpPort = config.ddpPort;
  } else {
    // As before: a host only where none is saved, a port only over the default.
    if (!settings.host && config?.host) next.host = config.host;
    if (config?.ddpPort && settings.ddpPort === defaultPort) next.ddpPort = config.ddpPort;
  }
  if (config?.started) next.serverStarted = config.started;
  return { settings: next, hostChanged: next.host !== settings.host || next.ddpPort !== settings.ddpPort };
}
