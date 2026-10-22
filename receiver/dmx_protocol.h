// Copyright (C) 2026 Anjin <anjin@skyhighatry.com>
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 3 of the License, or
// (at your option) any later version.

#ifndef DMX_PROTOCOL_H
#define DMX_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

struct DmxPacketView {
  uint16_t universe;
  const uint8_t *slots;
  size_t slot_count;
};

struct DdpPacketView {
  uint32_t byte_offset;
  const uint8_t *data;
  size_t data_length;
  uint16_t sequence;
  uint8_t data_type;
  uint16_t destination_id;
  uint8_t flags;
  bool push_frame;
};

bool ParseArtNetDmx(const uint8_t *packet, size_t packet_size,
                    DmxPacketView *result);
bool ParseSacnDmx(const uint8_t *packet, size_t packet_size,
                  DmxPacketView *result);
bool ParseDdpPacket(const uint8_t *packet, size_t packet_size,
                    DdpPacketView *result);
bool ParsePixelAnimatorPacket(const uint8_t *packet, size_t packet_size,
                              DdpPacketView *result);
// Tries the strict Pixel Animator layout, then standard DDP.
bool ParseAutoDdpPacket(const uint8_t *packet, size_t packet_size,
                        DdpPacketView *result, bool *is_pixel_animator);
bool IsArtNetPoll(const uint8_t *packet, size_t packet_size);
bool BuildArtNetPollReply(const uint8_t ipv4[4], uint16_t first_universe,
                          uint8_t port_count, uint8_t bind_index,
                          uint8_t reply[239]);

// Copies complete RGB triples from one universe into a row-major RGB buffer.
size_t ApplyDmxPacket(uint8_t *pixels, size_t pixel_count,
                      uint16_t start_universe, const DmxPacketView &packet);
size_t ApplyDdpPacket(uint8_t *pixels, size_t pixel_byte_count,
                      const DdpPacketView &packet);

#endif  // DMX_PROTOCOL_H
