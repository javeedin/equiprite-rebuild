'use strict';
/**
 * Is this a URL/origin of EquipRite's own pages on this PC? Used by the desktop app to allow screen capture
 * (getDisplayMedia) and the microphone (getUserMedia) only for the local dev-server, and nothing else.
 *
 * The origin can arrive with a path ("http://localhost:8890/vp/shell/x") or as a bare origin with no trailing slash
 * ("http://localhost:8890") — both must be accepted, or screen recording is wrongly refused with "Permission denied".
 */
function isLocal(url) {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(String(url || ''));
}

module.exports = { isLocal };
