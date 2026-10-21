// Thin binding to Corsair's iCUE SDK 4 (iCUESDK.x64_2019.dll) through koffi.
// Structs are read and written by hand from Buffers, so the layout is explicit here:
//   CorsairDeviceInfo   { int type; char id[128]; char serial[128]; char model[128]; int ledCount; int channelCount; }  396 bytes
//   CorsairLedPosition  { unsigned int id; double cx; double cy; }                                                       24 bytes
//   CorsairLedColor     { unsigned int id; unsigned char r, g, b, a; }                                                    8 bytes
// The SDK is Corsair's and is not shipped with Command Deck; lighting.js downloads it from Corsair.

const DEVICE_INFO_SIZE = 396;
const LED_POSITION_SIZE = 24;
const LED_COLOR_SIZE = 8;
const MAX_DEVICES = 64;
const MAX_LEDS = 512;

const ERRORS = ['OK', 'NOT CONNECTED', 'NO CONTROL', 'INCOMPATIBLE PROTOCOL', 'INVALID ARGUMENTS', 'INVALID OPERATION', 'DEVICE NOT FOUND', 'NOT ALLOWED'];
const STATES = ['INVALID', 'CLOSED', 'CONNECTING', 'TIMEOUT', 'CONNECTION REFUSED', 'CONNECTION LOST', 'CONNECTED'];

// CorsairDeviceType bit flags
const TYPES = {
  0x0001: 'keyboard', 0x0002: 'mouse', 0x0004: 'mousemat', 0x0008: 'headset', 0x0010: 'headset stand',
  0x0020: 'fans', 0x0040: 'light strip', 0x0080: 'ram', 0x0100: 'cooler', 0x0200: 'motherboard',
  0x0400: 'graphics card', 0x0800: 'touchbar', 0x1000: 'controller'
};

function cstr(buf, start, len) {
  const end = buf.indexOf(0, start);
  return buf.toString('utf8', start, end === -1 || end > start + len ? start + len : end);
}

/** Loads the SDK. Throws if the file or koffi can't be loaded. */
function loadIcue(dllPath, { koffi = require('koffi') } = {}) {
  const lib = koffi.load(dllPath);
  koffi.struct('CorsairVersion', { major: 'int', minor: 'int', patch: 'int' });
  koffi.struct('CorsairSessionDetails', { clientVersion: 'CorsairVersion', serverVersion: 'CorsairVersion', serverHostVersion: 'CorsairVersion' });
  koffi.struct('CorsairSessionStateChanged', { state: 'int', details: 'CorsairSessionDetails' });
  const Handler = koffi.proto('void CorsairSessionStateChangedHandler(void *context, const CorsairSessionStateChanged *eventData)');
  const fn = {
    connect: lib.func('int CorsairConnect(CorsairSessionStateChangedHandler *onStateChanged, void *context)'),
    disconnect: lib.func('int CorsairDisconnect()'),
    getDevices: lib.func('int CorsairGetDevices(const void *filter, int sizeMax, _Out_ void *devices, _Out_ int *size)'),
    getLedPositions: lib.func('int CorsairGetLedPositions(const char *deviceId, int sizeMax, _Out_ void *ledPositions, _Out_ int *size)'),
    setLedColors: lib.func('int CorsairSetLedColors(const char *deviceId, int size, const void *ledColors)'),
    setLayerPriority: lib.func('int CorsairSetLayerPriority(unsigned int priority)')
  };
  let registered = null;

  return {
    /** Starts the session. onState(stateName) is called as iCUE connects or drops. */
    connect(onState) {
      if (registered) return 0;
      registered = koffi.register((_ctx, ev) => {
        try {
          const st = ev ? koffi.decode(ev, 'CorsairSessionStateChanged').state : 0;
          onState(STATES[st] || 'UNKNOWN');
        } catch (e) { /* never throw into the SDK */ }
      }, koffi.pointer(Handler));
      return fn.connect(registered, null);
    },
    disconnect() {
      try { fn.disconnect(); } catch (e) { /* already gone */ }
      if (registered) { try { koffi.unregister(registered); } catch (e) { /* ok */ } registered = null; }
    },
    /** [{ id, type, model, ledCount }] or throws { code } */
    devices() {
      const filter = Buffer.alloc(4);
      filter.writeInt32LE(0xFFFFFFFF | 0, 0); // all device types
      const buf = Buffer.alloc(DEVICE_INFO_SIZE * MAX_DEVICES);
      const size = [0];
      const err = fn.getDevices(filter, MAX_DEVICES, buf, size);
      if (err) throw Object.assign(new Error(ERRORS[err] || `ERROR ${err}`), { code: err });
      const out = [];
      for (let i = 0; i < Math.min(size[0], MAX_DEVICES); i++) {
        const o = i * DEVICE_INFO_SIZE;
        const type = buf.readInt32LE(o);
        out.push({ type, kind: TYPES[type] || 'device', id: cstr(buf, o + 4, 128), model: cstr(buf, o + 260, 128), ledCount: buf.readInt32LE(o + 388) });
      }
      return out;
    },
    /** [{ id, cx, cy }] */
    ledPositions(deviceId) {
      const buf = Buffer.alloc(LED_POSITION_SIZE * MAX_LEDS);
      const size = [0];
      const err = fn.getLedPositions(deviceId, MAX_LEDS, buf, size);
      if (err) throw Object.assign(new Error(ERRORS[err] || `ERROR ${err}`), { code: err });
      const out = [];
      for (let i = 0; i < Math.min(size[0], MAX_LEDS); i++) {
        const o = i * LED_POSITION_SIZE;
        out.push({ id: buf.readUInt32LE(o), cx: buf.readDoubleLE(o + 8), cy: buf.readDoubleLE(o + 16) });
      }
      return out;
    },
    /** colors: [{ id, r, g, b, a }] */
    setColors(deviceId, colors) {
      if (!colors.length) return 0;
      const buf = Buffer.alloc(LED_COLOR_SIZE * colors.length);
      colors.forEach((c, i) => {
        const o = i * LED_COLOR_SIZE;
        buf.writeUInt32LE(c.id >>> 0, o);
        buf[o + 4] = c.r; buf[o + 5] = c.g; buf[o + 6] = c.b; buf[o + 7] = c.a;
      });
      return fn.setLedColors(deviceId, colors.length, buf);
    },
    setLayerPriority(p) { return fn.setLayerPriority(p); },
    errorName: (code) => ERRORS[code] || `ERROR ${code}`
  };
}

module.exports = { loadIcue, TYPES };
