// Turns the raw text read from a receipt photo into structured data.
// Pure functions, no browser APIs, so this file is tested with Node.

export const CATEGORIES = [
  'Produce', 'Dairy & eggs', 'Meat & fish', 'Bakery & grains', 'Pantry',
  'Snacks & sweets', 'Drinks', 'Ready meals', 'Household', 'Eating out', 'Other',
];

const KEYWORDS = {
  'Produce': ['apple', 'banana', 'orange', 'lemon', 'lime', 'grape', 'berry', 'berries', 'melon', 'mango', 'avocado', 'tomato', 'potato', 'onion', 'garlic', 'carrot', 'lettuce', 'spinach', 'kale', 'broccoli', 'pepper', 'cucumber', 'celery', 'mushroom', 'salad', 'herb', 'cilantro', 'ginger', 'squash', 'zucchini', 'corn', 'peach', 'pear', 'plum', 'cabbage', 'produce', 'organic veg', 'fruit'],
  'Dairy & eggs': ['milk', 'cheese', 'cheddar', 'mozzarella', 'yogurt', 'yoghurt', 'butter', 'cream', 'egg', 'paneer', 'curd'],
  'Meat & fish': ['chicken', 'beef', 'pork', 'lamb', 'turkey', 'bacon', 'sausage', 'ham', 'salmon', 'tuna', 'shrimp', 'fish', 'steak', 'mince', 'ground'],
  'Bakery & grains': ['bread', 'bagel', 'bun', 'tortilla', 'roll', 'loaf', 'rice', 'pasta', 'noodle', 'flour', 'oat', 'cereal', 'granola', 'naan', 'pita', 'quinoa'],
  'Pantry': ['oil', 'sauce', 'salt', 'sugar', 'spice', 'bean', 'lentil', 'soup', 'canned', 'vinegar', 'honey', 'jam', 'peanut butter', 'ketchup', 'mustard', 'mayo', 'stock', 'broth', 'nuts', 'almond', 'tofu'],
  'Snacks & sweets': ['chip', 'crisps', 'cookie', 'biscuit', 'candy', 'chocolate', 'choc', 'ice cream', 'popcorn', 'cracker', 'pretzel', 'donut', 'doughnut', 'cake', 'gum', 'snack', 'oreo', 'doritos', 'lays', 'pringles'],
  'Drinks': ['soda', 'cola', 'coke', 'pepsi', 'sprite', 'juice', 'water', 'coffee', 'tea', 'beer', 'wine', 'energy', 'gatorade', 'lemonade', 'kombucha', 'drink'],
  'Ready meals': ['pizza', 'frozen', 'nugget', 'ramen', 'instant', 'microwave', 'ready meal', 'burrito', 'lasagna', 'meal kit', 'rotisserie', 'sandwich', 'sushi'],
  'Household': ['paper towel', 'toilet', 'tissue', 'detergent', 'soap', 'shampoo', 'toothpaste', 'bleach', 'cleaner', 'sponge', 'trash bag', 'foil', 'battery', 'diaper', 'laundry', 'dish', 'napkin', 'deodorant', 'razor', 'bulb'],
};

const EATING_OUT_STORES = ['restaurant', 'cafe', 'coffee', 'pizza', 'burger', 'grill', 'sushi', 'taco', 'diner', 'kitchen', 'bistro', 'bar ', 'pub', 'bakery', 'mcdonald', 'starbucks', 'subway', 'kfc', 'chipotle', 'domino', 'wendy', 'dunkin', 'takeaway', 'takeout'];

// Lines that end in a price but are not something that was bought.
const NOT_AN_ITEM = /\b(sub\s*-?\s*total|total|tax|vat|gst|hst|pst|cash|change|visa|master\s*card|amex|debit|credit|balance|tender|card|rounding|amount|payment|tip|gratuity|loyalty|points|items? sold|shipping|delivery|handling|postage|fees?|refund)\b/i;
// Money taken off the item on the line above.
const DISCOUNT = /\b(discount|coupon|savings?|saved|promo|member|markdown|reduced|off)\b/i;
const PRICE_AT_END = /(-?)\s*[$€£₹]?\s*(\d{1,3}(?:,\d{3})+|\d{1,4})\s*[.,]\s*(\d{2})\s*(-?)\s*[$€£₹]?\s*[A-Za-z]{0,2}\s*$/;
// The same, allowing letters the reader often mistakes for digits (O for 0, l for 1, S for 5, B for 8).
const PRICE_MISREAD = /(?<![A-Za-z])(-?)\s*[$€£₹]?\s*([\dOoIlSB]{1,4})\s*[.,]\s*([\dOoIlSB]{2})\s*(-?)(?:\s+[A-Za-z]{1,2})?\s*$/;
const AS_DIGIT = { O: '0', o: '0', I: '1', l: '1', S: '5', B: '8' };

// Finds the price a line ends with, or null.
function priceAtEnd(line) {
  let m = line.match(PRICE_AT_END);
  if (!m) {
    m = line.match(PRICE_MISREAD);
    // Only trust a misread price if most of it is still real digits.
    if (!m || ((m[2] + m[3]).match(/\d/g) || []).length < 2 || ((m[2] + m[3]).match(/\D/g) || []).length > 1) return null;
  }
  const digits = (t) => t.replace(/[OoIlSB]/g, (c) => AS_DIGIT[c]);
  return { value: Number(`${digits(m[2].replace(/,/g, ''))}.${digits(m[3])}`), negative: Boolean(m[1] || m[4]), label: line.slice(0, m.index) };
}

// What is left of a label once quantities and weights are taken out,
// e.g. "0.45 kg @ 3.99/kg" leaves nothing: the name is on the line above.
function withoutQuantity(label) {
  return label
    .replace(/[@xX*]\s*[$€£₹]?\s*\d+[.,]\d{2}(\s*\/\s*[A-Za-z]{1,4})?/g, ' ')
    .replace(/\d+[.,]?\d*\s*(kg|lbs?|g|oz|ml|l|ea|each|ct|pk|pcs?)\b/gi, ' ')
    .replace(/\b(qty|net|tare|wt|at|for)\b/gi, ' ')
    .replace(/\/\s*(kg|lbs?|g|oz|ea|each)\b/gi, ' ');
}
const DETAIL_LINE = /^\s*(sold by|ships? from|shipped by|seller|quantity|condition|size|colou?r|style|sku|asin|item (no|number|#)|model|return|arriving|arrives|delivered|estimated delivery|gift)\b/i;
// Online shops whose name is rarely the first line of their emails.
const MERCHANTS = ['Amazon', 'Walmart', 'Instacart', 'Uber Eats', 'DoorDash', 'Grubhub', 'Deliveroo', 'Just Eat', 'Target', 'Costco', 'eBay', 'Etsy', 'IKEA', 'Tesco', 'Sainsbury', 'Ocado', 'Asda', 'Kroger', 'Safeway', 'Whole Foods', 'Aldi', 'Lidl', 'Best Buy', 'Apple', 'Shein', 'Temu', 'Zomato', 'Swiggy', 'Blinkit', 'Flipkart', 'HelloFresh'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const letters = (t) => (t.match(/[A-Za-z]/g) || []).length;

export function categorize(name) {
  const n = ` ${name.toLowerCase()} `;
  // Check the more specific groups first so "ice cream" is a snack, not dairy.
  const order = ['Household', 'Ready meals', 'Snacks & sweets', 'Drinks', 'Meat & fish', 'Dairy & eggs', 'Bakery & grains', 'Produce', 'Pantry'];
  for (const cat of order) {
    if (KEYWORDS[cat].some((k) => n.includes(k))) return cat;
  }
  return 'Other';
}

export function looksLikeEatingOut(store) {
  const s = ` ${String(store).toLowerCase()} `;
  return EATING_OUT_STORES.some((k) => s.includes(k));
}

function pad(n) { return String(n).padStart(2, '0'); }

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Finds the first date in the text. Slash dates are read as month/day unless
// the first number cannot be a month.
export function findDate(text, dayFirst = false) {
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    // a/b is month/day or day/month; a number above 12 settles it either way.
    const monthFirst = dayFirst ? a <= 12 && b > 12 : !(a > 12);
    return monthFirst ? valid(y, a, b) : valid(y, b, a);
  }
  // Written-out dates, as in order emails: "November 12, 2026" or "12 Nov 2026".
  const name = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  m = text.match(new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'i'));
  if (m) return valid(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  m = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${name},?\\s+(20\\d{2})\\b`, 'i'));
  if (m) return valid(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return null;
}

function valid(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function cleanName(raw) {
  return raw
    .replace(/\b\d{5,}\b/g, ' ')            // barcodes and product codes
    .replace(/^\s*\d+\s*[xX@]\s*/, ' ')     // "2 x"
    .replace(/[^A-Za-z0-9&%'./ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseReceipt(text, today = new Date(), { dayFirst = false } = {}) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const merchant = MERCHANTS.find((name) => new RegExp(`\\b${name}\\b`, 'i').test(text));
  const store = merchant || (lines.find((l) => letters(l) >= 3 && !priceAtEnd(l)) || '').slice(0, 40);
  const items = [];
  let total = null;
  let above = null; // a name-only line waiting for its price on the next line

  for (const line of lines) {
    const p = priceAtEnd(line);
    if (!p) {
      // A bare quantity ("Qty: 1") or a detail line ("Sold by ...") sits between a
      // name and its price in online orders: the name above keeps waiting.
      if (letters(withoutQuantity(line)) >= 3 && !DETAIL_LINE.test(line)) above = NOT_AN_ITEM.test(line) ? null : line;
      continue;
    }
    const nameAbove = above;
    above = null;
    const { label } = p;
    if (NOT_AN_ITEM.test(label)) {
      if (/\btotal\b/i.test(label) && !/sub|tax|sav|disc|item/i.test(label)) total = p.value;
      continue;
    }
    if (p.negative || DISCOUNT.test(label)) {
      const last = items[items.length - 1];
      if (last) last.price = Math.max(0, Math.round((last.price - p.value) * 100) / 100);
      continue;
    }
    // "0.45 kg @ 3.99/kg   1.80" prices the item named on the line above.
    const name = cleanName(letters(withoutQuantity(label)) < 2 && nameAbove ? nameAbove : label);
    if (letters(withoutQuantity(name)) < 2 || p.value <= 0) continue;
    items.push({ name, price: p.value, category: categorize(name) });
  }

  const kept = items.filter((i) => i.price > 0);
  const sum = Math.round(kept.reduce((s, i) => s + i.price, 0) * 100) / 100;
  const eatingOut = looksLikeEatingOut(store);
  if (eatingOut) kept.forEach((i) => { i.category = 'Eating out'; });
  return {
    store,
    date: findDate(text, dayFirst) || toISODate(today),
    eatingOut,
    items: kept,
    total: total ?? sum,
  };
}

// Applies what the household has corrected before: a store or item the reader
// produced is swapped for the name and category it was changed to last time.
// `rules` is { stores: { key: name }, items: { key: { name, category } } }.
export function ruleKey(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function applyLearned(parsed, rules = {}) {
  const stores = rules.stores || {}, known = rules.items || {};
  const store = stores[ruleKey(parsed.store)] || parsed.store;
  const eatingOut = parsed.eatingOut || looksLikeEatingOut(store);
  const items = parsed.items.map((i) => {
    const rule = known[ruleKey(i.name)];
    const item = { ...i, read: i.name, ...(rule ? { name: rule.name, category: rule.category } : {}) };
    if (eatingOut) item.category = 'Eating out';
    return item;
  });
  return { ...parsed, store, read: parsed.store, eatingOut, items };
}

// What to remember after a review: every store or item whose name or category
// was changed from what the reader produced.
export function learnFrom(rules = {}, readStore, store, rows) {
  const out = { stores: { ...(rules.stores || {}) }, items: { ...(rules.items || {}) } };
  if (readStore && store && ruleKey(readStore) && readStore !== store) out.stores[ruleKey(readStore)] = store;
  for (const r of rows) {
    if (!r.read || !ruleKey(r.read) || r.category === 'Eating out') continue;
    if (r.read !== r.name || r.category !== categorize(r.read)) out.items[ruleKey(r.read)] = { name: r.name, category: r.category };
  }
  return out;
}
