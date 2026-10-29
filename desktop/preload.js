'use strict';

/**
 * What the web app sees of the desktop client: window.erpDesktop, a small read-only marker.
 *
 * The EquipRite app talks to its backends through Visual Builder's own service layer, proxied by
 * vb-serve, so the desktop client does not need an HTTP bridge (unlike the Re-ERP maintenance app).
 * This only lets the page tell it is running inside the desktop shell, for future use. Sandboxed and
 * context-isolated: nothing but the fields below crosses over.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('erpDesktop', {
  isDesktop: true,
  app: 'equiprite',
  version: process.env.EQP_DESKTOP_VERSION || '',
  platform: process.platform,
});
