// The only bridge between the console's interface and the system.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deck', {
  load: () => ipcRenderer.invoke('store:get'),
  save: (key, value) => ipcRenderer.invoke('store:set', key, value),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  setOpacity: (v) => ipcRenderer.invoke('win:setOpacity', v),
  getBounds: () => ipcRenderer.invoke('win:getBounds'),
  setSize: (w, h) => ipcRenderer.invoke('win:setSize', w, h),
  parse: (text, ctx) => ipcRenderer.invoke('cmd:parse', text, ctx),
  fetchCalendars: (calendars, startISO, endISO) => ipcRenderer.invoke('cal:fetch', calendars, startISO, endISO),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  pushKeys: () => ipcRenderer.invoke('push:keys'),
  pushSend: (subs, payload, subject) => ipcRenderer.invoke('push:send', subs, payload, subject),
  qr: (text) => ipcRenderer.invoke('qr:make', text),
  copy: (text) => ipcRenderer.invoke('clip:write', text),
  hostname: () => ipcRenderer.invoke('sys:hostname'),
  onShown: (fn) => ipcRenderer.on('deck:shown', () => fn()),
  onAway: (fn) => ipcRenderer.on('deck:away', (_e, away) => fn(away)),
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (fn) => ipcRenderer.on('update:state', (_e, s) => fn(s))
  },
  onSettingsChanged: (fn) => ipcRenderer.on('deck:settings-changed', (_e, s) => fn(s))
});
