/* 暖流 — 轻量 SVG 图表（无依赖） */
(function (g) {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => CF.fmt(n);
  const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    if (a >= 1e3) return (n / 1e3).toFixed(2) + 'k';
    return n.toFixed(0);
  };

  /** 环形占比图。segments: [{label,value,color}] */
  function donut(el, segments, total) {
    const size = 168, r = 66, sw = 20, C = 2 * Math.PI * r;
    const pos = segments.filter((s) => s.value > 0);
    const sum = pos.reduce((a, s) => a + s.value, 0);
    const gap = pos.length > 1 ? 3 : 0;
    let acc = 0;
    const arcs = pos.map((s) => {
      const len = (s.value / sum) * C;
      const draw = Math.max(1, len - gap);
      const arc = `<circle class="donut-seg" data-label="${esc(s.label)}" data-value="${s.value}" cx="${size / 2}" cy="${size / 2}" r="${r}"
        fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${draw} ${C - draw}" stroke-dashoffset="${-acc - gap / 2}"/>`;
      acc += len;
      return arc;
    }).join('');
    el.innerHTML = `
      <div class="donut-wrap">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="资产占比环形图">
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(120,80,50,.08)" stroke-width="${sw}"/>
          <g class="donut-arcs"><g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g></g>
        </svg>
        <div class="donut-center"><span class="dc-label">总资产</span><span class="dc-value">RM ${compact(total)}</span><span class="dc-pct"></span></div>
      </div>
      <ul class="legend">
        ${segments.map((s) => `<li data-label="${esc(s.label)}">
          <i style="background:${s.color}"></i><span class="lg-name">${esc(s.label)}</span>
          <span class="lg-val">RM ${fmt(s.value)}</span>
          <span class="lg-pct">${sum > 0 ? ((Math.max(0, s.value) / sum) * 100).toFixed(1) : '0.0'}%</span></li>`).join('')}
      </ul>`;
    const center = el.querySelector('.donut-center');
    const set = (label) => {
      const s = segments.find((x) => x.label === label);
      el.querySelectorAll('.donut-seg').forEach((c) => c.classList.toggle('dim', !!s && c.dataset.label !== label));
      el.querySelectorAll('.legend li').forEach((c) => c.classList.toggle('on', !!s && c.dataset.label === label));
      center.querySelector('.dc-label').textContent = s ? s.label : '总资产';
      center.querySelector('.dc-value').textContent = 'RM ' + compact(s ? s.value : total);
      center.querySelector('.dc-pct').textContent = s && sum > 0 ? ((Math.max(0, s.value) / sum) * 100).toFixed(1) + '%' : '';
    };
    let current = null;
    el.onclick = (e) => {
      const t = e.target.closest('[data-label]');
      current = t && t.dataset.label !== current ? t.dataset.label : null;
      set(current);
    };
  }

  /** 走势图：两个共用时间轴的小图（不同量级不共用 Y 轴）。points: [{date,total,cash}] */
  function trend(el, points) {
    if (!points.length) {
      el.innerHTML = '<p class="empty">还没有记录，输入第一天的余额后这里会出现走势。</p>';
      return;
    }
    const W = Math.max(280, el.clientWidth || 320);
    const padL = 6, padR = 6, headH = 26, plotH = 92, gapY = 22, axisH = 20;
    const series = [
      { key: 'total', name: '总资产', color: '#F08A3C' },
      { key: 'cash', name: '个人可用现金', color: '#EC6A45' },
    ];
    const H = series.length * (headH + plotH) + gapY * (series.length - 1) + axisH;
    const t0 = CF.parseYmd(points[0].date).getTime();
    const t1 = CF.parseYmd(points[points.length - 1].date).getTime();
    const xOf = (p) => (t1 === t0 ? W / 2 : padL + ((CF.parseYmd(p.date).getTime() - t0) / (t1 - t0)) * (W - padL - padR));
    const xs = points.map(xOf);
    const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

    let body = '';
    const panels = series.map((s, i) => {
      const top = i * (headH + plotH + gapY) + headH;
      const vals = points.map((p) => p[s.key]);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi - lo < 1) { lo -= 1; hi += 1; }
      const padV = (hi - lo) * 0.12;
      const yOf = (v) => top + 6 + (1 - (v - (lo - padV)) / (hi - lo + 2 * padV)) * (plotH - 12);
      const ys = vals.map(yOf);
      const line = xs.map((x, k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${ys[k].toFixed(1)}`).join('');
      const area = `${line}L${xs[xs.length - 1].toFixed(1)},${top + plotH}L${xs[0].toFixed(1)},${top + plotH}Z`;
      body += `
        <text x="${padL}" y="${top - 9}" class="tc-name"><tspan fill="${s.color}">● </tspan>${s.name}</text>
        <text x="${W - padR}" y="${top - 9}" text-anchor="end" class="tc-val" data-val="${s.key}">RM ${fmt(vals[vals.length - 1])}</text>
        ${[hi, lo].map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${yOf(v).toFixed(1)}" y2="${yOf(v).toFixed(1)}" class="tc-grid"/>
          <text x="${padL}" y="${(yOf(v) + (v === hi ? 12 : -5)).toFixed(1)}" class="tc-tick">${compact(v)}</text>`).join('')}
        ${points.length > 1 ? `<path d="${area}" fill="url(#tg-${s.key})"/><path d="${line}" class="tc-line" stroke="${s.color}"/>` : ''}
        <circle cx="${xs[xs.length - 1].toFixed(1)}" cy="${ys[ys.length - 1].toFixed(1)}" r="4" fill="${s.color}" class="tc-end"/>
        <circle r="5" fill="${s.color}" class="tc-dot" data-dot="${s.key}" visibility="hidden"/>`;
      return { s, ys, vals, top };
    });
    const axisY = H - 5;
    const defs = series.map((s) => `<linearGradient id="tg-${s.key}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${s.color}" stop-opacity=".22"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('');

    el.innerHTML = `<svg class="trend" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="总资产与个人可用现金走势">
      <defs>${defs}</defs>
      <line class="tc-cross" y1="${headH}" y2="${H - axisH}" visibility="hidden"/>
      ${body}
      <text x="${padL}" y="${axisY}" class="tc-tick">${md(points[0].date)}</text>
      ${points.length > 1 ? `<text x="${W - padR}" y="${axisY}" text-anchor="end" class="tc-tick">${md(points[points.length - 1].date)}</text>` : ''}
      <text x="${W / 2}" y="${axisY}" text-anchor="middle" class="tc-date"></text>
    </svg>`;

    const svg = el.querySelector('svg');
    const cross = svg.querySelector('.tc-cross');
    const dateText = svg.querySelector('.tc-date');
    const show = (idx) => {
      const on = idx !== null;
      cross.setAttribute('visibility', on ? 'visible' : 'hidden');
      const k = on ? idx : points.length - 1;
      if (on) { cross.setAttribute('x1', xs[k]); cross.setAttribute('x2', xs[k]); }
      dateText.textContent = on ? points[k].date : '';
      for (const p of panels) {
        svg.querySelector(`[data-val="${p.s.key}"]`).textContent = 'RM ' + fmt(p.vals[k]);
        const dot = svg.querySelector(`[data-dot="${p.s.key}"]`);
        dot.setAttribute('visibility', on ? 'visible' : 'hidden');
        if (on) { dot.setAttribute('cx', xs[k]); dot.setAttribute('cy', p.ys[k]); }
      }
    };
    const pick = (e) => {
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * W;
      let best = 0;
      xs.forEach((v, k) => { if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = k; });
      show(best);
    };
    svg.addEventListener('pointerdown', pick);
    svg.addEventListener('pointermove', pick);
    svg.addEventListener('pointerleave', () => show(null));
    svg.addEventListener('pointercancel', () => show(null));
  }

  /** 最近几天的花费小柱图。days: [{date, spend|null, budget}] */
  function spendBars(days, dailyBudget) {
    const max = Math.max(dailyBudget * 1.5, ...days.map((d) => Math.max(0, d.spend || 0) / (d.days || 1)));
    return `<div class="sbars" role="img" aria-label="最近 7 天花费">
      ${days.map((d) => {
        const per = d.spend === null ? null : Math.max(0, d.spend) / (d.days || 1);
        const h = per === null ? 0 : Math.max(4, (per / max) * 100);
        const cls = per === null ? 'none' : d.over ? 'over' : 'ok';
        return `<div class="sbar ${cls}" title="${d.date}${per === null ? '' : ' · RM ' + fmt(d.spend)}">
          <div class="sbar-track"><div class="sbar-fill" style="height:${h}%"></div></div>
          <span>${'日一二三四五六'[CF.parseYmd(d.date).getDay()]}</span></div>`;
      }).join('')}
    </div>`;
  }

  g.Charts = { donut, trend, spendBars, compact };
})(self);
