import { CATEGORIES, parseReceipt, categorize, looksLikeEatingOut, toISODate } from './parser.js';
import {
  summarize, generateInsights, WEEKDAYS, inMonth, toYM, budgetStatus,
  itemMemory, dueItems, itemKey,
} from './insights.js';
import { sampleReceipts } from './sample.js';

const KEY = 'receipt-coach-v1';
const LIST_KEY = 'receipt-coach-list-v1';
const BUDGET_KEY = 'receipt-coach-budget-v1';
const $ = (id) => document.getElementById(id);
const money = (n) => `$${n.toFixed(2)}`;
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
const save = () => write(KEY, receipts);
const saveList = () => write(LIST_KEY, list);

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
  if (view === 'add') renderMonthLine();
  if (view === 'dash') renderDash();
  if (view === 'insights') renderInsights();
  if (view === 'shop') renderShop();
  if (view === 'list') renderList();
  window.scrollTo(0, 0);
}
document.querySelector('nav').addEventListener('click', (e) => {
  if (e.target.dataset.view) show(e.target.dataset.view);
});

// One line on the Add screen saying where the month stands.
function renderMonthLine() {
  const b = budgetStatus(receipts, budget);
  const month = new Date().toLocaleDateString('en', { month: 'long' });
  $('month-line').textContent = !receipts.length ? ''
    : budget > 0
      ? `${month} so far: ${money(b.spent)} of ${money(budget)}${b.left >= 0 ? `, ${money(b.left)} left` : `, ${money(-b.left)} over`}.`
      : `${month} so far: ${money(b.spent)}.`;
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
    const { data } = await window.Tesseract.recognize(await shrink(file), 'eng', {
      logger: (m) => { if (m.status === 'recognizing text') status.textContent = `Reading the receipt… ${Math.round(m.progress * 100)}%`; },
    });
    const parsed = parseReceipt(data.text);
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
  return row;
}

function readItems() {
  return [...$('r-items').children].map((row) => {
    const [name, price] = row.querySelectorAll('input');
    return { name: name.value.trim(), price: Number(price.value), category: row.querySelector('select').value };
  }).filter((i) => i.name && i.price > 0);
}

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

function openReview(p, id = null) {
  editingId = id;
  memory = new Map(itemMemory(receipts).map((m) => [m.key, m]));
  fill($('stores'), [...new Set(receipts.map((r) => r.store).filter(Boolean))].map((s) => el('option', { value: s })));
  fill($('item-names'), [...memory.values()].slice(0, 200).map((m) => el('option', { value: m.name })));
  $('r-title').textContent = id ? 'Edit receipt' : 'Check the details';
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
  if (wasEditing) show('list'); else renderMonthLine();
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
      el('div', { class: 'card' }, el('h2', {}, 'Where you shopped'), bars(s.byStore.slice(0, 6))),
      el('div', { class: 'card' }, el('h2', {}, 'Day of the week'), bars(WEEKDAYS.map((d, i) => [d, s.byWeekday[i]]))),
    ] : el('p', { class: 'muted' }, 'No receipts in this month.'));
}

// ---------- insights ----------
function renderInsights() {
  const view = $('view-insights');
  if (!receipts.length) { fill(view, emptyState('Suggestions appear once there are receipts to learn from.')); return; }
  const tips = generateInsights(receipts, new Date(), budget);
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
    fill(results,
      q ? el('p', { class: 'muted' }, `${found.length} matching receipt${found.length === 1 ? '' : 's'}.`) : null,
      found.map((r) => el('details', { class: 'card receipt', open: Boolean(q) },
        el('summary', {}, el('span', {}, r.store || 'Unknown store', el('small', {}, r.date + (r.eatingOut ? ' · eating out' : ''))), el('span', {}, money(r.total))),
        el('table', {}, r.items.map((i) => el('tr', {}, el('td', {}, i.name, ' ', el('small', {}, i.category)), el('td', {}, money(i.price))))),
        el('div', { class: 'row' },
          el('button', { class: 'btn small', onclick: () => { show('add'); openReview(r, r.id); } }, 'Edit'),
          el('button', { class: 'btn small danger', onclick: () => {
            if (!confirm('Delete this receipt?')) return;
            receipts = receipts.filter((x) => x.id !== r.id); save(); renderList();
          } }, 'Delete')))));
  };
  draw();
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
      receipts.some((r) => r.sample) ? el('button', { class: 'btn danger', onclick: () => { receipts = receipts.filter((r) => !r.sample); save(); renderList(); } }, 'Remove sample receipts') : null));
}

function exportData() {
  const data = { app: 'receipt-coach', version: 2, receipts, list, budget };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: `receipts-${toISODate(new Date())}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

renderMonthLine();
