// Replit injects Umami on published sites when analytics is enabled.
// Only fixed event names and dimensions are accepted; never pass form data.
(function () {
  'use strict';
  const dimensions = {
    crew_verified: [],
    availability_submitted: [],
    availability_submit_failed: [],
    personal_schedule_viewed: [],
    published_schedule_loaded: [],
    schedule_published: ['surface'],
    schedule_publish_failed: ['surface'],
    estimate_saved: [],
  };

  window.trackEvent = function (name, data) {
    try {
      if (!Object.prototype.hasOwnProperty.call(dimensions, name)) return;
      const safeData = {};
      for (const key of dimensions[name]) {
        if (key === 'surface' && ['desktop', 'mobile'].includes(data?.[key])) {
          safeData[key] = data[key];
        }
      }
      // Catch synchronous errors and rejected promises without blocking the UI.
      const result = window.umami?.track(name, safeData);
      Promise.resolve(result).catch(function () {});
    } catch (_) {
      // Analytics must never break the application.
    }
  };
})();
