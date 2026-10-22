// SPDX-License-Identifier: GPL-3.0-or-later
#ifndef UDP_SOCKET_H
#define UDP_SOCKET_H

#include <stdint.h>

// Returns an IPv4 UDP socket bound to the port on all interfaces, with
// SO_REUSEADDR set. Throws std::runtime_error on failure.
int CreateBoundUdpSocket(uint16_t port);

#endif  // UDP_SOCKET_H
