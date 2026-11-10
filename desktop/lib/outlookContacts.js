'use strict';
/**
 * Read the signed-in user's Outlook contacts on Windows, for the Minutes page's attendee picker. Outlook is driven
 * through its COM automation object from a short PowerShell command (as the transcription and SQL features already shell
 * out on this PC); the default Contacts folder's people are returned as { name, email }. Cached for a few minutes.
 *
 * Windows only: on macOS/Linux (and when Outlook is not installed) it answers { ok:false, available:false, contacts:[] }
 * with a reason, and the page falls back to typing attendees by hand. Reading only, never sending — nothing is written.
 */
const { execFile } = require('child_process');

const TTL = 5 * 60 * 1000;
let cache = null;
let cacheAt = 0;

// Outlook COM: the default Contacts folder (10 = olFolderContacts); each contact's display name and first email.
// Prints a JSON array (or [] on any error) so this never throws into the app.
const PS = [
  "$ErrorActionPreference='Stop';",
  'try {',
  '  try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject(\'Outlook.Application\') } catch { $ol = New-Object -ComObject Outlook.Application };',
  "  $ns = $ol.GetNamespace('MAPI');",
  '  $f = $ns.GetDefaultFolder(10);',
  '  $out = New-Object System.Collections.ArrayList;',
  '  foreach ($c in $f.Items) {',
  '    try {',
  '      $e = $c.Email1Address; $n = $c.FullName; if (-not $n) { $n = $c.CompanyName }',
  '      if ($e) { [void]$out.Add([pscustomobject]@{ name = [string]$n; email = [string]$e }) }',
  '    } catch {}',
  '  }',
  '  if ($out.Count -eq 0) { Write-Output "[]" } else { ConvertTo-Json -InputObject @($out) -Compress }',
  "} catch { Write-Output '[]' }",
].join(' ');

function normalise(list) {
  const seen = {};
  const out = [];
  (Array.isArray(list) ? list : [list]).forEach((c) => {
    if (!c) return;
    const email = String(c.email || '').trim();
    const name = String(c.name || '').trim() || email;
    if (!email) return;
    const key = email.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    out.push({ name: name, email: email });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 2000);
}

/** The contacts, from the cache or a fresh read. Resolves { ok, available, contacts, error? } and never rejects. */
function read() {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, available: false, contacts: [], error: 'Outlook contacts are read from Outlook on Windows.' });
  }
  if (cache && Date.now() - cacheAt < TTL) return Promise.resolve({ ok: true, available: true, contacts: cache, cached: true });
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS],
      { timeout: 25000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        const raw = String(stdout || '').trim();
        if (/^ERR:/.test(raw)) { resolve({ ok: false, available: true, contacts: [], error: raw.replace(/^ERR:/, '').trim() || 'Could not read Outlook contacts.' }); return; }
        let parsed;
        try { parsed = JSON.parse(raw || '[]'); }
        catch (e) { resolve({ ok: false, available: true, contacts: [], error: (String(stderr || '').trim() || (err && err.message) || 'Outlook contacts could not be read (classic Outlook is required).') }); return; }
        cache = normalise(parsed);
        cacheAt = Date.now();
        resolve({ ok: true, available: true, contacts: cache });
      });
  });
}

function clear() { cache = null; cacheAt = 0; }

// Open a new Outlook message, pre-filled, for the user to review and send (COM .Display, not .Send — nothing is sent
// without the person clicking Send in Outlook). To/subject/HTML are passed as environment variables, never inlined.
const COMPOSE_PS = [
  "$ErrorActionPreference='Stop';",
  'try {',
  '  try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject(\'Outlook.Application\') } catch { $ol = New-Object -ComObject Outlook.Application };',
  '  $m = $ol.CreateItem(0);',
  '  $m.To = $env:ERM_TO;',
  '  $m.Subject = $env:ERM_SUBJECT;',
  '  $m.HTMLBody = $env:ERM_HTML;',
  '  $m.Display($false);',
  "  Write-Output 'OK';",
  "} catch { Write-Output ('ERR:' + $_.Exception.Message) }",
].join(' ');

function compose(opts) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, available: false, error: 'Sending via Outlook works on Windows with Outlook installed.' });
  const o = opts || {};
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', COMPOSE_PS],
      { timeout: 25000, windowsHide: true, env: Object.assign({}, process.env, { ERM_TO: String(o.to || ''), ERM_SUBJECT: String(o.subject || ''), ERM_HTML: String(o.html || '') }) },
      (err, stdout, stderr) => {
        const out = String(stdout || '').trim();
        if (/^OK/.test(out)) { resolve({ ok: true, available: true }); return; }
        const msg = out.replace(/^ERR:/, '').trim() || String(stderr || '').trim() || (err && err.message) || 'Outlook did not open the message.';
        resolve({ ok: false, available: true, error: msg });
      });
  });
}

module.exports = { read, clear, compose };
