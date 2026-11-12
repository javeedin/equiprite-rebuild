#!/usr/bin/env node
/*
 * The FDD library from a terminal: the same as the FDD library page (desktop/lib/fdd.js), for when the app is not open.
 *
 *   npm run fdd -- list
 *   npm run fdd -- upload <file> [--name "EquipRite FDD"] [--version 1.7] [--note "..."] [--not-latest] [--push]
 *   npm run fdd -- latest <id> [--push]
 *   npm run fdd -- remove <id> [--push]
 *   npm run fdd -- outline <id>
 *   npm run fdd -- push                         commit and push whatever FDD changes are not in git yet
 *
 * --push commits only the FDD files (docs/fdd, webApps/equiprite-next/resources/fdd) and pushes them to the branch
 * the project is on. Without it the files are written and left for you to commit.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('../desktop/lib/fdd');

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (['push', 'not-latest'].indexOf(k) !== -1) out[k] = true;
      else out[k] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  // the library lives on the app's data branch (desktop/lib/dataBranch.js), as in the desktop app; else in the project
  const data = await require('../desktop/lib/dataBranch').open({ root: path.join(__dirname, '..'), log: (l) => console.error(l) }).ensure();
  const store = F.open({ root: path.join(__dirname, '..'), data: data });
  const cmd = a._[0] || 'list';
  const say = (s) => console.log(s);
  const git = async (msg) => {
    if (!a.push) { say('Not committed yet: add --push, or commit ' + F.DOCS_DIR + ' and ' + F.RES_DIR + ' yourself.'); return; }
    const r = await store.gitSave({ message: msg });
    if (!r.ok) { say('git: ' + r.error + (r.hint ? '\n  ' + r.hint : '')); process.exitCode = 1; return; }
    say(r.nothing ? 'git: nothing to commit or push.' : 'git: ' + (r.committed ? 'committed ' + r.committed : 'nothing new to commit') + (r.pushed ? ', pushed to ' + r.upstream : ''));
  };

  if (cmd === 'list') {
    const i = store.info();
    if (!i.docs.length) { say('The FDD library is empty. Upload one: npm run fdd -- upload <file> --name "EquipRite FDD" --version 1.7 --push'); return; }
    i.docs.forEach((d) => say((d.id === i.latest ? '* ' : '  ') + d.id.padEnd(32) + ' ' + (d.name + (d.version ? ' v' + d.version : '')).padEnd(36) + ' ' +
      String(d.sections).padStart(4) + ' sections  ' + String(d.uploadedAt).slice(0, 10) + (d.uploadedBy ? ' by ' + d.uploadedBy : '')));
    say('(* = latest)');
    return;
  }
  if (cmd === 'upload') {
    const file = a._[1];
    if (!file || !fs.existsSync(file)) { say('Give the file: npm run fdd -- upload <file>'); process.exitCode = 1; return; }
    const r = await store.upload({ fileName: path.basename(file), base64: fs.readFileSync(file).toString('base64'), name: a.name, version: a.version, note: a.note,
      latest: !a['not-latest'], by: process.env.USERNAME || process.env.USER || '' });
    if (!r.ok) { say(r.error); process.exitCode = 1; return; }
    say(`Uploaded ${r.doc.name}${r.doc.version ? ' v' + r.doc.version : ''} as "${r.doc.id}": ${r.doc.sections} sections (${r.doc.numbered} numbered)${r.latest === r.doc.id ? ', now the latest' : ''}.`);
    (r.warnings || []).forEach((w) => say('  note: ' + w));
    r.files.forEach((f) => say('  wrote ' + f));
    await git(`FDD library: add ${r.doc.name}${r.doc.version ? ' v' + r.doc.version : ''}${r.latest === r.doc.id ? ' (latest)' : ''}`);
    return;
  }
  if (cmd === 'latest' || cmd === 'remove') {
    const id = a._[1];
    const r = cmd === 'latest' ? store.setLatest(id) : store.remove(id);
    if (!r.ok) { say(r.error); process.exitCode = 1; return; }
    say(cmd === 'latest' ? `"${id}" is now the latest.` : `Removed "${id}".` + (r.latest ? ` The latest is "${r.latest}".` : ''));
    await git(cmd === 'latest' ? `FDD library: ${id} is the latest` : `FDD library: remove ${id}`);
    return;
  }
  if (cmd === 'outline') {
    const r = store.outline(a._[1]);
    if (!r.ok) { say(r.error); process.exitCode = 1; return; }
    r.sections.forEach((s) => say('  '.repeat(Math.max(0, s.l - 1)) + (s.n ? s.n + ' ' : '') + s.t + '  (' + s.chars + ' chars)'));
    return;
  }
  if (cmd === 'push') { a.push = true; await git('FDD library: update'); return; }
  say('Commands: list, upload <file>, latest <id>, remove <id>, outline <id>, push');
  process.exitCode = 1;
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
