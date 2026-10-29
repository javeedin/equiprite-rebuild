define(['resources/js/integrationHealth'], (IntegrationHealth) => {
  'use strict';

  // Integration health. The rules and the model live in resources/js/integrationHealth.js, shared with the
  // Administrator's Home, so both grade an integration the same way.
  class PageModule extends IntegrationHealth {}

  return PageModule;
});
