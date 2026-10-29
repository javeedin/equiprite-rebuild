define([
    'vb/action/actionChain',
    'vb/action/actions',
], (ActionChain, Actions) => {
    'use strict';

    class gotoEquipmentWorkbenchChain extends ActionChain {

        /**
         * @param {Object} context
         */
        async run(context) {
            await Actions.navigateToFlow(context, {
                target: 'parent',
                flow: 'equipment-foundation',
                page: 'equipment-workbench'
            });
        }
    }

    return gotoEquipmentWorkbenchChain;
});
