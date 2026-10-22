// SPDX-License-Identifier: GPL-3.0-or-later
#include "stream_store.h"

#include <errno.h>
#include <fcntl.h>
#include <cmath>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <fstream>
#include <algorithm>
#include <limits>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <thread>

namespace {
const size_t kHeaderBytes = 32;
const uint64_t kMaxDurationUs = UINT64_C(31536000) * 1000000;
// Frames the recorder may hold while storage catches up.
const size_t kMaxQueuedFrames = 64;

void Fail(const std::string &message) { throw std::runtime_error(message); }

void WriteBytes(FILE *file, const void *data, size_t size) {
  if (fwrite(data, 1, size, file) != size)
    Fail(std::string("Recording write failed: ") + strerror(errno));
}

void ReadBytes(FILE *file, void *data, size_t size) {
  if (fread(data, 1, size, file) != size)
    Fail("Truncated or unreadable recording");
}

void WriteNumber(FILE *file, uint64_t value, size_t bytes) {
  uint8_t encoded[8];
  for (size_t i = 0; i < bytes; ++i)
    encoded[i] = static_cast<uint8_t>(value >> (i * 8));
  WriteBytes(file, encoded, bytes);
}

uint64_t ReadNumber(FILE *file, size_t bytes) {
  uint8_t encoded[8];
  ReadBytes(file, encoded, bytes);
  uint64_t value = 0;
  for (size_t i = 0; i < bytes; ++i)
    value |= static_cast<uint64_t>(encoded[i]) << (i * 8);
  return value;
}

size_t FrameBytes(uint32_t width, uint32_t height) {
  const uint64_t pixels = static_cast<uint64_t>(width) * height;
  if (width == 0 || height == 0 || pixels > 16 * 1024 * 1024)
    Fail("Invalid recording dimensions (maximum 16 million pixels)");
  return static_cast<size_t>(pixels * 3);
}

void Seek(FILE *file, uint64_t offset) {
  if (offset > static_cast<uint64_t>(std::numeric_limits<off_t>::max()) ||
      fseeko(file, static_cast<off_t>(offset), SEEK_SET) != 0)
    Fail("Cannot seek recording");
}

void Sync(FILE *file) {
  if (fflush(file) != 0 || fsync(fileno(file)) != 0)
    Fail(std::string("Cannot persist recording: ") + strerror(errno));
}

uint64_t ParseInteger(const std::string &text) {
  if (text.empty() || text.find_first_not_of("0123456789") != std::string::npos)
    Fail("Invalid unsigned integer: " + text);
  char *end = NULL;
  errno = 0;
  const unsigned long long value = strtoull(text.c_str(), &end, 10);
  if (errno != 0 || *end != 0)
    Fail("Invalid unsigned integer: " + text);
  return value;
}
}  // namespace

StreamWriter::StreamWriter(const std::string &path, uint32_t width,
                           uint32_t height)
    : StreamWriter(path) {
  Begin(width, height);
}

StreamWriter::StreamWriter(const std::string &path)
    : file_(NULL), frame_bytes_(0), count_(0), last_time_(0) {
  const int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0644);
  if (fd < 0)
    Fail("Cannot create recording " + path + ": " + strerror(errno));
  file_ = fdopen(fd, "wb");
  if (file_ == NULL) {
    close(fd);
    Fail("Cannot open recording stream: " + path);
  }
}

void StreamWriter::Begin(uint32_t width, uint32_t height) {
  if (file_ == NULL || frame_bytes_ != 0)
    Fail("Recording already initialized or closed");
  const size_t bytes = FrameBytes(width, height);
  try {
    WriteBytes(file_, "MRGB0001", 8);
    WriteNumber(file_, width, 4);
    WriteNumber(file_, height, 4);
    WriteNumber(file_, 0, 8);
    frame_bytes_ = bytes;
    WriteNumber(file_, 0, 8);
  } catch (...) {
    fclose(file_);
    file_ = NULL;
    throw;
  }
}

StreamWriter::~StreamWriter() {
  if (file_ != NULL)
    fclose(file_);
}

void StreamWriter::Append(uint64_t time_us, const std::vector<uint8_t> &pixels) {
  if (file_ == NULL || frame_bytes_ == 0 || pixels.size() != frame_bytes_ ||
      (count_ == 0 && time_us != 0) || (count_ != 0 && time_us < last_time_))
    Fail("Invalid recording frame or timestamp");
  WriteNumber(file_, time_us, 8);
  WriteBytes(file_, pixels.data(), pixels.size());
  last_time_ = time_us;
  ++count_;
}

void StreamWriter::Finish(uint64_t duration_us) {
  if (file_ == NULL)
    Fail("Recording already closed");
  if (count_ == 0 || duration_us <= last_time_ ||
      duration_us > kMaxDurationUs)
    Fail("Recording needs frames and a duration beyond its last timestamp");
  Seek(file_, 16);
  WriteNumber(file_, count_, 8);
  WriteNumber(file_, duration_us, 8);
  Sync(file_);
  FILE *file = file_;
  file_ = NULL;
  if (fclose(file) != 0)
    Fail("Cannot close recording");
}

StreamReader::StreamReader(const std::string &path) : file_(NULL) {
  file_ = fopen(path.c_str(), "rb");
  if (file_ == NULL)
    Fail("Cannot read recording " + path + ": " + strerror(errno));
  try {
    char magic[8];
    ReadBytes(file_, magic, 8);
    if (memcmp(magic, "MRGB0001", 8) != 0)
      Fail("Unsupported recording format: " + path);
    width_ = static_cast<uint32_t>(ReadNumber(file_, 4));
    height_ = static_cast<uint32_t>(ReadNumber(file_, 4));
    frame_bytes_ = FrameBytes(width_, height_);
    count_ = ReadNumber(file_, 8);
    duration_ = ReadNumber(file_, 8);
    if (count_ == 0 || duration_ == 0 || duration_ > kMaxDurationUs ||
        count_ > std::numeric_limits<size_t>::max() ||
        count_ > (static_cast<uint64_t>(std::numeric_limits<off_t>::max()) -
                  kHeaderBytes) / (frame_bytes_ + 8))
      Fail("Empty, unfinished or invalid recording: " + path);
    if (fseeko(file_, 0, SEEK_END) != 0 ||
        ftello(file_) != static_cast<off_t>(
            kHeaderBytes + count_ * (frame_bytes_ + 8)))
      Fail("Recording size does not match its frame count: " + path);
    uint64_t previous = 0;
    timestamps_.reserve(static_cast<size_t>(count_));
    for (uint64_t i = 0; i < count_; ++i) {
      Seek(file_, kHeaderBytes + i * (frame_bytes_ + 8));
      const uint64_t timestamp = ReadNumber(file_, 8);
      if ((i == 0 && timestamp != 0) || timestamp < previous ||
          timestamp >= duration_)
        Fail("Invalid recording timestamps: " + path);
      previous = timestamp;
      timestamps_.push_back(timestamp);
    }
  } catch (...) {
    fclose(file_);
    file_ = NULL;
    throw;
  }
}

StreamReader::~StreamReader() { fclose(file_); }

uint64_t StreamReader::Read(uint64_t index, std::vector<uint8_t> *pixels) {
  if (index >= count_ || pixels == NULL)
    Fail("Recording frame index out of range");
  Seek(file_, kHeaderBytes + index * (frame_bytes_ + 8));
  const uint64_t timestamp = ReadNumber(file_, 8);
  pixels->resize(frame_bytes_);
  ReadBytes(file_, pixels->data(), pixels->size());
  return timestamp;
}

uint64_t StreamReader::timestamp_us(uint64_t index) const {
  if (index >= count_)
    Fail("Recording frame index out of range");
  return timestamps_[static_cast<size_t>(index)];
}

uint64_t StreamReader::FrameAt(uint64_t time_us) const {
  if (time_us >= duration_)
    Fail("Recording time out of range");
  return static_cast<uint64_t>(
      std::upper_bound(timestamps_.begin(), timestamps_.end(), time_us) -
      timestamps_.begin() - 1);
}

uint64_t ParseSeconds(const std::string &text) {
  char *end = NULL;
  errno = 0;
  const double seconds = strtod(text.c_str(), &end);
  if (text.empty() || end == text.c_str() || *end != 0 || errno != 0 ||
      !std::isfinite(seconds) || seconds < 0 || seconds > 86400 * 365)
    Fail("Invalid seconds (range 0..31536000): " + text);
  return static_cast<uint64_t>(seconds * 1000000);
}

StreamRecording::StreamRecording(const std::string &path, uint64_t duration)
    : path_(path), duration_(duration), finished_(false), started_(false),
      writer_(new StreamWriter(path)) {
  if (duration > kMaxDurationUs)
    Fail("Recording duration exceeds one year");
}

void StreamRecording::Begin(uint32_t width, uint32_t height) {
  writer_->Begin(width, height);
}

uint64_t StreamRecording::Elapsed(Clock::time_point now) const {
  if (now < start_)
    Fail("Recording clock moved backwards");
  return static_cast<uint64_t>(
      std::chrono::duration_cast<std::chrono::microseconds>(now - start_)
          .count());
}

StreamRecording::~StreamRecording() {
  try {
    StopWriter();
  } catch (const std::exception &) {
    // Nothing useful can be reported from a destructor.
  }
}

void StreamRecording::WriteQueuedFrames() {
  for (;;) {
    Frame frame;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      changed_.wait(lock, [this] { return closing_ || !queue_.empty(); });
      if (queue_.empty())
        return;
      frame = std::move(queue_.front());
      queue_.pop_front();
    }
    changed_.notify_all();
    try {
      writer_->Append(frame.time_us, frame.pixels);
    } catch (const std::exception &error) {
      std::lock_guard<std::mutex> lock(mutex_);
      write_error_ = error.what();
      queue_.clear();
      changed_.notify_all();
      return;
    }
  }
}

// Writes out everything queued, then reports any write failure.
void StreamRecording::StopWriter() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    closing_ = true;
  }
  changed_.notify_all();
  if (worker_.joinable())
    worker_.join();
  if (!write_error_.empty())
    Fail(write_error_);
}

void StreamRecording::Capture(const std::vector<uint8_t> &pixels,
                              Clock::time_point now) {
  if (finished_)
    return;
  if (!started_) {
    start_ = now;
    started_ = true;
    worker_ = std::thread(&StreamRecording::WriteQueuedFrames, this);
    fprintf(stderr, "Recording displayed frames to %s\n", path_.c_str());
  }
  const uint64_t elapsed = Elapsed(now);
  if (duration_ != 0 && elapsed >= duration_) {
    Finish(now);
    return;
  }
  {
    std::unique_lock<std::mutex> lock(mutex_);
    changed_.wait(lock, [this] {
      return queue_.size() < kMaxQueuedFrames || !write_error_.empty();
    });
    if (!write_error_.empty())
      Fail(write_error_);
    queue_.push_back({elapsed, pixels});
  }
  changed_.notify_all();
  last_frame_ = elapsed;
}

void StreamRecording::CheckDuration(Clock::time_point now) {
  if (started_ && !finished_ && duration_ != 0 && Elapsed(now) >= duration_)
    Finish(now);
}

void StreamRecording::Finish(Clock::time_point now) {
  if (finished_)
    return;
  if (!started_) {
    fprintf(stderr, "No displayed frames received; %s is empty and not "
                    "playable\n", path_.c_str());
  } else {
    StopWriter();
    const uint64_t elapsed = Elapsed(now);
    const uint64_t end = duration_ != 0 && elapsed >= duration_
                             ? duration_ : std::max(elapsed, last_frame_ + 1);
    writer_->Finish(end);
    fprintf(stderr, "Saved %llu frames (%.3f seconds) to %s\n",
            static_cast<unsigned long long>(writer_->frame_count()),
            end / 1000000.0, path_.c_str());
  }
  finished_ = true;
}

std::vector<SceneClip> LoadScene(const std::string &path) {
  std::ifstream input(path.c_str());
  std::string line;
  if (!std::getline(input, line) || line != "MATRIX-SCENE-1")
    Fail("Invalid or unreadable scene: " + path);
  std::vector<SceneClip> clips;
  while (std::getline(input, line)) {
    const size_t first = line.find('\t');
    const size_t second = first == std::string::npos ? first :
        line.find('\t', first + 1);
    if (first == 0 || first == std::string::npos ||
        second == std::string::npos)
      Fail("Invalid scene entry: " + path);
    SceneClip clip = {line.substr(0, first),
        ParseInteger(line.substr(first + 1, second - first - 1)),
        ParseInteger(line.substr(second + 1))};
    if (clip.end_us <= clip.start_us)
      Fail("Scene clip end must be after start");
    clips.push_back(clip);
  }
  if (input.bad() || clips.empty())
    Fail("Unreadable or empty scene: " + path);
  return clips;
}

void SaveScene(const std::string &path, const std::vector<SceneClip> &clips,
               bool replace) {
  if (clips.empty())
    Fail("A scene must contain at least one clip");
  std::ostringstream output;
  output << "MATRIX-SCENE-1\n";
  for (const SceneClip &clip : clips) {
    if (clip.path.empty() || clip.path.find_first_of("\t\r\n") !=
        std::string::npos || clip.end_us <= clip.start_us)
      Fail("Invalid scene clip");
    output << clip.path << '\t' << clip.start_us << '\t' << clip.end_us << '\n';
  }

  const std::string text = output.str();
  std::string pattern = path + ".tmp-XXXXXX";
  std::vector<char> temporary(pattern.begin(), pattern.end());
  temporary.push_back(0);
  const int fd = mkstemp(temporary.data());
  if (fd < 0)
    Fail("Cannot create scene temporary file: " + std::string(strerror(errno)));
  FILE *file = fdopen(fd, "wb");
  if (file == NULL) {
    close(fd);
    unlink(temporary.data());
    Fail("Cannot open scene temporary file");
  }
  try {
    WriteBytes(file, text.data(), text.size());
    Sync(file);
  } catch (...) {
    fclose(file);
    unlink(temporary.data());
    throw;
  }
  if (fclose(file) != 0) {
    unlink(temporary.data());
    Fail("Cannot close scene file");
  }
  const int saved = replace ? rename(temporary.data(), path.c_str())
                            : link(temporary.data(), path.c_str());
  if (saved != 0) {
    const std::string error = strerror(errno);
    unlink(temporary.data());
    Fail("Cannot save scene: " + error);
  }
  if (!replace && unlink(temporary.data()) != 0)
    Fail("Scene saved but cannot remove temporary file");
}

void ValidateClipRange(const SceneClip &clip, const StreamReader &reader) {
  if (clip.start_us >= clip.end_us || clip.end_us > reader.duration_us())
    Fail("Clip range exceeds recording duration: " + clip.path);
}

void ValidateScene(const std::string &path,
                   const std::vector<SceneClip> &clips) {
  if (clips.empty())
    Fail("A scene must contain at least one clip");
  uint32_t width = 0, height = 0;
  for (const SceneClip &clip : clips) {
    StreamReader reader(ResolveSceneClip(path, clip.path));
    ValidateClipRange(clip, reader);
    if (width != 0 && (width != reader.width() || height != reader.height()))
      Fail("Scene recordings must have matching dimensions: " + clip.path);
    width = reader.width();
    height = reader.height();
  }
}

std::string ResolveSceneClip(const std::string &scene, const std::string &clip) {
  if (!clip.empty() && clip[0] == '/')
    return clip;
  const size_t slash = scene.find_last_of('/');
  return slash == std::string::npos ? clip : scene.substr(0, slash + 1) + clip;
}

void TrimStream(const std::string &input, const std::string &output,
                uint64_t start_us, uint64_t end_us) {
  StreamReader reader(input);
  if (end_us <= start_us || end_us > reader.duration_us())
    Fail("Trim range must satisfy 0 <= start < end <= duration");
  StreamWriter writer(output, reader.width(), reader.height());
  std::vector<uint8_t> pixels;
  const uint64_t active = reader.FrameAt(start_us);
  reader.Read(active, &pixels);
  writer.Append(0, pixels);
  for (uint64_t i = active + 1; i < reader.frame_count(); ++i) {
    const uint64_t time = reader.Read(i, &pixels);
    if (time >= end_us)
      break;
    if (time > start_us)
      writer.Append(time - start_us, pixels);
  }
  writer.Finish(end_us - start_us);
}

uint64_t RecoverStream(const std::string &input, const std::string &output) {
  FILE *file = fopen(input.c_str(), "rb");
  if (file == NULL)
    Fail("Cannot read recording " + input + ": " + strerror(errno));
  try {
    char magic[8];
    ReadBytes(file, magic, 8);
    if (memcmp(magic, "MRGB0001", 8) != 0)
      Fail("Unsupported recording format: " + input);
    const uint32_t width = static_cast<uint32_t>(ReadNumber(file, 4));
    const uint32_t height = static_cast<uint32_t>(ReadNumber(file, 4));
    const size_t frame_bytes = FrameBytes(width, height);
    if (fseeko(file, 0, SEEK_END) != 0)
      Fail("Cannot seek recording");
    const off_t size = ftello(file);
    if (size < static_cast<off_t>(kHeaderBytes))
      Fail("Recording has no complete header: " + input);
    // A trailing partial frame is whatever was being written at the end.
    const uint64_t available =
        (static_cast<uint64_t>(size) - kHeaderBytes) / (frame_bytes + 8);
    Seek(file, kHeaderBytes);

    StreamWriter writer(output, width, height);
    std::vector<uint8_t> pixels(frame_bytes);
    uint64_t previous = 0, last = 0;
    for (uint64_t i = 0; i < available; ++i) {
      const uint64_t timestamp = ReadNumber(file, 8);
      if ((i == 0 && timestamp != 0) || timestamp < last ||
          timestamp >= kMaxDurationUs)
        break;  // Keep the consistent prefix.
      ReadBytes(file, pixels.data(), pixels.size());
      writer.Append(timestamp, pixels);
      previous = last;
      last = timestamp;
    }
    if (writer.frame_count() == 0) {
      unlink(output.c_str());
      Fail("No complete frames to recover: " + input);
    }
    // The true end is unknown; hold the last frame for one more interval.
    const uint64_t count = writer.frame_count();
    writer.Finish(last + std::max<uint64_t>(1, last - previous));
    fclose(file);
    return count;
  } catch (...) {
    fclose(file);
    throw;
  }
}

StreamPlayback::StreamPlayback(const std::vector<SceneClip> &clips)
    : clips_(clips) {
  if (clips.empty())
    Fail("A scene must contain at least one clip");
  for (SceneClip &clip : clips_) {
    std::unique_ptr<StreamReader> reader(new StreamReader(clip.path));
    if (clip.end_us == kWholeRecording)
      clip.end_us = reader->duration_us();
    ValidateClipRange(clip, *reader);
    if (!readers_.empty() && (reader->width() != readers_[0]->width() ||
                              reader->height() != readers_[0]->height()))
      Fail("Playback dimensions mismatch: " + clip.path);
    readers_.push_back(std::move(reader));
  }
}

void StreamPlayback::Play(
    uint32_t width, uint32_t height, bool loop,
    const std::function<void(const std::vector<uint8_t> &)> &present,
    const std::function<bool()> &should_stop) {
  if (readers_[0]->width() != width || readers_[0]->height() != height)
    Fail("Playback dimensions do not match the configured matrix");
  if (!present || !should_stop)
    Fail("Playback requires presentation and stop callbacks");
  const auto wait = [&](std::chrono::steady_clock::time_point deadline) {
    while (!should_stop() && std::chrono::steady_clock::now() < deadline) {
      std::this_thread::sleep_until(std::min(
          deadline, std::chrono::steady_clock::now() +
                        std::chrono::milliseconds(10)));
    }
  };
  do {
    for (size_t clip_index = 0; clip_index < clips_.size(); ++clip_index) {
      if (should_stop())
        return;
      const SceneClip &clip = clips_[clip_index];
      StreamReader &reader = *readers_[clip_index];
      std::vector<uint8_t> pixels;
      const auto start = std::chrono::steady_clock::now();
      for (uint64_t i = reader.FrameAt(clip.start_us);
           i < reader.frame_count() && !should_stop(); ++i) {
        const uint64_t timestamp = reader.timestamp_us(i);
        if (timestamp >= clip.end_us)
          break;
        reader.Read(i, &pixels);
        const uint64_t offset =
            timestamp <= clip.start_us ? 0 : timestamp - clip.start_us;
        wait(start + std::chrono::microseconds(offset));
        if (should_stop())
          return;
        present(pixels);
      }
      wait(start + std::chrono::microseconds(clip.end_us - clip.start_us));
    }
  } while (loop && !should_stop());
}
