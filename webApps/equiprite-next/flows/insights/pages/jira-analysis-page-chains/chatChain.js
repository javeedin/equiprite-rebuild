define([
  'vb/action/actionChain',
  'resources/js/storyAnalysis',
  'resources/js/minutesClient',
  'resources/js/shellBus',
  'resources/js/storyAnalysisRun',
], (ActionChain, SA, M, bus, R) => {
  'use strict';

  // The chatbot on the analysis page: a follow-up question (Enter in the box, or the Send button), answered by the shared
  // Ask AI grounded in the same story, its sub-tasks and comments, and the chosen FDD's sections for that question.
  // Keeps the conversation in v.chat.
  // the box in the tab that is showing: several Analyze tabs can be open, each with its own
  const box = (id) => { try { if (typeof document === 'undefined') return null; const all = Array.prototype.slice.call(document.querySelectorAll('[id="' + id + '"]')); return all.filter((e) => e.offsetParent !== null)[0] || all[0] || null; } catch (e) { return null; } };
  const clearInput = () => { try { const el = box('anChatInput'); if (el) { el.value = ''; el.focus(); } } catch (e) { /* no DOM (tests) */ } };

  class chatChain extends ActionChain {
    async run(context, { key }) {
      if (String(key || '') !== 'Enter') return; // the box sends on Enter; the Send button passes key="Enter"
      const v = context.$page.variables;
      // Read the box directly (the on-input handler that fills v.chatDraft may not have run yet on a Send click).
      let q = '';
      try { const el = box('anChatInput'); if (el) q = String(el.value || '').trim(); } catch (e) { /* no DOM (tests) */ }
      if (!q) q = String(v.chatDraft || '').trim();
      if (!q || v.chatBusy) return;
      if (!v.aiReady) { bus.toast('Set up AI first (Minutes → Set up AI).', 'error'); return; }
      const chat = (v.chat || []).slice();
      chat.push({ role: 'user', text: q, html: SA.renderHtml(q) });
      v.chat = chat; v.chatDraft = ''; clearInput(); v.chatBusy = true;
      try {
        const history = chat.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, text: m.text })).slice(0, -1);
        let f = null;
        try { f = await R.fddFor(v, context.$application.path, q); } catch (e) { f = null; }
        const p = SA.chatPrompt(v.story, history, q, f && f.text ? { name: f.name, text: f.text } : '');
        const r = await M.aiChat(p.system, p.user);
        const out = (v.chat || []).slice();
        if (r.ok && r.body && r.body.ok && r.body.text) out.push({ role: 'assistant', text: r.body.text, html: SA.renderHtml(r.body.text) });
        else out.push({ role: 'assistant', text: '', html: '<p class="nx-an-err">' + ((r.body && r.body.error) || 'AI could not answer.') + '</p>' });
        v.chat = out;
      } finally {
        v.chatBusy = false;
      }
    }
  }

  return chatChain;
});
