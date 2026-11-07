// Comm Tower 1's bridge: the chip only talks to the main process (which relays to the deck).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tower', {
  talk: () => ipcRenderer.send('tower:talk'),
  hit: (over) => ipcRenderer.send('tower:hit', !!over),
  drag: (phase, sx, sy) => ipcRenderer.send('tower:drag', phase, sx, sy),
  home: () => ipcRenderer.send('tower:home'),
  onState: (fn) => ipcRenderer.on('tower:state', (_e, s) => fn(s)),
  onConfig: (fn) => ipcRenderer.on('tower:config', (_e, c) => fn(c))
});
