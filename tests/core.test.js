import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, categorize, findDate, applyLearned, learnFrom } from '../parser.js';
import { generateInsights, summarize, within, budgetStatus, itemMemory, itemKey, dueItems, cheaperElsewhere, monthlyTotals, weekSummary, setCurrency } from '../insights.js';
import { sampleReceipts } from '../sample.js';

const TEXT = `FRESH MARKET
123 Main Street
11/02/2026 14:32
MILK 2L            3.49
012345678901 BANANAS   1.80 F
2 x TORTILLA CHIPS  7.00
DISH SOAP          $4,25
SUBTOTAL          16.54
TAX                0.90
TOTAL             17.44
VISA              17.44
CHANGE             0.00
THANK YOU`;

test('parses store, date, items and total', () => {
  const r = parseReceipt(TEXT);
  assert.equal(r.store, 'FRESH MARKET');
  assert.equal(r.date, '2026-11-02');
  assert.equal(r.total, 17.44);
  assert.deepEqual(r.items.map((i) => [i.name, i.price, i.category]), [
    ['MILK 2L', 3.49, 'Dairy & eggs'],
    ['BANANAS', 1.8, 'Produce'],
    ['TORTILLA CHIPS', 7, 'Snacks & sweets'],
    ['DISH SOAP', 4.25, 'Household'],
  ]);
  assert.equal(r.eatingOut, false);
});

test('falls back to today and item sum; flags eating out', () => {
  const r = parseReceipt('Pizza Palace\nLarge pizza 21.00\nGarlic bread 5.50', new Date(2026, 0, 5));
  assert.equal(r.date, '2026-01-05');
  assert.equal(r.total, 26.5);
  assert.equal(r.eatingOut, true);
  assert.equal(r.items[0].category, 'Eating out');
});

test('dates and categories', () => {
  assert.equal(findDate('on 2026-03-09 ok'), '2026-03-09');
  assert.equal(findDate('25/12/26'), '2026-12-25');
  assert.equal(findDate('no date 99/99/99'), null);
  assert.equal(categorize('Ice cream tub'), 'Snacks & sweets');
  assert.equal(categorize('Widget'), 'Other');
});

test('insights from sample data', () => {
  const now = new Date(2026, 10, 13);
  const all = sampleReceipts(now);
  const s = summarize(within(all, 30, now));
  assert.equal(s.count, 13);
  const titles = generateInsights(all, now).map((i) => i.title).join(' | ');
  assert.match(titles, /small shopping trips/);
  assert.match(titles, /Eating out is \d+%/);
  assert.match(titles, /paid more/);
  assert.match(titles, /running low/);
  assert.deepEqual(generateInsights([], now).map((i) => i.title), ['Keep adding receipts']);
});

test('budget status for the current month', () => {
  const now = new Date(2026, 10, 13); // 13 Nov, 30-day month
  const all = sampleReceipts(now);
  const b = budgetStatus(all, 250, now);
  assert.equal(Math.round(b.spent * 100), 11451);
  assert.equal(b.daysLeft, 18);
  assert.equal(Math.round(b.perDay * 100), 753);
  assert.equal(b.state, 'fast');
  assert.equal(budgetStatus(all, 100, now).state, 'over');
  assert.equal(budgetStatus(all, 600, now).state, 'ok');
  // Too early in the month to judge the pace.
  assert.equal(budgetStatus([{ date: '2026-11-02', total: 90, items: [] }], 250, new Date(2026, 10, 2)).state, 'ok');
  assert.match(generateInsights(all, now, 250)[0].title, /ahead of your budget/);
  assert.match(generateInsights(all, now, 100)[0].title, /over budget/);
});

test('item memory, due items and cheaper shops', () => {
  const now = new Date(2026, 10, 13);
  const all = sampleReceipts(now);
  const milk = itemMemory(all).find((m) => m.key === itemKey('MILK 2L'));
  assert.deepEqual([milk.name, milk.price, milk.category, milk.count], ['Milk 2L', 4.19, 'Dairy & eggs', 4]);
  assert.equal(itemMemory(all).some((m) => m.name === 'Large pizza'), false); // eating out is not remembered
  assert.deepEqual(dueItems(all, now).map((d) => d.name), ['Milk 2L', 'Cola 6 pack']);
  assert.deepEqual(cheaperElsewhere(all), [{ name: 'Bread', low: 2.99, lowStore: 'Fresh Market', high: 3.49, highStore: 'Corner Shop' }]);
});

test('weights on the next line, discounts and misread digits', () => {
  const r = parseReceipt(`FRESH MARKET
11/02/2026
MILK 2L 3.49
BANANAS
0.45 kg @ 3.99/kg 1.80
2 X TORTILLA CHIPS 7.00
MEMBER SAVINGS -1.00
DISH SOAP 4.25
EGGS DOZEN 4.9S F
COUPON 0.50-
RICE 2kg l.80
TOTAL SAVINGS 1.50
SUBTOTAL 21.83
TOTAL 22.73
VISA
22.73`);
  assert.deepEqual(r.items.map((i) => [i.name, i.price]), [
    ['MILK 2L', 3.49], ['BANANAS', 1.8], ['TORTILLA CHIPS', 6], ['DISH SOAP', 4.25], ['EGGS DOZEN', 4.45], ['RICE 2kg', 1.8],
  ]);
  assert.equal(r.total, 22.73);
  assert.equal(parseReceipt('Shop\nThank you. SO').items.length, 0);
  assert.equal(findDate('03/04/2026'), '2026-03-04');
  assert.equal(findDate('03/04/2026', true), '2026-04-03');
  assert.equal(findDate('03/25/2026', true), '2026-03-25');
});

test('monthly trend, weekly summary, category limits and currency', () => {
  const now = new Date(2026, 10, 13);
  const all = sampleReceipts(now);
  const trend = monthlyTotals(all, now, 3);
  assert.deepEqual(trend.map((t) => [t.ym, t.label, Math.round(t.total * 100)]), [['2026-09', 'Sep', 0], ['2026-10', 'Oct', 18606], ['2026-11', 'Nov', 11451]]);
  const w = weekSummary(all, now);
  assert.deepEqual([Math.round(w.thisWeek * 100), Math.round(w.lastWeek * 100), w.pct], [4426, 7025, -37]);
  assert.equal(weekSummary([], now).pct, null);
  const tips = generateInsights(all, now, 0, { 'Eating out': 40, Produce: 50 });
  assert.equal(tips[0].title, 'Eating out is over its limit this month');
  assert.equal(tips.some((t) => /Produce is over/.test(t.title)), false);
  setCurrency('£');
  assert.match(generateInsights(all, now, 0, { 'Eating out': 40 })[0].detail, /£57\.00 spent against a limit of £40\.00/);
  setCurrency('$');
});

test('learns corrections and applies them next time', () => {
  const first = applyLearned(parseReceipt('FRESH MKT #204\nMLK 2L HMGZ 3.49\nBANANAS 1.80\nWIDGET 2.00'));
  assert.equal(first.items[0].read, 'MLK 2L HMGZ');
  const rules = learnFrom({}, first.read, 'Fresh Market', [
    { read: 'MLK 2L HMGZ', name: 'Milk 2L', category: 'Dairy & eggs' },
    { read: 'BANANAS', name: 'BANANAS', category: 'Produce' },      // untouched: nothing to learn
    { read: 'WIDGET', name: 'WIDGET', category: 'Household' },      // category only
    { read: '', name: 'Typed by hand', category: 'Other' },
  ]);
  assert.deepEqual(rules, { stores: { 'fresh mkt 204': 'Fresh Market' }, items: { 'mlk 2l hmgz': { name: 'Milk 2L', category: 'Dairy & eggs' }, widget: { name: 'WIDGET', category: 'Household' } } });
  const next = applyLearned(parseReceipt('Fresh Mkt #204\nMLK 2L HMGZ 3.69\nWIDGET 2.10'), rules);
  assert.equal(next.store, 'Fresh Market');
  assert.deepEqual(next.items.map((i) => [i.name, i.price, i.category]), [['Milk 2L', 3.69, 'Dairy & eggs'], ['WIDGET', 2.1, 'Household']]);
});
