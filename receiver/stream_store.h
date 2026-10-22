// SPDX-License-Identifier: GPL-3.0-or-later
#ifndef STREAM_STORE_H
#define STREAM_STORE_H

#include <stdint.h>
#include <stdio.h>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

class StreamWriter {
 public:
  explicit StreamWriter(const std::string &path);
  StreamWriter(const std::string &path, uint32_t width, uint32_t height);
  ~StreamWriter();
  void Begin(uint32_t width, uint32_t height);
  void Append(uint64_t time_us, const std::vector<uint8_t> &pixels);
  void Finish(uint64_t duration_us);
  uint64_t frame_count() const { return count_; }
 private:
  StreamWriter(const StreamWriter &) = delete;
  StreamWriter &operator=(const StreamWriter &) = delete;
  FILE *file_;
  size_t frame_bytes_;
  uint64_t count_;
  uint64_t last_time_;
};

class StreamReader {
 public:
  explicit StreamReader(const std::string &path);
  ~StreamReader();
  uint64_t Read(uint64_t index, std::vector<uint8_t> *pixels);
  uint64_t timestamp_us(uint64_t index) const;
  uint64_t FrameAt(uint64_t time_us) const;
  uint32_t width() const { return width_; }
  uint32_t height() const { return height_; }
  uint64_t frame_count() const { return count_; }
  uint64_t duration_us() const { return duration_; }
 private:
  StreamReader(const StreamReader &) = delete;
  StreamReader &operator=(const StreamReader &) = delete;
  FILE *file_;
  uint32_t width_;
  uint32_t height_;
  size_t frame_bytes_;
  uint64_t count_;
  uint64_t duration_;
  std::vector<uint64_t> timestamps_;
};

// Records displayed frames. Frames are written by a background thread so
// slow storage does not hold up the caller; Capture only blocks when the
// bounded queue is full.
class StreamRecording {
 public:
  using Clock = std::chrono::steady_clock;
  StreamRecording(const std::string &path, uint64_t duration);
  ~StreamRecording();
  void Begin(uint32_t width, uint32_t height);
  void Capture(const std::vector<uint8_t> &pixels, Clock::time_point now);
  void CheckDuration(Clock::time_point now = Clock::now());
  void Finish(Clock::time_point now = Clock::now());
 private:
  struct Frame {
    uint64_t time_us;
    std::vector<uint8_t> pixels;
  };
  StreamRecording(const StreamRecording &) = delete;
  StreamRecording &operator=(const StreamRecording &) = delete;
  uint64_t Elapsed(Clock::time_point now) const;
  void WriteQueuedFrames();
  void StopWriter();
  std::string path_;
  uint64_t duration_;
  bool finished_;
  bool started_;
  uint64_t last_frame_ = 0;
  Clock::time_point start_;
  std::unique_ptr<StreamWriter> writer_;
  // Guarded by mutex_; the worker owns writer_ while it runs.
  std::mutex mutex_;
  std::condition_variable changed_;
  std::deque<Frame> queue_;
  bool closing_ = false;
  std::string write_error_;
  std::thread worker_;
};

struct SceneClip {
  std::string path;
  uint64_t start_us;
  uint64_t end_us;
};

// As a clip end for StreamPlayback: play to the end of the recording.
const uint64_t kWholeRecording = UINT64_MAX;

class StreamPlayback {
 public:
  explicit StreamPlayback(const std::vector<SceneClip> &clips);
  void Play(uint32_t width, uint32_t height, bool loop,
            const std::function<void(const std::vector<uint8_t> &)> &present,
            const std::function<bool()> &should_stop);
 private:
  std::vector<SceneClip> clips_;
  std::vector<std::unique_ptr<StreamReader>> readers_;
};

uint64_t ParseSeconds(const std::string &text);
std::vector<SceneClip> LoadScene(const std::string &path);
void SaveScene(const std::string &path, const std::vector<SceneClip> &clips,
               bool replace = true);
// Throws unless start < end <= the recording's duration.
void ValidateClipRange(const SceneClip &clip, const StreamReader &reader);
void ValidateScene(const std::string &path, const std::vector<SceneClip> &clips);
std::string ResolveSceneClip(const std::string &scene, const std::string &clip);
void TrimStream(const std::string &input, const std::string &output,
                uint64_t start_us, uint64_t end_us);
// Copies the complete frames of a recording that was never finished (crash
// or power loss) into a new playable recording. Returns the frame count.
uint64_t RecoverStream(const std::string &input, const std::string &output);

#endif
