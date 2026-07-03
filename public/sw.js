// Service Worker para PWA e Notificações
const CACHE_VERSION = 'v1.0.1';
const CACHE_NAME = `produkti-${CACHE_VERSION}`;
const FALLBACK_HTML = new URL('produkti.html', self.location).href;
const urlsToCache = [
  new URL('produkti.html', self.location).href,
  new URL('style.css', self.location).href,
  new URL('app.js', self.location).href,
  new URL('firebase.js', self.location).href,
  new URL('services/authService.js', self.location).href,
  new URL('services/firestoreService.js', self.location).href,
  new URL('manifest.json', self.location).href,
  new URL('assets/logo-icon.png', self.location).href,
  new URL('assets/logo.png', self.location).href
];

// ===== INSTALAÇÃO =====
self.addEventListener('install', (event) => {
  console.log('Service Worker: Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Cacheando arquivos...');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ===== ATIVAÇÃO =====
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Ativando...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ===== FETCH =====
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const acceptHeader = request.headers.get('accept') || '';
  const isNavigationRequest = request.mode === 'navigate' || acceptHeader.includes('text/html');

  if (isNavigationRequest) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request.url, responseClone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(FALLBACK_HTML))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request.url, responseToCache));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request.url, responseToCache));
        }
        return networkResponse;
      });
    })
  );
});

// ===== PUSH NOTIFICATIONS =====
self.addEventListener('push', (event) => {
  console.log('Push recebido:', event);

  let data = {};
  if (event.data) {
    data = event.data.json();
  }

  const options = {
    body: data.body || 'Notificação do Produkti',
    icon: 'assets/logo-icon.png',
    badge: 'assets/logo-icon.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: true,
    silent: false
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Produkti', options)
  );
});

// ===== NOTIFICATION CLICK =====
self.addEventListener('notificationclick', (event) => {
  console.log('Notificação clicada:', event);

  event.notification.close();

  // Abre ou foca na app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const url = event.notification.data?.url || '/';

        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// ===== BACKGROUND SYNC (para notificações offline) =====
self.addEventListener('sync', (event) => {
  console.log('Background sync:', event.tag);

  if (event.tag === 'check-low-stock') {
    event.waitUntil(checkLowStock());
  }
});

// Função para verificar estoque baixo (será chamada periodicamente)
async function checkLowStock() {
  try {
    // Esta função seria implementada para verificar produtos com estoque baixo
    // Por enquanto, apenas log
    console.log('Verificando estoque baixo...');
  } catch (error) {
    console.error('Erro ao verificar estoque:', error);
  }
}