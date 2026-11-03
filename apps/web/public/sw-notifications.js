/* Service Worker Thông báo Hệ thống Ụm Bò Milk HR V5.1 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const notificationId = data.notificationId || '';
  const portal = data.portal || 'backoffice';
  const baseCenterUrl = portal === 'employee' ? '/nv/thong-bao' : '/admin/notifications';
  const targetUrl = data.targetUrl || (notificationId ? `${baseCenterUrl}?highlight=${encodeURIComponent(notificationId)}` : baseCenterUrl);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          try {
            await client.focus();
          } catch {
            // Ignore focus restrictions on some browsers
          }
          client.postMessage({
            type: 'UMBM_NOTIFICATION_CLICK',
            notificationId,
            targetUrl,
            portal,
          });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
