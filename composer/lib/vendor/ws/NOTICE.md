# ws, the composer server's WebSocket

This folder is [ws](https://github.com/websockets/ws) 8.22.0 by Einar Otto
Stangvik, Arnout Kazemier, Luigi Pinca and contributors, taken unchanged
from the npm package `ws-8.22.0.tgz` (every file in it, with this notice
added). It is kept here so the composer has no npm dependencies and needs no
`npm install`. The package's sha512, checked on 2026-10-22, matched the
registry's and the one in the composer's lockfile before it was removed:
`Ydggc987+RO0AnWtZ/7Wq9FtNvcrL1b/RO0ud9mWjUPgDrsAAwQSF51sm2hm1XofbU/4jkpGEsLFsZZxU+1DOg==`.
The tarball's sha256 is
`ca9b3798b2e11ce8fac6713f50ef0501aa12b09b330623c1dc409dff94e7abc8`.

The licence is MIT (`LICENSE`, from the same package).

ws is CommonJS; its own `package.json` keeps it so inside the composer,
which is an ES module package, and `wrapper.mjs` is what the composer
imports: `server.js`, `test/server.test.js`, `test/ddp.test.js` and
`tools/check-recording.mjs`. It has no dependencies. It will use the
optional native modules `bufferutil` and `utf-8-validate` if Node can find
them, and works the same without them; the composer does not install them.

Copied rather than installed, ws is not seen by GitHub's dependency
alerts (Dependabot), so watch its releases and advisories by hand:
<https://github.com/websockets/ws/security/advisories>.

To update it, download the new package with
`npm pack ws@<version> --ignore-scripts`, check its sha512 against
`npm view ws@<version> dist.integrity`, replace this folder's files with the
package's, and update the version and sums here and in `CREDITS.md`.

| File | sha256 |
|---|---|
| `browser.js` | `010da44a…0ead2d0e` |
| `index.js` | `924564d5…37429dd2` |
| `lib/buffer-util.js` | `8b0a4573…eec92da3` |
| `lib/constants.js` | `391e8231…6a0b4f86` |
| `lib/event-target.js` | `c45d3c6e…5aba128c` |
| `lib/extension.js` | `852564f0…a4e986ed` |
| `lib/limiter.js` | `e0469d4b…7f065f69` |
| `lib/permessage-deflate.js` | `16a91536…982f58b0` |
| `lib/receiver.js` | `a6ada33c…48274884` |
| `lib/sender.js` | `d0791d30…b23b4b77` |
| `lib/stream.js` | `a56fcb6e…e39070ec` |
| `lib/subprotocol.js` | `be3f6323…9fac0b7c` |
| `lib/validation.js` | `41ce8e83…b2845593` |
| `lib/websocket-server.js` | `6d8dd89a…8b9c55e5` |
| `lib/websocket.js` | `7ccf3059…ef08128f` |
| `LICENSE` | `2b29dcfe…32b1ecef` |
| `package.json` | `c1ef91ca…cf93e0b1` |
| `README.md` | `bb979132…bf1e480e` |
| `wrapper.mjs` | `fe154662…3ff27c7f` |
