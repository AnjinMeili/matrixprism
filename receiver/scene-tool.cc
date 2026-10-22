// SPDX-License-Identifier: GPL-3.0-or-later
#include "stream_store.h"

#include <stdlib.h>
#include <errno.h>
#include <string.h>
#include <iostream>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace {
std::string AbsolutePath(const char *path) {
  char *resolved = realpath(path, NULL);
  if (resolved == NULL)
    throw std::runtime_error(std::string("Cannot resolve path ") + path +
                             ": " + strerror(errno));
  const std::string result(resolved);
  free(resolved);
  return result;
}

size_t Index(const char *text, size_t count) {
  const std::string value(text);
  if (value.empty() || value.find_first_not_of("0123456789") !=
      std::string::npos)
    throw std::runtime_error("Scene index must be an integer");
  const unsigned long long index = std::stoull(value);
  if (index == 0 || index > count)
    throw std::runtime_error("Scene index out of range (indices start at 1)");
  return static_cast<size_t>(index - 1);
}

SceneClip Clip(const char *path, uint64_t start, uint64_t end) {
  const std::string absolute = AbsolutePath(path);
  const SceneClip clip = {absolute, start, end};
  ValidateClipRange(clip, StreamReader(absolute));
  return clip;
}

std::vector<std::string> PathParts(const std::string &path) {
  std::istringstream input(path);
  std::vector<std::string> parts;
  std::string part;
  while (std::getline(input, part, '/'))
    if (!part.empty())
      parts.push_back(part);
  return parts;
}

void SavePlaylist(const std::string &path, std::vector<SceneClip> clips,
                  bool replace = true) {
  ValidateScene(path, clips);
  const size_t slash = path.find_last_of('/');
  const std::string parent = slash == std::string::npos ? "." :
      (slash == 0 ? "/" : path.substr(0, slash));
  const auto directory = PathParts(AbsolutePath(parent.c_str()));
  for (SceneClip &clip : clips) {
    const auto recording =
        PathParts(AbsolutePath(ResolveSceneClip(path, clip.path).c_str()));
    size_t common = 0;
    while (common < directory.size() && common < recording.size() &&
           directory[common] == recording[common])
      ++common;
    std::string relative;
    for (size_t i = common; i < directory.size(); ++i)
      relative += "../";
    for (size_t i = common; i < recording.size(); ++i) {
      if (i != common)
        relative += "/";
      relative += recording[i];
    }
    clip.path = relative;
  }
  SaveScene(path, clips, replace);
}

int Usage() {
  std::cerr <<
      "Usage:\n"
      "  scene-tool info RECORDING\n"
      "  scene-tool trim INPUT OUTPUT START_SECONDS END_SECONDS\n"
      "  scene-tool recover INPUT OUTPUT\n"
      "  scene-tool create SCENE RECORDING [RECORDING ...]\n"
      "  scene-tool list SCENE\n"
      "  scene-tool add SCENE RECORDING START_SECONDS END_SECONDS\n"
      "  scene-tool range SCENE INDEX START_SECONDS END_SECONDS\n"
      "  scene-tool move SCENE FROM_INDEX TO_INDEX\n"
      "  scene-tool remove SCENE INDEX\n"
      "Scene indices start at 1. Recording outputs must not already exist.\n";
  return 1;
}
}

int main(int argc, char *argv[]) {
  try {
    std::cout << std::fixed << std::setprecision(6);
    if (argc < 3)
      return Usage();
    const std::string command(argv[1]);
    const std::string path(argv[2]);
    if (command == "info" && argc == 3) {
      StreamReader reader(path);
      std::cout << reader.width() << 'x' << reader.height()
                << " frames=" << reader.frame_count()
                << " duration-seconds=" << reader.duration_us() / 1000000.0
                << '\n';
    } else if (command == "trim" && argc == 6) {
      TrimStream(path, argv[3], ParseSeconds(argv[4]), ParseSeconds(argv[5]));
    } else if (command == "recover" && argc == 4) {
      std::cout << "Recovered " << RecoverStream(path, argv[3])
                << " frames\n";
    } else if (command == "create" && argc >= 4) {
      std::vector<SceneClip> clips;
      for (int i = 3; i < argc; ++i) {
        const std::string absolute = AbsolutePath(argv[i]);
        StreamReader reader(absolute);
        clips.push_back({absolute, 0, reader.duration_us()});
      }
      SavePlaylist(path, clips, false);
    } else if (command == "list" && argc == 3) {
      const auto clips = LoadScene(path);
      for (size_t i = 0; i < clips.size(); ++i)
        std::cout << i + 1 << '\t' << clips[i].path << '\t'
                  << clips[i].start_us / 1000000.0 << '\t'
                  << clips[i].end_us / 1000000.0 << '\n';
    } else if (command == "add" && argc == 6) {
      auto clips = LoadScene(path);
      clips.push_back(Clip(argv[3], ParseSeconds(argv[4]), ParseSeconds(argv[5])));
      SavePlaylist(path, clips);
    } else if (command == "range" && argc == 6) {
      auto clips = LoadScene(path);
      const size_t index = Index(argv[3], clips.size());
      clips[index] = Clip(ResolveSceneClip(path, clips[index].path).c_str(),
                          ParseSeconds(argv[4]), ParseSeconds(argv[5]));
      SavePlaylist(path, clips);
    } else if (command == "move" && argc == 5) {
      auto clips = LoadScene(path);
      const size_t from = Index(argv[3], clips.size());
      const size_t to = Index(argv[4], clips.size());
      const SceneClip clip = clips[from];
      clips.erase(clips.begin() + from);
      clips.insert(clips.begin() + to, clip);
      SavePlaylist(path, clips);
    } else if (command == "remove" && argc == 4) {
      auto clips = LoadScene(path);
      clips.erase(clips.begin() + Index(argv[3], clips.size()));
      SavePlaylist(path, clips);
    } else {
      return Usage();
    }
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "Scene error: " << error.what() << '\n';
    return 1;
  }
}
