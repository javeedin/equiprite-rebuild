define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (
  ActionChain,
  Actions,
  ActionUtils
) => {
  'use strict';

  class NextWeekChain extends ActionChain {

    /**
     * @param {Object} context
     */
    async run(context) {
      const { $page } = context;

      // Increment offset
      $page.variables.currentWeekOffset += 1;

      // Recalculate week label
      const record = $page.variables.currentRecord;
      if (record && record.week_start) {
        const offset = $page.variables.currentWeekOffset;
        
        let d = new Date(record.week_start);
        d.setDate(d.getDate() + (offset * 7));
        
        const options = { year: 'numeric', month: 'short', day: 'numeric' };
        
        // Simple mock formatting "Mon DD – Mon DD, YYYY"
        const startStr = d.toLocaleDateString("en-US", { month: 'short', day: 'numeric' });
        
        let endD = new Date(d);
        endD.setDate(endD.getDate() + 6);
        const endStr = endD.toLocaleDateString("en-US", options);
        
        $page.variables.currentWeekLabel = `${startStr} – ${endStr}`;
      }
    }
  }

  return NextWeekChain;
});
