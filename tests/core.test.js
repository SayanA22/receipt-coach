import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, categorize, findDate } from '../parser.js';
import { generateInsights, summarize, within } from '../insights.js';
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
