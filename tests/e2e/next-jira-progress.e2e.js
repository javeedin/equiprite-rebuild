#!/usr/bin/env node
'use strict';
/**
 * Jira · Daily progress, end to end in the browser (Build.Rite, Jira stories → Daily progress), on a fake Jira with a
 * fortnight of work (stories closed, created, moved, commented, by four people) and three stuck stories:
 *   opened from Jira stories (a tab of its own) → the headline numbers → closed and new, a column a day (today marked,
 *   the latest busy day chosen; a column's tooltip; a column clicked shows its day) → the day in detail (each story, what
 *   happened, who, when; the day before and after) → so far → who moved things → stuck → the numbers as a table →
 *   7 days → working days only → copied as text → a story opened in Jira stories → from the Jira updates bell too.
 * Needs npm run build.
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const DAY = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

(async () => {
  // a fortnight of work in Jira, day by day (back 0 = today)
  const m0 = new Date(); m0.setHours(0, 0, 0, 0);
  const dayAt = (back) => new Date(m0.getTime() - back * DAY + 3 * 3600000);
  const on = (back, h, min) => new Date(new Date(dayAt(back)).setHours(h, min || 0, 0, 0)).toISOString().replace('Z', '+0000');
  const long = (back) => { const d = dayAt(back); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); };
  const iso = (back) => { const d = dayAt(back); const p2 = (x) => (x < 10 ? '0' : '') + x; return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const PEOPLE = [{ accountId: 'me-1', displayName: 'Priya Raman' }, { accountId: 'u-2', displayName: 'Ben Ortiz' }, { accountId: 'u-3', displayName: 'Cara Lim' }, { accountId: 'u-4', displayName: 'Dev Shah' }];
  const CLOSES = [2, 3, 1, 0, 0, 4, 2, 3, 1, 2, 0, 0, 3, 1];
  const NEWS = [1, 2, 2, 0, 0, 1, 3, 1, 2, 1, 0, 0, 2, 2];
  const done = { name: 'Done', statusCategory: { key: 'done' } }, todo = { name: 'To Do', statusCategory: { key: 'new' } }, prog = { name: 'In Progress', statusCategory: { key: 'indeterminate' } };
  const issues = [];
  let n = 100;
  CLOSES.forEach((c, back) => {
    for (let k = 0; k < c; k++) {
      const by = PEOPLE[(back + k) % 4];
      issues.push({ key: 'EQP-' + (++n), fields: { summary: 'Closed story ' + n, issuetype: { name: k % 3 === 2 ? 'Bug' : 'Story' }, status: done, assignee: by, reporter: PEOPLE[3], created: on(40, 9), updated: on(back, 10 + k) },
        changelog: { histories: [{ created: on(back, 10 + k), author: by, items: [{ field: 'status', fromString: 'In Review', toString: 'Done' }, { field: 'resolution', toString: 'Done' }] },
          { created: on(back + 1, 9), author: by, items: [{ field: 'status', fromString: 'In Progress', toString: 'In Review' }] }] } });
    }
  });
  NEWS.forEach((c, back) => {
    for (let k = 0; k < c; k++) {
      issues.push({ key: 'EQP-' + (++n), fields: { summary: 'New story ' + n, issuetype: { name: 'Story' }, status: todo, reporter: PEOPLE[k % 4], created: on(back, 9 + k, 30), updated: on(back, 9 + k, 30),
        comment: { comments: k === 0 ? [{ created: on(back, 15), author: PEOPLE[1], body: 'Which branch first?' }] : [] } } });
    }
  });
  const moved = { key: 'EQP-' + (++n), fields: { summary: 'Rental rates by branch', issuetype: { name: 'Story' }, status: prog, assignee: PEOPLE[0], created: on(30, 9), updated: on(0, 11) },
    changelog: { histories: [{ created: on(0, 11), author: PEOPLE[0], items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }, { field: 'Rank', toString: 'Ranked higher' }] }] } };
  issues.push(moved);
  const stuck = [
    { key: 'EQP-61', fields: { summary: 'Yard check-in photos', issuetype: { name: 'Story' }, status: prog, assignee: PEOPLE[2], updated: on(21, 9) } },
    { key: 'EQP-62', fields: { summary: 'Branch transfer report', issuetype: { name: 'Story' }, status: todo, assignee: null, updated: on(12, 9) } },
    { key: 'EQP-63', fields: { summary: 'Invoice PDF footer', issuetype: { name: 'Bug' }, status: prog, assignee: PEOPLE[1], updated: on(6, 9) } },
  ];
  const searches = [];
  const env = await E.start({ port: 19940, app: 'next', product: 'buildrite', handle: (r, res) => {
    if (r.path === '/rest/api/2/myself') return res.json(PEOPLE[0]);
    if (r.path === '/rest/api/2/search/jql') {
      const jql = r.query.get('jql') || '';
      searches.push(jql);
      if (/statusCategory != Done/.test(jql)) return res.json({ issues: stuck, isLast: true });
      if (r.query.get('expand') === 'changelog') return res.json({ issues: issues, isLast: true });
    }
    return false;
  } });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('opened from Jira stories: a tab of its own');
    await env.open('/');
    await page.waitForSelector('#nxNav [data-nav-id="jira"]', { timeout: 30000 });
    await page.click('#nxNav [data-nav-id="jira"]');
    await page.waitForSelector('#jiraProgress', { timeout: 20000 });
    T.check('Jira stories has Daily progress in its header', /Daily progress/.test(await text(page, '#jiraProgress')));
    await page.click('#jiraProgress');
    await page.waitForSelector('#jpTiles .nx-jp-tile', { timeout: 30000 }).catch(() => {});
    T.check('…it opens in a tab of its own: Jira · Daily progress, reading the last 14 days with their history, and the stuck ones', /Jira · Daily progress/.test(await text(page, '.nx-tab--on .nx-tab-title')) && (await text(page, '#jpTitle')) === 'Daily progress'
      && searches.some((q) => q === 'project = EQP AND updated >= -14d ORDER BY updated DESC') && searches.some((q) => /statusCategory != Done AND updated <= -5d/.test(q))
      && /^EQP · the stories changed in the last 14 days \(.* – .*\) · \d+ stories read · at \d\d:\d\d$/.test(await text(page, '#jpSub')), await text(page, '#jpSub'));

    T.section('the headline numbers');
    const tile = async (id) => text(page, '#jpTiles [data-tile="' + id + '"] .nx-kpi-value');
    T.check('22 closed, 17 new, net +5, 3 stuck; per working day, the best day', (await tile('closed')) === '22' && (await tile('created')) === '17' && (await tile('net')) === '+5' && (await tile('stuck')) === '3'
      && /a working day · best .* \(4\)/.test(await text(page, '#jpTiles [data-tile="closed"] .nx-kpi-note')) && /more closed than new/.test(await text(page, '#jpTiles [data-tile="net"]')),
      JSON.stringify([await tile('closed'), await tile('created'), await tile('net'), await tile('stuck')]));

    T.section('closed and new, a column a day');
    const cols = await page.$$('#jpCols .nx-jp-col');
    const last = '#jpCols .nx-jp-col:last-child';
    T.check('14 columns; today\'s marked and chosen (it is the latest busy day); its bars: 2 closed (half the axis of 4), 1 new; values on the caps', cols.length === 14 && !!(await page.$(last + '.nx-jp-col--today.nx-jp-col--sel'))
      && (await page.$eval(last + ' .nx-jp-bar--closed', (e) => e.style.height)) === '50%' && (await page.$eval(last + ' .nx-jp-bar--new', (e) => e.style.height)) === '25%'
      && (await text(page, last + ' .nx-jp-bar--closed .nx-jp-val')) === '2' && (await page.$$eval('#jpChart .nx-jp-tick', (l) => l.map((x) => x.textContent.trim()).join(' '))) === '4 2 0', String(cols.length));
    T.check('…the legend names both; the stories touched under each day', /Closed\s*New/.test(await text(page, '#jpChart .nx-jp-legend')) && (await page.$$('#jpStrip .nx-jp-cell')).length === 14 && (await text(page, '#jpStrip .nx-jp-cell:last-child')) === '4');
    await page.hover('#jpCols .nx-jp-col:nth-child(9)');
    await page.waitForTimeout(200);
    T.check('a column\'s tooltip: the day, closed, new, moved, touched, comments; so far', /^.+ \d{4}\s*4 closed · 1 new · \d+ moved · \d+ stories touched · \d+ comments?\s*So far: \d+ closed, \d+ new$/.test(await text(page, '#jpCols .nx-jp-col:nth-child(9) .nx-jp-tip'))
      && await page.isVisible('#jpCols .nx-jp-col:nth-child(9) .nx-jp-tip'), await text(page, '#jpCols .nx-jp-col:nth-child(9) .nx-jp-tip'));
    await env.shot('jira-progress-hover.png');

    T.section('the day in detail');
    T.check('today first: its counts; closed, new, moved — each story with what happened, who, when', (await text(page, '#jpDayTitle')) === long(0) + ' · today'
      && /^2 closed · 1 new · 0 reopened · \d+ moves? · \d+ stories touched · \d+ comments?$/.test(await text(page, '#jpDayCounts'))
      && (await page.$$('#jpSecs [data-sec="closed"] .nx-jp-row')).length === 2 && /In Review → Done/.test(await text(page, '#jpSecs [data-sec="closed"]'))
      && /Rental rates by branch\s*To Do → In Progress\s*Priya Raman · 11:00 · Story · now In Progress/.test(await text(page, '#jpSecs [data-sec="moved"]')) && (await page.$$('#jpSecs [data-sec="created"] .nx-jp-row')).length === 1,
      await text(page, '#jpDayCounts') + ' | ' + await text(page, '#jpSecs'));
    await page.click('#jpCols .nx-jp-col:nth-child(9)');
    await page.waitForTimeout(200);
    T.check('a column clicked: its day — 4 closed, each by who closed it', (await text(page, '#jpDayTitle')) === long(5) && (await page.$$('#jpSecs [data-sec="closed"] .nx-jp-row')).length === 4
      && !!(await page.$('#jpCols .nx-jp-col:nth-child(9).nx-jp-col--sel')) && /Dev Shah|Priya Raman|Ben Ortiz|Cara Lim/.test(await text(page, '#jpSecs [data-sec="closed"] .nx-jp-meta')), await text(page, '#jpDayTitle'));
    await page.click('#jpNext');
    await page.waitForTimeout(150);
    T.check('…the day after (→), the day before (←)', (await text(page, '#jpDayTitle')) === long(4) && await (async () => { await page.click('#jpPrev'); await page.click('#jpPrev'); await page.waitForTimeout(150); return (await text(page, '#jpDayTitle')) === long(6); })());

    T.section('so far, who moved things, stuck, the numbers');
    T.check('so far: closing faster than new arrives (+5); 22 closed · 17 new since the first day; its lines and a dot a day', /^Closing faster than new work arrives: 5 more closed than new\. 22 closed · 17 new, \w+ \d+ \w+ to \w+ \d+ \w+$/.test(await text(page, '#jpSoFarText'))
      && /^data:image\/svg\+xml/.test(await page.getAttribute('#jpLines', 'src') || '') && (await page.$$('#jpSoFar .nx-jp-dot--closed')).length === 14, await text(page, '#jpSoFarText'));
    const ppl = await page.$$eval('#jpPeople .nx-jp-tr:not(.nx-jp-th)', (rows) => rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    T.check('who moved things: four people, the most closed first', ppl.length === 4 && /^\S+ \S+ (\d+)/.test(ppl[0]) && Number(/^\S+ \S+ (\d+)/.exec(ppl[0])[1]) >= Number(/^\S+ \S+ (\d+)/.exec(ppl[3])[1]), ppl.join(' | '));
    T.check('stuck: 3, quietest first (21, 12, 6 days)', /^Stuck · 3/.test(await text(page, '#jpStuckTitle')) && /EQP-61.*21 days.*EQP-62.*Not assigned.*12 days.*EQP-63.*6 days/.test(await text(page, '#jpStuck')), await text(page, '#jpStuck'));
    await page.click('#jpNumbers > summary');
    const row1 = await page.$$eval('#jpNumbers .nx-jp-tr:nth-child(2) [role="cell"]', (l) => l.map((x) => x.textContent.trim()).join('|'));
    T.check('the numbers as a table, a row a day (newest first)', (await page.$$('#jpNumbers .nx-jp-tr:not(.nx-jp-th)')).length === 14 && row1.indexOf(long(0) + '|2|1|0|') === 0, row1);
    await page.click('#jpNumbers > summary');
    await page.evaluate(() => window.scrollTo(0, 0));
    await env.shot('jira-progress.png');

    T.section('7 days; working days only');
    await page.click('#jpRanges [data-key="7"]');
    await page.waitForFunction(() => document.querySelectorAll('#jpCols .nx-jp-col').length === 7, null, { timeout: 15000 }).catch(() => {});
    T.check('7 days: read again; 7 columns, 12 closed', searches.some((q) => q === 'project = EQP AND updated >= -7d ORDER BY updated DESC') && (await page.$$('#jpCols .nx-jp-col')).length === 7 && (await tile('closed')) === '12', await tile('closed'));
    await page.click('#jpRanges [data-key="14"]');
    await page.waitForFunction(() => document.querySelectorAll('#jpCols .nx-jp-col').length === 14, null, { timeout: 15000 }).catch(() => {});
    const workdays = [...Array(14).keys()].filter((b) => [0, 6].indexOf(dayAt(b).getDay()) === -1).length;
    await page.click('#jpWorkOnly');
    await page.waitForTimeout(200);
    T.check('working days only: the weekends left out of the charts', (await page.$$('#jpCols .nx-jp-col')).length === workdays && !(await page.$('#jpCols .nx-jp-col--wknd')), String(workdays));
    await page.click('#jpWorkOnly');

    T.section('From – To: the days chosen');
    T.check('the date boxes show the window read (the last 14 days: 13 days back to today, no later than today)', (await page.inputValue('#jpFrom')) === iso(13) && (await page.inputValue('#jpTo')) === iso(0)
      && (await page.getAttribute('#jpTo', 'max')) === iso(0) && !(await page.$('#jpClearDates')), (await page.inputValue('#jpFrom')) + ' ' + (await page.inputValue('#jpTo')));
    await page.fill('#jpFrom', iso(9));
    await page.waitForFunction(() => document.querySelectorAll('#jpCols .nx-jp-col').length === 10, null, { timeout: 15000 }).catch(() => {});
    T.check('From 9 days back (To stays today): 10 columns; Jira asked for what changed since From and was created by To; no range button on; said as dates', (await page.$$('#jpCols .nx-jp-col')).length === 10
      && searches.some((q) => q === 'project = EQP AND updated >= "' + iso(9) + '" AND created <= "' + iso(0) + ' 23:59" ORDER BY updated DESC') && !(await page.$('#jpRanges .nx-jp-range--on'))
      && (await text(page, '#jpSub')).indexOf('the stories changed from ' + long(9) + ' – ' + long(0) + ' (10 days)') !== -1 && !!(await page.$('#jpDates.nx-jp-dates--on')), await text(page, '#jpSub'));
    await page.fill('#jpTo', iso(3));
    await page.waitForFunction(() => document.querySelectorAll('#jpCols .nx-jp-col').length === 7, null, { timeout: 15000 }).catch(() => {});
    T.check('…To 3 days back: 7 columns (none today), 12 closed in them; the day shown is the latest busy one in the window', (await page.$$('#jpCols .nx-jp-col')).length === 7 && !(await page.$('#jpCols .nx-jp-col--today'))
      && (await tile('closed')) === '12' && (await text(page, '#jpDayTitle')) === long(3), (await tile('closed')) + ' ' + await text(page, '#jpDayTitle'));
    await env.shot('jira-progress-dates.png');
    await page.click('#jpClearDates');
    await page.waitForFunction(() => document.querySelectorAll('#jpCols .nx-jp-col').length === 14, null, { timeout: 15000 }).catch(() => {});
    T.check('× : back to the last 14 days (its button on; the boxes show its days)', (await page.$$('#jpCols .nx-jp-col')).length === 14 && /14 days/.test(await text(page, '#jpRanges .nx-jp-range--on'))
      && (await page.inputValue('#jpFrom')) === iso(13) && (await page.inputValue('#jpTo')) === iso(0),
      JSON.stringify([(await page.$$('#jpCols .nx-jp-col')).length, await text(page, '#jpRanges .nx-jp-range--on'), await page.inputValue('#jpFrom'), await page.inputValue('#jpTo'), iso(13), iso(0)]));

    T.section('copied as text; a story opened; from the bell');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.click('#jpCopy');
    await page.waitForSelector('#jpCopied', { timeout: 5000 }).catch(() => {});
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    T.check('Copy summary: the window as text (totals, best day, who closed most, stuck, a line a day)', /^Copied: the last 14 days, as text/.test(await text(page, '#jpCopied'))
      && /^Jira EQP · the last 14 days \(.*\): 22 closed, 17 new \(net \+5\)/.test(clip) && /Best day: /.test(clip) && /Stuck \(open, no change for 5\+ days\): 3 — EQP-61 \(21 d\)/.test(clip), clip.slice(0, 300));
    await page.click('#jpSecs .nx-jp-row');
    await page.waitForFunction(() => /Jira stories/.test((document.querySelector('.nx-tab--on .nx-tab-title') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('a story clicked: Jira stories comes forward to open it', /Jira stories/.test(await text(page, '.nx-tab--on .nx-tab-title')), await text(page, '.nx-tab--on .nx-tab-title'));
    await page.click('#nxJiraBell');
    await page.waitForSelector('#nxJiraProgress', { timeout: 10000 });
    await page.click('#nxJiraProgress');
    await page.waitForTimeout(400);
    T.check('the Jira updates bell: Daily progress — the panel closes, its tab comes forward (one tab)', !(await page.isVisible('#nxJiraPanel').catch(() => false)) && /Jira · Daily progress/.test(await text(page, '.nx-tab--on .nx-tab-title'))
      && (await page.$$eval('.nx-tab-title', (l) => l.filter((x) => /Daily progress/.test(x.textContent)).length)) === 1);
    T.check('no errors in the browser console', errs().length === 0, errs().join(' | '));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
  }
  T.report();
})();
