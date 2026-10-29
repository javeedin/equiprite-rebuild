'use strict';

/**
 * The sign-in window's only link to the main process: read the saved sign-in (never the password) and submit the
 * form. Sandboxed and context-isolated; this preload is used by the sign-in window alone, never by the app.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('signin', {
  initial: () => ipcRenderer.invoke('signin:initial'),
  submit: (form) => ipcRenderer.invoke('signin:submit', form),
  cancel: () => ipcRenderer.invoke('signin:cancel'),
});
