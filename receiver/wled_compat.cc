// Copyright (C) 2026 Anjin <anjin@skyhighatry.com>
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 3 of the License, or
// (at your option) any later version.

#include "wled_compat.h"

#include "udp_socket.h"

#include <arpa/inet.h>
#include <errno.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <unistd.h>

#if defined(__linux__)
#include <netpacket/packet.h>
#elif defined(__APPLE__)
#include <net/if_dl.h>
#endif

#include <chrono>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace {

const int kMdnsPort = 5353;
const int kHttpPort = 80;
const char kMdnsGroup[] = "224.0.0.251";
const size_t kMaxMdnsPacketSize = 1500;
const size_t kMaxHttpRequestSize = 2048;
// The most of a POST body read and discarded before replying, so the
// connection closes cleanly rather than with a reset.
const size_t kMaxHttpBodyDrain = 65536;
// WLED 0.15.0's own build number, matching the version reported. Clients
// choose protocols by it: LedFx streams DDP from build 2110060, and WLED's
// older UDP realtime protocol below that, which this receiver does not take.
const uint32_t kWledBuild = 2412100;
#ifdef MSG_NOSIGNAL
const int kSendFlags = MSG_NOSIGNAL;
#else
const int kSendFlags = 0;
#endif

void Append16(std::vector<uint8_t> *bytes, uint16_t value) {
  bytes->push_back(static_cast<uint8_t>(value >> 8));
  bytes->push_back(static_cast<uint8_t>(value));
}

void Append32(std::vector<uint8_t> *bytes, uint32_t value) {
  bytes->push_back(static_cast<uint8_t>(value >> 24));
  bytes->push_back(static_cast<uint8_t>(value >> 16));
  bytes->push_back(static_cast<uint8_t>(value >> 8));
  bytes->push_back(static_cast<uint8_t>(value));
}

void AppendDnsName(std::vector<uint8_t> *bytes, const std::string &name) {
  size_t begin = 0;
  while (begin < name.size()) {
    const size_t end = name.find('.', begin);
    const size_t label_length =
        (end == std::string::npos ? name.size() : end) - begin;
    if (label_length == 0 || label_length > 63)
      throw std::runtime_error("Invalid DNS label in WLED hostname");
    bytes->push_back(static_cast<uint8_t>(label_length));
    bytes->insert(bytes->end(), name.begin() + begin,
                  name.begin() + begin + label_length);
    if (end == std::string::npos)
      break;
    begin = end + 1;
  }
  bytes->push_back(0);
}

void AppendRecordHeader(std::vector<uint8_t> *bytes,
                        const std::string &owner, uint16_t type,
                        uint16_t record_class, uint32_t ttl,
                        uint16_t data_length) {
  AppendDnsName(bytes, owner);
  Append16(bytes, type);
  Append16(bytes, record_class);
  Append32(bytes, ttl);
  Append16(bytes, data_length);
}

std::string SanitizeHostLabel(const char *hostname) {
  std::string label;
  for (const unsigned char *p =
           reinterpret_cast<const unsigned char *>(hostname);
       *p != '\0' && label.size() < 48; ++p) {
    if ((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
        (*p >= '0' && *p <= '9')) {
      label.push_back(static_cast<char>(
          (*p >= 'A' && *p <= 'Z') ? *p + ('a' - 'A') : *p));
    } else if (!label.empty() && label[label.size() - 1] != '-') {
      label.push_back('-');
    }
  }
  while (!label.empty() && label[label.size() - 1] == '-')
    label.erase(label.size() - 1);
  return label.empty() ? "matrix" : label;
}

void FindNetworkIdentity(std::string *ip_address, std::string *mac_address) {
  struct ifaddrs *interfaces = NULL;
  if (getifaddrs(&interfaces) < 0)
    throw std::runtime_error(std::string("getifaddrs: ") + strerror(errno));

  std::string interface_name;
  for (const struct ifaddrs *entry = interfaces; entry != NULL;
       entry = entry->ifa_next) {
    if (entry->ifa_addr == NULL || entry->ifa_addr->sa_family != AF_INET ||
        (entry->ifa_flags & (IFF_LOOPBACK | IFF_UP)) != IFF_UP) {
      continue;
    }
    const struct sockaddr_in *address =
        reinterpret_cast<const struct sockaddr_in *>(entry->ifa_addr);
    char printable[INET_ADDRSTRLEN] = {};
    if (inet_ntop(AF_INET, &address->sin_addr, printable,
                  sizeof(printable)) != NULL) {
      *ip_address = printable;
      interface_name = entry->ifa_name;
      break;
    }
  }
  if (interface_name.empty()) {
    freeifaddrs(interfaces);
    throw std::runtime_error("No non-loopback IPv4 interface for WLED discovery");
  }

  for (const struct ifaddrs *entry = interfaces; entry != NULL;
       entry = entry->ifa_next) {
    if (entry->ifa_addr == NULL || interface_name != entry->ifa_name)
      continue;
    const uint8_t *mac = NULL;
    size_t mac_length = 0;
#if defined(__linux__)
    if (entry->ifa_addr->sa_family == AF_PACKET) {
      const struct sockaddr_ll *link =
          reinterpret_cast<const struct sockaddr_ll *>(entry->ifa_addr);
      mac = link->sll_addr;
      mac_length = link->sll_halen;
    }
#elif defined(__APPLE__)
    if (entry->ifa_addr->sa_family == AF_LINK) {
      const struct sockaddr_dl *link =
          reinterpret_cast<const struct sockaddr_dl *>(entry->ifa_addr);
      mac = reinterpret_cast<const uint8_t *>(LLADDR(link));
      mac_length = link->sdl_alen;
    }
#endif
    if (mac != NULL && mac_length == 6) {
      std::ostringstream formatted;
      formatted << std::hex << std::setfill('0');
      for (size_t i = 0; i < mac_length; ++i)
        formatted << std::setw(2) << static_cast<unsigned int>(mac[i]);
      *mac_address = formatted.str();
      break;
    }
  }
  freeifaddrs(interfaces);
}

int CreateHttpSocket() {
  const int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0)
    throw std::runtime_error(std::string("HTTP socket: ") + strerror(errno));

  int reuse = 1;
  if (setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse)) < 0) {
    const std::string error = std::string("setsockopt(HTTP SO_REUSEADDR): ") +
                              strerror(errno);
    close(fd);
    throw std::runtime_error(error);
  }

  sockaddr_in address = {};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_ANY);
  address.sin_port = htons(kHttpPort);
  if (bind(fd, reinterpret_cast<sockaddr *>(&address), sizeof(address)) < 0) {
    const std::string error = std::string("bind HTTP port 80: ") +
                              strerror(errno);
    close(fd);
    throw std::runtime_error(error);
  }
  if (listen(fd, 8) < 0) {
    const std::string error = std::string("listen HTTP port 80: ") +
                              strerror(errno);
    close(fd);
    throw std::runtime_error(error);
  }
  return fd;
}

std::string JsonEscape(const std::string &value) {
  std::ostringstream escaped;
  for (std::string::const_iterator it = value.begin(); it != value.end(); ++it) {
    const unsigned char c = static_cast<unsigned char>(*it);
    if (c == '"' || c == '\\')
      escaped << '\\' << static_cast<char>(c);
    else if (c >= 0x20)
      escaped << static_cast<char>(c);
  }
  return escaped.str();
}

// Reads one possibly compressed DNS name as lower-case dotted text and
// advances *offset past it.
bool ReadDnsName(const uint8_t *packet, size_t size, size_t *offset,
                 std::string *name) {
  size_t position = *offset;
  bool jumped = false;
  int jumps = 0;
  name->clear();
  for (;;) {
    if (position >= size)
      return false;
    const uint8_t length = packet[position];
    if ((length & 0xc0) == 0xc0) {
      if (position + 1 >= size || ++jumps > 16)
        return false;
      if (!jumped)
        *offset = position + 2;
      jumped = true;
      position = (static_cast<size_t>(length & 0x3f) << 8) |
                 packet[position + 1];
      continue;
    }
    if (length == 0) {
      if (!jumped)
        *offset = position + 1;
      return true;
    }
    if (length > 63 || position + 1 + length > size ||
        name->size() + length + 1 > 255) {
      return false;
    }
    if (!name->empty())
      name->push_back('.');
    for (size_t i = 0; i < length; ++i) {
      const char c = static_cast<char>(packet[position + 1 + i]);
      name->push_back(c >= 'A' && c <= 'Z' ? c + ('a' - 'A') : c);
    }
    position += 1 + length;
  }
}

// Reads and discards what is left of a request's body, as given by its
// Content-Length, up to kMaxHttpBodyDrain bytes and a second in all, so that
// closing the connection does not reset it before the reply is read. The
// whole second is a cap, since clients are served one at a time.
void DrainHttpBody(int client_fd, const char *request, size_t received) {
  const char *headers_end = strstr(request, "\r\n\r\n");
  if (headers_end == NULL)
    return;
  size_t length = 0;
  for (const char *line = strstr(request, "\r\n"); line != NULL && line < headers_end;
       line = strstr(line + 2, "\r\n")) {
    if (strncasecmp(line + 2, "Content-Length:", 15) == 0) {
      length = strtoul(line + 17, NULL, 10);
      break;
    }
  }
  const size_t already = received - static_cast<size_t>(headers_end + 4 - request);
  if (length > kMaxHttpBodyDrain)
    length = kMaxHttpBodyDrain;
  size_t remaining = length > already ? length - already : 0;
  char discard[1024];
  const std::chrono::steady_clock::time_point deadline =
      std::chrono::steady_clock::now() + std::chrono::seconds(1);
  while (remaining > 0) {
    const long wait = static_cast<long>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            deadline - std::chrono::steady_clock::now()).count());
    struct pollfd descriptor = {client_fd, POLLIN, 0};
    if (wait <= 0 || poll(&descriptor, 1, static_cast<int>(wait)) <= 0)
      return;
    const ssize_t count = recv(client_fd, discard,
                               remaining < sizeof(discard) ? remaining : sizeof(discard), 0);
    if (count <= 0)
      return;
    remaining -= static_cast<size_t>(count);
  }
}

}  // namespace

bool WledMdnsQueryMatches(const uint8_t *query, size_t query_size,
                          const std::string &hostname) {
  if (query == NULL || query_size < 12 || (query[2] & 0x80) != 0)
    return false;
  const std::string names[] = {
      hostname + ".local",
      "_http._tcp.local",
      "_wled._tcp.local",
      hostname + "._http._tcp.local",
      hostname + "._wled._tcp.local",
  };
  const size_t question_count =
      (static_cast<size_t>(query[4]) << 8) | query[5];
  size_t offset = 12;
  std::string name;
  for (size_t i = 0; i < question_count; ++i) {
    if (!ReadDnsName(query, query_size, &offset, &name) ||
        offset + 4 > query_size) {
      return false;
    }
    offset += 4;  // Type and class.
    for (const std::string &candidate : names) {
      if (name == candidate)
        return true;
    }
  }
  return false;
}

bool BuildWledMdnsResponse(const std::string &hostname,
                           const uint8_t ipv4_address[4],
                           const std::string &mac_address,
                           std::vector<uint8_t> *response,
                           bool cache_flush) {
  if (response == NULL || ipv4_address == NULL || hostname.empty())
    return false;
  const uint16_t unique = cache_flush ? 0x8001 : 1;

  try {
    response->clear();
    response->reserve(256);
    for (int i = 0; i < 12; ++i)
      response->push_back(0);
    (*response)[2] = 0x84;  // Authoritative response.
    (*response)[7] = 6;  // Answer count.

    const std::string host_fqdn = hostname + ".local";
    const std::string http_service = "_http._tcp.local";
    const std::string wled_service = "_wled._tcp.local";
    const std::string http_instance = hostname + "._http._tcp.local";
    const std::string wled_instance = hostname + "._wled._tcp.local";

    AppendRecordHeader(response, http_service, 12, 1, 120,
                       static_cast<uint16_t>(http_instance.size() + 2));
    AppendDnsName(response, http_instance);

    AppendRecordHeader(response, http_instance, 33, unique, 120,
                       static_cast<uint16_t>(6 + host_fqdn.size() + 2));
    Append16(response, 0);
    Append16(response, 0);
    Append16(response, kHttpPort);
    AppendDnsName(response, host_fqdn);

    AppendRecordHeader(response, wled_service, 12, 1, 120,
                       static_cast<uint16_t>(wled_instance.size() + 2));
    AppendDnsName(response, wled_instance);

    AppendRecordHeader(response, wled_instance, 33, unique, 120,
                       static_cast<uint16_t>(6 + host_fqdn.size() + 2));
    Append16(response, 0);
    Append16(response, 0);
    Append16(response, kHttpPort);
    AppendDnsName(response, host_fqdn);

    const std::string txt = "mac=" + mac_address;
    if (!mac_address.empty()) {
      AppendRecordHeader(response, wled_instance, 16, unique, 120,
                         static_cast<uint16_t>(txt.size() + 1));
      response->push_back(static_cast<uint8_t>(txt.size()));
      response->insert(response->end(), txt.begin(), txt.end());
    } else {
      (*response)[7] = 5;
    }

    AppendRecordHeader(response, host_fqdn, 1, unique, 120, 4);
    response->insert(response->end(), ipv4_address, ipv4_address + 4);
    return true;
  } catch (const std::runtime_error &) {
    response->clear();
    return false;
  }
}

bool BuildWledLegacyUnicastReply(const uint8_t *query, size_t query_size,
                                 const std::vector<uint8_t> &unicast_records,
                                 std::vector<uint8_t> *reply) {
  if (query == NULL || query_size < 12 || reply == NULL ||
      unicast_records.size() < 12) {
    return false;
  }
  // The questions are copied as they came, at the same offset, so any
  // compression pointers in them still point where they did.
  const size_t question_count =
      (static_cast<size_t>(query[4]) << 8) | query[5];
  size_t offset = 12;
  std::string name;
  for (size_t i = 0; i < question_count; ++i) {
    if (!ReadDnsName(query, query_size, &offset, &name) ||
        offset + 4 > query_size) {
      return false;
    }
    offset += 4;  // Type and class.
  }
  reply->assign(unicast_records.begin(), unicast_records.begin() + 12);
  (*reply)[0] = query[0];
  (*reply)[1] = query[1];
  (*reply)[4] = query[4];
  (*reply)[5] = query[5];
  reply->insert(reply->end(), query + 12, query + offset);
  reply->insert(reply->end(), unicast_records.begin() + 12,
                unicast_records.end());
  return true;
}

std::string BuildWledInfoJson(uint32_t width, uint32_t height,
                              const std::string &hostname,
                              const std::string &mac_address) {
  if (width == 0 || height == 0)
    throw std::runtime_error("WLED matrix dimensions must be positive");
  const uint64_t pixel_count = static_cast<uint64_t>(width) * height;
  std::ostringstream json;
  json << "{\"ver\":\"0.15.0\",\"vid\":" << kWledBuild << ","
       << "\"leds\":{\"count\":" << pixel_count
       << ",\"rgbw\":false,\"pwr\":0,\"maxpwr\":65000,\"maxseg\":1,"
       << "\"seglc\":[1],\"lc\":1,"
       << "\"matrix\":{\"w\":" << width << ",\"h\":" << height << "}},"
       << "\"name\":\"WLED " << JsonEscape(hostname)
       << "\",\"udpport\":21324,\"live\":true,\"fxcount\":1,"
       << "\"palcount\":1,\"arch\":\"linux\",\"brand\":\"WLED\","
       << "\"product\":\"RGB Matrix\"";
  if (!mac_address.empty())
    json << ",\"mac\":\"" << JsonEscape(mac_address) << "\"";
  json << "}";
  return json.str();
}

std::string BuildWledStateJson(uint32_t width, uint32_t height) {
  if (width == 0 || height == 0)
    throw std::runtime_error("WLED matrix dimensions must be positive");
  std::ostringstream json;
  json << "{\"on\":true,\"bri\":255,\"transition\":0,\"ps\":-1,\"pl\":-1,"
       << "\"lor\":0,\"mainseg\":0,\"seg\":[{\"id\":0,\"start\":0,"
       << "\"stop\":" << width << ",\"startY\":0,\"stopY\":" << height
       << ",\"len\":" << width << ",\"grp\":1,\"spc\":0,\"of\":0,"
       << "\"on\":true,\"frz\":false,\"bri\":255,\"cct\":127,\"set\":0,"
       << "\"col\":[[255,255,255],[0,0,0],[0,0,0]],\"fx\":0,\"sx\":128,"
       << "\"ix\":128,\"pal\":0,\"sel\":true,\"rev\":false,\"mi\":false,"
       << "\"rY\":false,\"mY\":false,\"tp\":false}]}";
  return json.str();
}

std::string BuildWledConfigJson(uint32_t width, uint32_t height,
                                const std::string &hostname) {
  if (width == 0 || height == 0)
    throw std::runtime_error("WLED matrix dimensions must be positive");
  const uint64_t pixel_count = static_cast<uint64_t>(width) * height;
  std::ostringstream json;
  // `if.live` describes sACN as WLED would: port 5568 from universe 1,
  // address 1, mode 4 (multiple RGB). Changing it here changes nothing.
  json << "{\"rev\":[1,0],\"vid\":" << kWledBuild << ","
       << "\"id\":{\"mdns\":\"" << JsonEscape(hostname) << "\",\"name\":\"WLED "
       << JsonEscape(hostname) << "\",\"inv\":\"Light\"},"
       << "\"hw\":{\"led\":{\"total\":" << pixel_count
       << ",\"maxpwr\":65000,\"matrix\":{\"mpc\":1,\"panels\":[{\"b\":false,"
       << "\"r\":false,\"v\":false,\"s\":false,\"x\":0,\"y\":0,\"h\":" << height
       << ",\"w\":" << width << "}]}}},"
       << "\"if\":{\"live\":{\"en\":true,\"mso\":false,\"port\":5568,\"mc\":false,"
       << "\"dmx\":{\"uni\":1,\"seqskip\":false,\"addr\":1,\"dss\":0,\"mode\":4},"
       << "\"timeout\":25,\"maxbri\":false,\"no-gc\":true,\"offset\":0}}}";
  return json.str();
}

std::string BuildWledRootHtml(uint32_t width, uint32_t height,
                              const std::string &hostname) {
  std::string name;
  for (std::string::const_iterator it = hostname.begin(); it != hostname.end();
       ++it) {
    if (*it == '<') name += "&lt;";
    else if (*it == '>') name += "&gt;";
    else if (*it == '&') name += "&amp;";
    else if (*it == '"') name += "&quot;";
    else name += *it;
  }
  std::ostringstream html;
  html << "<!doctype html><html><head><meta charset=\"utf-8\">"
       << "<title>WLED " << name << "</title></head><body><h1>WLED " << name
       << "</h1><p>A MatrixPrism matrix-dmx receiver, " << width << " &times; "
       << height << ", answering WLED's JSON API (<a href=\"/json/info\">"
       << "/json/info</a>, <a href=\"/json/state\">/json/state</a>) and taking "
       << "DDP, sACN and Art-Net. It has no WLED controls of its own.</p>"
       << "</body></html>";
  return html.str();
}

WledHttpReply WledHttpRoute(const std::string &request_line,
                            const std::string &info_json,
                            const std::string &state_json,
                            const std::string &config_json,
                            const std::string &root_html) {
  const std::string json = "application/json";
  const size_t method_end = request_line.find(' ');
  const size_t target_end = method_end == std::string::npos
                                ? std::string::npos
                                : request_line.find(' ', method_end + 1);
  if (target_end == std::string::npos) {
    WledHttpReply bad = {400, json, "{\"error\":\"bad request\"}"};
    return bad;
  }
  const std::string method = request_line.substr(0, method_end);
  std::string path =
      request_line.substr(method_end + 1, target_end - method_end - 1);
  path = path.substr(0, path.find('?'));
  WledHttpReply reply = {200, json, ""};
  if (method == "GET") {
    if (path == "/json/info") reply.body = info_json;
    else if (path == "/json/state") reply.body = state_json;
    else if (path == "/json/si")
      reply.body = "{\"state\":" + state_json + ",\"info\":" + info_json + "}";
    else if (path == "/json" || path == "/json/")
      reply.body = "{\"state\":" + state_json + ",\"info\":" + info_json +
                   ",\"effects\":[\"Solid\"],\"palettes\":[\"Default\"]}";
    else if (path == "/json/eff") reply.body = "[\"Solid\"]";
    else if (path == "/json/pal") reply.body = "[\"Default\"]";
    else if (path == "/json/cfg") reply.body = config_json;
    else if (path == "/json/nodes") reply.body = "{\"nodes\":[]}";
    else if (path == "/presets.json") reply.body = "{}";
    else if (path == "/") {
      reply.content_type = "text/html; charset=utf-8";
      reply.body = root_html;
    } else {
      reply.status = 404;
      reply.body = "{\"error\":\"not found\"}";
    }
  } else if (method == "POST") {
    if (path == "/json/state" || path == "/json/si" || path == "/json" ||
        path == "/json/" || path == "/json/cfg") {
      reply.body = "{\"success\":true}";
    } else {
      reply.status = 404;
      reply.body = "{\"error\":\"not found\"}";
    }
  } else {
    reply.status = 405;
    reply.body = "{\"error\":\"method not allowed\"}";
  }
  return reply;
}

WledCompatibilityServer::WledCompatibilityServer()
    : mdns_fd_(-1), http_fd_(-1), stopping_(false) {
  char system_hostname[256] = {};
  if (gethostname(system_hostname, sizeof(system_hostname) - 1) < 0)
    throw std::runtime_error(std::string("gethostname: ") + strerror(errno));
  FindNetworkIdentity(&ip_address_, &mac_address_);
  hostname_ = mac_address_.size() == 12
                  ? "wled-" + mac_address_.substr(6)
                  : "wled-" + SanitizeHostLabel(system_hostname);
  mdns_fd_ = CreateBoundUdpSocket(kMdnsPort);
  try {
    ip_mreq membership = {};
    if (inet_pton(AF_INET, kMdnsGroup, &membership.imr_multiaddr) != 1)
      throw std::runtime_error("Invalid mDNS multicast group address");
    membership.imr_interface.s_addr = htonl(INADDR_ANY);
    if (setsockopt(mdns_fd_, IPPROTO_IP, IP_ADD_MEMBERSHIP, &membership,
                   sizeof(membership)) < 0) {
      throw std::runtime_error(std::string("join mDNS multicast group: ") +
                               strerror(errno));
    }
    http_fd_ = CreateHttpSocket();
  } catch (...) {
    close(mdns_fd_);
    mdns_fd_ = -1;
    throw;
  }
}

WledCompatibilityServer::~WledCompatibilityServer() {
  stopping_.store(true);
  if (worker_.joinable())
    worker_.join();
  if (mdns_fd_ >= 0)
    close(mdns_fd_);
  if (http_fd_ >= 0)
    close(http_fd_);
}

void WledCompatibilityServer::Start(uint32_t width, uint32_t height) {
  info_json_ = BuildWledInfoJson(width, height, hostname_, mac_address_);
  state_json_ = BuildWledStateJson(width, height);
  config_json_ = BuildWledConfigJson(width, height, hostname_);
  root_html_ = BuildWledRootHtml(width, height, hostname_);
  RebuildMdnsResponse();
  worker_ = std::thread(&WledCompatibilityServer::Run, this);
}

void WledCompatibilityServer::RebuildMdnsResponse() {
  in_addr address = {};
  const uint8_t *ip = reinterpret_cast<const uint8_t *>(&address.s_addr);
  if (inet_pton(AF_INET, ip_address_.c_str(), &address) != 1 ||
      !BuildWledMdnsResponse(hostname_, ip, mac_address_, &mdns_response_) ||
      !BuildWledMdnsResponse(hostname_, ip, mac_address_,
                             &mdns_unicast_records_, false)) {
    mdns_response_.clear();
    mdns_unicast_records_.clear();
  }
}

// Follows address changes such as a new DHCP lease. The hostname stays as
// first advertised so clients keep one identity for the node.
void WledCompatibilityServer::RefreshAddress() {
  std::string ip_address, mac_address;
  try {
    FindNetworkIdentity(&ip_address, &mac_address);
  } catch (const std::runtime_error &) {
    return;  // Interface is down for now; keep the last known address.
  }
  if (ip_address == ip_address_)
    return;
  ip_address_ = ip_address;
  RebuildMdnsResponse();
}

void WledCompatibilityServer::SendMdnsAnnouncement() {
  if (mdns_response_.empty())
    return;
  sockaddr_in destination = {};
  destination.sin_family = AF_INET;
  destination.sin_port = htons(kMdnsPort);
  inet_pton(AF_INET, kMdnsGroup, &destination.sin_addr);
  if (sendto(mdns_fd_, &mdns_response_[0], mdns_response_.size(), 0,
             reinterpret_cast<sockaddr *>(&destination),
             sizeof(destination)) < 0) {
    fprintf(stderr, "mDNS announcement failed: %s\n", strerror(errno));
  }
}

void WledCompatibilityServer::HandleMdnsQuery(
    const uint8_t *query, size_t query_size, const void *source,
    socklen_t source_size) {
  // Stay silent for the LAN's unrelated mDNS traffic.
  if (mdns_response_.empty() ||
      !WledMdnsQueryMatches(query, query_size, hostname_)) {
    return;
  }
  const sockaddr_in *query_source =
      reinterpret_cast<const sockaddr_in *>(source);
  sockaddr_in multicast = {};
  multicast.sin_family = AF_INET;
  multicast.sin_port = htons(kMdnsPort);
  inet_pton(AF_INET, kMdnsGroup, &multicast.sin_addr);
  // A query from a port other than 5353 is a legacy unicast query: answered
  // to its sender, with its id and questions and no cache-flush bits.
  const bool legacy_unicast = query_source->sin_family == AF_INET &&
                              query_source->sin_port != htons(kMdnsPort);
  std::vector<uint8_t> response;
  if (legacy_unicast) {
    if (!BuildWledLegacyUnicastReply(query, query_size, mdns_unicast_records_,
                                     &response)) {
      return;
    }
  } else {
    response = mdns_response_;
  }
  const sockaddr *destination =
      legacy_unicast ? reinterpret_cast<const sockaddr *>(source)
                     : reinterpret_cast<const sockaddr *>(&multicast);
  if (sendto(mdns_fd_, &response[0], response.size(), 0, destination,
             query_source->sin_family == AF_INET
                 ? sizeof(sockaddr_in)
                 : source_size) < 0 &&
      errno != EAGAIN && errno != EWOULDBLOCK) {
    fprintf(stderr, "mDNS query response failed: %s\n", strerror(errno));
  }
}

void WledCompatibilityServer::HandleHttpClient(int client_fd) {
  struct pollfd descriptor = {client_fd, POLLIN, 0};
  if (poll(&descriptor, 1, 1000) <= 0) {
    close(client_fd);
    return;
  }

  char request[kMaxHttpRequestSize + 1] = {};
  const ssize_t received = recv(client_fd, request, kMaxHttpRequestSize, 0);
  if (received <= 0) {
    close(client_fd);
    return;
  }
  request[received] = '\0';

  const char *line_end = strstr(request, "\r\n");
  const std::string request_line(
      request, line_end != NULL ? static_cast<size_t>(line_end - request)
                                : static_cast<size_t>(received));
  const WledHttpReply reply = WledHttpRoute(request_line, info_json_,
                                            state_json_, config_json_,
                                            root_html_);
  if (strncmp(request, "POST ", 5) == 0)
    DrainHttpBody(client_fd, request, static_cast<size_t>(received));
  const char *status = reply.status == 200   ? "200 OK"
                       : reply.status == 400 ? "400 Bad Request"
                       : reply.status == 405 ? "405 Method Not Allowed"
                                             : "404 Not Found";
  std::ostringstream response;
  response << "HTTP/1.1 " << status << "\r\n"
           << "Content-Type: " << reply.content_type << "\r\n"
           << "Content-Length: " << reply.body.size() << "\r\n"
           << "Connection: close\r\n\r\n"
           << reply.body;
  const std::string response_text = response.str();
  size_t sent = 0;
  while (sent < response_text.size()) {
    const ssize_t count = send(client_fd, response_text.data() + sent,
                               response_text.size() - sent, kSendFlags);
    if (count < 0) {
      if (errno == EINTR)
        continue;
      break;
    }
    sent += static_cast<size_t>(count);
  }
  close(client_fd);
}

void WledCompatibilityServer::Run() {
  using Clock = std::chrono::steady_clock;
  Clock::time_point next_announcement = Clock::now();
  uint8_t packet[kMaxMdnsPacketSize];

  while (!stopping_.load()) {
    struct pollfd descriptors[2] = {
        {mdns_fd_, POLLIN, 0},
        {http_fd_, POLLIN, 0},
    };
    const int ready = poll(descriptors, 2, 250);
    if (ready < 0) {
      if (errno == EINTR)
        continue;
      fprintf(stderr, "WLED compatibility server poll failed: %s\n",
              strerror(errno));
      return;
    }
    if ((descriptors[0].revents & POLLIN) != 0) {
      sockaddr_storage source = {};
      socklen_t source_size = sizeof(source);
      const ssize_t received =
          recvfrom(mdns_fd_, packet, sizeof(packet), 0,
                   reinterpret_cast<sockaddr *>(&source), &source_size);
      if (received > 0) {
        HandleMdnsQuery(packet, received, &source, source_size);
      } else if (received < 0 && errno != EINTR && errno != EAGAIN &&
                 errno != EWOULDBLOCK) {
        fprintf(stderr, "mDNS receive failed: %s\n", strerror(errno));
      }
    }
    if ((descriptors[1].revents & POLLIN) != 0) {
      const int client_fd = accept(http_fd_, NULL, NULL);
      if (client_fd >= 0) {
        HandleHttpClient(client_fd);
      } else if (errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) {
        fprintf(stderr, "HTTP accept failed: %s\n", strerror(errno));
      }
    }
    if ((descriptors[0].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0 ||
        (descriptors[1].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) {
      fprintf(stderr, "WLED compatibility server socket error\n");
      return;
    }

    if (Clock::now() >= next_announcement) {
      RefreshAddress();
      SendMdnsAnnouncement();
      next_announcement = Clock::now() + std::chrono::seconds(60);
    }
  }
}
