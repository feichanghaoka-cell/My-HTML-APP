/* 暖流 — 根据你的数字给建议，外加每日一句名言。全部在手机里计算，不联网。 */
(function (g) {
  'use strict';

  /* ---------- 名言：只收出处可靠的 ---------- */
  const QUOTES = [
    { zh: '不积跬步，无以至千里；不积小流，无以成江海。', by: '荀子《劝学》' },
    { zh: '千里之行，始于足下。', by: '老子《道德经》' },
    { zh: '知足者富。', by: '老子《道德经》' },
    { zh: '由俭入奢易，由奢入俭难。', by: '司马光《训俭示康》' },
    { zh: '历览前贤国与家，成由勤俭破由奢。', by: '李商隐《咏史》' },
    { zh: '节其流，开其源，而时斟酌焉。', by: '荀子《富国》' },
    { zh: '凡事豫则立，不豫则废。', by: '《礼记·中庸》' },
    { zh: '种一棵树最好的时间是十年前，其次是现在。', by: '谚语' },
    { zh: '小心小开销，小小的漏洞也能让大船沉没。', en: 'Beware of little expenses; a small leak will sink a great ship.', by: '本杰明·富兰克林' },
    { zh: '第一条：永远不要亏钱。第二条：永远不要忘记第一条。', en: 'Rule No. 1: Never lose money. Rule No. 2: Never forget rule No. 1.', by: '沃伦·巴菲特' },
    { zh: '价格是你付出的，价值是你得到的。', en: 'Price is what you pay; value is what you get.', by: '沃伦·巴菲特' },
    { zh: '今天有人能坐在树荫下，是因为很久以前有人种了一棵树。', en: "Someone's sitting in the shade today because someone planted a tree a long time ago.", by: '沃伦·巴菲特' },
    { zh: '重要的不是你赚多少钱，而是你留住多少钱。', en: "It's not how much money you make, but how much money you keep.", by: '罗伯特·清崎' },
    { zh: '财富不在于拥有很多，而在于欲望很少。', en: 'Wealth consists not in having great possessions, but in having few wants.', by: '爱比克泰德' },
    { zh: '钱是糟糕的主人，却是出色的仆人。', en: 'Money is a terrible master but an excellent servant.', by: 'P. T. 巴纳姆' },
    { zh: '清楚你拥有什么，也清楚你为什么拥有它。', en: 'Know what you own, and know why you own it.', by: '彼得·林奇' },
    { zh: '投资里最危险的一句话是：“这次不一样。”', en: "The four most dangerous words in investing are: 'this time it's different.'", by: '约翰·邓普顿' },
    { zh: '债务是自由人的奴役。', en: 'Debt is the slavery of the free.', by: '普布里乌斯·西鲁斯' },
  ];

  /** 按日期挑一句，每天固定；offset 用来“换一句” */
  function quoteOf(date, offset = 0) {
    let h = 0;
    for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    return QUOTES[(h + offset) % QUOTES.length];
  }

  /* ---------- 负债种类（从名字判断） ---------- */
  function debtKind(acc) {
    const n = acc.name.toLowerCase();
    if (/信用卡|visa|master|amex|credit|card/.test(n)) return 'card';
    if (/spaylater|atome|atomy|paylater|分期|grab|boost|bnpl/.test(n)) return 'bnpl';
    if (/车贷|car|hire|hp\b/.test(n)) return 'car';
    if (/ptptn|学贷|study|edu/.test(n)) return 'study';
    if (/房贷|house|home|mortgage/.test(n)) return 'house';
    return 'other';
  }

  /**
   * 根据最近的记录给出建议，按重要程度排序。
   * 每条：{ level: 'alert'|'tip'|'good', icon, title, text }
   */
  function insights(state, today, fmt) {
    const out = [];
    const dates = CF.snapshotDates(state);
    if (!dates.length) return out;
    const latest = dates[dates.length - 1];
    const t = CF.totalsOf(state, latest);
    const bal = state.snapshots[latest].balances;
    const money = (n) => 'RM ' + fmt(n);
    const debts = state.accounts.filter((a) => a.type === 'debt' && (Number(bal[a.id]) || 0) > 0);
    const kindSum = (k) => debts.filter((a) => debtKind(a) === k).reduce((x, a) => x + (Number(bal[a.id]) || 0), 0);

    // 1. 过期没付的还款
    const ym = today.slice(0, 7);
    const allDue = [-1, 0, 1].map((n) => CF.addMonths(ym, n)).flatMap((m) => CF.billsForMonth(state, m))
      .filter((r) => !r.paid && r.amount > 0).map((r) => Object.assign(r, { left: CF.diffDays(today, r.due) }));
    const overdue = allDue.filter((r) => r.left < 0 && r.left >= -31);
    if (overdue.length) {
      out.push({ level: 'alert', icon: '⚠️', title: `${overdue.length} 笔已过期`,
        text: `${overdue.map((r) => r.bill.name).slice(0, 3).join('、')}已经过了扣款日。如果已经付了，到「开销」打勾；还没付的尽快处理，避免罚款和利息。` });
    }

    // 2. 接下来 7 天的还款，个人现金够不够
    const week = allDue.filter((r) => r.left >= 0 && r.left <= 7);
    const weekSum = week.reduce((x, r) => x + r.amount, 0);
    if (weekSum > 0 && t.personal < weekSum) {
      out.push({ level: 'alert', icon: '💸', title: '这周的还款，现金不够',
        text: `接下来 7 天要付 ${money(weekSum)}，个人现金只有 ${money(t.personal)}，还差 ${money(weekSum - t.personal)}。可以先从公司户口转、或者先付利率最高的那笔。` });
    } else if (weekSum > 0) {
      out.push({ level: 'tip', icon: '📅', title: `7 天内要付 ${money(weekSum)}`,
        text: `${week.map((r) => `${r.bill.name}（${r.left === 0 ? '今天' : r.left + ' 天后'}）`).slice(0, 4).join('、')}。现金够付，记得按时付完打勾。` });
    }

    // 3. 先还利率最高的债
    const card = kindSum('card'), bnpl = kindSum('bnpl');
    if (card > 0) {
      out.push({ level: 'tip', icon: '💳', title: '信用卡尽量每月全额还清',
        text: `信用卡还欠 ${money(card)}。只付最低还款额的话，剩下的会被收每年 15%–18% 的利息，是你所有负债里最贵的。有多余的钱，先还信用卡。` });
    }
    if (bnpl > 0 && debts.filter((a) => debtKind(a) === 'bnpl').length >= 2) {
      out.push({ level: 'tip', icon: '🛍️', title: '先买后付开了好几个',
        text: `SPayLater、Atome 这类分期合计还欠 ${money(bnpl)}。每一笔看起来都不多，加起来会压住之后好几个月的现金。在还清之前，尽量不再开新的分期。` });
    }
    const low = kindSum('car') + kindSum('study') + kindSum('house');
    if (low > 0 && (card > 0 || bnpl > 0)) {
      out.push({ level: 'tip', icon: '🎯', title: '还债顺序：先贵后便宜',
        text: `车贷、学贷的利率很低（车贷约 3%、PTPTN 约 1%），按时供就好，不用提早还。多出来的钱先清信用卡和分期，省下的利息最多。` });
    }

    // 4. 紧急备用金：个人现金够撑几个月
    const fixedMonth = CF.billsForMonth(state, ym).reduce((x, r) => x + r.amount, 0);
    const monthlyNeed = fixedMonth + (Number(state.settings.dailyBudget) || 0) * 30;
    if (monthlyNeed > 0) {
      const months = t.personal / monthlyNeed;
      if (months < 3) {
        out.push({ level: 'tip', icon: '🛟', title: `备用金约 ${months.toFixed(1)} 个月`,
          text: `你每个月大概要 ${money(monthlyNeed)}（固定开销 + 每日预算）。个人现金最好能撑 3–6 个月，万一客户迟付款也不慌。每次收到款，先留一部分进备用金。` });
      } else {
        out.push({ level: 'good', icon: '🛟', title: `备用金够撑 ${months.toFixed(1)} 个月`,
          text: months >= 6 ? '已经超过 6 个月，很稳。多出来的可以考虑还贵的债，或者拿去定存、投资。' : '已经超过 3 个月，做得很好。继续存到 6 个月会更安心。' });
      }
    }

    // 5. 负债率和变化（和 30 天前比）
    const monthAgo = dates.filter((d) => d <= CF.addDays(latest, -28)).pop();
    if (t.debt > 0 && monthAgo) {
      const before = CF.totalsOf(state, monthAgo).debt;
      if (before - t.debt > 1) {
        out.push({ level: 'good', icon: '📉', title: `一个月少欠了 ${money(before - t.debt)}`,
          text: '负债在往下走，方向是对的。保持下去，每个月都会更轻松一点。' });
      } else if (t.debt - before > 1) {
        out.push({ level: 'tip', icon: '📈', title: `一个月多欠了 ${money(t.debt - before)}`,
          text: '负债比一个月前多了。看看是哪一笔在涨（总览负债卡片里有），这个月先不要再刷卡或分期。' });
      }
    }
    if (t.total > 0 && t.debt / t.total > 0.5) {
      out.push({ level: 'tip', icon: '⚖️', title: `负债率 ${((t.debt / t.total) * 100).toFixed(0)}%`,
        text: '负债超过资产的一半。不用焦虑，车贷这类长期贷款本来就会让比例偏高；重点是每个月都比上个月低一点。' });
    }

    // 6. 刚还清的负债
    const cleared = state.accounts.filter((a) => a.type === 'debt' && (Number(bal[a.id]) || 0) === 0 && monthAgo
      && (Number(state.snapshots[monthAgo].balances[a.id]) || 0) > 0);
    if (cleared.length) {
      out.push({ level: 'good', icon: '🎉', title: `${cleared.map((a) => a.name).join('、')} 还清了！`,
        text: '少了一笔债，每个月的压力就少一份。给自己一点小奖励，但别再开新的。' });
    }

    // 7. 预算连续达标 / 最近常超支
    let streak = 0, overCount = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
      const s = CF.spendOf(state, dates[i]);
      if (!s) break;
      if (!s.over) streak++; else break;
    }
    for (const d of dates.slice(-7)) { const s = CF.spendOf(state, d); if (s && s.over) overCount++; }
    if (streak >= 3) {
      out.push({ level: 'good', icon: '🔥', title: `连续 ${streak} 次在预算内`,
        text: streak >= 7 ? '一整个星期都守住了，真的不容易。这种习惯就是存钱最大的秘诀。' : '守住了！再坚持几天就是一整个星期。' });
    } else if (overCount >= 3) {
      out.push({ level: 'tip', icon: '🧾', title: '最近 7 次有 ' + overCount + ' 次超预算',
        text: '可以回想一下这几天花在哪里。如果每日预算本来就定得太紧，到设置里调整成实际可行的数字，比天天超支更有用。' });
    }

    // 8. 客户逾期没付
    const late = CF.overdueIncome(state, today);
    if (late.length) {
      const sum = late.reduce((x, r) => x + r.amount, 0);
      const who = new Set(late.map((r) => r.client.id)).size;
      out.push({ level: 'tip', icon: '📨', title: `${who} 个客户、${late.length} 笔款项还没收到`,
        text: `合计 ${money(sum)} 已经过了付款日。礼貌地发个提醒吧，收回来的钱可以先补备用金或还信用卡。` });
    }

    // 9. 净资产在增长
    if (monthAgo) {
      const nw = t.net - CF.totalsOf(state, monthAgo).net;
      if (nw > 1) out.push({ level: 'good', icon: '🌱', title: `净资产一个月多了 ${money(nw)}`, text: '资产减负债在变多，你在往对的方向走。' });
    }

    const rank = { alert: 0, tip: 1, good: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  g.Insights = { QUOTES, quoteOf, insights, debtKind };
})(self);
