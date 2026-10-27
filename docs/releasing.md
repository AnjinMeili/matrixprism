# Releasing MatrixPrism

How a release of the desktop app is made: when, by whom, and what checks it.
Nothing here runs by itself.

## When

A release groups several pieces of work, kept together as a milestone named
for its version (`v0.2.0`, say). It is made only when every story in that
milestone is closed, that is merged into `main` and accepted. Until then there
is nothing to release.

## Steps

1. **The version.** Set `version` in `app/package.json` to the release's
   number, on `main`.
2. **Publish the source.** The public repository is updated from `main`, as
   for any other change. Publishing for a release checks the milestone first,
   and stops if any of its stories is still open.
3. **Build.** On the public repository, open Actions, choose **Build
   release**, then **Run workflow**, and give the version (`0.2.0`). The VS
   Code GitHub Actions extension can start it too. It runs on GitHub's own
   machines, one per platform:

   | Runner | Builds |
   | --- | --- |
   | `macos-26` | `MatrixPrism-<version>-arm64.dmg` |
   | `windows-2025` | `MatrixPrism-<version>-setup-x64.exe` |
   | `ubuntu-24.04` | `MatrixPrism-<version>-amd64.deb`, `-x86_64.AppImage` |
   | `ubuntu-24.04-arm` | `MatrixPrism-<version>-arm64.deb`, `-arm64.AppImage` |

   Each one runs the composer's and the app's tests, builds, and checks the
   packaged app: receivers, discovery, saved settings across a restart,
   recording, and the stream key (macOS and Windows; a Linux runner has no
   keyring). A platform whose checks fail gives no files.
4. **The draft.** When all four have passed, the workflow makes a **draft**
   release `v<version>` with the files, `SHA256SUMS` and build attestations.
   Nobody else sees a draft.
5. **Try it.** Download the file for your computer from the draft, check it
   (`shasum -a 256` against `SHA256SUMS`, or `gh attestation verify <file>
   --repo AnjinMeili/matrixprism`), install it, and go through the
   milestone's acceptance lists and the standing items in
   [templates/release-checklist.md](templates/release-checklist.md).
6. **Publish** the draft on GitHub, or delete it and start again.

## What the workflow may do

It starts only when run by hand; never on a push, a tag or a pull request,
and it gates nothing. Every job reads only, except the last, which alone may
write the draft release and its attestations. Each action is pinned to a full
commit hash, with its version beside it. The version given is passed to the
steps as data, never pasted into a command.

## Not yet

- **Signing.** The builds are unsigned: macOS signing and notarising wait for
  the Apple Developer account, Windows signing for the SignPath Foundation.
  Each system asks before the first run; the README's quick start says what
  to do.
- **What no runner can check:** the microphone, the LED panel, a real MIDI
  device, and a stream to YouTube. Those are tried by hand at step 5.
