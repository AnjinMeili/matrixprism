# Release checklist

For each build: these standing items, then the acceptance list of every
story the build includes.

## Release candidates

Before acceptance the work is still on its branch, so a candidate is tagged
there (`v<x.y.z>-rc.<n>`) and built from a clean checkout of that tag; the
build is tried against the stories' lists. On acceptance the branch is
merged, `v<x.y.z>` is tagged on `main` and the build is made again from
that tag: the same code, now the build that is kept.

## Standing items

- [ ] Version set and tagged on `main` (`v<x.y.z>`); notes list the stories
      closed since the last tag
- [ ] Built from a clean checkout of the tag (`npm ci`, pinned Electron)
- [ ] `npm test`, every `check-*` and `make -C receiver test` pass on that
      checkout
- [ ] The packaged app's checks pass (`check-app`, recording, discovery)
- [ ] Installed on a Mac that did not build it; opens, finds the receivers
- [ ] The Panel Range card read on the panel
- [ ] The page in Safari
- [ ] An audio input (BlackHole) and the MIDI controller work in the app
- [ ] Record and Go live produce a file and a stream
- [ ] Signed and notarised (once the Apple account is ready; until then,
      ad hoc signed and marked internal)

## Stories in this build (the milestone `v<x.y.z>`)

- #<n> <title>: its acceptance list, ticked
