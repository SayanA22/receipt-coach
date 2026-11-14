import { CATEGORIES, parseReceipt, categorize, looksLikeEatingOut, toISODate, applyLearned, learnFrom } from './parser.js';
import {
  summarize, generateInsights, WEEKDAYS, inMonth, toYM, budgetStatus,
  itemMemory, itemHistory, dueItems, itemKey, monthlyTotals, weekSummary, money, setCurrency,
} from './insights.js';
import { sampleReceipts } from './sample.js';

const KEY = 'receipt-coach-v1';
const LIST_KEY = 'receipt-coach-list-v1';
const BUDGET_KEY = 'receipt-coach-budget-v1';
const SETTINGS_KEY = 'receipt-coach-settings-v1';
const RULES_KEY = 'receipt-coach-rules-v1';
const $ = (id) => document.getElementById(id);
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------- storage (stays on this device) ----------
function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { alert('Could not save on this device. Storage may be full or blocked.'); }
}
let receipts = read(KEY, []);
let list = read(LIST_KEY, []);      // shopping list: { id, name, done }
let budget = Number(read(BUDGET_KEY, 0)) || 0; // monthly budget, 0 = not set
// currency symbol, how 03/04 dates are read, and monthly limits per category
let settings = { currency: '$', dayFirst: false, limits: {}, ...read(SETTINGS_KEY, {}) };
// corrections made on the review screen, reused on later receipts
let rules = read(RULES_KEY, { stores: {}, items: {} });
const save = () => write(KEY, receipts);
const saveList = () => write(LIST_KEY, list);
const saveSettings = () => { write(SETTINGS_KEY, settings); setCurrency(settings.currency); };
setCurrency(settings.currency);

// A short message above the tab bar, optionally with one action such as Undo.
let toastTimer = 0;
function toast(text, action, run) {
  clearTimeout(toastTimer);
  const box = $('toast');
  fill(box, el('span', {}, text), action ? el('button', { onclick: () => { box.hidden = true; run(); } }, action) : null);
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, 7000);
}

// ---------- tiny DOM helper ----------
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k);
  return n;
}
function fill(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}

// ---------- navigation ----------
function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  for (const b of document.querySelectorAll('nav button')) {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (view === 'add') renderSummary();
  if (view === 'dash') renderDash();
  if (view === 'insights') renderInsights();
  if (view === 'shop') renderShop();
  if (view === 'list') renderList();
  window.scrollTo(0, 0);
}
document.querySelector('nav').addEventListener('click', (e) => {
  if (e.target.dataset.view) show(e.target.dataset.view);
});

// The week at a glance on the Add screen: last 7 days, the month, one tip.
function renderSummary() {
  const box = $('summary');
  box.hidden = !receipts.length;
  if (box.hidden) return;
  const w = weekSummary(receipts);
  const b = budgetStatus(receipts, budget);
  const month = new Date().toLocaleDateString('en', { month: 'long' });
  const tip = generateInsights(receipts, new Date(), budget, settings.limits).find((i) => !/Keep adding|last week/.test(i.title));
  fill(box,
    el('h2', {}, 'This week'),
    el('p', {}, `${money(w.thisWeek)} in the last 7 days`,
      w.pct == null ? '.' : w.pct === 0 ? ', the same as the week before.' : `, ${w.pct > 0 ? 'up' : 'down'} ${Math.abs(w.pct)}% on the week before.`),
    el('p', { class: 'muted' }, budget > 0
      ? `${month} so far: ${money(b.spent)} of ${money(budget)}${b.left >= 0 ? `, ${money(b.left)} left` : `, ${money(-b.left)} over`}.`
      : `${month} so far: ${money(b.spent)}.`),
    tip ? el('p', { class: 'muted' }, `Tip: ${tip.title}. `) : null,
    tip ? el('button', { class: 'btn small', onclick: () => show('insights') }, 'See all tips') : null);
}

// ---------- add: read a photo ----------
// Phone photos are far bigger than the reader needs; shrinking them makes
// reading several times faster without losing the print.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1) return file;
    const canvas = el('canvas', { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch { return file; }
}

// One reader is started and kept, so the second receipt reads faster than the first.
let reader = null;
let onProgress = () => {};
function getReader() {
  reader ||= (async () => {
    const worker = await window.Tesseract.createWorker('eng', 1, {
      logger: (m) => { if (m.status === 'recognizing text') onProgress(m.progress); },
    });
    // Treat the receipt as one block of lines. The default layout guess splits
    // names and prices into separate columns and the prices get lost.
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    return worker;
  })();
  reader.catch(() => { reader = null; });
  return reader;
}

$('photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('status');
  if (!window.Tesseract) {
    status.textContent = 'The photo reader could not load (it needs internet the first time). You can type the receipt in instead.';
    return;
  }
  try {
    status.textContent = 'Reading the receipt… 0%';
    onProgress = (p) => { status.textContent = `Reading the receipt… ${Math.round(p * 100)}%`; };
    const { data } = await (await getReader()).recognize(await shrink(file));
    const parsed = applyLearned(parseReceipt(data.text, new Date(), { dayFirst: settings.dayFirst }), rules);
    status.textContent = parsed.items.length
      ? `Found ${parsed.items.length} items. Check them below.`
      : 'Could not find any items. Try a flatter, brighter photo, or type them in below.';
    openReview(parsed);
  } catch (err) {
    console.error(err);
    status.textContent = 'Sorry, that photo could not be read. Try again or type it in.';
  }
});

$('manual').addEventListener('click', () => {
  $('status').textContent = '';
  openReview({ store: '', date: toISODate(new Date()), eatingOut: false, items: [{ name: '', price: '', category: 'Other' }], total: '' });
});

// For markets, cash and online orders: a store and an amount, no items.
$('quick').addEventListener('click', () => {
  $('status').textContent = '';
  openReview({ store: '', date: toISODate(new Date()), eatingOut: false, items: [], total: '' }, null, 'Quick add');
  $('r-store').focus();
});

// ---------- add: review form (also used to edit a saved receipt) ----------
let totalTouched = false;
let editingId = null;
let memory = new Map(); // tidied item name -> what was paid last time

function itemRow(item) {
  const name = el('input', { placeholder: 'Item', value: item.name, 'aria-label': 'Item name', maxlength: 60, list: 'item-names', autocomplete: 'off' });
  const price = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '0.00', value: item.price === '' ? '' : Number(item.price).toFixed(2), 'aria-label': 'Price' });
  const cat = el('select', { 'aria-label': 'Category' }, CATEGORIES.map((c) => el('option', { selected: c === item.category }, c)));
  name.addEventListener('change', () => {
    // Fill in what is already known about this item from earlier receipts.
    const known = memory.get(itemKey(name.value));
    if (known) name.value = known.name; // keep one spelling so the history lines up
    if (cat.value === 'Other') cat.value = known ? known.category : categorize(name.value);
    if (known && price.value === '') { price.value = known.price.toFixed(2); syncTotal(); }
  });
  price.addEventListener('input', syncTotal);
  const row = el('div', { class: 'item' }, name, price, cat,
    el('button', { type: 'button', 'aria-label': 'Remove item', onclick: () => { row.remove(); syncTotal(); } }, '×'));
  row.dataset.read = item.read || ''; // what the photo reader produced, before any correction
  return row;
}

function readRows() {
  return [...$('r-items').children].map((row) => {
    const [name, price] = row.querySelectorAll('input');
    return { read: row.dataset.read, name: name.value.trim(), price: Number(price.value), category: row.querySelector('select').value };
  }).filter((i) => i.name && i.price > 0);
}
const readItems = () => readRows().map(({ name, price, category }) => ({ name, price, category }));

function syncTotal() {
  const sum = readItems().reduce((a, i) => a + i.price, 0);
  if (!totalTouched) $('r-total').value = sum ? sum.toFixed(2) : '';
  // Compare the items with the total so a misread price is easy to spot.
  const total = Number($('r-total').value);
  const hint = $('r-hint');
  const gap = total - sum;
  hint.hidden = !(sum > 0 && total > 0 && Math.abs(gap) >= 0.01);
  if (hint.hidden) return;
  const large = gap > sum * 0.25;
  hint.className = gap < 0 || large ? 'hint warn' : 'hint';
  hint.textContent = gap < 0
    ? `The items add up to ${money(sum)}, which is ${money(-gap)} more than the total. Check for a misread price or a discount.`
    : large
      ? `The items add up to ${money(sum)}, ${money(gap)} less than the total. An item may be missing.`
      : `The items add up to ${money(sum)}. The other ${money(gap)} is probably tax.`;
}

function openReview(p, id = null, title = id ? 'Edit receipt' : 'Check the details') {
  editingId = id;
  $('review').dataset.read = (!id && p.read) || '';
  memory = new Map(itemMemory(receipts).map((m) => [m.key, m]));
  fill($('stores'), [...new Set(receipts.map((r) => r.store).filter(Boolean))].map((s) => el('option', { value: s })));
  fill($('item-names'), [...memory.values()].slice(0, 200).map((m) => el('option', { value: m.name })));
  $('r-title').textContent = title;
  totalTouched = Boolean(p.total) && p.items.length > 0;
  $('r-store').value = p.store;
  $('r-date').value = p.date;
  $('r-out').checked = p.eatingOut;
  $('r-items').replaceChildren(...p.items.map(itemRow));
  $('r-total').value = p.total === '' ? '' : Number(p.total).toFixed(2);
  $('review').hidden = false;
  syncTotal();
  $('review').scrollIntoView({ behavior: 'smooth' });
}

function closeReview(message) {
  const wasEditing = editingId;
  editingId = null;
  $('review').hidden = true;
  $('status').textContent = message;
  if (wasEditing) show('list'); else renderSummary();
}

$('r-total').addEventListener('input', () => { totalTouched = true; syncTotal(); });
$('r-store').addEventListener('change', () => { if (looksLikeEatingOut($('r-store').value)) $('r-out').checked = true; });
$('r-add').addEventListener('click', () => {
  const row = itemRow({ name: '', price: '', category: 'Other' });
  $('r-items').append(row);
  row.querySelector('input').focus();
});
$('r-cancel').addEventListener('click', () => closeReview(''));

$('review').addEventListener('submit', (e) => {
  e.preventDefault();
  const eatingOut = $('r-out').checked;
  const items = readItems().map((i) => ({ ...i, category: eatingOut ? 'Eating out' : i.category }));
  const total = Number($('r-total').value);
  if (!items.length && !(total > 0)) { $('status').textContent = 'Add at least one item or a total.'; return; }
  const old = receipts.find((r) => r.id === editingId);
  const receipt = {
    ...(old && old.sample ? { sample: true } : {}),
    id: old ? old.id : newId(),
    store: $('r-store').value.trim(),
    date: $('r-date').value,
    eatingOut,
    items: items.length ? items : [{ name: 'Unlisted items', price: total, category: eatingOut ? 'Eating out' : 'Other' }],
    total: total > 0 ? total : items.reduce((a, i) => a + i.price, 0),
  };
  const twin = receipts.find((r) => r.id !== receipt.id && r.date === receipt.date
    && r.store.toLowerCase() === receipt.store.toLowerCase() && Math.abs(r.total - receipt.total) < 0.005);
  if (twin && !confirm(`You already saved a ${money(twin.total)} receipt from ${twin.store || 'this store'} on ${twin.date}. Save this one as well?`)) return;
  receipts = old ? receipts.map((r) => (r.id === old.id ? receipt : r)) : receipts.concat(receipt);
  save();
  // Remember any names or categories that were corrected, for next time.
  if (!old) {
    rules = learnFrom(rules, $('review').dataset.read, receipt.store, eatingOut ? [] : readRows());
    write(RULES_KEY, rules);
  }
  // Anything just bought comes off the shopping list.
  const bought = new Set(receipt.items.map((i) => itemKey(i.name)));
  const ticked = old ? [] : list.filter((i) => !i.done && bought.has(itemKey(i.name)));
  if (ticked.length) { ticked.forEach((i) => { i.done = true; }); saveList(); }
  closeReview(old ? '' : `Saved.${ticked.length ? ` Ticked ${ticked.length} item${ticked.length === 1 ? '' : 's'} off your shopping list.` : ''} Add another, or look at your dashboard.`);
});

// ---------- dashboard ----------
let dashMonth = toYM(new Date());

function bars(rows) {
  const max = Math.max(...rows.map((r) => r[1]), 0.01);
  return el('dl', { class: 'bars' }, rows.map(([label, value]) => [
    el('dt', {}, label),
    el('dd', { title: `${label}: ${money(value)}` },
      el('div', { class: 'bar', style: `width:${Math.max((value / max) * 70, 0.5)}%` }),
      el('span', {}, money(value))),
  ]));
}

function emptyState(text) {
  return el('div', { class: 'card' },
    el('h2', {}, 'Nothing here yet'),
    el('p', { class: 'muted' }, text),
    el('button', { class: 'btn', onclick: () => { receipts = receipts.concat(sampleReceipts()); save(); show('dash'); } }, 'Try it with sample receipts'));
}

function shiftMonth(ym, by) {
  const [y, m] = ym.split('-').map(Number);
  return toYM(new Date(y, m - 1 + by, 1));
}

function budgetForm(label) {
  const input = el('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', placeholder: 'e.g. 600', value: budget || '', 'aria-label': 'Monthly budget' });
  return el('form', { class: 'inline', onsubmit: (e) => {
    e.preventDefault();
    budget = Math.max(0, Number(input.value) || 0);
    write(BUDGET_KEY, budget);
    renderDash();
  } }, input, el('button', { class: 'btn primary' }, label));
}

function budgetCard(spent, isCurrent) {
  if (!budget) {
    return el('div', { class: 'card' },
      el('h2', {}, 'Set a monthly budget'),
      el('p', { class: 'muted' }, 'Pick what the household wants to spend each month. The app then shows what is left and how much a day that allows.'),
      budgetForm('Set'));
  }
  const b = budgetStatus(receipts, budget);
  const left = budget - spent;
  const days = `${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'}`;
  const line = !isCurrent
    ? (left >= 0 ? `Finished ${money(left)} under budget.` : `Finished ${money(-left)} over budget.`)
    : left < 0
      ? `${money(-left)} over budget with ${days} to go.`
      : `${money(left)} left. That is ${money(b.perDay)} a day for the next ${days}.`;
  const pace = isCurrent && b.state === 'fast' ? ` At this pace the month ends near ${money(b.projected)}.` : '';
  const form = budgetForm('Save');
  form.hidden = true;
  return el('div', { class: 'card' },
    el('h2', {}, 'Budget'),
    el('div', { class: 'big' }, `${money(spent)} of ${money(budget)}`),
    el('div', { class: `meter${left < 0 ? ' over' : ''}`, role: 'img', 'aria-label': `${Math.round((spent / budget) * 100)}% of budget used` },
      el('div', { style: `width:${Math.min((spent / budget) * 100, 100)}%` })),
    el('p', { class: 'muted' }, line + pace),
    form,
    el('button', { class: 'btn small', onclick: (e) => { form.hidden = false; e.target.hidden = true; form.querySelector('input').focus(); } }, 'Change budget'));
}

// Monthly limits for single categories, e.g. eating out.
function limitsCard(byCategory) {
  const spent = Object.fromEntries(byCategory);
  const limited = CATEGORIES.filter((c) => settings.limits[c] > 0);
  const inputs = CATEGORIES.map((c, n) => [c, el('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', placeholder: 'no limit', value: settings.limits[c] || '', id: `limit-${n}` })]);
  const form = el('form', { hidden: true, onsubmit: (e) => {
    e.preventDefault();
    settings.limits = Object.fromEntries(inputs.map(([c, i]) => [c, Number(i.value) || 0]).filter(([, v]) => v > 0));
    saveSettings();
    renderDash();
  } },
    el('div', { class: 'fields' }, inputs.map(([c, i]) => [el('label', { for: i.id }, c), i])),
    el('button', { class: 'btn primary' }, 'Save limits'));
  return el('div', { class: 'card' },
    el('h2', {}, 'Category limits'),
    limited.length ? limited.map((c) => {
      const used = spent[c] || 0, limit = settings.limits[c];
      return el('div', { class: 'limit' },
        el('div', {}, el('span', {}, c), el('span', {}, `${money(used)} of ${money(limit)}`)),
        el('div', { class: `meter${used > limit ? ' over' : ''}`, role: 'img', 'aria-label': `${Math.round((used / limit) * 100)}% of the ${c} limit used` },
          el('div', { style: `width:${Math.min((used / limit) * 100, 100)}%` })));
    }) : el('p', { class: 'muted' }, 'Cap a single category for the month, for example eating out or snacks.'),
    form,
    el('button', { class: 'btn small', onclick: (e) => { form.hidden = false; e.target.hidden = true; } }, limited.length ? 'Change limits' : 'Set limits'));
}

function renderDash() {
  const view = $('view-dash');
  if (!receipts.length) { fill(view, emptyState('Add a few receipts and your spending will show up here.')); return; }
  const isCurrent = dashMonth === toYM(new Date());
  const month = inMonth(receipts, dashMonth);
  const s = summarize(month);
  const prev = summarize(inMonth(receipts, shiftMonth(dashMonth, -1))).total;
  const [y, m] = dashMonth.split('-').map(Number);
  const title = new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' });
  const go = (by) => () => { dashMonth = shiftMonth(dashMonth, by); renderDash(); };
  fill(view,
    el('div', { class: 'monthnav' },
      el('button', { class: 'btn', 'aria-label': 'Previous month', onclick: go(-1) }, '‹'),
      el('h2', {}, title),
      el('button', { class: 'btn', 'aria-label': 'Next month', disabled: isCurrent, onclick: go(1) }, '›')),
    budgetCard(s.total, isCurrent),
    el('div', { class: 'tiles' },
      el('div', { class: 'tile' }, el('b', {}, money(s.total)), el('span', {}, 'spent')),
      el('div', { class: 'tile' }, el('b', {}, money(prev)), el('span', {}, 'month before')),
      el('div', { class: 'tile' }, el('b', {}, String(s.count)), el('span', {}, s.count === 1 ? 'receipt' : 'receipts'))),
    month.length ? [
      el('div', { class: 'card' }, el('h2', {}, 'What it went on'), bars(s.byCategory)),
      limitsCard(s.byCategory),
      el('div', { class: 'card' }, el('h2', {}, 'Where you shopped'), bars(s.byStore.slice(0, 6))),
      el('div', { class: 'card' }, el('h2', {}, 'Day of the week'), bars(WEEKDAYS.map((d, i) => [d, s.byWeekday[i]]))),
    ] : el('p', { class: 'muted' }, 'No receipts in this month.'),
    el('div', { class: 'card' }, el('h2', {}, 'Month by month'),
      // Months before the first receipt are left out.
      bars(monthlyTotals(receipts, new Date(y, m - 1, 1)).filter((t, i, all) => all.slice(0, i + 1).some((x) => x.total > 0) || i === all.length - 1)
        .map((t) => [t.label, t.total]))));
}

// ---------- insights ----------
function renderInsights() {
  const view = $('view-insights');
  if (!receipts.length) { fill(view, emptyState('Suggestions appear once there are receipts to learn from.')); return; }
  const tips = generateInsights(receipts, new Date(), budget, settings.limits);
  fill(view,
    el('h2', {}, 'What your receipts say'),
    el('p', { class: 'muted' }, 'Based on the last 30 days.'),
    tips.length ? tips.map((i) => el('div', { class: 'card insight' },
      el('h2', {}, i.title),
      el('p', {}, i.detail),
      i.list ? el('ul', {}, i.list.map((x) => el('li', {}, x))) : null))
      : el('p', { class: 'muted' }, 'Nothing stands out in the last 30 days.'));
}

// ---------- shopping list ----------
function addToList(name) {
  const clean = name.trim().slice(0, 60);
  if (!clean) return;
  const same = list.find((i) => itemKey(i.name) === itemKey(clean));
  if (same) same.done = false; else list.push({ id: newId(), name: clean, done: false });
  saveList();
  renderShop();
}

async function shareList() {
  const text = `Shopping list\n${list.filter((i) => !i.done).map((i) => `- ${i.name}`).join('\n')}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); alert('List copied. Paste it into a message.'); }
  } catch { /* the share sheet was closed */ }
}

function renderShop() {
  const view = $('view-shop');
  const known = itemMemory(receipts);
  const mem = new Map(known.map((m) => [m.key, m]));
  const onList = new Set(list.map((i) => itemKey(i.name)));
  const due = dueItems(receipts).filter((d) => !onList.has(itemKey(d.name)));
  const dueKeys = new Set(due.map((d) => itemKey(d.name)));
  const often = known.filter((m) => m.count >= 2 && !onList.has(m.key) && !dueKeys.has(m.key)).slice(0, 8);
  const open = list.filter((i) => !i.done), done = list.filter((i) => i.done);
  const priced = open.filter((i) => mem.has(itemKey(i.name)));
  const estimate = priced.reduce((a, i) => a + mem.get(itemKey(i.name)).price, 0);

  const input = el('input', { placeholder: 'Add an item', 'aria-label': 'Item to buy', maxlength: 60, list: 'shop-names', autocomplete: 'off' });
  const row = (i) => {
    const last = mem.get(itemKey(i.name));
    return el('div', { class: `todo${i.done ? ' done' : ''}` },
      el('label', {},
        el('input', { type: 'checkbox', checked: i.done, onchange: (e) => { i.done = e.target.checked; saveList(); renderShop(); } }),
        el('span', {}, i.name, last && !i.done ? el('small', {}, `last time ${money(last.price)}${last.store ? ` at ${last.store}` : ''}`) : null)),
      el('button', { 'aria-label': `Remove ${i.name}`, onclick: () => { list = list.filter((x) => x.id !== i.id); saveList(); renderShop(); } }, '×'));
  };
  const chips = (items) => el('div', { class: 'chips' }, items.map((x) => el('button', { class: 'chip', onclick: () => addToList(x.name) }, `+ ${x.name}`)));

  fill(view,
    el('h2', {}, 'Shopping list'),
    el('div', { class: 'card' },
      el('form', { class: 'inline', onsubmit: (e) => { e.preventDefault(); addToList(input.value); } },
        input, el('button', { class: 'btn primary' }, 'Add')),
      el('datalist', { id: 'shop-names' }, known.slice(0, 200).map((m) => el('option', { value: m.name }))),
      open.length ? open.map(row) : el('p', { class: 'muted' }, 'Nothing to buy yet. Type an item above or tap a suggestion below.'),
      open.length ? el('p', { class: 'hint' }, priced.length
        ? `About ${money(estimate)} at the prices you paid last time${priced.length < open.length ? ` (${open.length - priced.length} not priced yet)` : ''}.`
        : 'Prices appear here once these items are on a saved receipt.') : null,
      open.length ? el('button', { class: 'btn', onclick: shareList }, 'Send list to someone') : null),
    due.length ? el('div', { class: 'card' },
      el('h2', {}, 'Probably running low'),
      el('p', { class: 'muted' }, 'You buy these regularly and they are due again. Tap to add.'),
      chips(due)) : null,
    often.length ? el('div', { class: 'card' },
      el('h2', {}, 'You often buy'),
      chips(often)) : null,
    done.length ? el('div', { class: 'card' },
      el('h2', {}, 'In the basket'),
      done.map(row),
      el('button', { class: 'btn small', onclick: () => { list = list.filter((i) => !i.done); saveList(); renderShop(); } }, 'Clear ticked items')) : null);
}

// ---------- receipts list and backup ----------
let query = '';

function renderList() {
  const view = $('view-list');
  const results = el('div', {});
  const draw = () => {
    const q = query.trim().toLowerCase();
    const found = [...receipts].sort((a, b) => b.date.localeCompare(a.date))
      .filter((r) => !q || r.store.toLowerCase().includes(q) || r.items.some((i) => i.name.toLowerCase().includes(q)));
    // Searching an item also shows what it has cost, where and when.
    const priced = q.length < 2 ? [] : Object.values(itemHistory(receipts))
      .filter((h) => h[h.length - 1].name.toLowerCase().includes(q)).slice(0, 3);
    fill(results,
      priced.map((h) => {
        const low = h.reduce((a, x) => (x.price < a.price ? x : a));
        return el('div', { class: 'card receipt prices' },
          el('h2', {}, `${h[h.length - 1].name}: price history`),
          el('p', { class: 'muted' }, `Lowest ${money(low.price)}${low.store ? ` at ${low.store}` : ''}. Bought ${h.length} time${h.length === 1 ? '' : 's'}.`),
          el('table', {}, [...h].reverse().slice(0, 8).map((x) => el('tr', {}, el('td', {}, x.date), el('td', {}, x.store || ''), el('td', {}, money(x.price))))));
      }),
      q ? el('p', { class: 'muted' }, `${found.length} matching receipt${found.length === 1 ? '' : 's'}.`) : null,
      found.map((r) => el('details', { class: 'card receipt', open: Boolean(q) },
        el('summary', {}, el('span', {}, r.store || 'Unknown store', el('small', {}, r.date + (r.eatingOut ? ' · eating out' : ''))), el('span', {}, money(r.total))),
        el('table', {}, r.items.map((i) => el('tr', {}, el('td', {}, i.name, ' ', el('small', {}, i.category)), el('td', {}, money(i.price))))),
        el('div', { class: 'row' },
          el('button', { class: 'btn small', onclick: () => { show('add'); openReview(r, r.id); } }, 'Edit'),
          el('button', { class: 'btn small danger', onclick: () => {
            receipts = receipts.filter((x) => x.id !== r.id); save(); renderList();
            toast('Receipt deleted.', 'Undo', () => { receipts = receipts.concat(r); save(); renderList(); });
          } }, 'Delete')))));
  };
  draw();
  const currency = el('input', { id: 'set-currency', maxlength: 3, value: settings.currency,
    onchange: (e) => { settings.currency = e.target.value.trim() || '$'; saveSettings(); renderList(); } });
  const dates = el('select', { id: 'set-dates', onchange: (e) => { settings.dayFirst = e.target.value === 'd'; saveSettings(); } },
    el('option', { value: 'm', selected: !settings.dayFirst }, 'month/day'),
    el('option', { value: 'd', selected: settings.dayFirst }, 'day/month'));
  fill(view,
    el('h2', {}, `${receipts.length} receipt${receipts.length === 1 ? '' : 's'}`),
    receipts.length ? el('input', { type: 'search', placeholder: 'Search a store or an item', 'aria-label': 'Search receipts', value: query,
      oninput: (e) => { query = e.target.value; draw(); } }) : null,
    results,
    el('div', { class: 'card' },
      el('h2', {}, 'Backup'),
      el('p', { class: 'muted' }, 'Everything is stored only on this device. Save a backup file to keep it safe or move it to another phone.'),
      el('button', { class: 'btn', onclick: exportData }, 'Save backup file'),
      el('label', { class: 'btn', for: 'import' }, 'Load backup file'),
      el('input', { id: 'import', type: 'file', accept: 'application/json,.json', hidden: true, onchange: importData }),
      canShareFiles() ? el('button', { class: 'btn', onclick: shareData }, 'Send to another phone') : null,
      receipts.length ? el('button', { class: 'btn', onclick: exportCsv }, 'Save as spreadsheet (CSV)') : null,
      receipts.some((r) => r.sample) ? el('button', { class: 'btn danger', onclick: () => { receipts = receipts.filter((r) => !r.sample); save(); renderList(); } }, 'Remove sample receipts') : null),
    el('div', { class: 'card' },
      el('h2', {}, 'Settings'),
      el('div', { class: 'fields' },
        el('label', { for: 'set-currency' }, 'Currency symbol'), currency,
        el('label', { for: 'set-dates' }, 'A receipt date like 03/04 means'), dates)));
}

const backupName = () => `receipts-${toISODate(new Date())}`;
const backupJson = () => JSON.stringify({ app: 'receipt-coach', version: 3, receipts, list, budget, settings, rules }, null, 2);

function download(text, type, name) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportData() { download(backupJson(), 'application/json', `${backupName()}.json`); }

// Hands the backup to the phone's share sheet (messages, AirDrop, email).
// The other phone opens it with "Load backup file", which only adds what is new.
function shareFile() { return new File([backupJson()], `${backupName()}.json`, { type: 'application/json' }); }
function canShareFiles() {
  try { return Boolean(navigator.canShare && navigator.canShare({ files: [shareFile()] })); } catch { return false; }
}
async function shareData() {
  try { await navigator.share({ files: [shareFile()], title: 'Receipt Coach backup' }); } catch { /* the share sheet was closed */ }
}

function exportCsv() {
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['Date', 'Store', 'Item', 'Category', 'Price', 'Receipt total', 'Eating out']];
  for (const r of [...receipts].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const i of r.items) rows.push([r.date, r.store, i.name, i.category, i.price.toFixed(2), r.total.toFixed(2), r.eatingOut ? 'yes' : 'no']);
  }
  download(rows.map((r) => r.map(cell).join(',')).join('\r\n'), 'text/csv', `${backupName()}.csv`);
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    // Older backups are a plain list of receipts.
    const incoming = Array.isArray(data) ? data : data && data.receipts;
    if (!Array.isArray(incoming)) throw new Error('not a backup');
    const good = incoming.filter((r) => r && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Array.isArray(r.items) && typeof r.total === 'number')
      .map((r) => ({
        ...(r.sample ? { sample: true } : {}),
        id: String(r.id || newId()),
        store: String(r.store || ''), date: r.date, eatingOut: Boolean(r.eatingOut), total: r.total,
        items: r.items.filter((i) => i && typeof i.price === 'number').map((i) => ({ name: String(i.name || ''), price: i.price, category: CATEGORIES.includes(i.category) ? i.category : 'Other' })),
      }));
    const have = new Set(receipts.map((r) => r.id));
    const fresh = good.filter((r) => !have.has(r.id));
    receipts = receipts.concat(fresh);
    save();
    if (!budget && Number(data.budget) > 0) { budget = Number(data.budget); write(BUDGET_KEY, budget); }
    // Settings come across only onto a phone that has none of its own yet.
    if (data.settings && typeof data.settings === 'object' && localStorage.getItem(SETTINGS_KEY) == null) {
      const limits = {};
      for (const c of CATEGORIES) if (Number(data.settings.limits?.[c]) > 0) limits[c] = Number(data.settings.limits[c]);
      settings = { currency: String(data.settings.currency || '$').slice(0, 3), dayFirst: Boolean(data.settings.dayFirst), limits };
      saveSettings();
    }
    // Corrections learned on the other phone are added; this phone's own win a clash.
    if (data.rules && typeof data.rules === 'object') {
      const text = (v) => typeof v === 'string' && v.trim();
      const theirs = { stores: {}, items: {} };
      for (const [k, v] of Object.entries(data.rules.stores || {})) if (text(v)) theirs.stores[k] = v.slice(0, 40);
      for (const [k, v] of Object.entries(data.rules.items || {})) {
        if (v && text(v.name) && CATEGORIES.includes(v.category)) theirs.items[k] = { name: v.name.slice(0, 60), category: v.category };
      }
      rules = { stores: { ...theirs.stores, ...rules.stores }, items: { ...theirs.items, ...rules.items } };
      write(RULES_KEY, rules);
    }
    if (Array.isArray(data.list)) {
      const names = new Set(list.map((i) => itemKey(i.name)));
      for (const i of data.list) {
        if (!i || typeof i.name !== 'string' || !i.name.trim() || names.has(itemKey(i.name))) continue;
        names.add(itemKey(i.name));
        list.push({ id: newId(), name: i.name.trim().slice(0, 60), done: Boolean(i.done) });
      }
      saveList();
    }
    renderList();
    alert(`Added ${fresh.length} receipt${fresh.length === 1 ? '' : 's'} from the backup.`);
  } catch {
    alert('That file is not a Receipt Coach backup.');
  }
}

renderSummary();

// Keep the app and the reader on the phone, so both work with no signal.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    // Start the reader once in the background: its files are saved for offline
    // use and the first photo reads sooner.
    if (window.Tesseract && navigator.onLine) setTimeout(() => getReader().catch(() => {}), 3000);
  }).catch(() => {});
}
