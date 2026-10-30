define(['resources/js/mobileBus', 'resources/js/requestData'], (bus, requestData) => {
  'use strict';

  // My requests: binding helpers, the line from another tab (mobileBus.focus('track', …)) to this screen, and a fresh
  // list whenever a tab changes the requests (requestData.invalidate after an approval, a submit, a draft saved).
  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('track', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
      requestData.onChange(() => { if (helper) helper.fireCustomEvent('requestsChanged', {}); });
    }

    /** The class for a stage's colours. */
    stage(key) { return 'mb-stage--' + (key || 'draft'); }

    /** "3" or "" (no count shown on an empty chip, apart from All). */
    count(chip) { return chip && (chip.count || chip.key === 'all') ? String(chip.count) : ''; }

    /** A milestone's row: its state and its stage's colours. */
    step(m) { return 'mb-hist-step mb-hist-step--' + (m.state || 'todo') + ' mb-stage--' + (m.stage || 'draft'); }

    /** "What it is now" under a milestone: when and who, else that it was not recorded. */
    when(m) {
      const bits = [m.when, m.who].filter(Boolean);
      if (bits.length) return bits.join(' · ');
      if (m.missing) return 'Date not recorded';
      return '';
    }

    /** The empty list, in words, for the chip and the search. */
    empty(chip, text, scope) {
      if (text) return 'No request matches “' + text + '”.';
      if (chip === 'action') return 'Nothing needs you now.';
      if (chip && chip !== 'all' && chip !== 'open') return 'No request is at this stage.';
      return scope === 'all' ? 'No requests yet.' : 'You have no requests yet. Raise one from the Request tab.';
    }

    /** A piece's class and unit: "Dozer · Unit KD-0042". */
    lineSub(e) { return [e.cls, e.serial].filter((x) => !!x).join(' · '); }

    pieces(n) { return n === 1 ? '1 piece' : (n || 0) + ' pieces'; }
  }

  return PageModule;
});
