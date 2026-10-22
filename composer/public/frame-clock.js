// Worker timers keep driving frames when the page's animation frames pause.
let frameStarted = 0;
let waitingForFrame = false;
let timer = null;

function requestFrame() {
  timer = null;
  frameStarted = performance.now();
  waitingForFrame = true;
  self.postMessage({ type: 'tick' });
}

self.onmessage = ({ data }) => {
  if (data.type !== 'start' && data.type !== 'frame')
    return;
  if (data.type === 'frame' && !waitingForFrame)
    return;
  if (timer !== null)
    clearTimeout(timer);
  waitingForFrame = false;
  const delay = data.type === 'start' ? 0 :
    Math.max(0, 1000 / data.fps - (performance.now() - frameStarted));
  timer = setTimeout(requestFrame, delay);
};
