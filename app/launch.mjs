// How the checks start the app (T65): the development copy (`electron .` in this folder)
// or a packaged one, named by MATRIXPRISM_ELECTRON with MATRIXPRISM_PACKAGED=1 (a packaged
// app takes no folder argument). On a machine with no node_modules, MATRIXPRISM_ELECTRON
// names the Electron to use.
export const electron = process.env.MATRIXPRISM_ELECTRON ?? (await import('electron')).default;
// MATRIXPRISM_NO_SANDBOX=1 is for a Linux CI runner only (the release workflow): an
// unpacked app there cannot use Chromium's setuid sandbox. The app as installed keeps it.
const extra = process.env.MATRIXPRISM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
export const launchArgs = (profile) => process.env.MATRIXPRISM_PACKAGED === '1'
  ? [`--user-data-dir=${profile}`, ...extra] : ['.', `--user-data-dir=${profile}`, ...extra];
