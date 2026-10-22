// Copyright (C) 2026 Anjin <anjin@skyhighatry.com>
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 3 of the License, or
// (at your option) any later version.

#include "dmx_protocol.h"

#include <string.h>

namespace {

uint16_t ReadBigEndian16(const uint8_t *data) {
  return static_cast<uint16_t>((static_cast<uint16_t>(data[0]) << 8) |
                               data[1]);
}

uint32_t ReadBigEndian32(const uint8_t *data) {
  return (static_cast<uint32_t>(data[0]) << 24) |
         (static_cast<uint32_t>(data[1]) << 16) |
         (static_cast<uint32_t>(data[2]) << 8) | data[3];
}

uint16_t ReadLittleEndian16(const uint8_t *data) {
  return static_cast<uint16_t>(data[0] |
                               (static_cast<uint16_t>(data[1]) << 8));
}

bool ReadPduLength(const uint8_t *packet, size_t packet_size,
                   size_t offset, size_t *pdu_length) {
  if (offset + 2 > packet_size)
    return false;
  const uint16_t flags_and_length = ReadBigEndian16(packet + offset);
  if ((flags_and_length & 0xf000) != 0x7000)
    return false;
  *pdu_length = flags_and_length & 0x0fff;
  return *pdu_length >= 2 && *pdu_length <= packet_size - offset;
}

}  // namespace

bool IsArtNetPoll(const uint8_t *packet, size_t packet_size) {
  return packet != NULL && packet_size >= 14 &&
         memcmp(packet, "Art-Net\0", 8) == 0 &&
         ReadLittleEndian16(packet + 8) == 0x2000 &&
         ReadBigEndian16(packet + 10) >= 14;
}

bool BuildArtNetPollReply(const uint8_t ipv4[4], uint16_t first_universe,
                          uint8_t port_count, uint8_t bind_index,
                          uint8_t reply[239]) {
  if (ipv4 == NULL || reply == NULL || port_count == 0 || port_count > 4 ||
      bind_index == 0 || first_universe > 32767 ||
      (first_universe & 15) + port_count > 16) {
    return false;
  }
  memset(reply, 0, 239);
  memcpy(reply, "Art-Net\0", 8);
  reply[9] = 0x21;
  memcpy(reply + 10, ipv4, 4);
  reply[14] = 0x36;
  reply[15] = 0x19;
  reply[17] = 1;
  reply[18] = static_cast<uint8_t>(first_universe >> 8);
  reply[19] = static_cast<uint8_t>((first_universe >> 4) & 15);
  reply[23] = 0xc0;
  memcpy(reply + 26, "RGB Matrix", 11);
  memcpy(reply + 44, "Raspberry Pi RGB Matrix Art-Net receiver", 40);
  memcpy(reply + 108, "#0001 [0000] OK", 16);
  reply[173] = port_count;
  for (uint8_t i = 0; i < port_count; ++i) {
    reply[174 + i] = 0x80;
    reply[190 + i] = static_cast<uint8_t>((first_universe + i) & 15);
    reply[213 + i] = 0xc0;
  }
  memcpy(reply + 207, ipv4, 4);
  reply[211] = bind_index;
  reply[212] = 0x08;  // Supports 15-bit port addresses.
  return true;
}

bool ParseArtNetDmx(const uint8_t *packet, size_t packet_size,
                    DmxPacketView *result) {
  static const uint8_t kArtNetId[] = {'A', 'r', 't', '-', 'N', 'e', 't', 0};
  const size_t kHeaderSize = 18;
  if (packet == NULL || result == NULL || packet_size < kHeaderSize ||
      memcmp(packet, kArtNetId, sizeof(kArtNetId)) != 0 ||
      ReadLittleEndian16(packet + 8) != 0x5000 ||
      ReadBigEndian16(packet + 10) < 14) {
    return false;
  }

  const size_t slot_count = ReadBigEndian16(packet + 16);
  if (slot_count < 2 || slot_count > 512 ||
      (slot_count & 1) != 0 || packet_size < kHeaderSize + slot_count) {
    return false;
  }

  result->universe = static_cast<uint16_t>(
      packet[14] | ((packet[15] & 0x7f) << 8));
  result->slots = packet + kHeaderSize;
  result->slot_count = slot_count;
  return true;
}

bool ParseSacnDmx(const uint8_t *packet, size_t packet_size,
                  DmxPacketView *result) {
  static const uint8_t kAcnPacketIdentifier[] = {
      'A', 'S', 'C', '-', 'E', '1', '.', '1', '7', 0, 0, 0};
  const size_t kMinimumPacketSize = 126;
  if (packet == NULL || result == NULL || packet_size < kMinimumPacketSize ||
      ReadBigEndian16(packet) != 0x0010 ||
      ReadBigEndian16(packet + 2) != 0 ||
      memcmp(packet + 4, kAcnPacketIdentifier,
             sizeof(kAcnPacketIdentifier)) != 0) {
    return false;
  }

  size_t root_length;
  size_t framing_length;
  size_t dmp_length;
  if (!ReadPduLength(packet, packet_size, 16, &root_length) ||
      !ReadPduLength(packet, packet_size, 38, &framing_length) ||
      !ReadPduLength(packet, packet_size, 115, &dmp_length) ||
      ReadBigEndian32(packet + 18) != 4 ||
      ReadBigEndian32(packet + 40) != 2 ||
      packet[117] != 2 || packet[118] != 0xa1 ||
      ReadBigEndian16(packet + 119) != 0 ||
      ReadBigEndian16(packet + 121) != 1) {
    return false;
  }
  if (root_length < 22 || framing_length < 77 || dmp_length < 11)
    return false;

  const size_t property_value_count = ReadBigEndian16(packet + 123);
  if (property_value_count < 1 || property_value_count > 513 ||
      property_value_count > packet_size - 125 ||
      dmp_length < 10 + property_value_count ||
      framing_length < 77 + dmp_length ||
      root_length < 22 + framing_length ||
      packet[125] != 0) {
    return false;
  }

  const uint16_t universe = ReadBigEndian16(packet + 113);
  if (universe == 0 || universe > 63999)
    return false;

  result->universe = universe;
  result->slots = packet + 126;
  result->slot_count = property_value_count - 1;
  return true;
}

bool ParseDdpPacket(const uint8_t *packet, size_t packet_size,
                    DdpPacketView *result) {
  if (packet == NULL || result == NULL || packet_size < 10 ||
      (packet[0] & 0xc0) != 0x40) {
    return false;
  }
  // The timecode flag inserts a 4-byte timecode between header and data.
  const size_t kHeaderSize = (packet[0] & 0x10) != 0 ? 14 : 10;
  if (packet_size < kHeaderSize)
    return false;
  // 0x0b encodes standard RGB with 8-bit components. Keep accepting the
  // existing 0x01 encoding for compatibility with earlier senders.
  if (packet[2] != 0x0b && packet[2] != 0x01)
    return false;

  const size_t data_length = ReadBigEndian16(packet + 8);
  if (data_length == 0 || packet_size < kHeaderSize + data_length)
    return false;

  result->byte_offset = ReadBigEndian32(packet + 4);
  result->data = packet + kHeaderSize;
  result->data_length = data_length;
  result->sequence = packet[1];
  result->data_type = packet[2];
  result->destination_id = packet[3];
  result->flags = packet[0];
  result->push_frame = (packet[0] & 0x01) != 0;
  return true;
}

bool ParsePixelAnimatorPacket(const uint8_t *packet, size_t packet_size,
                              DdpPacketView *result) {
  // Observed Pixel Animator 3 layout: two flag bytes, 16-bit sequence and
  // output ID, 32-bit byte offset, 16-bit length, then RGB data.
  const size_t header_size = 12;
  if (packet == NULL || result == NULL || packet_size < header_size ||
      packet[0] != 0x41 || packet[1] != 0x41 ||
      ReadBigEndian16(packet + 4) != 1) {
    return false;
  }
  const size_t data_length = ReadBigEndian16(packet + 10);
  if (data_length == 0 || data_length % 3 != 0 ||
      packet_size - header_size != data_length) {
    return false;
  }
  result->byte_offset = ReadBigEndian32(packet + 6);
  result->data = packet + header_size;
  result->data_length = data_length;
  result->sequence = ReadBigEndian16(packet + 2);
  result->data_type = 0;
  result->destination_id = ReadBigEndian16(packet + 4);
  result->flags = packet[0];
  result->push_frame = true;
  return true;
}

bool ParseAutoDdpPacket(const uint8_t *packet, size_t packet_size,
                        DdpPacketView *result, bool *is_pixel_animator) {
  if (is_pixel_animator == NULL)
    return false;
  if (ParsePixelAnimatorPacket(packet, packet_size, result)) {
    *is_pixel_animator = true;
    return true;
  }
  *is_pixel_animator = false;
  return ParseDdpPacket(packet, packet_size, result);
}

size_t ApplyDmxPacket(uint8_t *pixels, size_t pixel_count,
                      uint16_t start_universe, const DmxPacketView &packet) {
  if (pixels == NULL || packet.slots == NULL ||
      packet.universe < start_universe) {
    return 0;
  }

  const size_t universe_offset =
      static_cast<size_t>(packet.universe - start_universe) * 170;
  if (universe_offset >= pixel_count)
    return 0;

  const size_t complete_pixels = packet.slot_count / 3;
  const size_t pixels_to_copy =
      complete_pixels < pixel_count - universe_offset
          ? complete_pixels
          : pixel_count - universe_offset;
  if (pixels_to_copy == 0)
    return 0;

  memcpy(pixels + universe_offset * 3, packet.slots, pixels_to_copy * 3);
  return pixels_to_copy;
}

size_t ApplyDdpPacket(uint8_t *pixels, size_t pixel_byte_count,
                      const DdpPacketView &packet) {
  if (pixels == NULL || packet.data == NULL ||
      packet.byte_offset >= pixel_byte_count) {
    return 0;
  }

  const size_t byte_count =
      packet.data_length < pixel_byte_count - packet.byte_offset
          ? packet.data_length
          : pixel_byte_count - packet.byte_offset;
  memcpy(pixels + packet.byte_offset, packet.data, byte_count);
  return byte_count;
}
