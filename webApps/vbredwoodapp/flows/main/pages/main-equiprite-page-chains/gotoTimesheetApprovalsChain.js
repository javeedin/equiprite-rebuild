define([
    'vb/action/actionChain',
    'vb/action/actions',
], (ActionChain, Actions) => {
    'use strict';

    class gotoTimesheetApprovalsChain extends ActionChain {

        /**
         * @param {Object} context
         */
        async run(context) {
            await Actions.navigateToFlow(context, {
                target: 'parent',
                flow: 'equipment-foundation',
                page: 'timesheet-approvals'
            });
        }
    }

    return gotoTimesheetApprovalsChain;
});
