// Service Worker para PWA e Notificações
const CACHE_NAME = 'produkti-v1.0.0';
const urlsToCache = [
  '/',
  '/produkti.html',
  '/public/style.css',
  '/public/app.js',
  '/public/firebase.js',
  '/public/services/authService.js',
  '/public/services/firestoreService.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
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

// ===== FETCH (CACHE FIRST) =====
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Retorna do cache se existir
        if (response) {
          return response;
        }

        // Busca na rede se não estiver em cache
        return fetch(event.request).then((response) => {
          // Não cacheia respostas não-200 ou não-GET
          if (!response || response.status !== 200 || response.type !== 'basic' || event.request.method !== 'GET') {
            return response;
          }

          // Cacheia a resposta
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });

          return response;
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
    icon: '/icon-192.png',
    badge: '/icon-192.png',
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