// Gives the page a frame channel to the main process and puts a stand-in for
// WebSocket in front of it for the /stream address, so app.js is unchanged.
// Anything else the page opens with WebSocket goes to the real one.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const listeners = new Set();
ipcRenderer.on('stream:message', (_event, message) => listeners.forEach((listener) => listener(message)));

// The stream key (#8): the page can set, clear and ask whether one is set, never read it.
const keyListeners = new Set();
ipcRenderer.on('key:changed', () => keyListeners.forEach((listener) => listener()));
contextBridge.exposeInMainWorld('matrixprismKey', {
  set: (key) => ipcRenderer.invoke('key:set', String(key)),
  clear: () => ipcRenderer.invoke('key:clear'),
  status: () => ipcRenderer.invoke('key:status'),
  onChange: (listener) => { keyListeners.add(listener); return () => keyListeners.delete(listener); },
});

contextBridge.exposeInMainWorld('matrixprismStream', {
  open: () => ipcRenderer.send('stream:open'),
  send: (data) => ipcRenderer.send('stream:data', data),
  close: () => ipcRenderer.send('stream:close'),
  onMessage: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
});

webFrame.executeJavaScript(`(() => {
  const Native = window.WebSocket;
  class StreamSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.binaryType = 'arraybuffer';
      this.bufferedAmount = 0;
      this.onopen = this.onclose = this.onmessage = this.onerror = null;
      this.off = window.matrixprismStream.onMessage((message) => {
        const event = new MessageEvent('message', { data: JSON.stringify(message) });
        this.onmessage?.(event);
        this.dispatchEvent(event);
      });
      window.matrixprismStream.open();
      setTimeout(() => {
        this.readyState = 1;
        const event = new Event('open');
        this.onopen?.(event);
        this.dispatchEvent(event);
      }, 0);
    }
    send(data) { window.matrixprismStream.send(data); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.off();
      window.matrixprismStream.close();
      const event = new Event('close');
      this.onclose?.(event);
      this.dispatchEvent(event);
    }
  }
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      return /\\/stream$/.test(String(args[0])) ? new StreamSocket(args[0]) : new target(...args);
    },
  });
})();`);
