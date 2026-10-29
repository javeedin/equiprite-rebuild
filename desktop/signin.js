'use strict';

/* Sign-in window. Talks to the main process only through window.signin (signin-preload.js). */
(async function () {
  const $ = (id) => document.getElementById(id);
  const init = (await window.signin.initial()) || {};

  $('username').value = init.username || '';
  $('fusionUser').value = init.fusionUser && init.fusionUser !== init.username ? init.fusionUser : '';
  if (init.hasPassword) {
    $('fusionPassword').placeholder = 'saved, leave empty to keep';
  }
  document.querySelector(`input[name=rolesFrom][value=${init.rolesFrom === 'pick' ? 'pick' : 'fusion'}]`).checked = true;

  const picked = new Set(init.roles || []);
  (init.knownRoles || []).forEach((code) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = code;
    box.checked = picked.has(code);
    picked.delete(code);
    label.append(box, document.createTextNode(code.replace(/^RT_EQP_/, '').replace(/_/g, ' ').toLowerCase()));
    label.title = code;
    $('roles').append(label);
  });
  $('otherRoles').value = [...picked].join(', ');

  const sync = () => {
    const pick = document.querySelector('input[name=rolesFrom]:checked').value === 'pick';
    $('pick').classList.toggle('disabled', !pick);
  };
  document.querySelectorAll('input[name=rolesFrom]').forEach((r) => r.addEventListener('change', sync));
  sync();
  ($('username').value ? $('fusionPassword') : $('username')).focus();

  $('cancel').addEventListener('click', () => window.signin.cancel());
  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('err').textContent = '';
    $('go').disabled = true;
    try {
      const result = await window.signin.submit({
        username: $('username').value,
        fusionUser: $('fusionUser').value,
        fusionPassword: $('fusionPassword').value,
        rolesFrom: document.querySelector('input[name=rolesFrom]:checked').value,
        roles: [...document.querySelectorAll('#roles input:checked')].map((b) => b.value),
        otherRoles: $('otherRoles').value,
      });
      if (result && result.error) {
        $('err').textContent = result.error;
      }
    } finally {
      $('go').disabled = false;
    }
  });
})();
