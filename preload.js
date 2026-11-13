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
  memory: () => ipcRenderer.invoke('sys:memory'),
  recap: {
    save: (id, ext, bytes) => ipcRenderer.invoke('recap:save', id, ext, bytes),
    append: (id, ext, bytes) => ipcRenderer.invoke('recap:append', id, ext, bytes),
    read: (id) => ipcRenderer.invoke('recap:read', id),
    remove: (id) => ipcRenderer.invoke('recap:delete', id),
    info: (id) => ipcRenderer.invoke('recap:info', id),
    summarize: (opts) => ipcRenderer.invoke('recap:summarize', opts),
    testKey: (key) => ipcRenderer.invoke('recap:testKey', key)
  },
  onShown: (fn) => ipcRenderer.on('deck:shown', () => fn()),
  onAway: (fn) => ipcRenderer.on('deck:away', (_e, away) => fn(away)),
  lights: {
    get: () => ipcRenderer.invoke('lights:get'),
    configure: (cfg) => ipcRenderer.invoke('lights:configure', cfg),
    rescan: () => ipcRenderer.invoke('lights:rescan'),
    test: (name) => ipcRenderer.invoke('lights:test', name),
    moment: (name, on, data) => ipcRenderer.send('lights:moment', name, on, data),
    onState: (fn) => ipcRenderer.on('lights:state', (_e, s) => fn(s))
  },
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (fn) => ipcRenderer.on('update:state', (_e, s) => fn(s))
  },
  discord: {
    get: () => ipcRenderer.invoke('discord:get'),
    config: (cfg) => ipcRenderer.invoke('discord:config', cfg),
    forget: () => ipcRenderer.invoke('discord:forget'),
    set: (patch) => ipcRenderer.invoke('discord:set', patch),
    onState: (fn) => ipcRenderer.on('discord:state', (_e, st) => fn(st))
  },
  openBrowser: () => ipcRenderer.invoke('deck:browser'),
  orb: {
    state: (st) => ipcRenderer.send('orb:state', st),
    home: () => ipcRenderer.send('orb:home'),
    onAct: (fn) => ipcRenderer.on('orb:act', (_e, a) => fn(a)),
    onHello: (fn) => ipcRenderer.on('orb:hello', () => fn())
  },
  tower: {
    state: (st) => ipcRenderer.send('tower:state', st),
    home: () => ipcRenderer.send('tower:home'),
    word: (opts) => ipcRenderer.invoke('tower:word', opts),
    lookup: (opts) => ipcRenderer.invoke('tower:lookup', opts),
    onText: (fn) => ipcRenderer.on('tower:text', (_e, t) => fn(t)),
    onRec: (fn) => ipcRenderer.on('tower:rec', (_e, a) => fn(a))
  },
  onTermOpen: (fn) => ipcRenderer.on('term:open', () => fn()),
  onSettingsChanged: (fn) => ipcRenderer.on('deck:settings-changed', (_e, s) => fn(s))
});
