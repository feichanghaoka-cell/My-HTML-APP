/* 暖流 — 页面与 Service Worker 共用的数据层与计算逻辑 */
(function (g) {
  'use strict';

  const DB_NAME = 'nuanliu';
  const STORE = 'kv';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------- 日期 ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ymOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const parseYmd = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d || 1);
  };
  const addDays = (s, n) => {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };
  const addMonths = (ym, n) => {
    const [y, m] = ym.split('-').map(Number);
    return ymOf(new Date(y, m - 1 + n, 1));
  };
  const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
  const daysInMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  };
  /** 某月的第 day 天（超过月底时取月底） */
  const dateInMonth = (ym, day) => `${ym}-${pad(Math.min(Math.max(1, day || 1), daysInMonth(ym)))}`;

  /* ---------- 类型 ---------- */
  const TYPES = [
    { id: 'personal', label: '个人可用现金', short: '个人现金', color: '#EC6A45' },
    { id: 'business', label: '公司现金', short: '公司现金', color: '#2E9C86' },
    { id: 'fd', label: '定存', short: '定存', color: '#DB9A12' },
    { id: 'stock', label: '股票 / 投资', short: '股票', color: '#8572DB' },
    { id: 'epf', label: '公积金 / 退休金', short: '公积金', color: '#4E9A2E' },
    // 负债：填“还欠多少”，不计入总资产，只用来算净资产
    { id: 'debt', label: '负债（贷款）', short: '负债', color: '#8E8E93', liability: true },
  ];
  const ASSET_TYPES = TYPES.filter((t) => !t.liability);

  /* ---------- 默认数据 ---------- */
  let seq = 0;
  const uid = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

  function defaultState() {
    const acc = (name, type, domain) => ({ id: uid(), name, type, domain: domain || '' });
    const bill = (name, category, domain) => ({ id: uid(), name, amount: 0, day: 1, category, domain: domain || '' });
    return {
      version: 1,
      settings: { dailyBudget: 100, reminderEnabled: false, reminderTime: '21:00', billRemindDays: 3, hideAmounts: true },
      accounts: [
        acc('Maybank 个人', 'personal', 'maybank2u.com.my'),
        acc('Maybank 公司', 'business', 'maybank2u.com.my'),
        acc('Hong Leong 个人', 'personal', 'hlb.com.my'),
        acc('Hong Leong 公司', 'business', 'hlb.com.my'),
        acc('Hong Leong 定存 (FD)', 'fd', 'hlb.com.my'),
        acc('Public Bank', 'personal', 'pbebank.com'),
        acc("Touch 'n Go 电子钱包", 'personal', 'touchngo.com.my'),
        acc('Moomoo 股票市值', 'stock', 'moomoo.com'),
        acc('Moomoo 未投资现金', 'stock', 'moomoo.com'),
        acc('钱包现金', 'personal', ''),
      ],
      snapshots: {},
      bills: [
        bill('租金', '住房'),
        bill('车贷', '贷款'),
        bill('学贷', '贷款'),
        bill('网络费', '网络通讯'),
        bill('电话费', '网络通讯'),
        bill('Google', '订阅服务', 'google.com'),
        bill('ChatGPT', '订阅服务', 'chatgpt.com'),
        bill('Claude', '订阅服务', 'claude.ai'),
        bill('Spotify', '订阅服务', 'spotify.com'),
        bill('iCloud', '订阅服务', 'icloud.com'),
      ],
      billMonths: {},
      clients: [],
      incomeMonths: {},
    };
  }

  /** 补齐缺失字段，保证旧数据 / 导入数据可用 */
  function normalize(s) {
    const d = defaultState();
    if (!s || typeof s !== 'object') return d;
    s.version = 1;
    s.settings = Object.assign({}, d.settings, s.settings || {});
    for (const k of ['accounts', 'bills', 'clients']) if (!Array.isArray(s[k])) s[k] = k === 'clients' ? [] : d[k];
    for (const k of ['snapshots', 'billMonths', 'incomeMonths']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
    return s;
  }

  /* ---------- 余额计算 ---------- */
  const snapshotDates = (state) => Object.keys(state.snapshots).sort();

  function totalsOf(state, date) {
    const snap = state.snapshots[date];
    const t = { personal: 0, business: 0, fd: 0, stock: 0, epf: 0, debt: 0, total: 0, net: 0 };
    if (!snap) return t;
    for (const a of state.accounts) {
      const v = Number(snap.balances[a.id]) || 0;
      if (t[a.type] === undefined || a.type === 'total' || a.type === 'net') continue;
      t[a.type] += v;
      if (a.type !== 'debt') t.total += v;
    }
    t.net = t.total - t.debt;
    return t;
  }

  function prevSnapshotDate(state, date) {
    const ds = snapshotDates(state);
    let prev = null;
    for (const d of ds) {
      if (d < date) prev = d;
      else break;
    }
    return prev;
  }

  /** 某天的花费：个人可用现金比上一次记录少了多少（可被手动修正覆盖） */
  function spendOf(state, date) {
    const snap = state.snapshots[date];
    if (!snap) return null;
    const prev = prevSnapshotDate(state, date);
    if (!prev) return null;
    const auto = totalsOf(state, prev).personal - totalsOf(state, date).personal;
    const days = Math.max(1, diffDays(prev, date));
    const overridden = typeof snap.spendOverride === 'number';
    const spend = overridden ? snap.spendOverride : auto;
    const budget = (Number(state.settings.dailyBudget) || 0) * days;
    return { date, prev, days, auto, spend, overridden, budget, over: spend > budget + 0.004 };
  }

  /* ---------- 固定开销 ---------- */
  function billsForMonth(state, ym) {
    const m = state.billMonths[ym] || {};
    return state.bills.map((bill) => {
      const rec = m[bill.id] || {};
      const amount = typeof rec.amount === 'number' ? rec.amount : Number(bill.amount) || 0;
      return { bill, amount, customAmount: typeof rec.amount === 'number', paid: !!rec.paid, due: dateInMonth(ym, bill.day) };
    }).sort((a, b) => a.due.localeCompare(b.due));
  }
  function billSummary(state, ym) {
    const rows = billsForMonth(state, ym);
    const sum = { total: 0, paid: 0, unpaid: 0, rows };
    for (const r of rows) {
      sum.total += r.amount;
      if (r.paid) sum.paid += r.amount;
      else sum.unpaid += r.amount;
    }
    return sum;
  }
  /** 快到期或已过期但未付的本月开销 */
  function dueBills(state, today) {
    const within = Number(state.settings.billRemindDays);
    const n = Number.isFinite(within) ? within : 3;
    return billsForMonth(state, today.slice(0, 7))
      .filter((r) => !r.paid && r.amount > 0)
      .map((r) => Object.assign(r, { daysLeft: diffDays(today, r.due) }))
      .filter((r) => r.daysLeft <= n);
  }

  /* ---------- 收入（仅参照） ---------- */
  function incomeForMonth(state, ym) {
    const m = state.incomeMonths[ym] || {};
    return state.clients
      .filter((c) => !c.since || c.since <= ym)
      .map((client) => {
        const rec = m[client.id] || {};
        const amount = typeof rec.amount === 'number' ? rec.amount : Number(client.amount) || 0;
        return { client, ym, amount, customAmount: typeof rec.amount === 'number', paid: !!rec.paid, due: dateInMonth(ym, client.dueDay || daysInMonth(ym)) };
      });
  }
  /** 逾期未收：检查本月及之前最多 6 个月 */
  function overdueIncome(state, today) {
    const out = [];
    let ym = today.slice(0, 7);
    for (let i = 0; i < 7; i++, ym = addMonths(ym, -1)) {
      for (const r of incomeForMonth(state, ym)) {
        if (!r.paid && r.amount > 0 && r.due < today) out.push(Object.assign(r, { daysLate: diffDays(r.due, today) }));
      }
    }
    return out;
  }

  const fmt = (n, digits = 2) =>
    (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  g.CF = {
    idbGet, idbSet, uid, ymd, ymOf, parseYmd, addDays, addMonths, diffDays, daysInMonth, dateInMonth,
    TYPES, ASSET_TYPES, defaultState, normalize, snapshotDates, totalsOf, prevSnapshotDate, spendOf,
    billsForMonth, billSummary, dueBills, incomeForMonth, overdueIncome, fmt,
  };
})(self);
