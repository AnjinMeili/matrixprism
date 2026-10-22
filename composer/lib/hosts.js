import net from 'node:net';
import os from 'node:os';

const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'];

// The host in a Host header, lower-cased and without its port, with an IPv6
// address kept in its brackets. Null when the header is missing or is
// anything but a host and an optional port.
export function hostName(header) {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d+)?$/i.exec(header || '');
  return match ? match[1].toLowerCase() : null;
}

// An address or name as a browser writes it in a Host header. Null for an
// IPv6 address a URL cannot hold, such as one with a zone.
function asHostName(address) {
  if (!net.isIPv6(address))
    return address.toLowerCase();
  try {
    return new URL(`http://[${address}]/`).hostname;
  } catch {
    return null;
  }
}

// The names the server answers to when started with `--listen <listen>`: the
// loopback names and the listen address. Listening on every interface, it
// answers to each of the machine's addresses and to the machine's own name.
// A name that is not in this set was pointed at the machine by someone else.
export function servedNames(listen, interfaces = os.networkInterfaces(), machine = os.hostname()) {
  const names = new Set(LOOPBACK_NAMES);
  const add = (address) => {
    const name = asHostName(address);
    if (name)
      names.add(name);
  };
  const listening = asHostName(listen);
  if (listening !== '' && listening !== '0.0.0.0' && listening !== '[::]') {
    add(listen);
    return names;
  }
  for (const addresses of Object.values(interfaces))
    for (const { address } of addresses || [])
      add(address);
  if (machine) {
    add(machine);
    if (!machine.includes('.'))
      add(`${machine}.local`);
  }
  return names;
}
