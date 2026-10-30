'use strict';

/**
 * The "EquipRite on your phone" window's only link to the main process: what to show (the QR codes), the VBCS address
 * to save, switching the phone link on and off, copying an address. Sandboxed and context-isolated; used by that
 * window alone.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phone', {
  state: () => ipcRenderer.invoke('phone:state'),
  saveVbcs: (url) => ipcRenderer.invoke('phone:vbcs', url),
  lan: (on) => ipcRenderer.invoke('phone:lan', !!on),
  copy: (text) => ipcRenderer.invoke('phone:copy', String(text || '')),
});
