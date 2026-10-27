// How the checks start the app (T65): the development copy (`electron .` in this folder)
// or a packaged one, named by MATRIXPRISM_ELECTRON with MATRIXPRISM_PACKAGED=1 (a packaged
// app takes no folder argument). On a machine with no node_modules, MATRIXPRISM_ELECTRON
// names the Electron to use.
export const electron = process.env.MATRIXPRISM_ELECTRON ?? (await import('electron')).default;
// MATRIXPRISM_NO_SANDBOX=1 is for a Linux CI runner only (the release workflow): an
// unpacked app there cannot use Chromium's setuid sandbox. The app as installed keeps it.
// MATRIXPRISM_SOFTWARE_GL=1 is for a CI runner with no GPU, where the app otherwise
// gets no WebGL at all (seen on GitHub's Linux arm64 runner): Chromium's software
// renderer, as the composer's headless-Chrome checks use. Linux only: on macOS,
// where WebGL goes through Metal, the same switches leave the app with no WebGL
// (measured 2026-10-27), so the release workflow sets this on Linux alone.
const extra = [
  ...(process.env.MATRIXPRISM_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
  ...(process.env.MATRIXPRISM_SOFTWARE_GL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
];
export const launchArgs = (profile) => process.env.MATRIXPRISM_PACKAGED === '1'
  ? [`--user-data-dir=${profile}`, ...extra] : ['.', `--user-data-dir=${profile}`, ...extra];
