define([], function () {
    'use strict';

    var PageModule = function PageModule() { };

    /**
     * Currency for the money KPI tile and the Bill Cost column.
     *
     * Page-level rather than app-level to match how every other page in this
     * app formats money (equipment-detail, equipment-reports, request-cart all
     * define their own). Whole dollars: these are dashboard-scale aggregates
     * where cents are noise.
     *
     * Null/undefined/non-numeric render as $0 rather than '$NaN' — the tile is
     * populated asynchronously, so it WILL evaluate before the chain resolves.
     */
    PageModule.prototype.formatCurrency = function (value) {
        var n = Number(value);
        if (!isFinite(n)) {
            n = 0;
        }
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(n);
    };

    return PageModule;
});
