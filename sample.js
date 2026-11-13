// Made-up receipts so the app can be tried before any real ones are added.
import { toISODate } from './parser.js';

export function sampleReceipts(now = new Date()) {
  const day = (n) => toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  const r = (n, store, eatingOut, items) => ({
    id: `sample-${n}-${store}`,
    sample: true,
    store,
    date: day(n),
    eatingOut,
    items: items.map(([name, price, category]) => ({ name, price, category: eatingOut ? 'Eating out' : category })),
    total: Math.round(items.reduce((a, i) => a + i[1], 0) * 100) / 100,
  });
  return [
    r(27, 'Fresh Market', false, [['Milk 2L', 3.49, 'Dairy & eggs'], ['Bananas', 1.8, 'Produce'], ['Chicken breast', 11.2, 'Meat & fish'], ['Bread', 2.99, 'Bakery & grains'], ['Tortilla chips', 3.5, 'Snacks & sweets'], ['Laundry detergent', 12.99, 'Household']]),
    r(24, 'Corner Shop', false, [['Cola 6 pack', 5.99, 'Drinks'], ['Chocolate bar', 1.99, 'Snacks & sweets']]),
    r(22, 'Pizza Palace', true, [['Large pizza', 21.0, 'Eating out'], ['Garlic bread', 5.5, 'Eating out']]),
    r(21, 'Fresh Market', false, [['Milk 2L', 3.49, 'Dairy & eggs'], ['Eggs dozen', 4.29, 'Dairy & eggs'], ['Apples', 4.1, 'Produce'], ['Pasta', 1.79, 'Bakery & grains'], ['Pasta sauce', 3.29, 'Pantry'], ['Frozen pizza', 6.99, 'Ready meals'], ['Ice cream', 5.49, 'Snacks & sweets']]),
    r(18, 'Corner Shop', false, [['Energy drink', 3.49, 'Drinks'], ['Potato chips', 3.29, 'Snacks & sweets'], ['Cookies', 3.99, 'Snacks & sweets']]),
    r(15, 'Burger Barn Grill', true, [['Family meal', 34.5, 'Eating out']]),
    r(14, 'Fresh Market', false, [['Milk 2L', 3.69, 'Dairy & eggs'], ['Bananas', 1.95, 'Produce'], ['Ground beef', 9.8, 'Meat & fish'], ['Bread', 2.99, 'Bakery & grains'], ['Cola 6 pack', 5.99, 'Drinks'], ['Frozen nuggets', 7.49, 'Ready meals'], ['Paper towels', 8.99, 'Household']]),
    r(11, 'Corner Shop', false, [['Cola 6 pack', 6.49, 'Drinks'], ['Candy', 2.5, 'Snacks & sweets']]),
    r(8, 'Sunrise Cafe', true, [['Coffee x2', 9.0, 'Eating out'], ['Breakfast sandwich x2', 15.0, 'Eating out']]),
    r(7, 'Fresh Market', false, [['Milk 2L', 4.19, 'Dairy & eggs'], ['Eggs dozen', 4.99, 'Dairy & eggs'], ['Carrots', 2.2, 'Produce'], ['Chicken breast', 12.6, 'Meat & fish'], ['Rice 2kg', 5.49, 'Bakery & grains'], ['Tortilla chips', 3.5, 'Snacks & sweets'], ['Juice', 4.29, 'Drinks']]),
    r(4, 'Corner Shop', false, [['Potato chips', 3.29, 'Snacks & sweets'], ['Soda', 2.49, 'Drinks']]),
    r(2, 'Pizza Palace', true, [['Large pizza', 22.0, 'Eating out'], ['Wings', 11.0, 'Eating out']]),
    r(1, 'Corner Shop', false, [['Bread', 3.49, 'Bakery & grains'], ['Chocolate bar', 1.99, 'Snacks & sweets']]),
  ];
}
