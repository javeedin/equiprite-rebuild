/*
 * The desktop app allows screen capture (getDisplayMedia) and the microphone (getUserMedia) only for EquipRite's own
 * pages on this PC (desktop/lib/localOrigin.js). The origin can arrive with a path or as a bare origin with no trailing
 * slash — both must pass, or recording is wrongly refused with "Permission denied" (the reported bug).
 *
 * Run:  node tests/local-origin.test.js
 */
'use strict';
const path = require('path');
const H = require('./_harness');
const { isLocal } = require(path.join(__dirname, '..', 'desktop', 'lib', 'localOrigin.js'));

const T = H.makeAsserter();

T.section('EquipRite\'s own local pages are allowed (bare origin or with a path)');
['http://localhost:8890', 'http://localhost:8890/', 'http://localhost:8890/vp/shell/setup/jira-stories',
  'http://127.0.0.1:19761', 'http://127.0.0.1:19761/', 'http://[::1]:8890'].forEach((u) => T.check(u, isLocal(u)));

T.section('everything else is refused');
['https://equiprite.atlassian.net', 'http://localhost.evil.com/', 'http://evil-localhost/', 'https://localhost:8890/',
  'file:///C:/x', '', null].forEach((u) => T.check(String(u) + ' refused', !isLocal(u)));

T.report();
