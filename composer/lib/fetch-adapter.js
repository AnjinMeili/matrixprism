// Lets the recording and live handlers, written for Node's HTTP request and
// response, answer a Fetch API request, as the desktop app's secure scheme gets
// (T65). The handlers keep their one implementation; this gives them a request
// that reads like Node's and a response that streams into a Fetch Response.
//
// Only the app's own page can send a request to the scheme, so the same-origin
// test the handlers make is met by giving the request the host and origin an
// HTTP server on this computer would have seen.
import { PassThrough, Readable } from 'node:stream';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// `handler(request, response, url)` is, for example,
// (req, res, url) => recordingRequest(service, req, res, url).
export async function answerWithNodeHandler(handler, fetchRequest) {
  const url = new URL(fetchRequest.url);
  const headers = Object.fromEntries(fetchRequest.headers);
  headers.host = url.host;
  // matrixprism://app is this page's origin; to the handlers it is http://app.
  // Chromium sends no Origin on a same-origin request to a custom scheme, and only
  // the app's own page can reach the scheme, so a missing one is this page; any
  // other origin is kept (as itself) and the handlers refuse it.
  headers.origin = headers.origin ? `http://${new URL(headers.origin).host}` : `http://${url.host}`;

  const request = Object.assign(
    fetchRequest.body ? Readable.fromWeb(fetchRequest.body) : Readable.from([]),
    { method: fetchRequest.method, headers, url: url.pathname + url.search,
      socket: { remoteAddress: '127.0.0.1' }, setTimeout() {} });

  const out = new PassThrough();
  let resolveHead;
  const head = new Promise((resolve) => { resolveHead = resolve; });
  const response = Object.assign(out, {
    writeHead(status, responseHeaders = {}) {
      resolveHead({ status, headers: responseHeaders });
      return response;
    },
  });

  const done = (async () => handler(request, response, url))().then(
    () => resolveHead(null), (error) => resolveHead({ error }));
  const first = await head;
  if (first === null) {
    // The handler finished without writing a head: an empty answer.
    return new Response(null, { status: 204 });
  }
  if (first.error) return json(500, { error: first.error.message });
  done.catch(() => {});
  return new Response(Readable.toWeb(out), { status: first.status, headers: first.headers });
}
