define([
  'vb/action/actionChain',
  'resources/js/minutesClient',
  'resources/js/minutes',
  'resources/js/shellBus',
], (ActionChain, C, R, bus) => {
  'use strict';

  const clone = (x) => JSON.parse(JSON.stringify(x == null ? null : x));
  const lid = () => 'l_' + Date.now().toString(36) + Math.random().toString(16).slice(2, 6);
  function toast(msg, kind) { try { bus.toast(msg, kind || 'info'); } catch (e) { /* no bus */ } }

  class actChain extends ActionChain {
    async run(context, { act, id, lineId }) {
      const v = context.$page.variables;

      async function refreshList() { const r = await C.list(); if (r.ok && r.body && r.body.meetings) v.meetings = r.body.meetings; }
      function openMeeting(m) { v.meeting = m; v.attendeesText = (m.attendees || []).join(', '); v.dirty = false; }

      switch (act) {
        case 'view': v.view = id || 'edit'; return;
        case 'trackBy': v.trackBy = id || 'epic'; return;

        case 'new': { const m = R.blankMeeting(); m.attendees = ((v.settings && v.settings.defaultAttendees) || []).slice(); openMeeting(m); v.view = 'edit'; return; }
        case 'open': { const r = await C.get(id); if (r.ok && r.body && r.body.meeting) { openMeeting(r.body.meeting); v.view = 'edit'; } else toast('Could not open that meeting.', 'error'); return; }
        case 'addLine': { const m = clone(v.meeting) || { lines: [] }; const l = R.blankLine(); l.id = lid(); m.lines = (m.lines || []).concat(l); v.meeting = m; return; }
        case 'removeLine': { const m = clone(v.meeting) || { lines: [] }; m.lines = (m.lines || []).filter((x) => x.id !== lineId); v.meeting = m; v.dirty = true; return; }
        case 'toggleDone': { const m = clone(v.meeting) || { lines: [] }; const l = (m.lines || []).filter((x) => x.id === lineId)[0]; if (l) l.status = l.status === 'done' ? 'open' : 'done'; v.meeting = m; v.dirty = true; return; }
        case 'addAttendee': {
          let val = String(id || '').trim();
          if (!val) { v.attendeeDraft = ''; return; }
          // Enter on a typed name resolves to the matching person (with their email) when there is one.
          if (val.indexOf('<') === -1) {
            const ql = val.toLowerCase();
            const hit = (v.people || []).filter((p) => p && (String(p.name || '').toLowerCase().indexOf(ql) !== -1 || String(p.email || '').toLowerCase().indexOf(ql) !== -1))[0];
            if (hit) val = hit.email ? (hit.name + ' <' + hit.email + '>') : hit.name;
          }
          const m = clone(v.meeting) || {}; m.attendees = (m.attendees || []).slice();
          if (m.attendees.indexOf(val) === -1) m.attendees.push(val);
          v.meeting = m; v.attendeeDraft = ''; v.dirty = true; return;
        }
        case 'removeAttendee': { const m = clone(v.meeting) || {}; m.attendees = (m.attendees || []).filter((a) => a !== id); v.meeting = m; v.dirty = true; return; }

        case 'save': {
          const r = await C.save(clone(v.meeting));
          if (r.ok && r.body && r.body.meeting) { openMeeting(r.body.meeting); await refreshList(); toast('Minutes saved.'); }
          else toast((r.body && r.body.error) || 'Could not save the minutes.', 'error');
          return;
        }
        case 'delete': {
          if (!v.meeting.id) return;
          const r = await C.remove(v.meeting.id);
          if (r.ok) { const m = R.blankMeeting(); m.attendees = ((v.settings && v.settings.defaultAttendees) || []).slice(); openMeeting(m); await refreshList(); toast('Meeting deleted.'); }
          else toast('Could not delete.', 'error');
          return;
        }

        case 'dictate': {
          if (v.recLineId === lineId) {
            v.recLineId = '';
            let res;
            try { res = await C.stopRec(); } catch (e) { toast('Could not read the recording.', 'error'); return; }
            if (!res || !res.base64) { toast('Nothing was recorded.', 'error'); return; }
            toast('Transcribing…');
            const d = await C.dictate(res.base64, res.mime);
            if (d.ok && d.body && d.body.ok && d.body.text) {
              const m = clone(v.meeting); const l = (m.lines || []).filter((x) => x.id === lineId)[0];
              if (l) { l.text = (l.text ? l.text.trim() + ' ' : '') + d.body.text; l.raw = l.text; }
              v.meeting = m; v.dirty = true; toast('Added from voice.');
            } else toast((d.body && d.body.error) || 'Could not transcribe. Set up transcription on the Jira page first.', 'error');
          } else {
            if (v.recLineId) { try { await C.stopRec(); } catch (e) { /* drop */ } }
            try { await C.startRec(); v.recLineId = lineId; toast('Recording… click Stop when done.'); }
            catch (e) { toast((e && e.message) || 'Cannot record audio here.', 'error'); }
          }
          return;
        }

        case 'format': {
          const src = clone(v.meeting); const l0 = (src.lines || []).filter((x) => x.id === lineId)[0];
          const text = l0 ? String(l0.text || l0.raw || '').trim() : '';
          if (!text) { toast('Write something in the note first.', 'error'); return; }
          v.fmtLineId = lineId;
          const p = R.formatPrompt(text);
          const r = await C.aiChat(p.system, p.user);
          v.fmtLineId = '';
          if (r.ok && r.body && r.body.ok && r.body.text) {
            const m = clone(v.meeting); const l = (m.lines || []).filter((x) => x.id === lineId)[0];
            if (l) l.text = String(r.body.text).trim();
            v.meeting = m; v.dirty = true; toast('Formatted by ' + (r.body.provider || 'AI') + '.');
          } else {
            const err = (r.body && r.body.error) || '';
            if (/choose the llm|not set up/i.test(err)) { toast('Set up AI first.', 'error'); v.aiForm = { provider: (v.ai && v.ai.active) || 'claude', key: '', model: '', baseUrl: '', status: '' }; v.dialog = 'ai'; }
            else toast(err || 'AI could not format this.', 'error');
          }
          return;
        }

        case 'email': { const em = R.emailFor(v.meeting, v.rows); const emails = R.attendeeEmails(v.meeting.attendees || []); em.to = emails.length ? emails.join('; ') : ((v.settings && v.settings.fromEmail) || ''); v.email = em; v.dialog = 'email'; return; }
        case 'emailCopy': { const okc = await C.copyHtml(v.email.html, v.email.text); toast(okc ? 'Email copied.' : 'Copied the text.'); return; }
        case 'emailDownload': { C.download('minutes-' + (v.meeting.date || 'meeting') + '.html', v.email.html, 'text/html'); return; }
        case 'emailMailto': { C.mailto(v.email.to, v.email.subject, v.email.text); return; }
        case 'emailOutlook': {
          const r = await C.outlook({ to: v.email.to, subject: v.email.subject, html: v.email.html });
          if (r.ok && r.body && r.body.ok) { toast('Opening the message in Outlook…'); }
          else {
            // Outlook COM isn't available (e.g. the new Outlook has none) — open the default mail app instead.
            C.mailto(v.email.to, v.email.subject, v.email.text);
            toast('Outlook automation is not available here — opened your default mail app instead.' + ((r.body && r.body.error) ? ' (' + r.body.error + ')' : ''), 'error');
          }
          return;
        }

        case 'teams': {
          const t = R.teamsFor(v.meeting, v.rows);
          const r = await C.teams({ text: t.text });
          if (r.ok && r.body && r.body.ok) toast('Sent to Teams.');
          else {
            const err = (r.body && r.body.error) || 'Could not send to Teams.';
            toast(err, 'error');
            if (/no teams webhook/i.test(err)) { v.settingsForm = { teamsWebhook: '', clearTeamsWebhook: false, defaultAttendees: ((v.settings && v.settings.defaultAttendees) || []).join(', '), orgName: (v.settings && v.settings.orgName) || '', fromName: (v.settings && v.settings.fromName) || '', fromEmail: (v.settings && v.settings.fromEmail) || '' }; v.dialog = 'settings'; }
          }
          return;
        }

        case 'dialog': {
          v.dialog = id || '';
          if (id === 'settings') v.settingsForm = { teamsWebhook: '', clearTeamsWebhook: false, defaultAttendees: ((v.settings && v.settings.defaultAttendees) || []).join(', '), orgName: (v.settings && v.settings.orgName) || '', fromName: (v.settings && v.settings.fromName) || '', fromEmail: (v.settings && v.settings.fromEmail) || '' };
          if (id === 'ai') v.aiForm = { provider: (v.ai && v.ai.active) || 'claude', key: '', model: '', baseUrl: '', status: '' };
          return;
        }
        case 'ai': { v.aiForm = { provider: (v.ai && v.ai.active) || 'claude', key: '', model: '', baseUrl: '', status: '' }; v.dialog = 'ai'; return; }
        case 'settings': { v.settingsForm = { teamsWebhook: '', clearTeamsWebhook: false, defaultAttendees: ((v.settings && v.settings.defaultAttendees) || []).join(', '), orgName: (v.settings && v.settings.orgName) || '', fromName: (v.settings && v.settings.fromName) || '', fromEmail: (v.settings && v.settings.fromEmail) || '' }; v.dialog = 'settings'; return; }

        case 'settingsSave': {
          const f = clone(v.settingsForm) || {};
          const body = { teamsWebhook: f.teamsWebhook || '', defaultAttendees: String(f.defaultAttendees || '').split(',').map((s) => s.trim()).filter(Boolean), orgName: f.orgName || '', fromName: f.fromName || '', fromEmail: f.fromEmail || '' };
          const r = await C.saveSettings(body);
          if (r.ok && r.body) { v.settings = r.body; v.dialog = ''; toast('Settings saved.'); } else toast((r.body && r.body.error) || 'Could not save settings.', 'error');
          return;
        }
        case 'aiSave': {
          const f = clone(v.aiForm) || {};
          const r = await C.aiSave({ provider: f.provider, key: f.key, model: f.model, base: f.baseUrl });
          if (r.ok && r.body && !r.body.error) {
            const a = await C.aiSettings();
            if (a.ok && a.body) { v.ai = { active: a.body.active || '', providers: a.body.providers || {} }; v.aiReady = !!a.body.active; }
            v.dialog = ''; toast('AI saved.');
          } else { const a2 = clone(v.aiForm) || {}; a2.status = (r.body && r.body.error) || 'Could not save the AI settings.'; v.aiForm = a2; }
          return;
        }
        default: return;
      }
    }
  }
  return actChain;
});
