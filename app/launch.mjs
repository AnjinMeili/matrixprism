// How the checks start the app (T65): the development copy (`electron .` in this folder)
// or a packaged one, named by MATRIXPRISM_ELECTRON with MATRIXPRISM_PACKAGED=1 (a packaged
// app takes no folder argument). On a machine with no node_modules, MATRIXPRISM_ELECTRON
// names the Electron to use.
export const electron = process.env.MATRIXPRISM_ELECTRON ?? (await import('electron')).default;
export const launchArgs = (profile) => process.env.MATRIXPRISM_PACKAGED === '1'
  ? [`--user-data-dir=${profile}`] : ['.', `--user-data-dir=${profile}`];
