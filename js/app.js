/* 暖流 — 应用主逻辑 */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MASK = '••••';
  // 隐藏金额时，所有显示用的数字都换成圆点（导出的文件不受影响）
  const fmt = (n, digits) => (ui.masked ? MASK : CF.fmt(n, digits));
  const view = $('#view');
  const todayStr = () => CF.ymd(new Date());
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = CF.defaultState();
  const ui = { tab: 'home', range: 30, billsYm: null, incomeYm: null, entryDate: null, shownTotal: 0, installEvt: null, periodic: null, masked: false, draft: null, slide: 0 };

  /* 安卓 APK 外壳提供的原生接口（网页版里不存在） */
  const Native = window.NativeApp || null;
  function nativeSync() {
    if (!Native) return;
    const today = todayStr();
    const dates = CF.snapshotDates(state);
    // 交给原生闹钟：除了本月和下月，也带上上个月没付的，跨月后照样提醒
    const bills = [-1, 0, 1, 2].map((n) => CF.addMonths(today.slice(0, 7), n))
      .flatMap((ym) => CF.billsForMonth(state, ym))
      .filter((r) => !r.paid && r.amount > 0 && CF.diffDays(r.due, today) <= 31)
      .map((r) => ({ name: r.bill.name, amount: r.amount, due: r.due }));
    try {
      Native.sync(JSON.stringify({
        enabled: !!state.settings.reminderEnabled, time: state.settings.reminderTime || '21:00',
        remindDays: Number(state.settings.billRemindDays) || 0, lastEntry: dates[dates.length - 1] || '', bills,
      }));
    } catch (e) { /* 旧版外壳没有这个接口 */ }
  }

  const save = () => CF.idbSet('state', state).then(nativeSync).catch(() => toast('保存失败：存储空间不可用'));
  const activeAccounts = () => state.accounts.filter((a) => !a.deleted);
  const typeOf = (id) => CF.TYPES.find((t) => t.id === id) || CF.TYPES[0];

  /* ---------- 小工具 ---------- */
  const parseNum = (v) => {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const numStr = (n) => (n === null || n === undefined || n === '' ? '' : String(Math.round(Number(n) * 100) / 100));
  const money = (n, cls = '') => {
    if (ui.masked) return `<span class="money ${cls}"><span class="cur">RM</span><span class="int">${MASK}</span></span>`;
    const neg = n < -0.004;
    const [int, dec] = fmt(Math.abs(n)).split('.');
    return `<span class="money ${cls}">${neg ? '<span class="neg">−</span>' : ''}<span class="cur">RM</span><span class="int">${int}</span><span class="dec">.${dec}</span></span>`;
  };
  const signed = (n) => `${n < 0 ? '−' : '+'}RM ${fmt(Math.abs(n))}`;
  const monthLabel = (ym) => `${ym.slice(0, 4)} 年 ${Number(ym.slice(5))} 月`;
  const dayLabel = (s) => {
    const d = CF.parseYmd(s);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${'日一二三四五六'[d.getDay()]}`;
  };
  const relDay = (s) => {
    const n = CF.diffDays(s, todayStr());
    return n === 0 ? '今天' : n === 1 ? '昨天' : dayLabel(s);
  };
  const cleanDomain = (v) => String(v || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];

  const haptic = (ms = 8) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 不支持就算了 */ } };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function download(name, text, mime) {
    if (Native) { Native.saveFile(name, mime.split(';')[0], text); return; }
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- Logo：网站图标 + 首字母后备 ---------- */
  const BRAND = {
    'maybank2u.com.my': '#F5B800', 'hlb.com.my': '#0B4EA2', 'pbebank.com': '#D71920', 'touchngo.com.my': '#0A5BC4',
    'moomoo.com': '#FF6A00', 'google.com': '#4285F4', 'chatgpt.com': '#10A37F', 'openai.com': '#10A37F',
    'claude.ai': '#D97757', 'spotify.com': '#1DB954', 'icloud.com': '#3693F3', 'apple.com': '#555555',
    'netflix.com': '#E50914', 'youtube.com': '#FF0000',
  };
  function brandColor(name, domain) {
    if (BRAND[domain]) return BRAND[domain];
    let h = 0;
    for (const ch of String(name || domain || '?')) h = (h * 31 + ch.codePointAt(0)) % 360;
    return `hsl(${h} 58% 56%)`;
  }
  function logo(name, domain, size = '') {
    const initial = (String(name || domain || '?').trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    const img = domain
      ? `<img alt="" data-logo="${esc(domain)}" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128">`
      : '';
    return `<span class="logo ${size}" style="--c:${brandColor(name, domain)}"><b>${esc(initial)}</b>${img}</span>`;
  }
  function logoFallback(img) {
    if (!img.dataset.retry) {
      img.dataset.retry = '1';
      img.src = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(img.dataset.logo)}.ico`;
    } else img.remove();
  }
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.logo) return;
    if (img.naturalWidth >= 32) img.classList.add('ok');
    else logoFallback(img); // 图标服务找不到时会返回 16px 的默认地球图标
  }, true);
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.dataset.logo) logoFallback(img);
  }, true);

  /* ---------- 数字滚动 ---------- */
  function rollNumber(el, from, to, ms = 1100) {
    if (ui.masked || reduceMotion || Math.abs(to - from) < 0.005) { el.innerHTML = money(to, 'hero-num'); return; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 4);
      el.innerHTML = money(from + (to - from) * eased, 'hero-num');
      if (p < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- 底部弹层表单 ---------- */
  function openSheet({ title, intro, fields = [], onSave, onDelete, saveLabel = '保存', deleteLabel = '删除', extra }) {
    const root = $('#sheet-root');
    root.classList.remove('closing'); // 上一个弹层的关闭动画还没结束时，不能让新弹层继承它
    const fieldHtml = fields.map((f) => {
      const id = 'f-' + f.key;
      let control;
      if (f.type === 'select') {
        control = `<select id="${id}" name="${f.key}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      } else if (f.type === 'money') {
        control = `<div class="in-money"><span>RM</span><input id="${id}" name="${f.key}" type="text" inputmode="decimal" autocomplete="off" value="${esc(numStr(f.value))}" placeholder="${esc(f.placeholder || '0.00')}"></div>`;
      } else {
        control = `<input id="${id}" name="${f.key}" type="${f.type === 'int' ? 'number' : f.type || 'text'}" ${f.type === 'int' ? `inputmode="numeric" min="${f.min || 1}" max="${f.max || 31}"` : ''} autocomplete="off" value="${esc(f.value == null ? '' : f.value)}" placeholder="${esc(f.placeholder || '')}">`;
      }
      return `<label class="field" for="${id}"><span>${esc(f.label)}</span>${control}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
    }).join('');
    root.innerHTML = `
      <div class="sheet-backdrop"></div>
      <form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-drag"><div class="sheet-grip"></div><h2>${esc(title)}</h2></div>
        ${intro ? `<p class="sheet-intro">${intro}</p>` : ''}
        ${fieldHtml}
        ${extra || ''}
        <div class="sheet-actions">
          ${onDelete ? `<button type="button" class="btn ghost danger" data-act="delete">${esc(deleteLabel)}</button>` : ''}
          <button type="button" class="btn ghost" data-act="cancel">取消</button>
          <button type="submit" class="btn primary">${esc(saveLabel)}</button>
        </div>
      </form>`;
    const form = $('.sheet', root);
    const clear = () => {
      if (!root.contains(form)) return; // 已经换成新的弹层了，别碰它
      root.innerHTML = '';
      root.classList.remove('closing');
    };
    const close = () => {
      if (reduceMotion) { clear(); return; }
      root.classList.add('closing');
      setTimeout(clear, 280);
    };
    // 像 iOS 一样可以往下拖动关闭
    const drag = $('.sheet-drag', root);
    let startY = null;
    drag.addEventListener('pointerdown', (e) => { startY = e.clientY; form.classList.add('dragging'); drag.setPointerCapture(e.pointerId); });
    drag.addEventListener('pointermove', (e) => { if (startY !== null) form.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`; });
    const endDrag = (e) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      startY = null;
      form.classList.remove('dragging');
      if (dy > 110) { form.style.transform = 'translateY(100%)'; root.classList.add('closing'); setTimeout(clear, 280); }
      else form.style.transform = '';
    };
    drag.addEventListener('pointerup', endDrag);
    drag.addEventListener('pointercancel', endDrag);
    $('.sheet-backdrop', root).onclick = close;
    $('[data-act="cancel"]', root).onclick = close;
    const del = $('[data-act="delete"]', root);
    if (del) del.onclick = () => { if (onDelete() !== false) close(); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      if (onSave(values) !== false) close();
    };
    return { root, close };
  }

  /* =====================================================
     总览
     ===================================================== */
  function renderHome() {
    const today = todayStr();
    const dates = CF.snapshotDates(state);
    const latest = dates[dates.length - 1];
    const bills = CF.billSummary(state, today.slice(0, 7));

    if (!latest) {
      view.innerHTML = `
        <section class="welcome">
          <img src="icons/icon.svg" alt="" width="76" height="76">
          <h1>欢迎来到暖流</h1>
          <p>每天花一分钟输入各账户的余额，<br>这里会自动帮你加总，让你一眼看清楚。</p>
          <a class="btn primary big" href="#entry">记录第一天的余额</a>
        </section>
        <section class="card">
          <h3>开始前可以先做</h3>
          <ol class="steps">
            <li><a href="#settings">设置</a>里检查账户列表和每日预算</li>
            <li><a href="#bills">开销</a>里填好固定开销与订阅的金额和扣款日</li>
            <li><a href="#settings">设置</a>里开启晚上 9 点的提醒</li>
          </ol>
        </section>`;
      return;
    }

    const t = CF.totalsOf(state, latest);
    const prev = CF.prevSnapshotDate(state, latest);
    const delta = prev ? t.total - CF.totalsOf(state, prev).total : null;
    const free = t.personal - bills.unpaid;
    const stale = latest !== today;
    // 公积金和负债是后加的类型：有这类账户时才显示，免得多出空格子
    const optional = (ty) => ty.id === 'epf' || ty.id === 'debt';
    const hasType = (ty) => state.accounts.some((a) => a.type === ty.id && (!a.deleted || t[ty.id]));
    const shownTypes = CF.TYPES.filter((ty) => !optional(ty) || hasType(ty));
    const tileTypes = shownTypes.filter((ty) => !ty.liability); // 负债有自己的卡片

    const due = CF.dueBills(state, today);
    const overdue = CF.overdueIncome(state, today);

    view.innerHTML = `
      ${stale ? `<a class="notice" href="#entry">
        <span class="notice-dot"></span>
        <span>今天还没记录 · 现在显示的是${relDay(latest)}的数字</span><b>去记录 ›</b></a>` : ''}

      <section class="hero">
        <div class="hero-label">总资产<span>${relDay(latest)}</span></div>
        <div id="hero-total" class="hero-total">${money(ui.shownTotal, 'hero-num')}</div>
        ${delta === null ? '' : `<div class="chip ${delta < 0 ? 'down' : 'up'}">${delta < 0 ? '▼' : '▲'} 较上次记录 ${signed(delta)}</div>`}
        ${t.debt > 0 ? `<div class="net">净资产 <b>RM ${fmt(t.net)}</b><span>已扣掉负债 RM ${fmt(t.debt)}</span></div>` : ''}
      </section>

      <section class="card free">
        <div class="free-head">
          <span class="eyebrow">真正可用的钱</span>
          <span class="free-sub">已扣掉本月未付的固定开销</span>
        </div>
        <div class="free-num ${free < 0 ? 'bad' : ''}">${money(free)}</div>
        <div class="free-eq">
          <span>个人现金 <b>RM ${fmt(t.personal)}</b></span><i>−</i>
          <a href="#bills">本月未付 <b>RM ${fmt(bills.unpaid)}</b> ›</a>
        </div>
      </section>

      ${budgetCard(latest)}

      <section class="tiles">
        ${tileTypes.map((ty) => `<div class="card tile">
          <span class="tile-dot" style="background:${ty.color}"></span>
          <span class="tile-label">${ty.label}</span>
          ${money(t[ty.id], 'tile-num')}
          <span class="tile-pct">${ty.liability ? '还欠的金额 · 不计入总资产' : (t.total > 0 ? ((Math.max(0, t[ty.id]) / t.total) * 100).toFixed(1) : '0.0') + '%'}</span>
        </div>`).join('')}
      </section>

      ${debtCard(latest, prev)}

      <section class="card">
        <h3>资产占比</h3>
        <div id="donut" class="donut"></div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3>每日走势</h3>
          <div class="seg" role="group" aria-label="时间范围" style="--i:${[7, 30, 0].indexOf(ui.range)}"><i class="seg-thumb"></i>
            ${[[7, '7 天'], [30, '30 天'], [0, '全部']].map(([v, l]) => `<button type="button" data-range="${v}" class="${ui.range === v ? 'on' : ''}">${l}</button>`).join('')}
          </div>
        </div>
        <div id="trend"></div>
      </section>

      ${due.length ? `<section class="card">
        <div class="card-head"><h3>快到扣款日</h3><a class="link" href="#bills">全部 ›</a></div>
        <ul class="rows">${due.map((r) => `<li class="row">
          ${logo(r.bill.name, r.bill.domain)}
          <div class="row-main"><strong>${esc(r.bill.name)}</strong><small>${dueText(r.daysLeft)}</small></div>
          <div class="row-amt">RM ${fmt(r.amount)}</div></li>`).join('')}</ul>
      </section>` : ''}

      ${overdue.length ? `<section class="card">
        <div class="card-head"><h3>客户逾期未付</h3><a class="link" href="#income">查看 ›</a></div>
        <ul class="rows">${overdue.map((r) => `<li class="row">
          ${logo(r.client.name, r.client.domain)}
          <div class="row-main"><strong>${esc(r.client.name)}</strong><small><span class="tag warn">⚠ 逾期 ${r.daysLate} 天</span> ${monthLabel(r.ym)}</small></div>
          <div class="row-amt">RM ${fmt(r.amount)}</div></li>`).join('')}</ul>
        <p class="fine">收入只作参照，不计入余额。</p>
      </section>` : ''}
    `;

    rollNumber($('#hero-total'), ui.shownTotal, t.total);
    if (!ui.masked) ui.shownTotal = t.total;
    $('#hero-total').onclick = toggleMask;

    Charts.donut($('#donut'), shownTypes.filter((ty) => !ty.liability).map((ty) => ({ label: ty.short, value: t[ty.id], color: ty.color })), t.total);
    drawTrend();
    $$('[data-range]').forEach((b) => (b.onclick = () => {
      ui.range = Number(b.dataset.range);
      $$('[data-range]').forEach((x) => x.classList.toggle('on', x === b));
      b.parentNode.style.setProperty('--i', [7, 30, 0].indexOf(ui.range));
      haptic();
      drawTrend();
    }));
    const fix = $('#fix-spend');
    if (fix) fix.onclick = () => openSpendFix(latest);
  }

  /** 总览里的负债卡片：每笔还欠多少、比上次多了还是少了 */
  function debtCard(date, prev) {
    const debts = state.accounts.filter((a) => a.type === 'debt' && (!a.deleted || Number(state.snapshots[date].balances[a.id])));
    if (!debts.length) return '';
    const now = state.snapshots[date].balances;
    const before = prev ? state.snapshots[prev].balances : null;
    let total = 0, change = 0;
    const rows = debts.map((a) => {
      const v = Number(now[a.id]) || 0;
      total += v;
      const d = before && a.id in before && a.id in now ? v - (Number(before[a.id]) || 0) : 0;
      change += d;
      const dTxt = Math.abs(d) > 0.004 ? `<span class="${d > 0 ? 'bad-text' : 'good-text'}">${d > 0 ? '多了' : '还了'} RM ${fmt(Math.abs(d))}</span>` : '';
      return { a, v, d: dTxt };
    }).sort((x, y) => y.v - x.v).map((r) => {
      const share = total > 0 ? (Math.max(0, r.v) / total) * 100 : 0;
      r.html = `<li class="row debt-row">
        ${logo(r.a.name, r.a.domain)}
        <div class="row-main"><strong>${esc(r.a.name)}</strong>
          <small>${r.v > 0 ? `${share.toFixed(1)}% · ` : ''}${r.d || (r.v > 0 ? '没有变动' : '目前没有欠款')}</small>
          ${r.v > 0 ? `<span class="share" aria-hidden="true"><i style="width:${share}%"></i></span>` : ''}</div>
        <div class="row-amt ${r.v > 0 ? '' : 'cleared'}">${r.v > 0 ? 'RM ' + fmt(r.v) : '✓'}</div></li>`;
      return r;
    });
    const t = CF.totalsOf(state, date);
    const ratio = t.total > 0 ? (total / t.total) * 100 : null;
    // 30 天内要还多少：还款类开销里还没付的（跨月也算，月底时下个月 1、2 号的账单很重要）
    const today = todayStr();
    const repayRows = [-1, 0, 1].map((n) => CF.addMonths(today.slice(0, 7), n))
      .flatMap((m) => CF.billsForMonth(state, m))
      .filter((r) => CF.REPAY_CATS.includes(r.bill.category) && r.amount > 0 && !r.paid)
      .filter((r) => { const d = CF.diffDays(today, r.due); return d <= 30 && d >= -31; });
    const repayLeft = repayRows.reduce((x, r) => x + r.amount, 0);
    const nextRows = CF.dueBills(state, todayStr()).filter((r) => CF.REPAY_CATS.includes(r.bill.category));
    return `<section class="card debt">
      <div class="card-head"><h3>负债</h3><span class="muted">还欠的总额</span></div>
      ${money(total, 'debt-num')}
      ${Math.abs(change) > 0.004 ? `<div class="chip ${change > 0 ? 'down' : 'up'}">${change > 0 ? '▲ 比上次多欠' : '▼ 比上次少欠'} RM ${fmt(Math.abs(change))}</div>` : ''}
      <div class="debt-stats">
        <div><span>负债率</span><b class="${ratio !== null && ratio > 50 ? 'bad-text' : ''}">${ratio === null ? '—' : ratio.toFixed(1) + '%'}</b><small>负债 ÷ 总资产</small></div>
        <a href="#bills"><span>30 天内要还</span><b>RM ${fmt(repayLeft)}</b><small>${repayRows.length ? `${repayRows.length} 笔 · 看还款计划 ›` : '看还款计划 ›'}</small></a>
      </div>
      ${nextRows.length ? `<div class="debt-next">${nextRows.map((r) => `<span>${esc(r.bill.name)} RM ${fmt(r.amount)} · ${r.daysLeft < 0 ? `<b class="bad-text">已过期 ${-r.daysLeft} 天</b>` : r.daysLeft === 0 ? '<b>今天到期</b>' : `${r.daysLeft} 天后`}</span>`).join('')}</div>` : ''}
      <ul class="rows debt-rows">${rows.map((r) => r.html).join('')}</ul>
      <p class="fine">负债不计入总资产，只用来算净资产。信用卡、分期刷了算花费，用现金还款不算。</p>
    </section>`;
  }

  function drawTrend() {
    const today = todayStr();
    const from = ui.range ? CF.addDays(today, -(ui.range - 1)) : '';
    const pts = CF.snapshotDates(state).filter((d) => d >= from).map((d) => {
      const t = CF.totalsOf(state, d);
      return { date: d, total: t.total, cash: t.personal };
    });
    const el = $('#trend');
    if (el) Charts.trend(el, pts);
  }

  const dueText = (n) => (n < 0 ? `<span class="tag warn">⚠ 已过期 ${-n} 天</span>` : n === 0 ? '<span class="tag soon">今天扣款</span>' : `<span class="tag soon">${n} 天后扣款</span>`);

  function budgetCard(date) {
    const s = CF.spendOf(state, date);
    const daily = Number(state.settings.dailyBudget) || 0;
    const today = todayStr();
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = CF.addDays(today, -i);
      const x = CF.spendOf(state, d);
      week.push({ date: d, spend: x ? x.spend : null, days: x ? x.days : 1, over: x ? x.over : false });
    }
    if (!s) {
      return `<section class="card budget">
        <div class="card-head"><h3>每日预算</h3><span class="muted">RM ${fmt(daily, 0)} / 天</span></div>
        <p class="empty">再记录一天，就能算出每天花了多少。</p></section>`;
    }
    const inflow = s.spend < -0.004;
    const left = s.budget - s.spend;
    const pct = s.budget > 0 ? Math.min(100, Math.max(0, (s.spend / s.budget) * 100)) : s.spend > 0 ? 100 : 0;
    const when = relDay(date);
    return `<section class="card budget ${s.over ? 'over' : 'ok'}">
      <div class="budget-top">
        <div class="status-icon" aria-hidden="true">${s.over
          ? '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 16.500v.500"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M6.500 12.500l3.500 3.500 7.500-8"/></svg>'}</div>
        <div class="budget-main">
          <span class="eyebrow">${when}的花费${s.overridden ? ' · 已手动修正' : ''}</span>
          <div class="budget-num">${inflow ? `<span class="inflow">现金增加 RM ${fmt(-s.spend)}</span>` : money(s.spend)}</div>
          <span class="budget-state">${s.over ? `超出预算 RM ${fmt(-left)}` : inflow ? '没有花费记录' : `预算内 · 还剩 RM ${fmt(left)}`}</span>
        </div>
        <button type="button" class="btn mini" id="fix-spend">修正</button>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="budget-foot">
        <span>预算 RM ${fmt(s.budget, 0)}${s.days > 1 ? `（距上次记录 ${s.days} 天）` : ' / 天'}</span>
        <span>${state.accounts.some((a) => !a.deleted && CF.spendsViaDebt(a)) ? '个人现金 + 信用卡 / 分期' : '只看个人可用现金'}</span>
      </div>
      ${Charts.spendBars(week, daily)}
    </section>`;
  }

  function openSpendFix(date) {
    const s = CF.spendOf(state, date);
    openSheet({
      title: `修正${relDay(date)}的花费`,
      intro: `自动推算：个人可用现金比上次记录${s.auto >= 0 ? '少了' : '多了'} <b>RM ${fmt(Math.abs(s.auto))}</b>。<br>如果当天有转账、收款等变动，可以在这里填实际花费。`,
      fields: [{ key: 'spend', label: '实际花费', type: 'money', value: s.overridden ? s.spend : Math.max(0, s.auto) }],
      onSave: (v) => {
        const n = parseNum(v.spend);
        if (n === null) { toast('请输入金额'); return false; }
        state.snapshots[date].spendOverride = n;
        save(); render();
      },
      onDelete: s.overridden ? () => { state.snapshots[date].spendOverride = null; save(); render(); } : null,
      deleteLabel: '恢复自动计算',
    });
  }

  /* =====================================================
     每日输入
     ===================================================== */
  function renderEntry() {
    const today = todayStr();
    const date = ui.entryDate || today;
    const existing = state.snapshots[date];
    const prev = CF.prevSnapshotDate(state, date);
    const prevBal = prev ? state.snapshots[prev].balances : {};
    // 输入到一半切去别的页面再回来，数字还在
    const draft = ui.draft && ui.draft.date === date ? ui.draft.values : null;
    // 还没有任何记录时，用预先帮你填好的负债数字
    const base = draft || (existing ? existing.balances : prev ? prevBal : (state.seedBalances || {}));
    const accounts = activeAccounts();
    const assetAccounts = accounts.filter((a) => a.type !== 'debt');
    const debtAccounts = accounts.filter((a) => a.type === 'debt');
    const entryRow = (a) => {
      const ty = typeOf(a.type);
      return `<label class="entry-row" data-id="${a.id}">
            ${logo(a.name, a.domain)}
            <div class="row-main"><strong>${esc(a.name)}</strong>
              <small><i class="type-dot" style="background:${ty.color}"></i>${ty.short}<em class="row-delta"></em></small></div>
            <div class="in-money"><span>RM</span><input type="text" inputmode="decimal" enterkeyhint="next" name="${a.id}"
              value="${esc(draft ? (draft[a.id] == null ? '' : draft[a.id]) : numStr(base[a.id]))}" placeholder="0.00" aria-label="${esc(a.name)} ${a.type === 'debt' ? '还欠' : '余额'}"></div>
          </label>`;
    };

    view.innerHTML = `
      <section class="card entry-head">
        <label class="date-pick">
          <span>${date === today ? '今天' : '日期'}</span>
          <input type="date" id="entry-date" value="${date}" max="${today}">
        </label>
        <p class="muted">${existing ? '这一天已经记录过，可以直接修改。' : prev ? `已填好${relDay(prev)}的数字，只改有变动的就好。` : '输入每个账户现在的余额。'}</p>
      </section>

      <form id="entry-form" autocomplete="off" class="entry-form">
        <div class="card entry-list">
          ${assetAccounts.map(entryRow).join('')}
          ${accounts.length ? '' : '<p class="empty">还没有账户，先到设置里添加。</p>'}
        </div>
        ${debtAccounts.length ? `<h3 class="entry-group">负债 · 填还欠多少</h3>
        <div class="card entry-list">${debtAccounts.map(entryRow).join('')}</div>` : ''}
      </form>

      <div class="savebar">
        <div class="savebar-sum">
          <span>合计</span><strong id="entry-total">RM 0.00</strong>
          <small id="entry-diff"></small>
        </div>
        <button type="submit" form="entry-form" class="btn primary">保存</button>
      </div>`;

    const form = $('#entry-form');
    const recalc = () => {
      let total = 0, spent = 0;
      for (const a of accounts) {
        const v = parseNum(form.elements[a.id].value) || 0;
        if (a.type !== 'debt') total += v;
        const had = prev && a.id in prevBal;
        const d = had ? v - (Number(prevBal[a.id]) || 0) : 0;
        // 和总览的每日花费用同一套算法
        if (a.type === 'personal') spent -= d;
        else if (CF.spendsViaDebt(a)) spent += d;
        const em = $(`[data-id="${a.id}"] .row-delta`, form);
        em.textContent = Math.abs(d) > 0.004 ? ` · ${signed(d)}` : '';
        // 负债增加是坏事，颜色反过来
        const bad = a.type === 'debt' ? d > 0 : d < 0;
        em.className = 'row-delta ' + (bad ? 'down' : 'up');
      }
      $('#entry-total').textContent = 'RM ' + fmt(total);
      $('#entry-diff').textContent = prev ? (spent >= 0 ? `这次约花了 RM ${fmt(spent)}` : `个人现金多了 RM ${fmt(-spent)}`) : '';
    };
    form.addEventListener('input', () => {
      const values = {};
      for (const a of accounts) values[a.id] = form.elements[a.id].value;
      ui.draft = { date, values };
      recalc();
    });
    form.addEventListener('focusin', (e) => { if (e.target.select) e.target.select(); });
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const inputs = $$('input', form);
      const i = inputs.indexOf(e.target);
      if (i > -1 && i < inputs.length - 1) { e.preventDefault(); inputs[i + 1].focus(); }
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      // 先保留这一天原有的数字（包括已删除账户的），再写入这次输入的
      const balances = Object.assign({}, existing ? existing.balances : {});
      for (const a of accounts) balances[a.id] = parseNum(form.elements[a.id].value) || 0;
      state.snapshots[date] = { balances, spendOverride: existing && typeof existing.spendOverride === 'number' ? existing.spendOverride : null };
      save();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      ui.entryDate = null;
      ui.draft = null;
      toast(date === today ? '已保存今天的余额 ✓' : `已保存 ${date}`);
      location.hash = '#home';
    };
    $('#entry-date').onchange = (e) => { ui.entryDate = e.target.value || today; ui.draft = null; renderEntry(); };
    recalc();
  }

  /* =====================================================
     固定开销与订阅
     ===================================================== */
  const BILL_CATS = ['住房', '贷款', '信用卡 / 分期', '网络通讯', '订阅服务', '保险', '水电', '其他'];

  function monthNav(ym, key) {
    return `<div class="month-nav">
      <button type="button" data-month="-1" aria-label="上个月">‹</button>
      <strong>${monthLabel(ym)}</strong>
      <button type="button" data-month="1" aria-label="下个月">›</button>
    </div>`;
  }
  function bindMonthNav(key) {
    $$('[data-month]').forEach((b) => (b.onclick = () => { ui[key] = CF.addMonths(ui[key], Number(b.dataset.month)); render(); }));
  }

  function renderBills() {
    const today = todayStr();
    const ym = ui.billsYm || (ui.billsYm = today.slice(0, 7));
    const sum = CF.billSummary(state, ym);
    const pct = sum.total > 0 ? (sum.paid / sum.total) * 100 : 0;
    const isCurrent = ym === today.slice(0, 7);
    const row = (r) => {
      const left = CF.diffDays(today, r.due);
      const remindDays = CF.remindDays(state);
      const status = r.paid ? '<span class="tag ok">✓ 已付</span>'
        : r.amount > 0 && isCurrent && left <= remindDays ? dueText(left) : '';
      return `<li class="row ${r.paid ? 'paid' : ''}">
        <button type="button" class="check ${r.paid ? 'on' : ''}" data-pay="${r.bill.id}" aria-pressed="${r.paid}" aria-label="${esc(r.bill.name)} 标记为${r.paid ? '未付' : '已付'}">
          <svg viewBox="0 0 24 24"><path d="M6.500 12.500l3.500 3.500 7.500-8"/></svg></button>
        <button type="button" class="row-body" data-edit="${r.bill.id}">
          ${logo(r.bill.name, r.bill.domain)}
          <div class="row-main"><strong>${esc(r.bill.name)}</strong>
            <small>每月 ${r.bill.day} 日 · ${(() => { const n = CF.billLeft(r.bill, ym); return n ? `还剩 ${n} 期` : esc(r.bill.category || '其他'); })()} ${status}</small></div>
          <div class="row-amt ${r.amount ? '' : 'zero'}">${r.amount ? 'RM ' + fmt(r.amount) : '填金额'}${r.customAmount && r.bill.amount ? '<small>本月调整</small>' : ''}</div>
        </button></li>`;
    };
    const isRepay = (r) => CF.REPAY_CATS.includes(r.bill.category);
    const repay = sum.rows.filter(isRepay);
    const fixed = sum.rows.filter((r) => !isRepay(r) && r.bill.category !== '订阅服务');
    const subs = sum.rows.filter((r) => r.bill.category === '订阅服务');
    const group = (title, rows, cat) => `<section class="card">
      <div class="card-head"><h3>${title}</h3><span class="muted">RM ${fmt(rows.reduce((a, r) => a + r.amount, 0))}</span></div>
      <ul class="rows">${rows.map(row).join('') || '<li class="empty">还没有项目</li>'}</ul>
      <button type="button" class="btn add" data-add="${cat}">＋ 添加${title}</button>
    </section>`;

    view.innerHTML = `
      ${monthNav(ym)}
      <section class="card summary">
        <span class="eyebrow">本月要付的钱</span>
        ${money(sum.total, 'sum-num')}
        <div class="bar good"><i style="width:${pct}%"></i></div>
        <div class="sum-split">
          <div><span>已付</span><b>RM ${fmt(sum.paid)}</b></div>
          <div><span>未付</span><b class="${sum.unpaid > 0 ? 'accent' : ''}">RM ${fmt(sum.unpaid)}</b></div>
        </div>
      </section>
      ${group('还款', repay, '信用卡 / 分期')}
      ${group('固定开销', fixed, '其他')}
      ${group('订阅服务', subs, '订阅服务')}`;

    bindMonthNav('billsYm');
    $$('[data-pay]').forEach((b) => (b.onclick = () => {
      const m = state.billMonths[ym] || (state.billMonths[ym] = {});
      const rec = m[b.dataset.pay] || (m[b.dataset.pay] = {});
      rec.paid = !rec.paid;
      haptic();
      save(); render();
    }));
    $$('[data-edit]').forEach((b) => (b.onclick = () => editBill(b.dataset.edit, ym)));
    $$('[data-add]').forEach((b) => (b.onclick = () => editBill(null, ym, b.dataset.add)));
  }

  function editBill(id, ym, newCat) {
    const bill = id ? state.bills.find((b) => b.id === id) : { name: '', amount: '', day: 1, category: newCat, domain: '' };
    const rec = (id && state.billMonths[ym] && state.billMonths[ym][id]) || {};
    openSheet({
      title: id ? '编辑开销' : '添加开销',
      fields: [
        { key: 'name', label: '名称', value: bill.name, placeholder: '例如 租金、Spotify' },
        { key: 'category', label: '类别', type: 'select', value: bill.category || '其他', options: BILL_CATS.map((c) => ({ value: c, label: c })) },
        { key: 'amount', label: '每月金额（默认）', type: 'money', value: bill.amount },
        ...(id ? [{ key: 'month', label: `${monthLabel(ym)}的金额`, type: 'money', value: typeof rec.amount === 'number' ? rec.amount : '', placeholder: '留空 = 用默认金额', hint: '这个月金额不一样时填这里，只影响这个月。' }] : []),
        { key: 'day', label: '扣款日（每月几号）', type: 'int', value: bill.day },
        { key: 'until', label: '最后一期（分期用，可留空）', type: 'month', value: bill.until || '', hint: '过了这个月就不再出现、也不再提醒。' },
        { key: 'domain', label: '品牌网址（用来抓 logo，可留空）', value: bill.domain, placeholder: '例如 spotify.com' },
      ],
      onSave: (v) => {
        if (!v.name.trim()) { toast('请填写名称'); return false; }
        const data = {
          name: v.name.trim(), category: v.category, amount: parseNum(v.amount) || 0,
          day: Math.min(31, Math.max(1, parseInt(v.day, 10) || 1)), domain: cleanDomain(v.domain),
        };
        if (/^\d{4}-\d{2}$/.test(v.until || '')) data.until = v.until; else delete bill.until;
        if (id) {
          Object.assign(bill, data);
          const m = state.billMonths[ym] || (state.billMonths[ym] = {});
          const r = m[id] || (m[id] = {});
          const mv = parseNum(v.month);
          if (mv === null) delete r.amount; else r.amount = mv;
        } else state.bills.push(Object.assign({ id: CF.uid() }, data));
        save(); render();
      },
      onDelete: id ? () => {
        if (!confirm(`删除「${bill.name}」？各月的付款记录也会一起删除。`)) return false;
        state.bills = state.bills.filter((b) => b.id !== id);
        for (const m of Object.values(state.billMonths)) delete m[id];
        save(); render();
      } : null,
    });
  }

  /* =====================================================
     收入（仅参照）
     ===================================================== */
  function renderIncome() {
    const today = todayStr();
    const ym = ui.incomeYm || (ui.incomeYm = today.slice(0, 7));
    const rows = CF.incomeForMonth(state, ym);
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const got = rows.filter((r) => r.paid).reduce((a, r) => a + r.amount, 0);
    const older = ym === today.slice(0, 7) ? CF.overdueIncome(state, today).filter((r) => r.ym !== ym) : [];
    const row = (r, showMonth) => {
      const late = !r.paid && r.amount > 0 && r.due < today ? CF.diffDays(r.due, today) : 0;
      const status = r.paid ? '<span class="tag ok">✓ 已收</span>' : late ? `<span class="tag warn">⚠ 逾期 ${late} 天</span>` : '<span class="tag">待收</span>';
      return `<li class="row ${r.paid ? 'paid' : ''}">
        <button type="button" class="check ${r.paid ? 'on' : ''}" data-got="${r.client.id}" data-ym="${r.ym}" aria-pressed="${r.paid}" aria-label="${esc(r.client.name)} 标记为${r.paid ? '未收' : '已收'}">
          <svg viewBox="0 0 24 24"><path d="M6.500 12.500l3.500 3.500 7.500-8"/></svg></button>
        <button type="button" class="row-body" data-client="${r.client.id}" data-ym="${r.ym}">
          ${logo(r.client.name, r.client.domain)}
          <div class="row-main"><strong>${esc(r.client.name)}</strong>
            <small>${showMonth ? monthLabel(r.ym) + ' · ' : ''}${Number(r.due.slice(8))} 日到期 ${status}</small></div>
          <div class="row-amt ${r.amount ? '' : 'zero'}">${r.amount ? 'RM ' + fmt(r.amount) : '填金额'}</div>
        </button></li>`;
    };

    view.innerHTML = `
      ${monthNav(ym)}
      <section class="card summary">
        <span class="eyebrow">本月应收</span>
        ${money(total, 'sum-num')}
        <div class="bar good"><i style="width:${total > 0 ? (got / total) * 100 : 0}%"></i></div>
        <div class="sum-split">
          <div><span>已收</span><b>RM ${fmt(got)}</b></div>
          <div><span>待收</span><b class="${total - got > 0 ? 'accent' : ''}">RM ${fmt(total - got)}</b></div>
        </div>
        <p class="fine">收入只作参照，不会加进每日余额的计算。</p>
      </section>
      <section class="card">
        <div class="card-head"><h3>客户</h3></div>
        <ul class="rows">${rows.map((r) => row(r)).join('') || '<li class="empty">还没有客户，添加第一位吧。</li>'}</ul>
        <button type="button" class="btn add" id="add-client">＋ 添加客户</button>
      </section>
      ${older.length ? `<section class="card">
        <div class="card-head"><h3>往月未收</h3></div>
        <ul class="rows">${older.map((r) => row(r, true)).join('')}</ul>
      </section>` : ''}`;

    bindMonthNav('incomeYm');
    $$('[data-got]').forEach((b) => (b.onclick = () => {
      const m = state.incomeMonths[b.dataset.ym] || (state.incomeMonths[b.dataset.ym] = {});
      const rec = m[b.dataset.got] || (m[b.dataset.got] = {});
      rec.paid = !rec.paid;
      haptic();
      save(); render();
    }));
    $$('[data-client]').forEach((b) => (b.onclick = () => editClient(b.dataset.client, b.dataset.ym)));
    $('#add-client').onclick = () => editClient(null, ym);
  }

  function editClient(id, ym) {
    const c = id ? state.clients.find((x) => x.id === id) : { name: '', amount: '', dueDay: 28, domain: '' };
    const rec = (id && state.incomeMonths[ym] && state.incomeMonths[ym][id]) || {};
    openSheet({
      title: id ? '编辑客户' : '添加客户',
      fields: [
        { key: 'name', label: '客户名称', value: c.name },
        { key: 'amount', label: '每月应收（默认）', type: 'money', value: c.amount },
        ...(id ? [{ key: 'month', label: `${monthLabel(ym)}的应收`, type: 'money', value: typeof rec.amount === 'number' ? rec.amount : '', placeholder: '留空 = 用默认金额', hint: '这个月金额不同时填这里；这个月没有合作就填 0。' }] : []),
        { key: 'dueDay', label: '应付款日（每月几号）', type: 'int', value: c.dueDay },
        { key: 'domain', label: '客户网址（用来抓 logo，可留空）', value: c.domain, placeholder: '例如 brand.com' },
      ],
      onSave: (v) => {
        if (!v.name.trim()) { toast('请填写客户名称'); return false; }
        const data = { name: v.name.trim(), amount: parseNum(v.amount) || 0, dueDay: Math.min(31, Math.max(1, parseInt(v.dueDay, 10) || 28)), domain: cleanDomain(v.domain) };
        if (id) {
          Object.assign(c, data);
          const m = state.incomeMonths[ym] || (state.incomeMonths[ym] = {});
          const r = m[id] || (m[id] = {});
          const mv = parseNum(v.month);
          if (mv === null) delete r.amount; else r.amount = mv;
        } else state.clients.push(Object.assign({ id: CF.uid(), since: ym }, data));
        save(); render();
      },
      onDelete: id ? () => {
        if (!confirm(`删除客户「${c.name}」和所有月份的记录？`)) return false;
        state.clients = state.clients.filter((x) => x.id !== id);
        for (const m of Object.values(state.incomeMonths)) delete m[id];
        save(); render();
      } : null,
    });
  }

  /* =====================================================
     设置
     ===================================================== */
  function renderSettings() {
    const s = state.settings;
    const accounts = activeAccounts();
    const perm = Native ? (Native.notificationsAllowed() ? 'granted' : 'default')
      : 'Notification' in window ? Notification.permission : 'unsupported';
    const standalone = matchMedia('(display-mode: standalone)').matches;
    const notifState = perm === 'unsupported' ? '此浏览器不支持通知'
      : perm === 'denied' ? '通知权限已被拒绝，请到浏览器的网站设置里重新允许'
      : s.reminderEnabled && perm === 'granted' ? `已开启 · 每天 ${s.reminderTime}` : '未开启';

    view.innerHTML = `
      <section class="card">
        <h3>每日预算</h3>
        <label class="field inline"><span>个人每日预算</span>
          <div class="in-money"><span>RM</span><input id="set-budget" type="text" inputmode="decimal" value="${esc(numStr(s.dailyBudget))}"></div></label>
      </section>

      <section class="card">
        <h3>隐私</h3>
        <label class="field inline"><span>打开 App 时隐藏金额</span>
          <input id="set-hide" type="checkbox" class="switch" role="switch" ${s.hideAmounts ? 'checked' : ''}></label>
        <p class="fine">开启后，每次打开都先显示 ••••，点右上角的眼睛或总资产才显示数字。离开 App 超过一分钟会重新隐藏。</p>
      </section>

      <section class="card">
        <div class="card-head"><h3>账户</h3><span class="muted">${accounts.length} 个</span></div>
        <ul class="rows">${accounts.map((a, i) => {
          const ty = typeOf(a.type);
          return `<li class="row">
            <button type="button" class="row-body" data-acc="${a.id}">
              ${logo(a.name, a.domain)}
              <div class="row-main"><strong>${esc(a.name)}</strong><small><i class="type-dot" style="background:${ty.color}"></i>${ty.label}</small></div>
            </button>
            <div class="reorder">
              <button type="button" data-move="-1" data-id="${a.id}" ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
              <button type="button" data-move="1" data-id="${a.id}" ${i === accounts.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
            </div></li>`;
        }).join('')}</ul>
        <button type="button" class="btn add" id="add-acc">＋ 添加账户</button>
        ${CF.missingDebtPresets(state).length ? `<button type="button" class="btn add" id="add-debts">＋ 一键添加常用负债（${CF.missingDebtPresets(state).map((p) => esc(p.name)).join('、')}）</button>` : ''}
      </section>

      <section class="card">
        <h3>提醒</h3>
        <p class="muted">${notifState}</p>
        <label class="field inline"><span>每日提醒时间</span><input id="set-time" type="time" value="${esc(s.reminderTime)}"></label>
        <label class="field inline"><span>扣款日前几天提醒</span><input id="set-days" type="number" inputmode="numeric" min="0" max="15" value="${esc(s.billRemindDays)}"></label>
        <div class="btn-row">
          ${s.reminderEnabled && perm === 'granted'
            ? '<button type="button" class="btn" id="notif-test">发一条测试通知</button><button type="button" class="btn ghost" id="notif-off">关闭通知</button>'
            : `<button type="button" class="btn primary" id="notif-on" ${perm === 'unsupported' ? 'disabled' : ''}>开启通知</button>`}
        </div>
        ${Native ? '<p class="fine">提醒由手机系统的闹钟发出，App 关闭后也会响。如果收不到，请在系统设置里允许暖流的通知，并把它从“休眠应用”里移除。</p>' : ''}
        <div class="callout" ${Native ? 'hidden' : ''}>
          <strong>关于通知的可靠性</strong>
          <p>网页 App 没有自己的服务器时，安卓不保证准时推送：App 开着或刚在后台时会准时提醒；完全关闭后，要靠系统的“定期后台同步”，时间由系统决定，可能延迟或不触发${ui.periodic === false ? '（当前环境未授予后台同步，需要先安装到主屏幕）' : ''}。</p>
          <p>想要每天 ${esc(s.reminderTime)} <b>一定</b>响，建议再加一个日历提醒，点通知里的链接就能直接打开输入页：</p>
          <div class="btn-row">
            <a class="btn" id="cal-google" target="_blank" rel="noopener">加到 Google 日历</a>
            <button type="button" class="btn ghost" id="cal-ics">下载日历文件 (.ics)</button>
          </div>
        </div>
      </section>

      <section class="card">
        <h3>备份</h3>
        <p class="muted">数据只存在这台手机里。建议定期导出一份备份。</p>
        <div class="btn-row">
          <button type="button" class="btn" id="exp-json">导出备份 (JSON)</button>
          <button type="button" class="btn" id="exp-csv">导出表格 (CSV)</button>
          <button type="button" class="btn ghost" id="imp-json">导入备份</button>
        </div>
        <input type="file" id="imp-file" accept="application/json,.json" hidden>
      </section>

      <section class="card" ${Native ? 'hidden' : ''}>
        <h3>安装到主屏幕</h3>
        ${standalone ? '<p class="muted">已经作为 App 安装 ✓</p>'
          : ui.installEvt ? '<button type="button" class="btn primary" id="install">安装暖流</button>'
          : '<p class="muted">在 Chrome 或 Samsung Internet 的菜单里选择“添加到主屏幕 / 安装应用”。安装后通知和离线使用会更稳定。</p>'}
        <p class="fine">暖流 · 第一版 · 所有数据仅保存在本机</p>
      </section>`;

    $('#set-budget').onchange = (e) => { state.settings.dailyBudget = Math.max(0, parseNum(e.target.value) || 0); save(); toast('已更新每日预算'); };
    $('#set-hide').onchange = (e) => { state.settings.hideAmounts = e.target.checked; haptic(); save(); };
    $('#set-time').onchange = (e) => { state.settings.reminderTime = e.target.value || '21:00'; save(); scheduleReminder(); render(); };
    $('#set-days').onchange = (e) => { state.settings.billRemindDays = Math.min(15, Math.max(0, parseInt(e.target.value, 10) || 0)); save(); };

    $$('[data-acc]').forEach((b) => (b.onclick = () => editAccount(b.dataset.acc)));
    $('#add-acc').onclick = () => editAccount(null);
    const addDebts = $('#add-debts');
    if (addDebts) addDebts.onclick = () => {
      const list = CF.missingDebtPresets(state);
      if (!confirm(`添加这 ${list.length} 个负债账户？\n${list.map((p) => '· ' + p.name).join('\n')}\n\n之后可以改名或删除不需要的。`)) return;
      const n = CF.addDebtPresets(state);
      save(); haptic(); toast(`已添加 ${n} 个负债账户`); render();
    };
    $$('[data-move]').forEach((b) => (b.onclick = () => {
      const list = activeAccounts();
      const i = list.findIndex((a) => a.id === b.dataset.id);
      const j = i + Number(b.dataset.move);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      state.accounts = list.concat(state.accounts.filter((a) => a.deleted));
      save(); render();
    }));

    const on = $('#notif-on'), off = $('#notif-off'), test = $('#notif-test');
    if (on) on.onclick = enableReminders;
    if (off) off.onclick = () => { state.settings.reminderEnabled = false; save(); render(); };
    if (test) test.onclick = async () => {
      if (Native) { Native.testNotification(); return; }
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('暖流测试通知', { body: '看到这条就代表通知可以正常显示。', icon: './icons/icon-192.png', badge: './icons/badge.png', tag: 'test', data: { hash: '#entry' } });
    };

    $('#cal-google').href = googleCalendarUrl();
    $('#cal-ics').onclick = () => download('nuanliu-reminder.ics', buildIcs(), 'text/calendar');

    $('#exp-json').onclick = () => download(`nuanliu-backup-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
    $('#exp-csv').onclick = () => download(`nuanliu-${todayStr()}.csv`, buildCsv(), 'text/csv;charset=utf-8');
    $('#imp-json').onclick = () => $('#imp-file').click();
    $('#imp-file').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || !Array.isArray(data.accounts) || typeof data.snapshots !== 'object') throw new Error('format');
        const n = Object.keys(data.snapshots).length;
        if (!confirm(`导入这份备份（${data.accounts.length} 个账户、${n} 天记录）？\n现在手机里的数据会被完全替换。`)) return;
        state = CF.normalize(data);
        await save();
        ui.shownTotal = 0;
        toast('导入完成 ✓');
        location.hash = '#home';
        render();
      } catch (err) {
        toast('导入失败：这不是暖流的备份文件');
      }
    };

    const inst = $('#install');
    if (inst) inst.onclick = async () => { ui.installEvt.prompt(); await ui.installEvt.userChoice; ui.installEvt = null; render(); };
  }

  function editAccount(id) {
    const a = id ? state.accounts.find((x) => x.id === id) : { name: '', type: 'personal', domain: '' };
    const spendOpts = [{ value: 'yes', label: '算（信用卡、分期、贷款）' }, { value: 'no', label: '不算' }];
    openSheet({
      title: id ? '编辑账户' : '添加账户',
      fields: [
        { key: 'name', label: '账户名称', value: a.name, placeholder: '例如 CIMB 个人' },
        { key: 'type', label: '类型', type: 'select', value: a.type, options: CF.TYPES.map((t) => ({ value: t.id, label: t.label })), hint: '只有“个人可用现金”会用来推算每日花费。负债（例如 PTPTN）填还欠多少钱，不计入总资产。' },
        { key: 'domain', label: '品牌网址（用来抓 logo，可留空）', value: a.domain, placeholder: '例如 cimb.com.my' },
        { key: 'spend', label: '负债的增减算进每日花费吗？（只对负债有效）', type: 'select', value: a.excludeSpend ? 'no' : 'yes', options: spendOpts,
          hint: '算：刷卡、分期买东西算花费；用现金还款不算花费（钱只是从现金搬去还债）。' },
      ],
      onSave: (v) => {
        if (!v.name.trim()) { toast('请填写账户名称'); return false; }
        const data = { name: v.name.trim(), type: v.type, domain: cleanDomain(v.domain) };
        if (v.type === 'debt' && v.spend === 'no') data.excludeSpend = true;
        else delete a.excludeSpend;
        if (id) Object.assign(a, data);
        else {
          const firstDeleted = state.accounts.findIndex((x) => x.deleted);
          const item = Object.assign({ id: CF.uid() }, data);
          if (firstDeleted < 0) state.accounts.push(item); else state.accounts.splice(firstDeleted, 0, item);
        }
        save(); render();
      },
      onDelete: id ? () => {
        if (!confirm(`删除「${a.name}」？\n它不会再出现在每日输入里；过去的记录会保留，历史总资产不变。`)) return false;
        a.deleted = true;
        save(); render();
      } : null,
    });
  }

  /* ---------- 导出 ---------- */
  function buildCsv() {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ['日期', ...state.accounts.map((a) => a.name + (a.deleted ? '（已删除）' : '')), ...CF.TYPES.map((t) => t.label), '总资产', '净资产', '当日花费'];
    const lines = [head.map(q).join(',')];
    for (const d of CF.snapshotDates(state)) {
      const snap = state.snapshots[d], t = CF.totalsOf(state, d), s = CF.spendOf(state, d);
      lines.push([d, ...state.accounts.map((a) => (snap.balances[a.id] === undefined ? '' : snap.balances[a.id])),
        ...CF.TYPES.map((ty) => t[ty.id].toFixed(2)), t.total.toFixed(2), t.net.toFixed(2), s ? s.spend.toFixed(2) : ''].join(','));
    }
    return '﻿' + lines.join('\r\n');
  }

  /* ---------- 日历提醒（替代方案） ---------- */
  const appUrl = () => location.origin + location.pathname + '#entry';
  function reminderStamp() {
    const [h, m] = String(state.settings.reminderTime || '21:00').split(':');
    const d = todayStr().replace(/-/g, '');
    const end = String(Math.min(59, Number(m) + 5)).padStart(2, '0');
    return { start: `${d}T${h}${m}00`, end: `${d}T${h}${end}00` };
  }
  function googleCalendarUrl() {
    const { start, end } = reminderStamp();
    const p = new URLSearchParams({
      action: 'TEMPLATE', text: '暖流：记录今天的余额', details: `打开输入页：${appUrl()}`,
      dates: `${start}/${end}`, recur: 'RRULE:FREQ=DAILY',
      ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kuala_Lumpur',
    });
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }
  function buildIcs() {
    const { start, end } = reminderStamp();
    // DTSTAMP 按规范必须是 UTC 时间（结尾带 Z）
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nuanliu//Cashflow//ZH', 'BEGIN:VEVENT',
      `UID:nuanliu-daily-${Date.now()}@nuanliu`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${end}`,
      'RRULE:FREQ=DAILY', 'SUMMARY:暖流：记录今天的余额', `DESCRIPTION:打开输入页：${appUrl()}`, `URL:${appUrl()}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:记录今天的余额', 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }

  /* ---------- 通知 ---------- */
  // 原生外壳：权限弹窗有结果后回调这里
  window.onNativeNotif = (granted) => {
    state.settings.reminderEnabled = !!granted;
    save();
    toast(granted ? '通知已开启 ✓' : '没有获得通知权限');
    render();
  };
  window.onNativeSaved = (ok) => toast(ok ? '文件已保存 ✓' : '没有保存');

  async function enableReminders() {
    if (Native) { Native.requestNotifications(); return; }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { toast('此浏览器不支持通知'); return; }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('没有获得通知权限'); render(); return; }
    state.settings.reminderEnabled = true;
    await save();
    await registerPeriodic();
    scheduleReminder();
    toast('通知已开启 ✓');
    render();
  }
  async function registerPeriodic() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!('periodicSync' in reg)) { ui.periodic = false; return; }
      await reg.periodicSync.register('reminder-check', { minInterval: 60 * 60 * 1000 });
      ui.periodic = true;
    } catch (e) { ui.periodic = false; }
  }
  let reminderTimer;
  function askSwToCheck() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({ type: 'reminder-check' });
  }
  function scheduleReminder() {
    clearTimeout(reminderTimer);
    if (!state.settings.reminderEnabled) return;
    const [h, m] = String(state.settings.reminderTime || '21:00').split(':').map(Number);
    const now = new Date();
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m || 0, 5);
    if (at <= now) at.setDate(at.getDate() + 1);
    reminderTimer = setTimeout(() => { askSwToCheck(); scheduleReminder(); }, at - now);
  }

  /* ---------- 路由 ---------- */
  const TABS = {
    home: { title: '总览', render: renderHome },
    entry: { title: '记录余额', render: renderEntry },
    bills: { title: '固定开销', render: renderBills },
    income: { title: '收入', render: renderIncome },
    settings: { title: '设置', render: renderSettings },
  };
  function toggleMask() {
    ui.masked = !ui.masked;
    haptic();
    render();
  }

  const TAB_ORDER = ['home', 'bills', 'entry', 'income', 'settings'];
  /** 左右滑动切换页面 */
  function bindSwipe() {
    let start = null;
    document.addEventListener('touchstart', (e) => {
      start = null;
      if (e.touches.length !== 1 || $('#sheet-root').innerHTML) return;
      // 走势图上的横向滑动是用来看数值的；输入框里是移动光标
      if (e.target.closest('svg.trend, .seg, .tabbar') || e.target === document.activeElement) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      const quick = Date.now() - start.t < 700;
      start = null;
      if (!quick || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2) return;
      const i = TAB_ORDER.indexOf(ui.tab) + (dx < 0 ? 1 : -1);
      if (i < 0 || i >= TAB_ORDER.length) return;
      ui.slide = dx < 0 ? 1 : -1;
      haptic();
      location.hash = '#' + TAB_ORDER[i];
    }, { passive: true });
  }

  function render() {
    Charts.masked = ui.masked;
    document.body.classList.toggle('masked', ui.masked);
    const tab = TABS[ui.tab] ? ui.tab : 'home';
    $('#page-title').textContent = TABS[tab].title;
    $('#nav-title').textContent = TABS[tab].title;
    $('#page-sub').textContent = dayLabel(todayStr());
    $$('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    document.body.dataset.tab = tab;
    TABS[tab].render();
  }
  function onRoute() {
    const tab = location.hash.replace('#', '') || 'home';
    if (tab !== ui.tab) {
      if (tab === 'entry' && !ui.draft) ui.entryDate = null;
      $('#sheet-root').innerHTML = '';
      window.scrollTo(0, 0);
      view.classList.remove('enter', 'slide-next', 'slide-prev');
      void view.offsetWidth;
      view.classList.add(ui.slide > 0 ? 'slide-next' : ui.slide < 0 ? 'slide-prev' : 'enter');
      ui.slide = 0;
    }
    ui.tab = tab;
    render();
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    try {
      const saved = await CF.idbGet('state');
      // 新装的也走一遍 normalize，保证所有设置字段都在
      state = CF.normalize(saved || state);
      if (!saved) await CF.idbSet('state', state);
    } catch (e) {
      toast('无法读取本机存储，数据可能无法保存');
    }
    // 1.5 版起：自动帮你建好常用负债账户（只做一次；已有的会跳过，删掉的不会再加回来）
    if (!state.settings.debtPresetsApplied) {
      const n = CF.addDebtPresets(state);
      state.settings.debtPresetsApplied = true;
      await save();
      if (n && !window.NUANLIU_SEED) setTimeout(() => toast(`已帮你加好 ${n} 个负债账户，到「记录」页填还欠多少`), 900);
    }
    // 打包进 APK 的个人资料（js/seed-data.js，不在 GitHub 上）
    const seeded = CF.applySeed(state, window.NUANLIU_SEED, todayStr());
    if (seeded) {
      await save();
      setTimeout(() => toast(`已填好 ${seeded.accounts} 笔负债和 ${seeded.bills} 项还款计划`), 900);
    }
    ui.masked = !!state.settings.hideAmounts;
    $('#eye').onclick = toggleMask;
    bindSwipe();
    window.addEventListener('hashchange', onRoute);
    const onScroll = () => document.body.classList.toggle('scrolled', window.scrollY > 46);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    ui.tab = null;
    onRoute();

    nativeSync();
    if (!Native && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(() => {
        if (state.settings.reminderEnabled) registerPeriodic();
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'navigate' && e.data.hash) location.hash = e.data.hash;
      });
    }
    scheduleReminder();
    document.addEventListener('visibilitychange', () => {
      // 输入到一半切去银行 App 再回来时，不能重绘把数字清掉
      if (document.visibilityState === 'visible') {
        scheduleReminder();
        const away = Date.now() - (ui.hiddenAt || Date.now());
        if (state.settings.hideAmounts && away > 60000 && !ui.masked) { ui.masked = true; render(); }
        else if (ui.tab === 'home') render();
      } else {
        ui.hiddenAt = Date.now();
        if (ui.tab !== 'entry') askSwToCheck();
      }
    });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installEvt = e; if (ui.tab === 'settings') render(); });
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (ui.tab === 'home') drawTrend(); }, 150); });
  }
  boot();
})();
