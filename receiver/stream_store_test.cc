// SPDX-License-Identifier: GPL-3.0-or-later
#include "stream_store.h"

#include <assert.h>
#include <stdlib.h>
#include <unistd.h>
#include <fstream>
#include <iostream>
#include <stdexcept>

template <typename Function>
void ExpectError(Function function) {
  bool failed = false;
  try { function(); }
  catch (const std::runtime_error &) { failed = true; }
  assert(failed);
}

int main() {
  char directory[] = "/tmp/matrix-stream-test-XXXXXX";
  assert(mkdtemp(directory) != NULL);
  const std::string root(directory);
  const std::string source = root + "/source.mrgb";
  const std::string trimmed = root + "/trimmed.mrgb";
  const std::string scene = root + "/playlist.scene";
  const std::string invalid = root + "/invalid.mrgb";
  const std::string timed = root + "/timed.mrgb";
  const std::string manual = root + "/manual.mrgb";
  const std::string empty = root + "/empty.mrgb";
  const std::string unfinished = root + "/unfinished.mrgb";
  const std::string queued = root + "/queued.mrgb";
  const std::string recovered = root + "/recovered.mrgb";
  const std::string boundary = root + "/boundary.mrgb";
  const std::string other_size = root + "/other-size.mrgb";
  const std::vector<uint8_t> red = {255, 0, 0, 255, 0, 0};
  const std::vector<uint8_t> green = {0, 255, 0, 0, 255, 0};
  const std::vector<uint8_t> blue = {0, 0, 255, 0, 0, 255};
  {
    StreamWriter writer(source, 2, 1);
    ExpectError([&] { writer.Append(1, red); });
    ExpectError([&] { writer.Append(0, {}); });
    writer.Append(0, red);
    writer.Append(100000, green);
    ExpectError([&] { writer.Append(50000, green); });
    writer.Append(300000, blue);
    ExpectError([&] { writer.Finish(300000); });
    writer.Finish(500000);
  }
  ExpectError([&] { StreamWriter writer(source, 2, 1); });
  {
    StreamReader reader(source);
    assert(reader.width() == 2 && reader.height() == 1);
    assert(reader.frame_count() == 3 && reader.duration_us() == 500000);
    std::vector<uint8_t> pixels;
    assert(reader.Read(1, &pixels) == 100000 && pixels == green);
    ExpectError([&] { reader.Read(3, &pixels); });
    assert(reader.FrameAt(99999) == 0);
    assert(reader.FrameAt(100000) == 1);
    assert(reader.FrameAt(499999) == 2);
    assert(reader.timestamp_us(2) == 300000);
    ExpectError([&] { reader.FrameAt(500000); });
  }
  TrimStream(source, trimmed, 150000, 400000);
  {
    StreamReader reader(trimmed);
    assert(reader.frame_count() == 2 && reader.duration_us() == 250000);
    std::vector<uint8_t> pixels;
    assert(reader.Read(0, &pixels) == 0 && pixels == green);
    assert(reader.Read(1, &pixels) == 150000 && pixels == blue);
  }
  ExpectError([&] { TrimStream(source, root + "/bad", 500000, 600000); });
  TrimStream(source, boundary, 100000, 300000);
  {
    StreamReader reader(boundary);
    std::vector<uint8_t> pixels;
    assert(reader.frame_count() == 1 && reader.duration_us() == 200000);
    assert(reader.Read(0, &pixels) == 0 && pixels == green);
  }
  SaveScene(scene, {{"source.mrgb", 150000, 400000}, {trimmed, 0, 250000}});
  auto clips = LoadScene(scene);
  assert(clips.size() == 2 && clips[0].start_us == 150000);
  assert(ResolveSceneClip(scene, clips[0].path) == source);
  assert(ResolveSceneClip(scene, clips[1].path) == trimmed);
  SaveScene(scene, {clips[1], clips[0]});
  assert(LoadScene(scene)[0].path == trimmed);
  ValidateScene(scene, clips);
  ExpectError([&] { SaveScene(scene, clips, false); });
  ExpectError([&] { ValidateScene(scene, {{"missing", 0, 1}}); });
  ExpectError([&] { ValidateScene(scene, {{source, 0, 500001}}); });
  {
    StreamWriter writer(other_size, 1, 1);
    writer.Append(0, {0, 0, 0});
    writer.Finish(1000);
  }
  ExpectError([&] {
    ValidateScene(scene, {{source, 0, 1}, {other_size, 0, 1}});
  });
  ExpectError([&] { SaveScene(scene, {}); });
  assert(ParseSeconds("1.25") == 1250000);
  ExpectError([&] { ParseSeconds("-1"); });
  ExpectError([&] { ParseSeconds("nan"); });
  ExpectError([&] { ParseSeconds("1x"); });
  const auto start = StreamRecording::Clock::now();
  {
    StreamRecording recording(timed, 10000);
    recording.Begin(2, 1);
    recording.CheckDuration(start + std::chrono::seconds(20));
    recording.Capture(red, start);
    recording.Capture(green, start + std::chrono::microseconds(5000));
    recording.CheckDuration(start + std::chrono::microseconds(10000));
    recording.Capture(blue, start + std::chrono::microseconds(20000));
    recording.Finish(start + std::chrono::microseconds(30000));
  }
  {
    StreamReader reader(timed);
    assert(reader.duration_us() == 10000 && reader.frame_count() == 2);
  }
  {
    StreamRecording recording(manual, 0);
    recording.Begin(2, 1);
    recording.Capture(blue, start);
    recording.Finish(start + std::chrono::microseconds(2000));
  }
  assert(StreamReader(manual).duration_us() == 2000);
  {
    StreamWriter writer(empty, 2, 1);
    writer.Append(0, red);
  }
  ExpectError([&] { StreamReader reader(empty); });
  {
    // More frames than the recorder queues at once still land in order.
    StreamRecording recording(queued, 0);
    recording.Begin(2, 1);
    const auto start = StreamRecording::Clock::now();
    for (int i = 0; i < 500; ++i) {
      recording.Capture(i % 2 ? green : red,
                        start + std::chrono::microseconds(i * 10));
    }
    recording.Finish(start + std::chrono::microseconds(5000));
    StreamReader reader(queued);
    assert(reader.frame_count() == 500 && reader.duration_us() == 5000);
    std::vector<uint8_t> pixels;
    assert(reader.Read(499, &pixels) == 4990 && pixels == green);
    assert(reader.Read(250, &pixels) == 2500 && pixels == red);
  }
  {
    // An unfinished recording stays unplayable until explicitly recovered.
    {
      StreamWriter writer(unfinished, 2, 1);
      writer.Append(0, red);
      writer.Append(4000, green);
    }
    assert(RecoverStream(unfinished, recovered) == 2);
    StreamReader reader(recovered);
    assert(reader.frame_count() == 2 && reader.duration_us() == 8000);
    std::vector<uint8_t> pixels;
    assert(reader.Read(1, &pixels) == 4000 && pixels == green);
    ExpectError([&] { RecoverStream(unfinished, recovered); });
    ExpectError([&] { RecoverStream(root + "/missing.mrgb", recovered); });
  }
  {
    std::vector<std::vector<uint8_t>> shown;
    StreamPlayback playback({{timed, 2000, 10000}, {manual, 0, 2000}});
    const auto playback_start = StreamRecording::Clock::now();
    playback.Play(2, 1, false,
        [&](const std::vector<uint8_t> &pixels) { shown.push_back(pixels); },
        [] { return false; });
    assert(shown == std::vector<std::vector<uint8_t>>({red, green, blue}));
    assert(StreamRecording::Clock::now() - playback_start >=
           std::chrono::microseconds(10000));
    shown.clear();
    playback.Play(2, 1, true,
        [&](const std::vector<uint8_t> &pixels) { shown.push_back(pixels); },
        [&] { return shown.size() >= 4; });
    assert(shown == std::vector<std::vector<uint8_t>>({red, green, blue, red}));
    shown.clear();
    ExpectError([&] {
      playback.Play(1, 1, false,
          [&](const std::vector<uint8_t> &pixels) { shown.push_back(pixels); },
          [] { return false; });
    });
    assert(shown.empty());
    ExpectError([&] {
      StreamPlayback bad({{timed, 0, 10000}, {empty, 0, 1}});
    });
  }
  {
    std::ofstream file(invalid.c_str(), std::ios::binary);
    file << "MRGB0001";
  }
  ExpectError([&] { StreamReader reader(invalid); });
  {
    std::fstream file(source.c_str(), std::ios::in | std::ios::out |
                                     std::ios::binary);
    file.seekp(32);
    file.put(1);
  }
  ExpectError([&] { StreamReader reader(source); });
  unlink(source.c_str());
  unlink(trimmed.c_str());
  unlink(scene.c_str());
  unlink(invalid.c_str());
  unlink(timed.c_str());
  unlink(manual.c_str());
  unlink(empty.c_str());
  unlink(unfinished.c_str());
  unlink(queued.c_str());
  unlink(recovered.c_str());
  unlink(boundary.c_str());
  unlink(other_size.c_str());
  assert(rmdir(directory) == 0);
  std::cout << "Recording, timed playback, looping, trimming, scene and "
               "corruption tests passed\n";
}
