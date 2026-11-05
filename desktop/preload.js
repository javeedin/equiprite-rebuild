'use strict';

/**
 * What the web app sees of the desktop client: window.erpDesktop, a small read-only marker.
 *
 * The EquipRite app talks to its backends through Visual Builder's own service layer, proxied by
 * vb-serve, so the desktop client does not need an HTTP bridge (unlike the Re-ERP maintenance app).
 * This lets the page tell it is running inside the desktop shell, and open the "EquipRite on your phone" window.
 * Sandboxed and context-isolated: nothing but the fields below crosses over.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('erpDesktop', {
  isDesktop: true,
  app: 'equiprite',
  version: process.env.EQP_DESKTOP_VERSION || '',
  platform: process.platform,
  // Next's toolbar QR code: opens File > EquipRite on your phone, where the phone's address is set up.
  openPhone: () => ipcRenderer.invoke('desktop:phone'),
  // Record, on a Jira story's panel: the screens and windows to record (with a thumbnail), the one chosen, the shortcuts
  // while recording (Screenshot and Stop from any app), and the window (minimised while testing, back when done).
  recordSources: () => ipcRenderer.invoke('rec:sources'),
  recordUse: (id) => ipcRenderer.invoke('rec:use', String(id || '')),
  recordState: (on) => ipcRenderer.invoke('rec:state', !!on),
  recordWindow: (what) => ipcRenderer.invoke('rec:window', String(what || '')),
  onRecordKey: (cb) => {
    ipcRenderer.removeAllListeners('rec:key');
    ipcRenderer.on('rec:key', (event, what) => { if (typeof cb === 'function') cb(String(what)); });
  },
});
