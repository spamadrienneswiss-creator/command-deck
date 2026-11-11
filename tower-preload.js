// Comm Tower 1's bridge: the dial and its terminal only talk to the main process (which relays to the deck).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tower', {
  send: (text) => ipcRenderer.send('tower:send', String(text || '')),
  rec: (action, opts = {}) => ipcRenderer.send('tower:rec', { ...opts, action }),
  focus: (on) => ipcRenderer.send('tower:focus', !!on),
  layout: (state, popH) => ipcRenderer.send('tower:layout', String(state), Number(popH) || 0),
  launch: (kind, id) => ipcRenderer.send('tower:launch', { kind: String(kind), id: String(id || '') }),
  shortcut: (a) => ipcRenderer.invoke('tower:shortcut', a),
  drag: (phase, sx, sy) => ipcRenderer.send('tower:drag', phase, sx, sy),
  home: () => ipcRenderer.send('tower:home'),
  onOpen: (fn) => ipcRenderer.on('tower:open', () => fn()),
  onLayout: (fn) => ipcRenderer.on('tower:layout', (_e, l) => fn(l)),
  onState: (fn) => ipcRenderer.on('tower:state', (_e, s) => fn(s)),
  onConfig: (fn) => ipcRenderer.on('tower:config', (_e, c) => fn(c))
});
