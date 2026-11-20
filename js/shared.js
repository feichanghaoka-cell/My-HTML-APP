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
    for (const k of ['snapshots', 'billMonths', 'incomeMonths']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};

    // 导入的文件可能被手动改过或损坏：只保留形状正确的数据
    const str = (v, max = 80) => String(v == null ? '' : v).slice(0, max);
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const day = (v, dflt) => Math.min(31, Math.max(1, parseInt(v, 10) || dflt));
    const domain = (v) => (/^[a-z0-9.-]{1,80}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');
    const typeIds = TYPES.map((t) => t.id);
    const okId = (o) => o && typeof o === 'object' && typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id);

    s.accounts = s.accounts.filter(okId).map((a) => ({
      id: a.id, name: str(a.name), type: typeIds.includes(a.type) ? a.type : 'personal', domain: domain(a.domain),
      ...(a.deleted ? { deleted: true } : {}),
      ...(a.type === 'debt' && a.excludeSpend ? { excludeSpend: true } : {}),
    }));
    s.bills = s.bills.filter(okId).map((b) => ({
      id: b.id, name: str(b.name), amount: num(b.amount), day: day(b.day, 1), category: str(b.category, 20) || '其他', domain: domain(b.domain),
    }));
    s.clients = s.clients.filter(okId).map((c) => ({
      id: c.id, name: str(c.name), amount: num(c.amount), dueDay: day(c.dueDay, 28), domain: domain(c.domain),
      ...(/^\d{4}-\d{2}$/.test(c.since) ? { since: c.since } : {}),
    }));
    for (const [date, snap] of Object.entries(s.snapshots)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !snap || typeof snap.balances !== 'object' || !snap.balances) { delete s.snapshots[date]; continue; }
      const balances = {};
      for (const [id, v] of Object.entries(snap.balances)) balances[id] = num(v);
      s.snapshots[date] = { balances, spendOverride: typeof snap.spendOverride === 'number' && Number.isFinite(snap.spendOverride) ? snap.spendOverride : null };
    }
    for (const k of ['billMonths', 'incomeMonths']) {
      for (const [ym, recs] of Object.entries(s[k])) {
        if (!/^\d{4}-\d{2}$/.test(ym) || !recs || typeof recs !== 'object') { delete s[k][ym]; continue; }
        for (const [id, r] of Object.entries(recs)) {
          if (!r || typeof r !== 'object') { delete recs[id]; continue; }
          recs[id] = { paid: !!r.paid, ...(typeof r.amount === 'number' && Number.isFinite(r.amount) ? { amount: r.amount } : {}) };
        }
      }
    }
    const st = s.settings;
    st.dailyBudget = Math.max(0, num(st.dailyBudget));
    st.reminderTime = /^\d{2}:\d{2}$/.test(st.reminderTime) ? st.reminderTime : '21:00';
    st.billRemindDays = Math.min(15, Math.max(0, parseInt(st.billRemindDays, 10) || 0));
    st.reminderEnabled = !!st.reminderEnabled;
    st.hideAmounts = !!st.hideAmounts;
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

  /** 这笔负债的增减是否算进每日花费（默认算；例如不想算的可以在账户里关掉） */
  const spendsViaDebt = (acc) => acc.type === 'debt' && !acc.excludeSpend;

  /** 常见负债，可以在设置里一键添加 */
  const DEBT_PRESETS = [
    { name: 'Maybank 信用卡 1', domain: 'maybank2u.com.my', kind: '信用卡' },
    { name: 'Maybank 信用卡 2', domain: 'maybank2u.com.my', kind: '信用卡' },
    { name: 'Hong Leong 信用卡 1', domain: 'hlb.com.my', kind: '信用卡' },
    { name: 'Hong Leong 信用卡 2', domain: 'hlb.com.my', kind: '信用卡' },
    { name: 'SPayLater', domain: 'shopee.com.my', kind: '分期' },
    { name: 'Atomy 分期', domain: 'atomy.com', kind: '分期' },
    { name: '车贷', domain: '', kind: '贷款', match: ['车贷'] },
    { name: 'PTPTN 学贷', domain: 'ptptn.gov.my', kind: '贷款', match: ['PTPTN', '学贷'] },
  ];
  /** 还没建的常见负债（按名称判断，避免重复） */
  function missingDebtPresets(state) {
    const names = state.accounts.filter((a) => !a.deleted).map((a) => a.name.toLowerCase());
    return DEBT_PRESETS.filter((p) => !(p.match || [p.name]).some((m) => names.some((n) => n.includes(m.toLowerCase()))));
  }

  /** 某天的花费：个人可用现金比上一次记录少了多少（可被手动修正覆盖） */
  function spendOf(state, date) {
    const snap = state.snapshots[date];
    if (!snap) return null;
    const prev = prevSnapshotDate(state, date);
    if (!prev) return null;
    // 只比较两天都有记录的账户：新增或删除账户不会被当成花费或进账
    const a = state.snapshots[prev].balances, b = snap.balances;
    let auto = 0;
    for (const acc of state.accounts) {
      if (!(acc.id in a) || !(acc.id in b)) continue;
      const diff = (Number(a[acc.id]) || 0) - (Number(b[acc.id]) || 0);
      if (acc.type === 'personal') auto += diff; // 个人现金少了 = 花了
      // 负债多了 = 花了（刷卡、分期）；负债少了 = 用现金还款，抵消掉现金的减少，不算花费
      else if (spendsViaDebt(acc)) auto -= diff;
    }
    auto = Math.round(auto * 100) / 100;
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
  function remindDays(state) {
    const n = Number(state.settings.billRemindDays);
    return Number.isFinite(n) && n >= 0 ? n : 3;
  }
  /** 快到期或已过期但未付的开销：看上个月（逾期）、本月和下个月初（跨月） */
  function dueBills(state, today) {
    const n = remindDays(state);
    const ym = today.slice(0, 7);
    return [addMonths(ym, -1), ym, addMonths(ym, 1)]
      .flatMap((m) => billsForMonth(state, m))
      .filter((r) => !r.paid && r.amount > 0)
      .map((r) => Object.assign(r, { daysLeft: diffDays(today, r.due) }))
      .filter((r) => r.daysLeft <= n && r.daysLeft >= -31);
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
    TYPES, ASSET_TYPES, DEBT_PRESETS, missingDebtPresets, spendsViaDebt, defaultState, normalize, snapshotDates, totalsOf, prevSnapshotDate, spendOf,
    billsForMonth, billSummary, dueBills, remindDays, incomeForMonth, overdueIncome, fmt,
  };
})(self);
