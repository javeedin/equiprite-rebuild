/*
 * EquipRite Mobile: the lists open on the last 3 days (resources/js/mobileRecent.js). A thing is recent when any of its
 * dates (raised or last changed, start, end) falls on or after today minus 3 days, from local midnight; no date at all
 * is recent; a search looks through every date. Boundaries (exactly 3 days ago, today, the future), each date field,
 * dates that are not dates, what a list shows for the period and the search, and the words. Every "now" and every date
 * here is local, so the suite reads the same in any time zone. Loads the real module.
 *
 * Run:  node tests/mobile-recent.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'equiprite-mobile', 'resources', 'js');

function load(name) {
  const sandbox = { console, Date, JSON, Math, isFinite, isNaN };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}
const R = load('mobileRecent');

// Friday 30 Oct 2026, 15:20 here. The period starts on Tuesday 27 Oct at 00:00 here.
const NOW = new Date(2026, 9, 30, 15, 20).getTime();
const pad = (n) => String(n).padStart(2, '0');
/** The local day n days from NOW, as "2026-10-27". */
const day = (n) => { const d = new Date(2026, 9, 30 + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
/** The local time n days from NOW at hh:mm, as "2026-10-27T08:30:00" (no zone: a local time). */
const at = (n, hh, mm) => day(n) + 'T' + pad(hh) + ':' + pad(mm || 0) + ':00';
const recent = (x) => R.isRecent(x, NOW);

T.section('where the period starts');
T.eq('3 days: the period the lists open on', R.DAYS, 3);
T.eq('local midnight, 3 days before today', R.cutoff(NOW), new Date(2026, 9, 27).getTime());
T.eq('…any time of today gives the same start', [R.cutoff(new Date(2026, 9, 30, 0, 0, 1).getTime()), R.cutoff(new Date(2026, 9, 30, 23, 59).getTime())].join(),
  [new Date(2026, 9, 27).getTime(), new Date(2026, 9, 27).getTime()].join());
T.eq('…across a month', R.cutoff(new Date(2026, 10, 2, 9).getTime()), new Date(2026, 9, 30).getTime());
T.eq('…another number of days', R.cutoff(NOW, 7), new Date(2026, 9, 23).getTime());

T.section('boundaries');
T.eq('exactly 3 days ago: recent', recent({ endDate: day(-3) }), true);
T.eq('3 days ago, at midnight: recent', recent({ lastUpdateDate: at(-3, 0, 0) }), true);
T.eq('4 days ago, a minute before midnight: not', recent({ lastUpdateDate: at(-4, 23, 59) }), false);
T.eq('4 days ago: not', recent({ endDate: day(-4) }), false);
T.eq('today: recent', recent({ startDate: day(0) }), true);
T.eq('yesterday: recent', recent({ createdDate: at(-1, 18, 5) }), true);
T.eq('in the future: recent (upcoming)', recent({ startDate: day(12), endDate: day(40) }), true);
T.eq('long ago: not', recent({ createdDate: at(-60, 9), startDate: day(-50), endDate: day(-20) }), false);
T.eq('started long ago, still running: recent', recent({ startDate: day(-50), endDate: day(10) }), true);
T.eq('raised long ago, changed yesterday: recent', recent({ createdDate: at(-60, 9), lastUpdatedDate: at(-1, 9), startDate: day(-50), endDate: day(-20) }), true);

T.section('no dates: never hidden');
T.eq('no date at all: recent', recent({ requestNumber: 'REQ-1' }), true);
T.eq('empty dates: recent', recent({ createdDate: '', startDate: null, endDate: undefined }), true);
T.eq('nothing at all: recent', [recent(null), recent(undefined), recent({})].join(), 'true,true,true');
T.eq('dates that are not dates only: recent (it cannot be dated)', recent({ createdDate: 'not a date', startDate: '31/10/2026', endDate: 'soon' }), true);
T.eq('a bad date beside an old one: the old one decides', recent({ createdDate: 'garbage', endDate: day(-30) }), false);
T.eq('a bad date beside a recent one: recent', recent({ createdDate: day(-1), endDate: 'garbage' }), true);

T.section('each date field counts');
const OLD = day(-30);
R.FIELDS.forEach((f) => {
  const x = { createdDate: OLD, startDate: OLD, endDate: OLD };
  x[f] = day(-1);
  T.eq(f + ' (yesterday) makes it recent', recent(x), true);
});
T.eq('the fields: raised or changed, then start and end', R.FIELDS.join(),
  'createdDate,creationDate,createdOn,lastUpdatedDate,lastUpdateDate,updatedDate,submittedDate,startDate,endDate,start,end');
T.eq('another field is not a date of it', recent({ createdDate: OLD, startDate: OLD, endDate: OLD, dueDate: day(1) }), false);
T.eq('more dates can be given (a pick item\'s pieces)', R.recentAt(R.latest({ start: OLD }, [day(2)]), NOW), true);
T.eq('…or only some fields read', R.latest({ createdDate: day(-1), startDate: OLD }, [], R.SPAN), R.ms(OLD));

T.section('what a date is');
T.eq('a day is its local midnight', R.ms('2026-10-27'), new Date(2026, 9, 27).getTime());
T.eq('a local time', R.ms('2026-10-27T08:30:00'), new Date(2026, 9, 27, 8, 30).getTime());
T.eq('…with a space', R.ms('2026-10-27 08:30:00'), new Date(2026, 9, 27, 8, 30).getTime());
T.eq('a time with a zone is that moment', R.ms('2026-10-27T08:30:00Z'), Date.UTC(2026, 9, 27, 8, 30));
T.eq('…an offset', R.ms('2026-10-27T08:30:00.000-05:00'), Date.UTC(2026, 9, 27, 13, 30));
T.eq('…an offset without a colon (Oracle REST)', R.ms('2026-10-27T08:30:00+0000'), Date.UTC(2026, 9, 27, 8, 30));
T.eq('a day sent as midnight UTC is that day (shown as 27 Oct)', R.ms('2026-10-27T00:00:00Z'), new Date(2026, 9, 27).getTime());
T.eq('…with milliseconds or +00:00', [R.ms('2026-10-27T00:00:00.000Z'), R.ms('2026-10-27T00:00:00+00:00')].join(),
  [new Date(2026, 9, 27).getTime(), new Date(2026, 9, 27).getTime()].join());
T.eq('ms already (a card\'s lastAt)', R.ms(1793000000000), 1793000000000);
T.eq('a Date', R.ms(new Date(2026, 9, 27)), new Date(2026, 9, 27).getTime());
T.eq('not dates', [R.ms(''), R.ms(null), R.ms(undefined), R.ms('garbage'), R.ms('27-OCT-26'), R.ms('2026-13-01'), R.ms('2026-02-31'), R.ms(0), R.ms(-5),
  R.ms(NaN), R.ms(Infinity), R.ms(true), R.ms({}), R.ms([]), R.ms(new Date('x'))].join(), ',,,,,,,,,,,,,,');
T.eq('the latest of its dates', R.latest({ createdDate: day(-9), lastUpdateDate: at(-2, 10), startDate: day(-5), endDate: day(-4) }), new Date(2026, 9, 28, 10).getTime());
T.eq('none: null', R.latest({ requestNumber: 'X' }), null);

T.section('a card keeps its latest date (lastAt)');
T.eq('read from lastAt, not its fields', recent({ lastAt: new Date(2026, 8, 1).getTime(), startDate: day(5) }), false);
T.eq('lastAt null: no date, recent', recent({ lastAt: null, startDate: day(-40) }), true);
T.eq('no lastAt (a copy kept before it was kept): read from its fields', recent({ start: day(-40), end: day(-35) }), false);
const card = { lastAt: R.latest({ createdDate: at(-10, 9), endDate: day(-6) }) };
const later = new Date(2026, 10, 3, 9).getTime();
T.eq('the same card, a few days later, is older (the copy on the phone is filtered when it is shown)', [R.isRecent({ lastAt: R.ms(day(-1)) }, NOW),
  R.isRecent({ lastAt: R.ms(day(-1)) }, later), R.isRecent(card, NOW)].join(), 'true,false,false');
T.eq('kept as JSON and back: the same', R.isRecent(JSON.parse(JSON.stringify({ lastAt: R.ms(day(-2)) })), NOW), true);
T.eq('a reader of its own (a pick work item)', R.isRecent({ id: 1 }, NOW, () => R.ms(day(-9))), false);

T.section('what a list shows');
const L = [
  { n: 'A', endDate: day(5) },
  { n: 'B', endDate: day(-10) },
  { n: 'C' },
  { n: 'D', createdDate: at(-2, 9), endDate: day(-20) },
  { n: 'E', startDate: day(-30), endDate: day(-25) },
];
const names = (l) => l.map((x) => x.n).join('');
let v = R.view(L, 'recent', '', NOW);
T.eq('the last 3 days (the default), in the list\'s order', [names(v.list), v.filtered, v.searching, v.older].join(' '), 'ACD true false 2');
T.eq('any period but All is the last 3 days', names(R.view(L, undefined, '', NOW).list), 'ACD');
v = R.view(L, 'all', '', NOW);
T.eq('every date', [names(v.list), v.filtered, v.searching, v.older].join(' '), 'ABCDE false false 0');
v = R.view(L, 'recent', 'quarry', NOW);
T.eq('a search looks through every date, setting the period aside', [names(v.list), v.filtered, v.searching, v.older].join(' '), 'ABCDE false true 0');
T.eq('…a search on All sets nothing aside', R.view(L, 'all', 'quarry', NOW).searching, false);
T.eq('…spaces are no search', R.view(L, 'recent', '   ', NOW).filtered, true);
T.eq('not a list: nothing', R.view(null, 'recent', '', NOW).list.length, 0);
T.eq('the recent ones', names(R.only(L, NOW)), 'ACD');
T.eq('the recent ones first, then the older (a "next up")', names(R.recentFirst(L, NOW)), 'ACDBE');

T.section('the words');
T.eq('the period', R.LABEL, 'Last 3 days');
T.eq('the head says so', R.PHRASE, 'in the last 3 days');
T.eq('what it leaves out', [R.olderText(12, 'request'), R.olderText(1, 'request'), R.olderText(0, 'request'), R.olderText(2, 'piece', 'pieces')].join(' | '),
  '12 older requests | 1 older request |  | 2 older pieces');
T.eq('what a page keeps of it', JSON.stringify(R.dated(R.view(L, 'recent', '', NOW), 2, 'request')),
  JSON.stringify({ filtered: true, searching: false, older: 2, olderText: '2 older requests', count: 3 }));
T.eq('…nothing left out once the period is set aside', JSON.stringify(R.dated(R.view(L, 'recent', 'x', NOW), 2, 'request')),
  JSON.stringify({ filtered: false, searching: true, older: 0, olderText: '', count: 5 }));

T.section('pure');
const src = fs.readFileSync(path.join(JS, 'mobileRecent.js'), 'utf8');
T.check('no calls, no storage, no DOM', !/callRest|fetch\(|XMLHttpRequest|localStorage|document\.|window\./.test(src));
T.check('reads the clock only when no "now" is given', (src.match(/Date\.now\(\)/g) || []).length === 1);

T.report();
