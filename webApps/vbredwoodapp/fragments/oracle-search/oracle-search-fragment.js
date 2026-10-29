define([], function() {
  'use strict';

  const FragmentModule = function FragmentModule() {};

  FragmentModule.prototype.debounce = function(key, value, delay) {
    if (!this._debouncState) this._debouncState = {};
    const state = this._debouncState;
    if (!state[key]) state[key] = { count: 0 };
    state[key].count++;
    const myCount = state[key].count;
    return new Promise(function(resolve) {
      if (state[key].timer) clearTimeout(state[key].timer);
      state[key].timer = setTimeout(function() {
        resolve(state[key].count === myCount ? value : null);
      }, delay || 400);
    });
  };

  FragmentModule.prototype.getFieldValue = function(row, fieldName) {
    if (!row || !fieldName) return '';
    // console.log(row[fieldName]);
    return row[fieldName];
  };

  return FragmentModule;
});
