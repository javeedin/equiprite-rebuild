define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  const RELOAD_TRIGGERS = ['xdoPath', 'bipEndpoint', 'reportParameters', 'rowTag', 'idField', 'labelField', 'label2Field'];

  class onPropertyChangedChain extends ActionChain {

    async run(context, { propertyName }) {
      const { $fragment } = context;

      console.log('bipReportLov onPropertyChanged:', propertyName,
        '| disabled =', $fragment.variables.disabled,
        '| reportParameters =', JSON.stringify($fragment.variables.reportParameters));

      // When the LOV becomes enabled (disabled → false), wait a tick so that all
      // sibling property changes (e.g. reportParameters) settle before loading.
      if (propertyName === 'disabled' && !$fragment.variables.disabled) {
        await new Promise(resolve => setTimeout(resolve, 0));
        console.log('bipReportLov: disabled→false settled, reportParameters =',
          JSON.stringify($fragment.variables.reportParameters));
        await Actions.callChain(context, { chain: 'loadBipLovChain' });
        return;
      }

      // Reload when a data-shaping property changes and the LOV is already enabled.
      if (RELOAD_TRIGGERS.includes(propertyName) && !$fragment.variables.disabled) {
        await Actions.callChain(context, { chain: 'loadBipLovChain' });
      }
    }
  }

  return onPropertyChangedChain;
});
