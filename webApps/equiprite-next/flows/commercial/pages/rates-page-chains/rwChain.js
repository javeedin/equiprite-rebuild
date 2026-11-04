define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood look (your menu, Look), as Old's Rate Management: the schedules as a Smart Search page, and the open one
  // as its record under Oracle's general overview header. Each step calls the chain the Current look's button calls,
  // on the same state (selectedId: both looks show the same schedule); rwView only says which of the two Redwood shows.
  //   open    a row of the table: the schedule opens as on Current (selectScheduleChain; unsaved changes are asked
  //           about first), shown as its record
  //   new     New schedule, the list's primary action: as Current's New schedule
  //   back    the header's in-flow back: the list again (nothing is lost; the open schedule stays open)
  //   act     a header action, by its id: details (Edit details), add (Add equipment), export (the rates, to Excel),
  //           discard (Discard changes), delete (asks first), refresh
  class rwChain extends ActionChain {
    async run(context, { action, value }) {
      const v = context.$page.variables;
      switch (action) {
        case 'open':
          if (!value) return;
          v.rwView = 'record';
          await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: String(value) } });
          return;
        case 'new':
          v.rwView = 'record';
          await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: 'new' } });
          return;
        case 'back':
          v.exportOpen = '';
          v.rwView = 'list';
          return;
        case 'act': {
          const id = value && typeof value === 'object' ? String(value.id || '') : String(value || '');
          if (id === 'details') {
            await Actions.callChain(context, { chain: 'headerChain', params: { action: 'toggle', field: '', value: '', index: '' } });
          } else if (id === 'add') {
            await Actions.callChain(context, { chain: 'addRowChain', params: { action: 'open', value: '' } });
          } else if (id === 'export') {
            await Actions.callChain(context, { chain: 'exportChain', params: { what: 'lines', format: 'xlsx' } });
          } else if (id === 'discard') {
            await Actions.callChain(context, { chain: 'discardChain' });
          } else if (id === 'delete') {
            await Actions.callChain(context, { chain: 'deleteScheduleChain', params: {} });
          } else if (id === 'refresh') {
            await Actions.callChain(context, { chain: 'refreshChain' });
          }
          return;
        }
        default:
      }
    }
  }

  return rwChain;
});
