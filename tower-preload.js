// Comm Tower 1's bridge: the button and its terminal only talk to the main process (which relays to the deck).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tower', {
  send: (text) => ipcRenderer.send('tower:send', String(text || '')),
  rec: (action, opts = {}) => ipcRenderer.send('tower:rec', { ...opts, action }),
  focus: (on) => ipcRenderer.send('tower:focus', !!on),
  onOpen: (fn) => ipcRenderer.on('tower:open', () => fn()),
  onAlign: (fn) => ipcRenderer.on('tower:align', (_e, side) => fn(side)),
  size: (w, h) => ipcRenderer.send('tower:size', w, h),
  drag: (phase, sx, sy) => ipcRenderer.send('tower:drag', phase, sx, sy),
  home: () => ipcRenderer.send('tower:home'),
  onState: (fn) => ipcRenderer.on('tower:state', (_e, s) => fn(s)),
  onConfig: (fn) => ipcRenderer.on('tower:config', (_e, c) => fn(c))
});
