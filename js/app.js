/* 暖流 — 应用主逻辑 */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = CF.fmt;
  const view = $('#view');
  const todayStr = () => CF.ymd(new Date());
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = CF.defaultState();
  const ui = { tab: 'home', range: 30, billsYm: null, incomeYm: null, entryDate: null, shownTotal: 0, installEvt: null, periodic: null };

  const save = () => CF.idbSet('state', state).catch(() => toast('保存失败：存储空间不可用'));
  const activeAccounts = () => state.accounts.filter((a) => !a.deleted);
  const typeOf = (id) => CF.TYPES.find((t) => t.id === id) || CF.TYPES[0];

  /* ---------- 小工具 ---------- */
  const parseNum = (v) => {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const numStr = (n) => (n === null || n === undefined || n === '' ? '' : String(Math.round(Number(n) * 100) / 100));
  const money = (n, cls = '') => {
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

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function download(name, text, mime) {
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
    if (reduceMotion || Math.abs(to - from) < 0.005) { el.innerHTML = money(to, 'hero-num'); return; }
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
        <div class="sheet-grip"></div>
        <h2>${esc(title)}</h2>
        ${intro ? `<p class="sheet-intro">${intro}</p>` : ''}
        ${fieldHtml}
        ${extra || ''}
        <div class="sheet-actions">
          ${onDelete ? `<button type="button" class="btn ghost danger" data-act="delete">${esc(deleteLabel)}</button>` : ''}
          <button type="button" class="btn ghost" data-act="cancel">取消</button>
          <button type="submit" class="btn primary">${esc(saveLabel)}</button>
        </div>
      </form>`;
    const close = () => { root.innerHTML = ''; };
    const form = $('.sheet', root);
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
        <section class="card hero welcome">
          <img src="icons/icon.svg" alt="" width="72" height="72">
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

    const due = CF.dueBills(state, today);
    const overdue = CF.overdueIncome(state, today);

    view.innerHTML = `
      ${stale ? `<a class="notice" href="#entry">
        <span class="notice-dot"></span>
        <span>今天还没记录 · 现在显示的是${relDay(latest)}的数字</span><b>去记录 ›</b></a>` : ''}

      <section class="card hero">
        <div class="hero-label">总资产<span>${relDay(latest)}</span></div>
        <div id="hero-total" class="hero-total">${money(ui.shownTotal, 'hero-num')}</div>
        ${delta === null ? '' : `<div class="chip ${delta < 0 ? 'down' : 'up'}">${delta < 0 ? '▼' : '▲'} 较上次记录 ${signed(delta)}</div>`}
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
        ${CF.TYPES.map((ty) => `<div class="card tile">
          <span class="tile-dot" style="background:${ty.color}"></span>
          <span class="tile-label">${ty.label}</span>
          ${money(t[ty.id], 'tile-num')}
          <span class="tile-pct">${t.total > 0 ? ((Math.max(0, t[ty.id]) / t.total) * 100).toFixed(1) : '0.0'}%</span>
        </div>`).join('')}
      </section>

      <section class="card">
        <h3>资产占比</h3>
        <div id="donut" class="donut"></div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3>每日走势</h3>
          <div class="seg" role="group" aria-label="时间范围">
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
    ui.shownTotal = t.total;

    Charts.donut($('#donut'), CF.TYPES.map((ty) => ({ label: ty.short, value: t[ty.id], color: ty.color })), t.total);
    drawTrend();
    $$('[data-range]').forEach((b) => (b.onclick = () => {
      ui.range = Number(b.dataset.range);
      $$('[data-range]').forEach((x) => x.classList.toggle('on', x === b));
      drawTrend();
    }));
    const fix = $('#fix-spend');
    if (fix) fix.onclick = () => openSpendFix(latest);
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
        <span>只看个人可用现金</span>
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
    const base = existing ? existing.balances : prevBal;
    const accounts = activeAccounts();

    view.innerHTML = `
      <section class="card entry-head">
        <label class="date-pick">
          <span>${date === today ? '今天' : '日期'}</span>
          <input type="date" id="entry-date" value="${date}" max="${today}">
        </label>
        <p class="muted">${existing ? '这一天已经记录过，可以直接修改。' : prev ? `已填好${relDay(prev)}的数字，只改有变动的就好。` : '输入每个账户现在的余额。'}</p>
      </section>

      <form id="entry-form" class="card entry-list" autocomplete="off">
        ${accounts.map((a) => {
          const ty = typeOf(a.type);
          return `<label class="entry-row" data-id="${a.id}">
            ${logo(a.name, a.domain)}
            <div class="row-main"><strong>${esc(a.name)}</strong>
              <small><i class="type-dot" style="background:${ty.color}"></i>${ty.short}<em class="row-delta"></em></small></div>
            <div class="in-money"><span>RM</span><input type="text" inputmode="decimal" enterkeyhint="next" name="${a.id}"
              value="${esc(numStr(base[a.id]))}" placeholder="0.00" aria-label="${esc(a.name)} 余额"></div>
          </label>`;
        }).join('')}
        ${accounts.length ? '' : '<p class="empty">还没有账户，先到设置里添加。</p>'}
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
      let total = 0, personal = 0, prevPersonal = 0;
      for (const a of accounts) {
        const v = parseNum(form.elements[a.id].value) || 0;
        total += v;
        if (a.type === 'personal') { personal += v; prevPersonal += Number(prevBal[a.id]) || 0; }
        const d = prev ? v - (Number(prevBal[a.id]) || 0) : 0;
        const em = $(`[data-id="${a.id}"] .row-delta`, form);
        em.textContent = Math.abs(d) > 0.004 ? ` · ${signed(d)}` : '';
        em.className = 'row-delta ' + (d < 0 ? 'down' : 'up');
      }
      $('#entry-total').textContent = 'RM ' + fmt(total);
      const spent = prevPersonal - personal;
      $('#entry-diff').textContent = prev ? (spent >= 0 ? `个人现金少了 RM ${fmt(spent)}` : `个人现金多了 RM ${fmt(-spent)}`) : '';
    };
    form.addEventListener('input', recalc);
    form.addEventListener('focusin', (e) => { if (e.target.select) e.target.select(); });
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const inputs = $$('input', form);
      const i = inputs.indexOf(e.target);
      if (i > -1 && i < inputs.length - 1) { e.preventDefault(); inputs[i + 1].focus(); }
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      const balances = {};
      for (const a of accounts) balances[a.id] = parseNum(form.elements[a.id].value) || 0;
      state.snapshots[date] = { balances, spendOverride: existing && typeof existing.spendOverride === 'number' ? existing.spendOverride : null };
      save();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      ui.entryDate = null;
      toast(date === today ? '已保存今天的余额 ✓' : `已保存 ${date}`);
      location.hash = '#home';
    };
    $('#entry-date').onchange = (e) => { ui.entryDate = e.target.value || today; renderEntry(); };
    recalc();
  }

  /* =====================================================
     固定开销与订阅
     ===================================================== */
  const BILL_CATS = ['住房', '贷款', '网络通讯', '订阅服务', '保险', '水电', '其他'];

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
      const remindDays = Number(state.settings.billRemindDays) || 3;
      const status = r.paid ? '<span class="tag ok">✓ 已付</span>'
        : r.amount > 0 && isCurrent && left <= remindDays ? dueText(left) : '';
      return `<li class="row ${r.paid ? 'paid' : ''}">
        <button type="button" class="check ${r.paid ? 'on' : ''}" data-pay="${r.bill.id}" aria-pressed="${r.paid}" aria-label="${esc(r.bill.name)} 标记为${r.paid ? '未付' : '已付'}">
          <svg viewBox="0 0 24 24"><path d="M6.500 12.500l3.500 3.500 7.500-8"/></svg></button>
        <button type="button" class="row-body" data-edit="${r.bill.id}">
          ${logo(r.bill.name, r.bill.domain)}
          <div class="row-main"><strong>${esc(r.bill.name)}</strong>
            <small>每月 ${r.bill.day} 日 · ${esc(r.bill.category || '其他')} ${status}</small></div>
          <div class="row-amt ${r.amount ? '' : 'zero'}">${r.amount ? 'RM ' + fmt(r.amount) : '填金额'}${r.customAmount ? '<small>本月调整</small>' : ''}</div>
        </button></li>`;
    };
    const fixed = sum.rows.filter((r) => r.bill.category !== '订阅服务');
    const subs = sum.rows.filter((r) => r.bill.category === '订阅服务');
    const group = (title, rows, cat) => `<section class="card">
      <div class="card-head"><h3>${title}</h3><span class="muted">RM ${fmt(rows.reduce((a, r) => a + r.amount, 0))}</span></div>
      <ul class="rows">${rows.map(row).join('') || '<li class="empty">还没有项目</li>'}</ul>
      <button type="button" class="btn add" data-add="${cat}">＋ 添加${title}</button>
    </section>`;

    view.innerHTML = `
      ${monthNav(ym)}
      <section class="card summary">
        <span class="eyebrow">本月固定开销</span>
        ${money(sum.total, 'sum-num')}
        <div class="bar good"><i style="width:${pct}%"></i></div>
        <div class="sum-split">
          <div><span>已付</span><b>RM ${fmt(sum.paid)}</b></div>
          <div><span>未付</span><b class="${sum.unpaid > 0 ? 'accent' : ''}">RM ${fmt(sum.unpaid)}</b></div>
        </div>
      </section>
      ${group('固定开销', fixed, '其他')}
      ${group('订阅服务', subs, '订阅服务')}`;

    bindMonthNav('billsYm');
    $$('[data-pay]').forEach((b) => (b.onclick = () => {
      const m = state.billMonths[ym] || (state.billMonths[ym] = {});
      const rec = m[b.dataset.pay] || (m[b.dataset.pay] = {});
      rec.paid = !rec.paid;
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
        { key: 'domain', label: '品牌网址（用来抓 logo，可留空）', value: bill.domain, placeholder: '例如 spotify.com' },
      ],
      onSave: (v) => {
        if (!v.name.trim()) { toast('请填写名称'); return false; }
        const data = {
          name: v.name.trim(), category: v.category, amount: parseNum(v.amount) || 0,
          day: Math.min(31, Math.max(1, parseInt(v.day, 10) || 1)), domain: cleanDomain(v.domain),
        };
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
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
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
        <div class="callout">
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

      <section class="card">
        <h3>安装到主屏幕</h3>
        ${standalone ? '<p class="muted">已经作为 App 安装 ✓</p>'
          : ui.installEvt ? '<button type="button" class="btn primary" id="install">安装暖流</button>'
          : '<p class="muted">在 Chrome 或 Samsung Internet 的菜单里选择“添加到主屏幕 / 安装应用”。安装后通知和离线使用会更稳定。</p>'}
        <p class="fine">暖流 · 第一版 · 所有数据仅保存在本机</p>
      </section>`;

    $('#set-budget').onchange = (e) => { state.settings.dailyBudget = Math.max(0, parseNum(e.target.value) || 0); save(); toast('已更新每日预算'); };
    $('#set-time').onchange = (e) => { state.settings.reminderTime = e.target.value || '21:00'; save(); scheduleReminder(); render(); };
    $('#set-days').onchange = (e) => { state.settings.billRemindDays = Math.min(15, Math.max(0, parseInt(e.target.value, 10) || 0)); save(); };

    $$('[data-acc]').forEach((b) => (b.onclick = () => editAccount(b.dataset.acc)));
    $('#add-acc').onclick = () => editAccount(null);
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
    openSheet({
      title: id ? '编辑账户' : '添加账户',
      fields: [
        { key: 'name', label: '账户名称', value: a.name, placeholder: '例如 CIMB 个人' },
        { key: 'type', label: '类型', type: 'select', value: a.type, options: CF.TYPES.map((t) => ({ value: t.id, label: t.label })), hint: '只有“个人可用现金”会用来推算每日花费。' },
        { key: 'domain', label: '品牌网址（用来抓 logo，可留空）', value: a.domain, placeholder: '例如 cimb.com.my' },
      ],
      onSave: (v) => {
        if (!v.name.trim()) { toast('请填写账户名称'); return false; }
        const data = { name: v.name.trim(), type: v.type, domain: cleanDomain(v.domain) };
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
    const head = ['日期', ...state.accounts.map((a) => a.name + (a.deleted ? '（已删除）' : '')), ...CF.TYPES.map((t) => t.label), '总资产', '当日花费'];
    const lines = [head.map(q).join(',')];
    for (const d of CF.snapshotDates(state)) {
      const snap = state.snapshots[d], t = CF.totalsOf(state, d), s = CF.spendOf(state, d);
      lines.push([d, ...state.accounts.map((a) => (snap.balances[a.id] === undefined ? '' : snap.balances[a.id])),
        ...CF.TYPES.map((ty) => t[ty.id].toFixed(2)), t.total.toFixed(2), s ? s.spend.toFixed(2) : ''].join(','));
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
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nuanliu//Cashflow//ZH', 'BEGIN:VEVENT',
      `UID:nuanliu-daily-${Date.now()}@nuanliu`, `DTSTAMP:${start}`, `DTSTART:${start}`, `DTEND:${end}`,
      'RRULE:FREQ=DAILY', 'SUMMARY:暖流：记录今天的余额', `DESCRIPTION:打开输入页：${appUrl()}`, `URL:${appUrl()}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:记录今天的余额', 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }

  /* ---------- 通知 ---------- */
  async function enableReminders() {
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
    home: { title: '暖流', render: renderHome },
    entry: { title: '记录余额', render: renderEntry },
    bills: { title: '固定开销', render: renderBills },
    income: { title: '收入', render: renderIncome },
    settings: { title: '设置', render: renderSettings },
  };
  function render() {
    const tab = TABS[ui.tab] ? ui.tab : 'home';
    $('#page-title').textContent = TABS[tab].title;
    $('#page-sub').textContent = dayLabel(todayStr());
    $$('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    document.body.dataset.tab = tab;
    TABS[tab].render();
  }
  function onRoute() {
    const tab = location.hash.replace('#', '') || 'home';
    if (tab !== ui.tab) {
      if (tab === 'entry') ui.entryDate = null;
      $('#sheet-root').innerHTML = '';
      window.scrollTo(0, 0);
      view.classList.remove('enter');
      void view.offsetWidth;
      view.classList.add('enter');
    }
    ui.tab = tab;
    render();
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    try {
      const saved = await CF.idbGet('state');
      if (saved) state = CF.normalize(saved);
      else await CF.idbSet('state', state);
    } catch (e) {
      toast('无法读取本机存储，数据可能无法保存');
    }
    window.addEventListener('hashchange', onRoute);
    ui.tab = null;
    onRoute();

    if ('serviceWorker' in navigator) {
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
      if (document.visibilityState === 'visible') { scheduleReminder(); if (ui.tab === 'home') render(); }
      else if (ui.tab !== 'entry') askSwToCheck();
    });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installEvt = e; if (ui.tab === 'settings') render(); });
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (ui.tab === 'home') drawTrend(); }, 150); });
  }
  boot();
})();
