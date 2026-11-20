/* 暖流 Service Worker：离线缓存 + 提醒通知 */
importScripts('./js/shared.js');

const CACHE = 'nuanliu-v6';
const ICON_CACHE = 'nuanliu-icons-v1';
const SHELL = [
  './', './index.html', './css/styles.css',
  './js/shared.js', './js/charts.js', './js/app.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== ICON_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // 应用文件：联网时取最新；离线、或信号差超过 3 秒没回应时用缓存
    const fromCache = () => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'));
    const network = fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    });
    e.respondWith(new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
      const timer = setTimeout(() => fromCache().then(finish), 3000);
      network
        .then((res) => { clearTimeout(timer); finish(res); })
        .catch(() => { clearTimeout(timer); fromCache().then((r) => (r ? finish(r) : finish(Response.error()))); });
    }));
    return;
  }

  // 品牌 logo：缓存优先，离线也能显示
  if (req.destination === 'image') {
    e.respondWith(
      caches.open(ICON_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      })
    );
  }
});

/* ---------- 提醒 ---------- */
async function runReminderCheck() {
  if (!self.registration.showNotification || Notification.permission !== 'granted') return;
  const state = CF.normalize(await CF.idbGet('state'));
  if (!state.settings.reminderEnabled) return;

  const now = new Date();
  const today = CF.ymd(now);
  const sent = (await CF.idbGet('notified')) || {};
  const [h, m] = String(state.settings.reminderTime || '21:00').split(':').map(Number);
  const afterReminder = now.getHours() * 60 + now.getMinutes() >= h * 60 + (m || 0);

  const windows = await self.clients.matchAll({ type: 'window' });
  const appVisible = windows.some((w) => w.visibilityState === 'visible');

  if (afterReminder && !state.snapshots[today] && sent.entry !== today && !appVisible) {
    await self.registration.showNotification('该记录今天的余额啦', {
      body: '花一分钟更新数字，看看今天的现金流。',
      icon: './icons/icon-192.png',
      badge: './icons/badge.png',
      tag: 'daily-entry',
      data: { hash: '#entry' },
    });
    sent.entry = today;
  }

  const due = CF.dueBills(state, today);
  if (due.length && sent.bills !== today && !appVisible) {
    const lines = due.slice(0, 4).map((r) => {
      const when = r.daysLeft < 0 ? `已过期 ${-r.daysLeft} 天` : r.daysLeft === 0 ? '今天' : `${r.daysLeft} 天后`;
      return `${r.bill.name} RM ${CF.fmt(r.amount)} · ${when}`;
    });
    await self.registration.showNotification(`${due.length} 笔开销快到扣款日`, {
      body: lines.join('\n'),
      icon: './icons/icon-192.png',
      badge: './icons/badge.png',
      tag: 'bills-due',
      data: { hash: '#bills' },
    });
    sent.bills = today;
  }
  await CF.idbSet('notified', sent);
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'reminder-check') e.waitUntil(runReminderCheck());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'reminder-check') e.waitUntil(runReminderCheck());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.hash) || '';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({ type: 'navigate', hash });
          return c.focus();
        }
      }
      return self.clients.openWindow('./' + hash);
    })
  );
});
