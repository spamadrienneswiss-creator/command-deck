// The Orb's bridge (v1.35): its page only talks to the main process, which relays to the deck.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orb', {
  layout: (state) => ipcRenderer.send('orb:layout', String(state)),
  drag: (phase, sx, sy) => ipcRenderer.send('orb:drag', phase, sx, sy),
  act: (a) => ipcRenderer.send('orb:act', a),
  onLayout: (fn) => ipcRenderer.on('orb:layout', (_e, l) => fn(l)),
  onState: (fn) => ipcRenderer.on('orb:state', (_e, s) => fn(s)),
  onToggle: (fn) => ipcRenderer.on('orb:toggle', () => fn())
});
