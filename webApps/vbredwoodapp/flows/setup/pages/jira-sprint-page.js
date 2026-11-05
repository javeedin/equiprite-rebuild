define([], function () {
  'use strict';

  // One Jira sprint (Jira Stories > By sprint): view helpers. The report is resources/js/jiraBacklog.js sprintReport.
  var kept = {};
  function same(key, content) {
    var json = JSON.stringify(content);
    if (!kept[key] || kept[key].json !== json) kept[key] = { json: json, value: content };
    return kept[key].value;
  }
  var STATE = { active: 'info', future: 'warning', closed: 'neutral' };
  var WHERE = { done: 'Done here', here: 'Still in this sprint', moved: 'Carried on' };

  function PageModule() {}

  PageModule.prototype.title = function (r, name) { return 'Sprint ' + ((r && r.sprint && r.sprint.name) || name || ''); };
  PageModule.prototype.subtitle = function (r, loading) {
    if (loading) return 'Reading the sprint from Jira…';
    var s = (r && r.sprint) || {};
    var k = (r && r.kpis) || {};
    return [s.start || s.end ? (s.start || '?') + ' – ' + (s.end || '?') : '', k.dayText, s.goal ? 'Goal: ' + s.goal : ''].filter(function (x) { return !!x; }).join(' · ');
  };
  PageModule.prototype.badge = function (r) { var st = (r && r.sprint && r.sprint.state) || ''; return same('badge', st ? { text: st, status: STATE[st] || 'neutral' } : { text: '' }); };
  PageModule.prototype.primary = function (loading) { return same('primary', { label: 'Refresh', display: loading ? 'disabled' : 'on' }); };
  PageModule.prototype.actions = function () {
    return same('actions', [{ id: 'jira', label: 'Open in Jira', icon: 'oj-ux-ico-external-link', display: 'on' },
      { id: 'csv', label: 'Export to CSV', icon: 'oj-ux-ico-download', display: 'on' }]);
  };
  PageModule.prototype.tiles = function (k) {
    var x = k || {};
    return same('tiles', [
      { label: 'Items', value: x.total || 0, tone: 'neutral', note: x.days ? x.days + ' days long' : '' },
      { label: 'Done', value: x.done || 0, tone: 'success', note: (x.donePct || 0) + '%' },
      { label: 'Open', value: x.open || 0, tone: 'neutral', note: '' },
      { label: 'Overdue', value: x.overdue || 0, tone: x.overdue ? 'danger' : 'success', note: '' },
      { label: 'Carried on', value: x.carriedOut || 0, tone: x.carriedOut ? 'warning' : 'neutral', note: 'to a later sprint' },
      { label: 'Came in', value: x.carriedIn || 0, tone: 'neutral', note: 'from an earlier sprint' },
      { label: 'Nobody assigned', value: x.unassigned || 0, tone: x.unassigned ? 'warning' : 'neutral', note: 'open items' }
    ]);
  };
  PageModule.prototype.tileClass = function (tone) { return 'jsp-tile jsp-tile--' + (tone || 'neutral'); };
  // Bars as objects: JET's :style takes an object, not a CSS string.
  PageModule.prototype.height = function (pct) { return { height: Math.max(1, Math.min(100, parseInt(pct, 10) || 0)) + '%' }; };
  PageModule.prototype.width = function (pct) { return { width: Math.max(2, Math.min(100, parseInt(pct, 10) || 0)) + '%' }; };
  PageModule.prototype.showLabel = function (i, n) { var step = n > 45 ? 7 : (n > 20 ? 3 : 1); return i % step === 0 || i === n - 1; };
  PageModule.prototype.dayClass = function (b) { return 'jsp-day' + (b && b.today ? ' jsp-day--today' : '') + (b && b.weekend ? ' jsp-day--weekend' : ''); };
  PageModule.prototype.dayTitle = function (b, total) { return b ? b.day + ': ' + b.done + ' of ' + total + ' done (' + b.pct + '%)' : ''; };
  PageModule.prototype.findingClass = function (tone) { return 'jsp-finding jsp-finding--' + (tone || 'info'); };
  PageModule.prototype.where = function (r) { return r ? WHERE[r.in] + (r.sprintNow ? ' to ' + r.sprintNow : '') : ''; };
  PageModule.prototype.whereClass = function (r) {
    return 'oj-badge oj-badge-subtle ' + ({ done: 'oj-badge-success', here: 'oj-badge-info', moved: 'oj-badge-warning' }[(r && r.in) || 'here']);
  };
  PageModule.prototype.statusClass = function (cat) {
    return 'oj-badge oj-badge-subtle' + (cat === 'done' ? ' oj-badge-success' : (cat === 'indeterminate' ? ' oj-badge-info' : ''));
  };
  PageModule.prototype.countText = function (n, at) { return n + (n === 1 ? ' item' : ' items') + (at ? ', read at ' + at : ''); };

  return PageModule;
});
