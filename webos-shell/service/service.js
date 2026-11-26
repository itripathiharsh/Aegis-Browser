'use strict';

const { createFilterProxyServer } = require('./proxyServer');

const SERVICE_ID = 'io.github.itripathiharsh.nivrok.service';
const proxy = createFilterProxyServer();

function registerWebOSService() {
  let ServiceCtor = null;
  try {
    ServiceCtor = require('webos-service');
  } catch (err) {
    return null;
  }

  const service = new ServiceCtor(SERVICE_ID);
  let keepAliveActivity = null;

  function ensureKeepAlive() {
    if (keepAliveActivity || !service.activityManager) return;
    try {
      service.activityManager.create('nivrok-proxy-keepalive', function (activity) {
        keepAliveActivity = activity;
      });
    } catch (err) {
      // Ignore if activityManager is unavailable on older webOS builds
    }
  }

  service.register('startProxy', function (message) {
    ensureKeepAlive();
    proxy
      .start()
      .then(function (info) {
        message.respond({
          returnValue: true,
          baseUrl: info.baseUrl,
          port: info.port,
          filterStats: info.filterStats,
        });
      })
      .catch(function (err) {
        message.respond({
          returnValue: false,
          errorText: err ? err.message : 'Failed to start loopback proxy',
        });
      });
  });

  service.register('getStats', function (message) {
    message.respond(proxy.getStats());
  });

  service.register('updateShields', function (message) {
    const payload = message && message.payload ? message.payload : {};
    const updated = proxy.updateShields(payload.shields || payload);
    message.respond({
      returnValue: true,
      shields: updated,
    });
  });

  service.register('reportBlocked', function (message) {
    const payload = message && message.payload ? message.payload : {};
    proxy.recordClientBlocked(payload.url, payload.pageUrl, payload.category);
    message.respond({
      returnValue: true,
      telemetry: proxy.getStats().telemetry,
    });
  });

  service.register('stopProxy', function (message) {
    proxy.stop().then(function () {
      if (keepAliveActivity && service.activityManager) {
        try {
          service.activityManager.complete(keepAliveActivity);
        } catch (err) {}
        keepAliveActivity = null;
      }
      message.respond({ returnValue: true });
    });
  });

  return service;
}

const registered = registerWebOSService();
if (!registered && require.main === module) {
  proxy.start().then(function (info) {
    console.log('[nivrok.service] standalone proxy listening on ' + info.baseUrl);
  });
}

module.exports = {
  SERVICE_ID,
  proxy,
};
