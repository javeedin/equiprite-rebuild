define([
  'vb/action/actionChain',
  'resources/js/storyAnalysis',
  'resources/js/storyAnalysisRun',
  'resources/js/shellBus',
], (ActionChain, SA, R, bus) => {
  'use strict';

  // The chatbot about the set: a follow-up question (Enter, or Send), answered by the shared Ask AI from the stories,
  // their activity and the chosen FDD's sections for that question. Keeps the conversation in v.chat.
  // the box in the tab that is showing: several Analyze tabs can be open, each with its own
  const box = (id) => { try { if (typeof document === 'undefined') return null; const all = Array.prototype.slice.call(document.querySelectorAll('[id="' + id + '"]')); return all.filter((e) => e.offsetParent !== null)[0] || all[0] || null; } catch (e) { return null; } };
  const clearInput = () => { try { const el = box('asChatInput'); if (el) { el.value = ''; el.focus(); } } catch (e) { /* no DOM */ } };

  class chatChain extends ActionChain {
    async run(context, { key }) {
      if (String(key || '') !== 'Enter') return;
      const v = context.$page.variables;
      let q = '';
      try { const el = box('asChatInput'); if (el) q = String(el.value || '').trim(); } catch (e) { /* no DOM */ }
      if (!q) q = String(v.chatDraft || '').trim();
      if (!q || v.chatBusy) return;
      if (!v.aiReady) { bus.toast('Set up AI first (Minutes → Set up AI).', 'error'); return; }
      const chat = (v.chat || []).slice();
      chat.push({ role: 'user', text: q, html: SA.renderHtml(q) });
      v.chat = chat; v.chatDraft = ''; clearInput(); v.chatBusy = true;
      try {
        const history = chat.map((m) => ({ role: m.role, text: m.text })).slice(0, -1);
        const r = await R.chatSet(v, context.$application.path, q, history);
        const out = (v.chat || []).slice();
        out.push(r.ok ? { role: 'assistant', text: r.text, html: SA.renderHtml(r.text) } : { role: 'assistant', text: '', html: '<p class="nx-an-err">' + (r.error || 'AI could not answer.') + '</p>' });
        v.chat = out;
      } finally {
        v.chatBusy = false;
      }
      R.saveChat(v); // kept with the saved analysis
    }
  }
  return chatChain;
});
