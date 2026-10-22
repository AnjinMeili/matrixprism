// -*- mode: c++; c-basic-offset: 2; indent-tabs-mode: nil; -*-
// MatrixPrism receiver: display Art-Net, sACN and DDP pixel data on an RGB
// LED matrix, and record and play back what is displayed.
//
// Copyright (C) 2013 Henner Zeller <h.zeller@acm.org>
// Copyright (C) 2026 Anjin <anjin@skyhighatry.com>
//
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 3 of the License, or
// (at your option) any later version.

#include <arpa/inet.h>
#include <errno.h>
#include <getopt.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <inttypes.h>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "dmx_protocol.h"
#include "led-matrix.h"
#include "wled_compat.h"
#include "stream_store.h"
#include "udp_socket.h"

using namespace rgb_matrix;

namespace {

const int kArtNetPort = 6454;
const int kSacnPort = 5568;
const int kDdpPort = 4048;
const size_t kMaxUdpPacketSize = 1500;
const size_t kSacnMembershipsPerSocket = 16;
const int kPartialFrameFlushMs = 40;
const int kDebugReportIntervalMs = 1000;
volatile sig_atomic_t gShouldStop = 0;

void HandleStopSignal(int) {
  gShouldStop = 1;
}

bool ParseUniverse(const char *text, uint32_t *universe) {
  char *end = NULL;
  errno = 0;
  const unsigned long parsed = strtoul(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0' ||
      parsed > std::numeric_limits<uint32_t>::max()) {
    return false;
  }
  *universe = static_cast<uint32_t>(parsed);
  return true;
}

// A bound listener tuned for bursty pixel data.
int CreateUdpSocket(uint16_t port) {
  const int fd = CreateBoundUdpSocket(port);

#ifdef IP_MULTICAST_ALL
  int socket_memberships_only = 0;
  if (setsockopt(fd, IPPROTO_IP, IP_MULTICAST_ALL, &socket_memberships_only,
                 sizeof(socket_memberships_only)) < 0) {
    const std::string error = std::string("setsockopt(IP_MULTICAST_ALL): ") +
                              strerror(errno);
    close(fd);
    throw std::runtime_error(error);
  }
#endif

  // A full-matrix DDP frame arrives as a burst of ~100 datagrams; the default
  // receive buffer can overflow while the display is busy. Best effort only:
  // SO_RCVBUFFORCE needs CAP_NET_ADMIN, SO_RCVBUF is capped by rmem_max.
  int receive_buffer = 4 * 1024 * 1024;
#ifdef SO_RCVBUFFORCE
  if (setsockopt(fd, SOL_SOCKET, SO_RCVBUFFORCE, &receive_buffer,
                 sizeof(receive_buffer)) < 0)
#endif
    setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &receive_buffer,
               sizeof(receive_buffer));
  return fd;
}

void PlayClips(RGBMatrix *matrix, StreamPlayback &playback,
               bool loop) {
  FrameCanvas *canvas = matrix->CreateFrameCanvas();
  playback.Play(matrix->width(), matrix->height(), loop,
      [&](const std::vector<uint8_t> &pixels) {
        size_t byte = 0;
        for (int y = 0; y < matrix->height(); ++y) {
          for (int x = 0; x < matrix->width(); ++x) {
            canvas->SetPixel(x, y, pixels[byte], pixels[byte + 1],
                            pixels[byte + 2]);
            byte += 3;
          }
        }
        canvas = matrix->SwapOnVSync(canvas);
      }, [] { return gShouldStop != 0; });
}

enum DdpFormat { kDdpAuto, kDdpStandard, kDdpPixelAnimator };
enum Listener { kArtNetListener, kDdpListener, kSacnListener };

const char *DdpFormatName(DdpFormat format) {
  switch (format) {
    case kDdpStandard:
      return "standard";
    case kDdpPixelAnimator:
      return "pixel-animator";
    default:
      return "auto";
  }
}

class DmxReceiver {
 public:
  struct ProtocolFrame {
    explicit ProtocolFrame(size_t pixel_count, size_t universe_count)
        : pixels(pixel_count * 3, 0),
          received_universes(universe_count, false),
          received_count(0),
          dirty(false),
          last_update(std::chrono::steady_clock::now()) {}

    std::vector<uint8_t> pixels;
    std::vector<bool> received_universes;
    size_t received_count;
    bool dirty;
    std::chrono::steady_clock::time_point last_update;
    uint64_t packets = 0;
    uint64_t accepted = 0;
    uint64_t renders = 0;
    double draw_ms = 0;
    double swap_ms = 0;

    void MarkDirty() {
      if (!dirty)
        last_update = std::chrono::steady_clock::now();
      dirty = true;
    }
  };

  DmxReceiver(RGBMatrix *matrix, uint16_t artnet_start_universe,
              uint16_t sacn_start_universe, bool debug, DdpFormat ddp_format,
              StreamRecording *recording)
      : matrix_(matrix),
        pixel_count_(static_cast<size_t>(matrix->width()) * matrix->height()),
        universe_count_((pixel_count_ + 169) / 170),
        artnet_start_universe_(artnet_start_universe),
        sacn_start_universe_(sacn_start_universe),
        debug_(debug),
        ddp_format_(ddp_format),
        recording_(recording),
        artnet_fd_(-1),
        ddp_fd_(-1),
        canvas_(matrix->CreateFrameCanvas()),
        artnet_frame_(pixel_count_, universe_count_),
        sacn_frame_(pixel_count_, universe_count_),
        ddp_frame_(pixel_count_, universe_count_),
        last_debug_report_(std::chrono::steady_clock::now()),
        ddp_received_(0),
        ddp_valid_(0),
        ddp_out_of_range_(0),
        ddp_bytes_applied_(0),
        ddp_pushes_(0),
        ddp_have_last_header_(false) {
    artnet_fd_ = CreateUdpSocket(kArtNetPort);
    try {
      ddp_fd_ = CreateUdpSocket(kDdpPort);
      JoinSacnUniverses();
    } catch (...) {
      close(artnet_fd_);
      if (ddp_fd_ >= 0)
        close(ddp_fd_);
      for (size_t i = 0; i < sacn_fds_.size(); ++i)
        close(sacn_fds_[i]);
      throw;
    }
  }

  ~DmxReceiver() {
    if (artnet_fd_ >= 0)
      close(artnet_fd_);
    if (ddp_fd_ >= 0)
      close(ddp_fd_);
    for (size_t i = 0; i < sacn_fds_.size(); ++i)
      close(sacn_fds_[i]);
  }

  void Run() {
    std::vector<struct pollfd> descriptors;
    descriptors.reserve(sacn_fds_.size() + 2);
    descriptors.push_back({artnet_fd_, POLLIN, 0});
    descriptors.push_back({ddp_fd_, POLLIN, 0});
    for (size_t i = 0; i < sacn_fds_.size(); ++i)
      descriptors.push_back({sacn_fds_[i], POLLIN, 0});

    uint8_t buffer[kMaxUdpPacketSize];
    while (!gShouldStop) {
      if (recording_)
        recording_->CheckDuration();
      const int ready =
          poll(&descriptors[0], descriptors.size(), kPartialFrameFlushMs);
      if (ready < 0) {
        if (errno == EINTR)
          continue;
        throw std::runtime_error(std::string("poll: ") + strerror(errno));
      }
      if (ready == 0) {
        FlushTimedOutFrames();
        ReportDebugStats();
        continue;
      }
      for (size_t i = 0; i < descriptors.size(); ++i) {
        if ((descriptors[i].revents & POLLIN) != 0) {
          // Bound each batch so busy inputs cannot starve the other listeners.
          const Listener listener = i == 0   ? kArtNetListener
                                    : i == 1 ? kDdpListener
                                             : kSacnListener;
          for (size_t batch = 0; batch < 64 && !gShouldStop; ++batch) {
            if (!ReceiveOne(descriptors[i].fd, listener, buffer,
                            sizeof(buffer)))
              break;
          }
        }
        if ((descriptors[i].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0)
          throw std::runtime_error("UDP listener reported a socket error");
      }
      FlushTimedOutFrames();
      ReportDebugStats();
    }
  }

 private:
  void FlushTimedOutFrames() {
    const std::chrono::steady_clock::time_point now =
        std::chrono::steady_clock::now();
    FlushIfTimedOut(artnet_frame_, now);
    FlushIfTimedOut(sacn_frame_, now);
    FlushIfTimedOut(ddp_frame_, now);
  }

  void FlushIfTimedOut(ProtocolFrame &frame,
                       std::chrono::steady_clock::time_point now) {
    if (frame.dirty &&
        now - frame.last_update >=
            std::chrono::milliseconds(kPartialFrameFlushMs)) {
      FlushFrame(frame);
    }
  }

  void FlushFrame(ProtocolFrame &frame) {
    const auto render_start = std::chrono::steady_clock::now();
    size_t offset = 0;
    const int width = matrix_->width();
    const int height = matrix_->height();
    for (int y = 0; y < height; ++y) {
      for (int x = 0; x < width; ++x) {
        canvas_->SetPixel(x, y, frame.pixels[offset], frame.pixels[offset + 1],
                          frame.pixels[offset + 2]);
        offset += 3;
      }
    }
    const auto swap_start = std::chrono::steady_clock::now();
    canvas_ = matrix_->SwapOnVSync(canvas_);
    const auto swap_end = std::chrono::steady_clock::now();
    if (recording_)
      recording_->Capture(frame.pixels, swap_end);
    std::fill(frame.received_universes.begin(),
              frame.received_universes.end(), false);
    frame.received_count = 0;
    frame.dirty = false;
    ++frame.renders;
    frame.draw_ms +=
        std::chrono::duration<double, std::milli>(swap_start - render_start)
            .count();
    frame.swap_ms +=
        std::chrono::duration<double, std::milli>(swap_end - swap_start)
            .count();
  }

  void ReportDebugStats() {
    if (!debug_)
      return;
    const std::chrono::steady_clock::time_point now =
        std::chrono::steady_clock::now();
    if (now - last_debug_report_ <
        std::chrono::milliseconds(kDebugReportIntervalMs)) {
      return;
    }
    const double interval_seconds =
        std::chrono::duration<double>(now - last_debug_report_).count();
    ReportProtocolStats("Art-Net", artnet_frame_, interval_seconds);
    ReportProtocolStats("sACN", sacn_frame_, interval_seconds);
    fprintf(stderr,
            "DDP stats (%.2fs): received=%llu valid=%llu invalid=%llu "
            "out-of-range=%llu "
            "bytes-applied=%llu pushes=%llu display-swaps=%llu "
            "packets/s=%.1f render-fps=%.1f draw-ms/frame=%.2f "
            "vsync-ms/frame=%.2f buffer[0..2]=%u,%u,%u\n",
            interval_seconds,
            static_cast<unsigned long long>(ddp_received_),
            static_cast<unsigned long long>(ddp_valid_),
            static_cast<unsigned long long>(ddp_received_ - ddp_valid_),
            static_cast<unsigned long long>(ddp_out_of_range_),
            static_cast<unsigned long long>(ddp_bytes_applied_),
            static_cast<unsigned long long>(ddp_pushes_),
            static_cast<unsigned long long>(ddp_frame_.renders),
            ddp_received_ / interval_seconds,
            ddp_frame_.renders / interval_seconds,
            ddp_frame_.renders == 0
                ? 0
                : ddp_frame_.draw_ms / ddp_frame_.renders,
            ddp_frame_.renders == 0
                ? 0
                : ddp_frame_.swap_ms / ddp_frame_.renders,
            ddp_frame_.pixels[0],
            ddp_frame_.pixels[1], ddp_frame_.pixels[2]);
    if (ddp_have_last_header_) {
      fprintf(stderr,
              "DDP last packet: seq=%u flags=0x%02x type=%u destination=%u "
              "offset=%" PRIu32 " length=%zu push=%s source=%s:%u "
              "payload RGB=(%u,%u,%u)\n",
              ddp_last_header_.sequence, ddp_last_header_.flags,
              ddp_last_header_.data_type, ddp_last_header_.destination_id,
              ddp_last_header_.byte_offset, ddp_last_header_.data_length,
              ddp_last_header_.push_frame ? "yes" : "no",
              ddp_last_source_ip_.c_str(), ddp_last_source_port_,
              ddp_last_payload_rgb_[0], ddp_last_payload_rgb_[1],
              ddp_last_payload_rgb_[2]);
    }
    ddp_received_ = 0;
    ddp_valid_ = 0;
    ddp_out_of_range_ = 0;
    ddp_bytes_applied_ = 0;
    ddp_pushes_ = 0;
    ddp_frame_.renders = 0;
    ddp_frame_.draw_ms = 0;
    ddp_frame_.swap_ms = 0;
    last_debug_report_ = now;
  }

  void ReportProtocolStats(const char *name, ProtocolFrame &frame,
                           double seconds) {
    fprintf(stderr,
            "%s stats (%.2fs): received=%llu applied=%llu "
            "packets/s=%.1f render-fps=%.1f pending-universes=%zu/%zu "
            "draw-ms/frame=%.2f vsync-ms/frame=%.2f\n",
            name, seconds, static_cast<unsigned long long>(frame.packets),
            static_cast<unsigned long long>(frame.accepted),
            frame.packets / seconds, frame.renders / seconds,
            frame.received_count, universe_count_,
            frame.renders == 0 ? 0 : frame.draw_ms / frame.renders,
            frame.renders == 0 ? 0 : frame.swap_ms / frame.renders);
    frame.packets = 0;
    frame.accepted = 0;
    frame.renders = 0;
    frame.draw_ms = 0;
    frame.swap_ms = 0;
  }

  void JoinSacnUniverses() {
    for (size_t offset = 0; offset < universe_count_; ++offset) {
      if (offset % kSacnMembershipsPerSocket == 0) {
        const int fd = CreateUdpSocket(kSacnPort);
        try {
          sacn_fds_.push_back(fd);
        } catch (...) {
          close(fd);
          throw;
        }
      }
      const uint32_t universe =
          static_cast<uint32_t>(sacn_start_universe_) + offset;
      ip_mreq membership = {};
      const uint32_t group = 0xefff0000u | universe;
      membership.imr_multiaddr.s_addr = htonl(group);
      membership.imr_interface.s_addr = htonl(INADDR_ANY);
      if (setsockopt(sacn_fds_.back(), IPPROTO_IP, IP_ADD_MEMBERSHIP,
                     &membership, sizeof(membership)) < 0) {
        throw std::runtime_error(std::string("join sACN universe ") +
                                 std::to_string(universe) + ": " +
                                 strerror(errno));
      }
    }
  }

  // Returns false once the socket has no more queued datagrams.
  bool ReceiveOne(int fd, Listener listener, uint8_t *buffer,
                  size_t buffer_size) {
    sockaddr_in source = {};
    socklen_t source_size = sizeof(source);
    const ssize_t bytes_received =
        recvfrom(fd, buffer, buffer_size, MSG_DONTWAIT,
                 reinterpret_cast<sockaddr *>(&source), &source_size);
    if (bytes_received < 0) {
      if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)
        return false;
      throw std::runtime_error(std::string("recvfrom: ") + strerror(errno));
    }
    const size_t size = static_cast<size_t>(bytes_received);

    if (listener == kDdpListener) {
      HandleDdp(buffer, size, source);
    } else if (listener == kArtNetListener && IsArtNetPoll(buffer, size)) {
      // Discovery is best effort; an unreachable scanner must not stop output.
      try {
        ReplyToArtPoll(source);
      } catch (const std::exception &error) {
        fprintf(stderr, "ArtPoll reply skipped: %s\n", error.what());
      }
    } else {
      HandleDmx(buffer, size, listener == kSacnListener);
    }
    return true;
  }

  void ReportRejectedDdp(const uint8_t *buffer, size_t size) {
    fprintf(stderr, "DDP rejected %zu-byte UDP packet; first 24 bytes:", size);
    const size_t header_bytes = size < 24 ? size : 24;
    for (size_t i = 0; i < header_bytes; ++i)
      fprintf(stderr, " %02x", buffer[i]);
    fprintf(stderr, "\n");
    if (size < 10)
      return;
    const uint32_t standard_offset =
        (static_cast<uint32_t>(buffer[4]) << 24) |
        (static_cast<uint32_t>(buffer[5]) << 16) |
        (static_cast<uint32_t>(buffer[6]) << 8) | buffer[7];
    const unsigned int standard_length =
        (static_cast<unsigned int>(buffer[8]) << 8) | buffer[9];
    fprintf(stderr,
            "DDP standard-header interpretation: flags=0x%02x "
            "sequence=0x%02x type=0x%02x destination=%u "
            "offset=%" PRIu32 " declared-length=%u available=%zu\n",
            buffer[0], buffer[1], buffer[2], buffer[3], standard_offset,
            standard_length, size - 10);
  }

  void RememberDdpPacket(const DdpPacketView &packet,
                         const sockaddr_in &source) {
    ddp_last_header_ = packet;
    ddp_have_last_header_ = true;
    for (size_t i = 0; i < 3; ++i) {
      ddp_last_payload_rgb_[i] = packet.data_length > i ? packet.data[i] : 0;
    }
    char source_ip[INET_ADDRSTRLEN] = {};
    if (inet_ntop(AF_INET, &source.sin_addr, source_ip, sizeof(source_ip)) !=
        NULL) {
      ddp_last_source_ip_ = source_ip;
    } else {
      ddp_last_source_ip_ = "unknown";
    }
    ddp_last_source_port_ = ntohs(source.sin_port);
  }

  void HandleDdp(const uint8_t *buffer, size_t size,
                 const sockaddr_in &source) {
    ++ddp_received_;
    DdpPacketView packet = {};
    bool is_pixel_animator = ddp_format_ == kDdpPixelAnimator;
    bool valid = false;
    if (ddp_format_ == kDdpAuto) {
      valid = ParseAutoDdpPacket(buffer, size, &packet, &is_pixel_animator);
    } else if (is_pixel_animator) {
      valid = ParsePixelAnimatorPacket(buffer, size, &packet);
    } else {
      valid = ParseDdpPacket(buffer, size, &packet);
    }
    if (!valid) {
      if (debug_ && (ddp_received_ == 1 || ddp_received_ % 1000 == 0))
        ReportRejectedDdp(buffer, size);
      return;
    }
    ++ddp_valid_;
    if (debug_)
      RememberDdpPacket(packet, source);
    const size_t updated =
        ApplyDdpPacket(&ddp_frame_.pixels[0], pixel_count_ * 3, packet);
    if (updated == 0) {
      ++ddp_out_of_range_;
      return;
    }
    ddp_bytes_applied_ += updated;
    ddp_frame_.MarkDirty();
    // The observed compatibility header sets its flag on every chunk.
    // Present at the end of the matrix buffer instead of swapping per chunk.
    const bool present = is_pixel_animator
                             ? updated == pixel_count_ * 3 - packet.byte_offset
                             : packet.push_frame;
    if (present) {
      ++ddp_pushes_;
      FlushFrame(ddp_frame_);
    }
  }

  void HandleDmx(const uint8_t *buffer, size_t size, bool is_sacn) {
    ProtocolFrame &frame = is_sacn ? sacn_frame_ : artnet_frame_;
    ++frame.packets;
    DmxPacketView packet = {};
    const bool valid = is_sacn ? ParseSacnDmx(buffer, size, &packet)
                               : ParseArtNetDmx(buffer, size, &packet);
    if (!valid)
      return;

    const uint16_t start_universe =
        is_sacn ? sacn_start_universe_ : artnet_start_universe_;
    const size_t updated = ApplyDmxPacket(
        &frame.pixels[0], pixel_count_, start_universe, packet);
    if (updated == 0)
      return;
    ++frame.accepted;

    const size_t universe_offset = packet.universe - start_universe;
    if (!frame.received_universes[universe_offset]) {
      frame.received_universes[universe_offset] = true;
      ++frame.received_count;
    }
    frame.MarkDirty();
    if (frame.received_count == universe_count_)
      FlushFrame(frame);
  }

  void ReplyToArtPoll(sockaddr_in destination) {
    destination.sin_port = htons(kArtNetPort);
    const int route_fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (route_fd < 0)
      throw std::runtime_error(std::string("ArtPoll route socket: ") +
                               strerror(errno));
    sockaddr_in local = {};
    socklen_t local_size = sizeof(local);
    if (connect(route_fd, reinterpret_cast<sockaddr *>(&destination),
                sizeof(destination)) < 0 ||
        getsockname(route_fd, reinterpret_cast<sockaddr *>(&local),
                    &local_size) < 0) {
      const std::string error = std::string("ArtPoll local address: ") +
                                strerror(errno);
      close(route_fd);
      throw std::runtime_error(error);
    }
    close(route_fd);
    size_t offset = 0;
    uint8_t bind_index = 1;
    while (offset < universe_count_) {
      const uint16_t universe =
          static_cast<uint16_t>(artnet_start_universe_ + offset);
      const size_t ports = std::min(
          std::min(static_cast<size_t>(4), universe_count_ - offset),
          static_cast<size_t>(16 - (universe & 15)));
      uint8_t reply[239];
      if (!BuildArtNetPollReply(
              reinterpret_cast<const uint8_t *>(&local.sin_addr.s_addr),
              universe, static_cast<uint8_t>(ports), bind_index, reply)) {
        throw std::runtime_error("Cannot encode ArtPollReply universe range");
      }
      if (sendto(artnet_fd_, reply, sizeof(reply), 0,
                 reinterpret_cast<sockaddr *>(&destination),
                 sizeof(destination)) < 0) {
        throw std::runtime_error(std::string("send ArtPollReply: ") +
                                 strerror(errno));
      }
      offset += ports;
      if (offset < universe_count_ && bind_index == 255)
        throw std::runtime_error("Art-Net discovery exceeds 255 bound nodes");
      ++bind_index;
    }
    if (debug_)
      fprintf(stderr, "ArtPoll: advertised %zu universes starting at %u\n",
              universe_count_, artnet_start_universe_);
  }

  RGBMatrix *const matrix_;
  const size_t pixel_count_;
  const size_t universe_count_;
  const uint16_t artnet_start_universe_;
  const uint16_t sacn_start_universe_;
  const bool debug_;
  const DdpFormat ddp_format_;
  StreamRecording *const recording_;
  int artnet_fd_;
  int ddp_fd_;
  std::vector<int> sacn_fds_;
  FrameCanvas *canvas_;
  ProtocolFrame artnet_frame_;
  ProtocolFrame sacn_frame_;
  ProtocolFrame ddp_frame_;
  std::chrono::steady_clock::time_point last_debug_report_;
  uint64_t ddp_received_;
  uint64_t ddp_valid_;
  uint64_t ddp_out_of_range_;
  uint64_t ddp_bytes_applied_;
  uint64_t ddp_pushes_;
  DdpPacketView ddp_last_header_;
  bool ddp_have_last_header_;
  std::string ddp_last_source_ip_;
  uint16_t ddp_last_source_port_ = 0;
  uint8_t ddp_last_payload_rgb_[3] = {0, 0, 0};
};

int Usage(const char *program) {
  fprintf(stderr,
          "usage: %s [options]\n"
          "  --artnet-universe <n>  First Art-Net universe (default: 0)\n"
          "  --sacn-universe <n>    First sACN universe (default: 1)\n"
          "  --debug                Log DDP packet and display statistics\n"
          "  --ddp-format <format>  auto (default), standard, or pixel-animator\n"
          "  --record <file>        Save displayed RGB frames with timing\n"
          "  --record-seconds <n>   Stop recording after n seconds of capture\n"
          "  --play <file>          Play a recording (no network listeners)\n"
          "  --scene <file>         Play a scene playlist\n"
          "  --loop                 Repeat playback until Ctrl-C\n"
          "  --no-wled              Do not serve WLED discovery (HTTP 80, mDNS)\n"
          "  DDP listens on UDP port 4048\n"
          "  -l                     Enable logarithmic luminance correction\n"
          "  -d                     Run as daemon\n"
          "  -P/-c/-r/-p <n>        Matrix parallel/chains/rows/PWM bits\n",
          program);
  PrintMatrixFlags(stderr);
  return 1;
}

}  // namespace

int main(int argc, char *argv[]) {
  uint32_t artnet_start_universe = 0;
  uint32_t sacn_start_universe = 1;
  bool logarithmic = false;
  bool debug = false;
  DdpFormat ddp_format = kDdpAuto;
  std::string record_path, playback_path, scene_path;
  uint64_t record_duration = 0;
  bool loop = false;
  bool wled = true;
  bool ushape_display = false;
  std::string rotation;

  RGBMatrix::Options matrix_options;
  matrix_options.rows = 32;
  matrix_options.chain_length = 1;
  matrix_options.parallel = 1;
  RuntimeOptions runtime_options;
  if (!ParseOptionsFromFlags(&argc, &argv, &matrix_options, &runtime_options))
    return Usage(argv[0]);

  static const option kLongOptions[] = {
      {"artnet-universe", required_argument, NULL, 1000},
      {"sacn-universe", required_argument, NULL, 1001},
      {"debug", no_argument, NULL, 1002},
      {"ddp-format", required_argument, NULL, 1003},
      {"record", required_argument, NULL, 1004},
      {"record-seconds", required_argument, NULL, 1005},
      {"play", required_argument, NULL, 1006},
      {"scene", required_argument, NULL, 1007},
      {"loop", no_argument, NULL, 1008},
      {"no-wled", no_argument, NULL, 1009},
      {NULL, 0, NULL, 0},
  };
  int opt;
  while ((opt = getopt_long(argc, argv, "dlLP:c:r:p:R:U", kLongOptions,
                            NULL)) != -1) {
    switch (opt) {
      case 'd':
        runtime_options.daemon = 1;
        break;
      case 'l':
        logarithmic = true;
        break;
      case 'L':
        fprintf(stderr, "-L is deprecated; use --led-pixel-mapper and --led-chain\n");
        matrix_options.rows = 32;
        matrix_options.chain_length = 4;
        rotation = "180";
        ushape_display = true;
        break;
      case 'U':
        fprintf(stderr, "-U is deprecated; use --led-pixel-mapper\n");
        ushape_display = true;
        break;
      case 'R':
        fprintf(stderr, "-R is deprecated; use --led-pixel-mapper\n");
        rotation = optarg;
        break;
      case 'P':
        matrix_options.parallel = atoi(optarg);
        break;
      case 'c':
        matrix_options.chain_length = atoi(optarg);
        break;
      case 'r':
        matrix_options.rows = atoi(optarg);
        break;
      case 'p':
        matrix_options.pwm_bits = atoi(optarg);
        break;
      case 1000:
        if (!ParseUniverse(optarg, &artnet_start_universe))
          return Usage(argv[0]);
        break;
      case 1001:
        if (!ParseUniverse(optarg, &sacn_start_universe))
          return Usage(argv[0]);
        break;
      case 1002:
        debug = true;
        break;
      case 1003:
        if (strcmp(optarg, "pixel-animator") == 0) {
          ddp_format = kDdpPixelAnimator;
        } else if (strcmp(optarg, "standard") == 0) {
          ddp_format = kDdpStandard;
        } else if (strcmp(optarg, "auto") == 0) {
          ddp_format = kDdpAuto;
        } else {
          fprintf(stderr, "Unknown DDP format: %s\n", optarg);
          return Usage(argv[0]);
        }
        break;
      case 1004:
      case 1006:
      case 1007:
        if (*optarg == '\0') {
          fprintf(stderr, "Recording, playback, and scene paths must not be empty\n");
          return 1;
        }
        if (opt == 1004)
          record_path = optarg;
        else if (opt == 1006)
          playback_path = optarg;
        else
          scene_path = optarg;
        break;
      case 1005:
        try {
          record_duration = ParseSeconds(optarg);
          if (record_duration == 0)
            throw std::runtime_error("Recording duration must be positive");
        } catch (const std::exception &error) {
          fprintf(stderr, "%s\n", error.what());
          return 1;
        }
        break;
      case 1008: loop = true; break;
      case 1009: wled = false; break;
      default:
        return Usage(argv[0]);
    }
  }
  const bool playback = !playback_path.empty() || !scene_path.empty();
  if ((!playback_path.empty() && !scene_path.empty()) ||
      (playback && !record_path.empty()) ||
      (record_duration != 0 && record_path.empty()) || (loop && !playback)) {
    fprintf(stderr, "Conflicting recording/playback options\n");
    return Usage(argv[0]);
  }
  if (optind != argc || artnet_start_universe > 32767 ||
      sacn_start_universe == 0 || sacn_start_universe > 63999) {
    fprintf(stderr, "Invalid trailing argument or start universe\n");
    return Usage(argv[0]);
  }

  std::string pixel_map_config;
  if (matrix_options.pixel_mapper_config != NULL)
    pixel_map_config = matrix_options.pixel_mapper_config;
  if (ushape_display) {
    pixel_map_config = pixel_map_config.empty()
                           ? "U-mapper"
                           : "U-mapper;" + pixel_map_config;
  }
  if (!rotation.empty()) {
    if (!pixel_map_config.empty())
      pixel_map_config.append(";");
    pixel_map_config.append("Rotate:").append(rotation);
  }
  if (!pixel_map_config.empty()) {
    matrix_options.pixel_mapper_config = pixel_map_config.c_str();
  }

  if (getuid() != 0) {
    fprintf(stderr,
            "Must run as root to access /dev/mem. Prepend 'sudo' to the command:\n"
            "\tsudo %s ...\n",
            argv[0]);
    return 1;
  }

  struct sigaction stop_action = {};
  stop_action.sa_handler = HandleStopSignal;
  sigemptyset(&stop_action.sa_mask);
  if (sigaction(SIGINT, &stop_action, NULL) < 0 ||
      sigaction(SIGTERM, &stop_action, NULL) < 0) {
    perror("sigaction");
    return 1;
  }
  // A discovery client that resets its connection must not end the process.
  signal(SIGPIPE, SIG_IGN);

  int result = 0;
  std::unique_ptr<RGBMatrix> matrix;
  std::unique_ptr<StreamRecording> recording;
  try {
    if (!record_path.empty())
      recording.reset(new StreamRecording(record_path, record_duration));
    std::unique_ptr<StreamPlayback> saved_playback;
    if (playback) {
      std::vector<SceneClip> clips;
      if (!scene_path.empty()) {
        clips = LoadScene(scene_path);
        for (SceneClip &clip : clips)
          clip.path = ResolveSceneClip(scene_path, clip.path);
      } else {
        // The playback reader validates the range against the real duration.
        clips.push_back({playback_path, 0, kWholeRecording});
      }
      saved_playback.reset(new StreamPlayback(clips));
    }
    // Bind HTTP and mDNS while still privileged; the matrix library may drop
    // root privileges during hardware initialization.
    std::unique_ptr<WledCompatibilityServer> wled_server;
    if (!playback && wled) {
      // Discovery is optional: DMX and DDP output still work without it.
      try {
        wled_server.reset(new WledCompatibilityServer);
      } catch (const std::exception &error) {
        fprintf(stderr,
                "WLED discovery disabled: %s (use --no-wled to silence)\n",
                error.what());
      }
    }
    matrix.reset(CreateMatrixFromOptions(matrix_options, runtime_options));
    if (!matrix)
      throw std::runtime_error("Could not initialize RGB matrix");
    matrix->set_luminance_correct(logarithmic);
    if (recording)
      recording->Begin(matrix->width(), matrix->height());
    if (playback) {
      PlayClips(matrix.get(), *saved_playback, loop);
      return 0;
    }
    if (wled_server) {
      wled_server->Start(static_cast<uint32_t>(matrix->width()),
                         static_cast<uint32_t>(matrix->height()));
    }

    const size_t universe_count =
        (static_cast<size_t>(matrix->width()) * matrix->height() + 169) / 170;
    if (artnet_start_universe + universe_count - 1 > 32767 ||
        sacn_start_universe + universe_count - 1 > 63999) {
      throw std::runtime_error("Matrix size exceeds the configured universe range");
    }
    DmxReceiver receiver(matrix.get(),
                         static_cast<uint16_t>(artnet_start_universe),
                         static_cast<uint16_t>(sacn_start_universe), debug,
                         ddp_format, recording.get());
    fprintf(stderr,
            "Listening for Art-Net on UDP %d (starting universe %u), "
            "sACN on UDP %d (starting universe %u; %zu universes), and "
            "DDP on UDP %d (format: %s)\n",
            kArtNetPort, artnet_start_universe, kSacnPort,
            sacn_start_universe, universe_count, kDdpPort,
            DdpFormatName(ddp_format));
    if (wled_server) {
      fprintf(stderr, "WLED-compatible node: http://%s.local/json/info\n",
              wled_server->hostname().c_str());
    }
    fprintf(stderr, "Press Ctrl-C to shut down\n");
    receiver.Run();
    if (recording)
      recording->Finish();
  } catch (const std::exception &error) {
    fprintf(stderr, "Receiver error: %s\n", error.what());
    result = 1;
    // Keep whatever was captured before the failure playable.
    if (recording) {
      try {
        recording->Finish();
      } catch (const std::exception &finish_error) {
        fprintf(stderr, "Could not finalize recording: %s\n",
                finish_error.what());
      }
    }
  }
  return result;
}
