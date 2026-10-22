#include "dmx_protocol.h"
#include "wled_compat.h"

#include <assert.h>
#include <stdint.h>
#include <string.h>

namespace {

void TestArtNetParserAndMapping() {
  uint8_t packet[18 + 6] = {};
  memcpy(packet, "Art-Net\0", 8);
  packet[8] = 0x00;
  packet[9] = 0x50;
  packet[11] = 14;
  packet[14] = 3;
  packet[16] = 0;
  packet[17] = 6;
  const uint8_t slots[] = {1, 2, 3, 4, 5, 6};
  memcpy(packet + 18, slots, sizeof(slots));

  DmxPacketView parsed = {};
  assert(ParseArtNetDmx(packet, sizeof(packet), &parsed));
  assert(parsed.universe == 3);
  assert(parsed.slot_count == sizeof(slots));
  assert(memcmp(parsed.slots, slots, sizeof(slots)) == 0);

  uint8_t pixels[172 * 3] = {};
  assert(ApplyDmxPacket(pixels, 172, 2, parsed) == 2);
  assert(pixels[3 * 170] == 1);
  assert(pixels[3 * 170 + 5] == 6);

  packet[9] = 0;
  assert(!ParseArtNetDmx(packet, sizeof(packet), &parsed));
  packet[9] = 0x50;
  assert(!ParseArtNetDmx(packet, sizeof(packet) - 1, &parsed));
}

void TestSacnParserAndMapping() {
  uint8_t packet[126 + 6] = {};
  packet[1] = 0x10;
  memcpy(packet + 4, "ASC-E1.17\0\0\0", 12);

  const size_t root_length = sizeof(packet) - 16;
  packet[16] = static_cast<uint8_t>(0x70 | (root_length >> 8));
  packet[17] = static_cast<uint8_t>(root_length);
  packet[21] = 4;
  const size_t framing_length = sizeof(packet) - 38;
  packet[38] = static_cast<uint8_t>(0x70 | (framing_length >> 8));
  packet[39] = static_cast<uint8_t>(framing_length);
  packet[43] = 2;
  const size_t dmp_length = sizeof(packet) - 115;
  packet[115] = static_cast<uint8_t>(0x70 | (dmp_length >> 8));
  packet[116] = static_cast<uint8_t>(dmp_length);
  packet[117] = 2;
  packet[118] = 0xa1;
  packet[122] = 1;
  packet[124] = 7;
  packet[125] = 0;
  packet[114] = 1;
  const uint8_t slots[] = {11, 22, 33, 44, 55, 66};
  memcpy(packet + 126, slots, sizeof(slots));

  DmxPacketView parsed = {};
  assert(ParseSacnDmx(packet, sizeof(packet), &parsed));
  assert(parsed.universe == 1);
  assert(parsed.slot_count == sizeof(slots));

  uint8_t pixels[2 * 3] = {};
  assert(ApplyDmxPacket(pixels, 2, 1, parsed) == 2);
  assert(memcmp(pixels, slots, sizeof(slots)) == 0);

  packet[125] = 1;
  assert(!ParseSacnDmx(packet, sizeof(packet), &parsed));
}

void TestDdpParserAndMapping() {
  uint8_t packet[10 + 6] = {};
  packet[0] = 0x41;
  packet[1] = 1;
  packet[2] = 1;
  packet[3] = 17;
  packet[7] = 3;
  packet[9] = 6;
  const uint8_t data[] = {10, 20, 30, 40, 50, 60};
  memcpy(packet + 10, data, sizeof(data));

  DdpPacketView parsed = {};
  assert(ParseDdpPacket(packet, sizeof(packet), &parsed));
  assert(parsed.byte_offset == 3);
  assert(parsed.data_length == sizeof(data));
  assert(parsed.sequence == 1);
  assert(parsed.data_type == 1);
  assert(parsed.destination_id == 17);
  assert(parsed.push_frame);

  uint8_t pixels[12] = {};
  assert(ApplyDdpPacket(pixels, sizeof(pixels), parsed) == sizeof(data));
  assert(pixels[3] == 10);
  assert(pixels[8] == 60);

  // A timecode flag moves the data four bytes later.
  uint8_t timed[14 + 3] = {0x51, 1, 0x0b, 1, 0, 0, 0, 0, 0, 3,
                           9, 9, 9, 9, 70, 80, 90};
  DdpPacketView timed_view = {};
  assert(ParseDdpPacket(timed, sizeof(timed), &timed_view));
  assert(timed_view.data_length == 3 && timed_view.data[0] == 70);
  assert(!ParseDdpPacket(timed, sizeof(timed) - 1, &timed_view));

  packet[2] = 2;
  assert(!ParseDdpPacket(packet, sizeof(packet), &parsed));
  packet[2] = 1;
  assert(!ParseDdpPacket(packet, sizeof(packet) - 1, &parsed));
}

void TestWledCompatibility() {
  const std::string info =
      BuildWledInfoJson(128, 64, "wled-dietpi", "aabbccddeeff");
  assert(info.find("\"brand\":\"WLED\"") != std::string::npos);
  assert(info.find("\"count\":8192") != std::string::npos);
  assert(info.find("\"matrix\":{\"w\":128,\"h\":64}") != std::string::npos);
  const std::string state = BuildWledStateJson(128, 64);
  assert(state.find("\"start\":0,\"stop\":128,\"startY\":0,\"stopY\":64") !=
         std::string::npos);
  assert(info.find("\"mac\":\"aabbccddeeff\"") != std::string::npos);
  // WLED 0.15.0's build, so LedFx chooses DDP (from build 2110060), and
  // counts that agree with the one effect and palette listed.
  assert(info.find("\"ver\":\"0.15.0\",\"vid\":2412100") != std::string::npos);
  assert(info.find("\"fxcount\":1") != std::string::npos);
  assert(info.find("\"palcount\":1") != std::string::npos);
  const std::string config = BuildWledConfigJson(128, 64, "wled-dietpi");
  assert(config.find("\"total\":8192") != std::string::npos);
  assert(config.find("\"live\":{\"en\":true") != std::string::npos);
  assert(config.find("\"no-gc\":true") != std::string::npos);
  assert(config.find("\"h\":64,\"w\":128") != std::string::npos);
  const std::string html = BuildWledRootHtml(128, 64, "wled-<x>");
  assert(html.find("WLED wled-&lt;x&gt;") != std::string::npos);
  assert(html.find("<x>") == std::string::npos);

  const uint8_t address[] = {192, 168, 1, 25};
  std::vector<uint8_t> response;
  assert(BuildWledMdnsResponse("wled-aabbcc", address, "001122aabbcc",
                               &response));
  assert(response.size() > 12);
  assert(response[2] == 0x84);
  assert(response[4] == 0 && response[5] == 0);
  assert(response[6] == 0 && response[7] == 6);
  const std::string dns_records(response.begin() + 12, response.end());
  assert(dns_records.find("_http") != std::string::npos);
  assert(dns_records.find("_wled") != std::string::npos);
  assert(dns_records.find("mac=001122aabbcc") != std::string::npos);
  // With cache_flush off, no record carries the cache-flush bit.
  std::vector<uint8_t> unicast;
  assert(BuildWledMdnsResponse("wled-aabbcc", address, "001122aabbcc",
                               &unicast, false));
  assert(unicast.size() == response.size());
  size_t flushed = 0, plain = 0;
  for (size_t i = 0; i + 1 < response.size(); ++i) {
    if (response[i] == 0x80 && response[i + 1] == 0x01) ++flushed;
    if (unicast[i] == 0x80 && unicast[i + 1] == 0x01) ++plain;
  }
  assert(flushed == 4 && plain == 0);
}

void TestWledHttpRoute() {
  const std::string info = "{\"i\":1}", state = "{\"s\":1}";
  const std::string config = "{\"c\":1}", html = "<p>page</p>";
  const struct {
    const char *line;
    int status;
    const char *body;
  } cases[] = {
      {"GET /json/info HTTP/1.1", 200, "{\"i\":1}"},
      {"GET /json/info?x=1 HTTP/1.1", 200, "{\"i\":1}"},
      {"GET /json/state HTTP/1.0", 200, "{\"s\":1}"},
      {"GET /json/si HTTP/1.1", 200, "{\"state\":{\"s\":1},\"info\":{\"i\":1}}"},
      {"GET /json HTTP/1.1", 200,
       "{\"state\":{\"s\":1},\"info\":{\"i\":1},\"effects\":[\"Solid\"],"
       "\"palettes\":[\"Default\"]}"},
      {"GET /json/ HTTP/1.1", 200, NULL},
      {"GET /json/eff HTTP/1.1", 200, "[\"Solid\"]"},
      {"GET /json/pal HTTP/1.1", 200, "[\"Default\"]"},
      {"GET /json/cfg HTTP/1.1", 200, "{\"c\":1}"},
      {"GET /json/nodes HTTP/1.1", 200, "{\"nodes\":[]}"},
      {"GET /presets.json HTTP/1.1", 200, "{}"},
      {"GET / HTTP/1.1", 200, "<p>page</p>"},
      {"POST /json/state HTTP/1.1", 200, "{\"success\":true}"},
      {"POST /json/cfg HTTP/1.1", 200, "{\"success\":true}"},
      {"POST /json/info HTTP/1.1", 404, NULL},
      {"GET /win HTTP/1.1", 404, NULL},
      {"GET /json/infox HTTP/1.1", 404, NULL},
      {"DELETE /json/state HTTP/1.1", 405, NULL},
      {"GET", 400, NULL},
      {"", 400, NULL},
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); ++i) {
    const WledHttpReply reply =
        WledHttpRoute(cases[i].line, info, state, config, html);
    assert(reply.status == cases[i].status);
    if (cases[i].body != NULL)
      assert(reply.body == cases[i].body);
  }
  assert(WledHttpRoute("GET / HTTP/1.1", info, state, config, html)
             .content_type == "text/html; charset=utf-8");
  assert(WledHttpRoute("GET /json HTTP/1.1", info, state, config, html)
             .content_type == "application/json");
}

void TestWledLegacyUnicastReply() {
  const uint8_t address[] = {192, 168, 1, 25};
  std::vector<uint8_t> records;
  assert(BuildWledMdnsResponse("wled-aabbcc", address, "001122aabbcc",
                               &records, false));
  // id 0x1234, one question for _wled._tcp.local PTR.
  const uint8_t query[] = {
      0x12, 0x34, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      5, '_', 'w', 'l', 'e', 'd', 4, '_', 't', 'c', 'p',
      5, 'l', 'o', 'c', 'a', 'l', 0, 0, 12, 0, 1};
  std::vector<uint8_t> reply;
  assert(BuildWledLegacyUnicastReply(query, sizeof(query), records, &reply));
  assert(reply[0] == 0x12 && reply[1] == 0x34);
  assert(reply[2] == 0x84);
  assert(reply[4] == 0 && reply[5] == 1);
  assert(reply[6] == records[6] && reply[7] == records[7]);
  assert(memcmp(&reply[12], query + 12, sizeof(query) - 12) == 0);
  assert(reply.size() == records.size() + sizeof(query) - 12);
  assert(memcmp(&reply[sizeof(query)], &records[12], records.size() - 12) == 0);
  // A question that cannot be read gets no reply.
  assert(!BuildWledLegacyUnicastReply(query, sizeof(query) - 3, records, &reply));
  const uint8_t loop[] = {0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
                          0xc0, 12, 0, 12, 0, 1};
  assert(!BuildWledLegacyUnicastReply(loop, sizeof(loop), records, &reply));
}

void TestWledMdnsQueryMatching() {
  // One question for _WLED._tcp.local (mixed case), type PTR, class IN.
  const uint8_t wled_query[] = {
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      5, '_', 'W', 'L', 'E', 'D', 4, '_', 't', 'c', 'p',
      5, 'l', 'o', 'c', 'a', 'l', 0, 0, 12, 0, 1};
  assert(WledMdnsQueryMatches(wled_query, sizeof(wled_query), "wled-aabbcc"));

  // Unrelated service first, then the host name via a compression pointer
  // to the earlier "local" label.
  const uint8_t two_questions[] = {
      0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0,
      8, '_', 'a', 'i', 'r', 'p', 'l', 'a', 'y', 4, '_', 't', 'c', 'p',
      5, 'l', 'o', 'c', 'a', 'l', 0, 0, 12, 0, 1,
      11, 'w', 'l', 'e', 'd', '-', 'a', 'a', 'b', 'b', 'c', 'c',
      0xc0, 26, 0, 1, 0, 1};
  assert(WledMdnsQueryMatches(two_questions, sizeof(two_questions),
                              "wled-aabbcc"));
  assert(!WledMdnsQueryMatches(two_questions, sizeof(two_questions),
                               "wled-ddeeff"));

  uint8_t response[sizeof(wled_query)];
  memcpy(response, wled_query, sizeof(response));
  response[2] = 0x84;
  assert(!WledMdnsQueryMatches(response, sizeof(response), "wled-aabbcc"));
  assert(!WledMdnsQueryMatches(wled_query, sizeof(wled_query) - 3,
                               "wled-aabbcc"));
  // A pointer loop must terminate.
  const uint8_t loop[] = {0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
                          0xc0, 12, 0, 12, 0, 1};
  assert(!WledMdnsQueryMatches(loop, sizeof(loop), "wled-aabbcc"));
}

void TestDdpRgb8SenderPacket() {
  const uint8_t header[] = {
      0x41, 0x03, 0x0b, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01, 0xfe};
  uint8_t packet[520] = {};
  memcpy(packet, header, sizeof(header));
  for (size_t i = 10; i < sizeof(packet); ++i)
    packet[i] = static_cast<uint8_t>(i);

  DdpPacketView parsed = {};
  assert(ParseDdpPacket(packet, sizeof(packet), &parsed));
  assert(parsed.sequence == 3);
  assert(parsed.data_type == 0x0b);
  assert(parsed.destination_id == 1);
  assert(parsed.byte_offset == 0);
  assert(parsed.data_length == 510);
  assert(parsed.push_frame);

  uint8_t pixels[513] = {};
  assert(ApplyDdpPacket(pixels, sizeof(pixels), parsed) == 510);
  assert(memcmp(pixels, packet + 10, 510) == 0);
  assert(pixels[510] == 0 && pixels[511] == 0 && pixels[512] == 0);
  assert(!ParseDdpPacket(packet, sizeof(packet) - 1, &parsed));

  packet[0] = 0x40;
  assert(ParseDdpPacket(packet, sizeof(packet), &parsed));
  assert(!parsed.push_frame);

  const uint8_t unsupported_types[] = {0x0c, 0x13, 0x1b, 0x8b};
  for (size_t i = 0; i < sizeof(unsupported_types); ++i) {
    packet[2] = unsupported_types[i];
    assert(!ParseDdpPacket(packet, sizeof(packet), &parsed));
  }
}

}  // namespace

void TestArtNetDiscovery() {
  uint8_t poll[] = {
      'A', 'r', 't', '-', 'N', 'e', 't', 0, 0, 0x20, 0, 14, 0, 0};
  assert(IsArtNetPoll(poll, sizeof(poll)));
  assert(!IsArtNetPoll(poll, sizeof(poll) - 1));
  poll[9] = 0x50;
  assert(!IsArtNetPoll(poll, sizeof(poll)));
  const uint8_t ip[] = {192, 168, 1, 42};
  uint8_t reply[239];
  assert(BuildArtNetPollReply(ip, 0x123, 4, 2, reply));
  assert(memcmp(reply, "Art-Net\0", 8) == 0);
  assert(reply[8] == 0 && reply[9] == 0x21);
  assert(memcmp(reply + 10, ip, 4) == 0);
  assert(reply[14] == 0x36 && reply[15] == 0x19);
  assert(reply[18] == 1 && reply[19] == 2);
  assert(reply[173] == 4);
  for (size_t i = 0; i < 4; ++i) {
    assert(reply[174 + i] == 0x80);
    assert(reply[190 + i] == 3 + i);
  }
  assert(memcmp(reply + 207, ip, 4) == 0);
  assert(reply[211] == 2);
  assert(!BuildArtNetPollReply(ip, 15, 2, 1, reply));
  assert(!BuildArtNetPollReply(ip, 0, 5, 1, reply));
  assert(!BuildArtNetPollReply(ip, 0, 1, 0, reply));
}

void TestPixelAnimatorPackets() {
  const uint8_t headers[][12] = {
      {0x41, 0x41, 0x00, 0xb9, 0x00, 0x01, 0x00, 0x01, 0xab, 0x80, 0x05, 0xa0},
      {0x41, 0x41, 0x00, 0xc3, 0x00, 0x01, 0x00, 0x01, 0x02, 0xc0, 0x05, 0xa0},
      {0x41, 0x41, 0x00, 0xca, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x05, 0xa0}};
  const uint32_t offsets[] = {109440, 66240, 0};
  std::vector<uint8_t> pixels(150000, 0);
  for (size_t i = 0; i < 3; ++i) {
    uint8_t packet[1452] = {};
    memcpy(packet, headers[i], 12);
    memset(packet + 12, 42, 1440);
    DdpPacketView parsed = {};
    assert(!ParseDdpPacket(packet, sizeof(packet), &parsed));
    assert(ParsePixelAnimatorPacket(packet, sizeof(packet), &parsed));
    assert(parsed.byte_offset == offsets[i]);
    assert(parsed.data_length == 1440);
    assert(parsed.sequence == headers[i][3]);
    assert(parsed.destination_id == 1);
    assert(parsed.data == packet + 12);
    assert(ApplyDdpPacket(pixels.data(), pixels.size(), parsed) == 1440);
    assert(memcmp(pixels.data() + offsets[i], packet + 12, 1440) == 0);
    bool is_pixel_animator = false;
    assert(ParseAutoDdpPacket(packet, sizeof(packet), &parsed,
                              &is_pixel_animator));
    assert(is_pixel_animator && parsed.byte_offset == offsets[i]);
    assert(!ParsePixelAnimatorPacket(packet, sizeof(packet) - 1, &parsed));
    packet[4] = 1;
    assert(!ParsePixelAnimatorPacket(packet, sizeof(packet), &parsed));
  }
}

void TestAutoDdpStandardPackets() {
  // Captured standard DDP header from Pixel Animator 3 in DDP mode.
  uint8_t packet[1450] = {0x40, 0x0e, 0x0b, 0x01, 0x00,
                          0x00, 0x21, 0xc0, 0x05, 0xa0};
  memset(packet + 10, 7, 1440);
  DdpPacketView parsed = {};
  bool is_pixel_animator = true;
  assert(!ParsePixelAnimatorPacket(packet, sizeof(packet), &parsed));
  assert(ParseAutoDdpPacket(packet, sizeof(packet), &parsed,
                            &is_pixel_animator));
  assert(!is_pixel_animator);
  assert(parsed.byte_offset == 8640);
  assert(parsed.data_length == 1440);
  assert(!parsed.push_frame);
  packet[0] = 0x41;
  assert(ParseAutoDdpPacket(packet, sizeof(packet), &parsed,
                            &is_pixel_animator));
  assert(!is_pixel_animator && parsed.push_frame);
}

int main() {
  TestPixelAnimatorPackets();
  TestAutoDdpStandardPackets();
  TestArtNetDiscovery();
  TestArtNetParserAndMapping();
  TestSacnParserAndMapping();
  TestDdpParserAndMapping();
  TestDdpRgb8SenderPacket();
  TestWledCompatibility();
  TestWledMdnsQueryMatching();
  TestWledHttpRoute();
  TestWledLegacyUnicastReply();
  return 0;
}
