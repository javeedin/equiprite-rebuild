define([], function () {
    'use strict';

    var PageModule = function PageModule() { };

    /**
     * The Fusion role codes the lookup found, for the "roles found" line, or
     * 'None' when it found none. Shown so an administrator can see at a glance
     * whether the fix is "grant a role" or "map this role in RBAC_ROLE_MAP".
     *
     * @param {string[]} fusionRoles - $application.variables.fusionRoles
     * @returns {string}
     */
    PageModule.prototype.rolesFoundText = function (fusionRoles) {
        var list = Array.isArray(fusionRoles) ? fusionRoles.filter(Boolean) : [];
        return list.length ? list.join(', ') : 'None';
    };

    return PageModule;
});
