/**
 * Data providers for the Task LOVs.
 *
 * The Task list cannot be a ServiceDataProvider — it shows only the CHARGEABLE
 * LEAVES of the WBS, and "no other row names me as parent" is a property of the
 * whole set that no Fusion q predicate can express (see projectTaskTree.js). So
 * the rows have to be fetched, classified, and only then handed to the picker.
 *
 * The naive way to do that is to fetch into an ArrayDataProvider and keep the
 * field disabled until it fills. That is what this module exists to avoid: a
 * disabled oj-select-single CLOSES its own dropdown, so a user who opens the
 * list while the fetch is in flight gets it shut in their face and has to open
 * it a second time. The load being fast does not help — it makes the flicker
 * shorter, not less confusing.
 *
 * A DeferredDataProvider fixes it properly. It wraps a PROMISE of a data
 * provider, so the component can be handed its data source the instant the
 * project changes, before any row exists. Opening the dropdown then calls
 * fetchFirst on a provider that has not resolved, and oj-select-single renders
 * its own loading skeleton — the grey placeholder row — until it does, exactly
 * like the SDP-backed Customer and Project pickers on the same form. The
 * dropdown stays open the whole time and fills in place.
 *
 * The field is never disabled for loading, and there is no separate spinner:
 * the dropdown reports its own state, in the place the user is already looking.
 */
define([
  'ojs/ojarraydataprovider',
  'ojs/ojdeferreddataprovider'
], function (ArrayDataProvider, DeferredDataProvider) {
  'use strict';

  /**
   * keyAttributes matches the pickers' value binding (TaskId).
   * textFilterAttributes is what makes the dropdown's own filter field search
   * the task NUMBER as well as the name, locally, with no round-trip.
   */
  var OPTIONS = {
    keyAttributes: 'TaskId',
    textFilterAttributes: ['TaskName', 'TaskNumber']
  };

  /**
   * DeferredDataProvider needs to answer getCapability BEFORE its promise
   * settles — that is how oj-select-single decides whether to render a filter
   * field at all. Delegating to a real (empty) ArrayDataProvider gives the
   * honest answer for the provider that will eventually arrive, rather than a
   * hand-maintained capability literal that would drift from JET's.
   */
  var CAPABILITY_PROBE = new ArrayDataProvider([], OPTIONS);

  function capabilityOf(capabilityName) {
    return CAPABILITY_PROBE.getCapability(capabilityName);
  }

  /**
   * A provider that resolves to `rowsPromise`'s rows.
   *
   * Assign this to the picker's data variable SYNCHRONOUSLY, in the same tick
   * the project changes — the point is to hand over the pending provider, not
   * to wait for it. Awaiting the rows first and assigning afterwards would
   * reintroduce the very gap the skeleton is there to cover.
   *
   * A rejected fetch resolves to an EMPTY provider rather than propagating.
   * An unsettled DeferredDataProvider leaves the dropdown skeletoning forever,
   * which reads as a hang; an empty list reads as "no tasks", which is at least
   * a state the user can act on. The chain logs the real error.
   */
  function deferredTaskDataProvider(rowsPromise) {
    var providerPromise = Promise.resolve(rowsPromise)
      .then(function (rows) {
        return new ArrayDataProvider(Array.isArray(rows) ? rows : [], OPTIONS);
      })
      .catch(function () {
        return new ArrayDataProvider([], OPTIONS);
      });

    return new DeferredDataProvider(providerPromise, capabilityOf);
  }

  /**
   * An already-resolved empty provider, for "no project selected yet".
   *
   * Not the same thing as a pending provider: there is no work in flight, so
   * the dropdown should say it is empty immediately rather than skeleton over
   * a load that will never come.
   */
  function emptyTaskDataProvider() {
    return new ArrayDataProvider([], OPTIONS);
  }

  return {
    deferredTaskDataProvider: deferredTaskDataProvider,
    emptyTaskDataProvider: emptyTaskDataProvider
  };
});
