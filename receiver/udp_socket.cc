// SPDX-License-Identifier: GPL-3.0-or-later
#include "udp_socket.h"

#include <errno.h>
#include <netinet/in.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include <stdexcept>
#include <string>

int CreateBoundUdpSocket(uint16_t port) {
  const int fd = socket(AF_INET, SOCK_DGRAM, 0);
  if (fd < 0)
    throw std::runtime_error(std::string("socket: ") + strerror(errno));

  int reuse = 1;
  if (setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse)) < 0) {
    const std::string error = std::string("setsockopt(SO_REUSEADDR): ") +
                              strerror(errno);
    close(fd);
    throw std::runtime_error(error);
  }

  sockaddr_in address = {};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_ANY);
  address.sin_port = htons(port);
  if (bind(fd, reinterpret_cast<sockaddr *>(&address), sizeof(address)) < 0) {
    const std::string error = std::string("bind UDP port ") +
                              std::to_string(port) + ": " + strerror(errno);
    close(fd);
    throw std::runtime_error(error);
  }
  return fd;
}
