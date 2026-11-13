// Works out totals and plain-language suggestions from saved receipts.
// Pure functions, no browser APIs, so this file is tested with Node.

const DAY = 86400000;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function daysAgo(iso, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - parseDate(iso)) / DAY);
}
function money(n) { return `$${n.toFixed(2)}`; }
export function itemKey(name) { return name.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim(); }

export function within(receipts, days, now = new Date(), offset = 0) {
  return receipts.filter((r) => {
    const a = daysAgo(r.date, now);
    return a >= offset && a < offset + days;
  });
}

export function toYM(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
export function inMonth(receipts, ym) { return receipts.filter((r) => r.date.startsWith(ym)); }

// Where this calendar month stands against a monthly budget.
export function budgetStatus(receipts, budget, now = new Date()) {
  const spent = inMonth(receipts, toYM(now)).reduce((a, r) => a + r.total, 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const daysLeft = daysInMonth - day + 1; // counting today
  const left = budget - spent;
  const projected = (spent / day) * daysInMonth;
  // The pace is too noisy to judge in the first week.
  const state = left < 0 ? 'over' : (day >= 7 && projected > budget * 1.05 ? 'fast' : 'ok');
  return { spent, budget, left, daysLeft, perDay: left > 0 ? left / daysLeft : 0, projected, state };
}

// Every grocery purchase of each item, oldest first, keyed by a tidied name.
export function itemHistory(all) {
  const history = {};
  for (const r of [...all].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.eatingOut) continue;
    for (const i of r.items) {
      const k = itemKey(i.name);
      if (k.length < 3 || k === 'unlisted items') continue;
      (history[k] ||= []).push({ date: r.date, price: i.price, store: r.store, name: i.name, category: i.category });
    }
  }
  return history;
}

// What the app remembers about each item: last price, category, how often.
export function itemMemory(all) {
  return Object.entries(itemHistory(all)).map(([key, h]) => {
    const last = h[h.length - 1];
    return { key, name: last.name, price: last.price, category: last.category, store: last.store, count: new Set(h.map((x) => x.date)).size };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Items bought on a regular rhythm that are due again.
export function dueItems(all, now = new Date()) {
  const due = [];
  for (const h of Object.values(itemHistory(all))) {
    const dates = [...new Set(h.map((x) => x.date))];
    if (dates.length < 3) continue;
    const span = daysAgo(dates[0], now) - daysAgo(dates[dates.length - 1], now);
    const every = span / (dates.length - 1);
    const since = daysAgo(dates[dates.length - 1], now);
    if (every >= 2 && since >= every * 0.9 && since <= every * 3) {
      due.push({ name: h[h.length - 1].name, every: Math.round(every), since });
    }
  }
  return due;
}

// Items whose latest price differs by 10% or more between two shops.
export function cheaperElsewhere(all) {
  const found = [];
  for (const h of Object.values(itemHistory(all))) {
    const latest = {};
    for (const x of h) if (x.store) latest[x.store] = x.price;
    const shops = Object.entries(latest).sort((a, b) => a[1] - b[1]);
    if (shops.length < 2) continue;
    const [lowStore, low] = shops[0], [highStore, high] = shops[shops.length - 1];
    if (high >= low * 1.1) found.push({ name: h[h.length - 1].name, low, lowStore, high, highStore });
  }
  return found.sort((a, b) => (b.high - b.low) - (a.high - a.low));
}

// Totals for the dashboard charts.
export function summarize(receipts) {
  const byCategory = {}, byStore = {}, byWeekday = WEEKDAYS.map(() => 0);
  let total = 0;
  for (const r of receipts) {
    total += r.total;
    byStore[r.store || 'Unknown'] = (byStore[r.store || 'Unknown'] || 0) + r.total;
    byWeekday[parseDate(r.date).getDay()] += r.total;
    for (const i of r.items) byCategory[i.category] = (byCategory[i.category] || 0) + i.price;
  }
  const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return { total, count: receipts.length, byCategory: sorted(byCategory), byStore: sorted(byStore), byWeekday };
}

export function generateInsights(all, now = new Date(), budget = 0) {
  const out = [];
  if (budget > 0) {
    const b = budgetStatus(all, budget, now);
    if (b.state === 'over') {
      out.push({
        title: `This month is ${money(-b.left)} over budget`,
        detail: `${money(b.spent)} spent against a budget of ${money(b.budget)}, with ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left in the month.`,
      });
    } else if (b.state === 'fast') {
      out.push({
        title: 'Spending is running ahead of your budget',
        detail: `${money(b.spent)} so far. At this pace the month ends near ${money(b.projected)}, about ${money(b.projected - b.budget)} over. Keeping to ${money(b.perDay)} a day gets you back on track.`,
      });
    }
  }
  const month = within(all, 30, now);
  if (all.length < 5) {
    out.push({
      title: 'Keep adding receipts',
      detail: `You have ${all.length} so far. Patterns start to show after about 15, and the suggestions below get more reliable as you add more.`,
    });
  }
  if (!month.length) return out;
  const s = summarize(month);

  // Week over week
  const thisWeek = summarize(within(all, 7, now)).total;
  const lastWeek = summarize(within(all, 7, now, 7)).total;
  if (lastWeek > 0 && thisWeek > 0) {
    const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
    if (Math.abs(pct) >= 15) {
      out.push({
        title: `Spending is ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on last week`,
        detail: `${money(thisWeek)} in the last 7 days against ${money(lastWeek)} in the 7 days before.`,
      });
    }
  }

  // Lots of small trips
  const groceryTrips = month.filter((r) => !r.eatingOut);
  const small = groceryTrips.filter((r) => r.total < 20);
  if (small.length >= 4) {
    out.push({
      title: `${small.length} small shopping trips in the last 30 days`,
      detail: `Trips under $20 added up to ${money(small.reduce((a, r) => a + r.total, 0))}. Folding them into one planned weekly shop usually cuts impulse buys and saves time.`,
    });
  }

  // Eating out
  const out30 = month.filter((r) => r.eatingOut);
  const outSpend = out30.reduce((a, r) => a + r.total, 0);
  if (out30.length >= 3 && outSpend / s.total >= 0.2) {
    out.push({
      title: `Eating out is ${Math.round((outSpend / s.total) * 100)}% of your spending`,
      detail: `${out30.length} times in the last 30 days for ${money(outSpend)}, about ${money(outSpend / out30.length)} each. Swapping one a week for a home meal would save roughly ${money((outSpend / out30.length) * 4)} a month.`,
    });
  }

  // Food balance
  const cat = Object.fromEntries(s.byCategory);
  const food = ['Produce', 'Dairy & eggs', 'Meat & fish', 'Bakery & grains', 'Pantry', 'Snacks & sweets', 'Drinks', 'Ready meals']
    .reduce((a, c) => a + (cat[c] || 0), 0);
  if (food > 0) {
    const treats = (cat['Snacks & sweets'] || 0) + (cat['Drinks'] || 0) + (cat['Ready meals'] || 0);
    const produce = cat['Produce'] || 0;
    if (treats > produce && treats / food >= 0.25) {
      out.push({
        title: 'More goes on snacks, drinks and ready meals than on produce',
        detail: `${Math.round((treats / food) * 100)}% of the food basket (${money(treats)}) against ${Math.round((produce / food) * 100)}% on fruit and vegetables (${money(produce)}).`,
      });
    } else if (produce / food >= 0.25) {
      out.push({
        title: 'Good balance: produce is a big part of the basket',
        detail: `Fruit and vegetables are ${Math.round((produce / food) * 100)}% of food spending in the last 30 days.`,
      });
    }
  }

  // Price memory, per item
  const rises = [];
  for (const h of Object.values(itemHistory(all))) {
    if (h.length < 2) continue;
    const last = h[h.length - 1], prev = h[h.length - 2];
    if (last.price >= prev.price * 1.1 && daysAgo(last.date, now) < 30) {
      rises.push(`${last.name}: ${money(prev.price)} → ${money(last.price)}${last.store ? ` at ${last.store}` : ''}`);
    }
  }
  const due = dueItems(all, now).map((d) => `${d.name} (about every ${d.every} days, last bought ${d.since} days ago)`);
  const cheaper = cheaperElsewhere(all).map((c) => `${c.name}: ${money(c.low)} at ${c.lowStore}, ${money(c.high)} at ${c.highStore}`);
  if (rises.length) {
    out.push({
      title: `You paid more for ${rises.length} item${rises.length > 1 ? 's' : ''} than last time`,
      detail: 'The line price went up by 10% or more. This can also mean a bigger pack, so check before switching.',
      list: rises.slice(0, 5),
    });
  }
  if (due.length) {
    out.push({
      title: 'Probably running low',
      detail: 'Based on how often you buy these. They are waiting on the Shopping tab, one tap to add.',
      list: due.slice(0, 6),
    });
  }
  if (cheaper.length) {
    out.push({
      title: `${cheaper.length} item${cheaper.length > 1 ? 's are' : ' is'} cheaper at another shop you use`,
      detail: 'Latest price you paid at each shop, where the gap is 10% or more.',
      list: cheaper.slice(0, 5),
    });
  }

  // Routine
  const top = s.byWeekday.indexOf(Math.max(...s.byWeekday));
  if (month.length >= 5 && s.byWeekday[top] / s.total >= 0.3) {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    out.push({
      title: `${names[top]} is your big spending day`,
      detail: `${Math.round((s.byWeekday[top] / s.total) * 100)}% of the last 30 days' spending happened on a ${names[top]}.`,
    });
  }
  return out;
}
