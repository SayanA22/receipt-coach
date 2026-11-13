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
const NOT_AN_ITEM = /\b(sub\s*-?\s*total|total|tax|vat|gst|hst|pst|cash|change|visa|master\s*card|amex|debit|credit|balance|tender|card|savings?|discount|coupon|rounding|amount|payment|tip|gratuity|loyalty|points|items? sold)\b/i;
const PRICE_AT_END = /(-?)\s*[$€£]?\s*(\d{1,4})\s*[.,]\s*(\d{2})\s*-?\s*[A-Za-z]{0,2}\s*$/;

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
export function findDate(text) {
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    return a > 12 ? valid(y, b, a) : valid(y, a, b);
  }
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

export function parseReceipt(text, today = new Date()) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const store = (lines.find((l) => (l.match(/[A-Za-z]/g) || []).length >= 3 && !PRICE_AT_END.test(l)) || '').slice(0, 40);
  const items = [];
  let total = null;

  for (const line of lines) {
    const m = line.match(PRICE_AT_END);
    if (!m) continue;
    const price = (m[1] ? -1 : 1) * Number(`${m[2]}.${m[3]}`);
    const label = line.slice(0, m.index);
    if (NOT_AN_ITEM.test(label)) {
      if (/\btotal\b/i.test(label) && !/sub/i.test(label)) total = Math.abs(price);
      continue;
    }
    const name = cleanName(label);
    if ((name.match(/[A-Za-z]/g) || []).length < 2 || price <= 0) continue;
    items.push({ name, price, category: categorize(name) });
  }

  const sum = Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
  const eatingOut = looksLikeEatingOut(store);
  if (eatingOut) items.forEach((i) => { i.category = 'Eating out'; });
  return {
    store,
    date: findDate(text) || toISODate(today),
    eatingOut,
    items,
    total: total ?? sum,
  };
}
