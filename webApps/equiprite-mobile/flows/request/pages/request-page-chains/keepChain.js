define([
  'vb/action/actionChain',
  'resources/js/currentUser',
  'resources/js/offlineSnapshot',
  'resources/js/mobileRequest',
], (ActionChain, cu, snapshot, mr) => {
  'use strict';

  // This phone's copy of the request being raised (offlineSnapshot 'request', per user): saved after every change, so
  // a dropped signal or a closed app loses nothing (initChain brings it back). Plain values only; nothing is sent from
  // it. With nothing being raised (an empty form, no draft held) the copy goes.
  class keepChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const pv = $page.variables;
      const user = cu.auditActor(context) || ($application.user || {}).username || '';
      if (!(pv.resume && pv.resume.id != null) && !mr.started(pv.form, pv.cart)) {
        snapshot.clear('request', user);
        return;
      }
      snapshot.save('request', user, mr.keep({ form: pv.form, cart: pv.cart, step: pv.step, resume: pv.resume,
        agreementId: pv.agreementId, agreementLineMap: pv.agreementLineMap }), Date.now());
    }
  }

  return keepChain;
});
