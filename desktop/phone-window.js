'use strict';

// The "EquipRite on your phone" window: shows the QR codes the main process makes (lib/phone.js), saves the VBCS
// address, switches the phone link on and off. Everything goes through window.phone (phone-preload.js).
(function () {
  const $ = (id) => document.getElementById(id);

  function showQr(box, svg, empty) {
    box.textContent = '';
    if (svg) {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = doc.documentElement;
      if (root && root.nodeName === 'svg') {
        box.appendChild(document.importNode(root, true));
        box.classList.remove('qr--off');
        return;
      }
    }
    box.textContent = empty;
    box.classList.add('qr--off');
  }

  function showText(el, text) {
    el.textContent = text || '';
    el.hidden = !text;
  }

  function render(s) {
    $('notBuilt').hidden = !!s.built;
    showQr($('vbcsQr'), s.vbcs.qr, 'Paste EquipRite\'s VBCS address below to get its code.');
    showText($('vbcsAddr'), s.vbcs.url);
    if (s.vbcs.input != null && document.activeElement !== $('vbcsInput')) $('vbcsInput').value = s.vbcs.input;
    showText($('vbcsErr'), s.vbcs.error);
    $('vbcsCopy').hidden = !s.vbcs.url;
    $('lanOn').checked = !!s.lan.on;
    $('lanOn').disabled = !s.built;
    showQr($('lanQr'), s.lan.qr, s.lan.on ? 'Starting…' : 'Switch on to get the code.');
    showText($('lanAddr'), s.lan.url);
    showText($('lanErr'), s.lan.error);
    $('lanCopy').hidden = !s.lan.url;
  }

  async function refresh() { render(await window.phone.state()); }

  $('vbcsSave').addEventListener('click', async () => { render(await window.phone.saveVbcs($('vbcsInput').value)); });
  $('vbcsInput').addEventListener('keydown', async (e) => { if (e.key === 'Enter') render(await window.phone.saveVbcs($('vbcsInput').value)); });
  $('lanOn').addEventListener('change', async (e) => {
    $('lanOn').disabled = true;
    render(await window.phone.lan(e.target.checked));
  });
  const copy = (id, btn) => async () => {
    await window.phone.copy($(id).textContent);
    const label = $(btn).textContent;
    $(btn).textContent = 'Copied';
    setTimeout(() => { $(btn).textContent = label; }, 1500);
  };
  $('vbcsCopy').addEventListener('click', copy('vbcsAddr', 'vbcsCopy'));
  $('lanCopy').addEventListener('click', copy('lanAddr', 'lanCopy'));
  refresh();
}());
