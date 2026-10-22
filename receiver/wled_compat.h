// Copyright (C) 2026 Anjin <anjin@skyhighatry.com>
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 3 of the License, or
// (at your option) any later version.

#ifndef WLED_COMPAT_H
#define WLED_COMPAT_H

#include <atomic>
#include <stdint.h>
#include <string>
#include <sys/socket.h>
#include <thread>
#include <vector>

class WledCompatibilityServer {
 public:
  WledCompatibilityServer();
  ~WledCompatibilityServer();

  WledCompatibilityServer(const WledCompatibilityServer &) = delete;
  WledCompatibilityServer &operator=(const WledCompatibilityServer &) = delete;

  void Start(uint32_t width, uint32_t height);
  const std::string &hostname() const { return hostname_; }

 private:
  void Run();
  void HandleMdnsQuery(const uint8_t *query, size_t query_size,
                       const void *source, socklen_t source_size);
  void HandleHttpClient(int client_fd);
  void SendMdnsAnnouncement();
  void RebuildMdnsResponse();
  void RefreshAddress();

  int mdns_fd_;
  int http_fd_;
  std::string hostname_;
  std::string ip_address_;
  std::string mac_address_;
  std::string info_json_;
  std::string state_json_;
  std::string config_json_;
  std::string root_html_;
  std::vector<uint8_t> mdns_response_;
  // The same records without the cache-flush bit, for legacy unicast replies.
  std::vector<uint8_t> mdns_unicast_records_;
  std::atomic<bool> stopping_;
  std::thread worker_;
};

// The node's records as one mDNS response. `cache_flush` marks the unique
// records as the whole set (RFC 6762, 10.2); it must be off in replies to
// legacy unicast queries.
bool BuildWledMdnsResponse(const std::string &hostname,
                           const uint8_t ipv4_address[4],
                           const std::string &mac_address,
                           std::vector<uint8_t> *response,
                           bool cache_flush = true);
// A reply to a legacy unicast query, one sent from a port other than 5353
// (RFC 6762, 6.7): the query's id and questions, then the records of
// `unicast_records` (built with cache_flush off). False if the questions
// cannot be read.
bool BuildWledLegacyUnicastReply(const uint8_t *query, size_t query_size,
                                 const std::vector<uint8_t> &unicast_records,
                                 std::vector<uint8_t> *reply);
// True when an mDNS query asks for this node's host or service names.
bool WledMdnsQueryMatches(const uint8_t *query, size_t query_size,
                          const std::string &hostname);
std::string BuildWledInfoJson(uint32_t width, uint32_t height,
                              const std::string &hostname,
                              const std::string &mac_address);
std::string BuildWledStateJson(uint32_t width, uint32_t height);
// The part of WLED's /json/cfg that clients read: identity, the LED count
// and matrix, and the live input settings (LedFx reads `if.live`).
std::string BuildWledConfigJson(uint32_t width, uint32_t height,
                                const std::string &hostname);
// The page at /, for apps that open a WLED device in a browser.
std::string BuildWledRootHtml(uint32_t width, uint32_t height,
                              const std::string &hostname);

// The answer to one HTTP request, from its first line.
struct WledHttpReply {
  int status;
  std::string content_type;
  std::string body;
};
// Answers WLED's JSON API from the given documents. GETs of the endpoints
// clients read are answered; POSTs that would change state or settings are
// accepted and reported as successful but change nothing, since what is
// shown comes from the streams.
WledHttpReply WledHttpRoute(const std::string &request_line,
                            const std::string &info_json,
                            const std::string &state_json,
                            const std::string &config_json,
                            const std::string &root_html);

#endif  // WLED_COMPAT_H
