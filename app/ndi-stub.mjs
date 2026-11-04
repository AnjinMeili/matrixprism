// A stand-in for the NDI runtime (#62), for app/check-ndi-binding.mjs and
// app/check-app-ndi.mjs: a libndi compiled from NDI's own headers by the C
// compiler, so its structs are laid out as the real library's are. It records
// what it is given (stub_last) and, with NDI_STUB_LOG set, writes each call
// to that file. It sends nothing anywhere.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const STUB = String.raw`
#ifdef _WIN32
#define STUB_API __declspec(dllexport)
#else
#define STUB_API
#endif
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "Processing.NDI.Lib.h"

struct NDIlib_send_instance_type { int unused; };
static struct NDIlib_send_instance_type instance;
static NDIlib_source_t source = { "HOST (MatrixPrism)", { "192.0.2.1:5961" } };
static char last[2048];
static int destroyed;

// With NDI_STUB_LOG set, each call is also written there as a line, so a check
// can read what the app sent from outside its process.
static void note(void) {
  const char *file = getenv("NDI_STUB_LOG");
  FILE *out = file ? fopen(file, "a") : NULL;
  if (out) { fprintf(out, "%s\n", last); fclose(out); }
}

bool NDIlib_initialize(void) { return true; }
const char *NDIlib_version(void) { return "stub NDI 6"; }

NDIlib_send_instance_t NDIlib_send_create(const NDIlib_send_create_t *s) {
  snprintf(last, sizeof last, "create name=%s groups=%s clock_video=%d clock_audio=%d size=%zu",
    s->p_ndi_name, s->p_groups ? s->p_groups : "(null)", s->clock_video, s->clock_audio, sizeof *s);
  note();
  return &instance;
}

void NDIlib_send_destroy(NDIlib_send_instance_t p) {
  destroyed += p == &instance;
  snprintf(last, sizeof last, "destroy instance=%d", p == &instance);
  note();
}

void NDIlib_send_send_video_v2(NDIlib_send_instance_t p, const NDIlib_video_frame_v2_t *f) {
  unsigned sum = 0;
  int peak = 0;
  for (int i = 0; i < f->yres * f->line_stride_in_bytes; ++i) {
    sum = sum * 31 + f->p_data[i];
    if (i % 4 != 3 && f->p_data[i] > peak) peak = f->p_data[i];
  }
  snprintf(last, sizeof last, "video instance=%d xres=%d yres=%d fourcc=%.4s rate=%d/%d aspect=%g format=%d "
    "timecode=%lld stride=%d metadata=%s timestamp=%lld sum=%u peak=%d size=%zu",
    p == &instance, f->xres, f->yres, (const char *)&f->FourCC, f->frame_rate_N, f->frame_rate_D,
    f->picture_aspect_ratio, (int)f->frame_format_type, (long long)f->timecode, f->line_stride_in_bytes,
    f->p_metadata ? f->p_metadata : "(null)", (long long)f->timestamp, sum, peak, sizeof *f);
  note();
}

int NDIlib_send_get_no_connections(NDIlib_send_instance_t p, uint32_t timeout) { return p == &instance && timeout == 0 ? 3 : -1; }
const NDIlib_source_t *NDIlib_send_get_source_name(NDIlib_send_instance_t p) { return p == &instance ? &source : NULL; }

STUB_API const char *stub_last(void) { return last; }
STUB_API int stub_destroyed(void) { return destroyed; }
`;

// The runtime's file name on each platform (Processing.NDI.Lib.h), and how
// the stub is compiled there: cc on macOS and Linux, clang on Windows (in
// GitHub's Windows images), exporting what the headers declare.
const LIBRARY = { darwin: 'libndi.dylib', linux: 'libndi.so.6', win32: 'Processing.NDI.Lib.x64.dll' };
const COMPILE = {
  darwin: ['cc', ['-shared', '-fPIC']],
  linux: ['cc', ['-shared', '-fPIC']],
  win32: ['clang', ['-shared', '-DPROCESSINGNDILIB_EXPORTS', '-D_CRT_SECURE_NO_WARNINGS']],
};

// Compiles the stub into `folder` against the headers in `headers`, named as
// the runtime is, and returns its path.
export function buildNdiStub(headers, folder) {
  const library = path.join(folder, LIBRARY[process.platform]);
  const [compiler, flags] = COMPILE[process.platform];
  fs.writeFileSync(path.join(folder, 'stub.c'), STUB);
  execFileSync(compiler, [...flags, '-O2', '-Wall', '-Werror', '-I', headers, '-o', library, path.join(folder, 'stub.c')],
    { stdio: 'inherit' });
  return library;
}
