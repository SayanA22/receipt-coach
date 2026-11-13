import { CATEGORIES, parseReceipt, categorize, looksLikeEatingOut, toISODate } from './parser.js';
import { summarize, generateInsights, within, WEEKDAYS } from './insights.js';
import { sampleReceipts } from './sample.js';

const KEY = 'receipt-coach-v1';
const $ = (id) => document.getElementById(id);
const money = (n) => `$${n.toFixed(2)}`;

// ---------- storage (stays on this device) ----------
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { alert('Could not save on this device. Storage may be full or blocked.'); }
}
let receipts = load();

// ---------- tiny DOM helper ----------
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null) n.append(k);
  return n;
}
function fill(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null));
}

// ---------- navigation ----------
function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  for (const b of document.querySelectorAll('nav button')) {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (view === 'dash') renderDash();
  if (view === 'insights') renderInsights();
  if (view === 'list') renderList();
  window.scrollTo(0, 0);
}
document.querySelector('nav').addEventListener('click', (e) => {
  if (e.target.dataset.view) show(e.target.dataset.view);
});

// ---------- add: read a photo ----------
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
    const { data } = await window.Tesseract.recognize(file, 'eng', {
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

// ---------- add: review form ----------
let totalTouched = false;

function itemRow(item) {
  const name = el('input', { placeholder: 'Item', value: item.name, 'aria-label': 'Item name', maxlength: 60 });
  const price = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '0.00', value: item.price === '' ? '' : Number(item.price).toFixed(2), 'aria-label': 'Price' });
  const cat = el('select', { 'aria-label': 'Category' }, CATEGORIES.map((c) => el('option', { selected: c === item.category }, c)));
  name.addEventListener('change', () => { if (cat.value === 'Other') cat.value = categorize(name.value); });
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
  if (totalTouched) return;
  const sum = readItems().reduce((a, i) => a + i.price, 0);
  $('r-total').value = sum ? sum.toFixed(2) : '';
}

function openReview(p) {
  totalTouched = Boolean(p.total) && p.items.length > 0;
  $('r-store').value = p.store;
  $('r-date').value = p.date;
  $('r-out').checked = p.eatingOut;
  $('r-items').replaceChildren(...p.items.map(itemRow));
  $('r-total').value = p.total === '' ? '' : Number(p.total).toFixed(2);
  $('review').hidden = false;
  $('review').scrollIntoView({ behavior: 'smooth' });
}

$('r-total').addEventListener('input', () => { totalTouched = true; });
$('r-store').addEventListener('change', () => { if (looksLikeEatingOut($('r-store').value)) $('r-out').checked = true; });
$('r-add').addEventListener('click', () => {
  const row = itemRow({ name: '', price: '', category: 'Other' });
  $('r-items').append(row);
  row.querySelector('input').focus();
});
$('r-cancel').addEventListener('click', () => { $('review').hidden = true; $('status').textContent = ''; });

$('review').addEventListener('submit', (e) => {
  e.preventDefault();
  const eatingOut = $('r-out').checked;
  const items = readItems().map((i) => ({ ...i, category: eatingOut ? 'Eating out' : i.category }));
  const total = Number($('r-total').value);
  if (!items.length && !(total > 0)) { $('status').textContent = 'Add at least one item or a total.'; return; }
  receipts.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    store: $('r-store').value.trim(),
    date: $('r-date').value,
    eatingOut,
    items: items.length ? items : [{ name: 'Unlisted items', price: total, category: eatingOut ? 'Eating out' : 'Other' }],
    total: total > 0 ? total : items.reduce((a, i) => a + i.price, 0),
  });
  save(receipts);
  $('review').hidden = true;
  $('status').textContent = 'Saved. Add another, or look at your dashboard.';
});

// ---------- dashboard ----------
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
    el('button', { class: 'btn', onclick: () => { receipts = receipts.concat(sampleReceipts()); save(receipts); show('dash'); } }, 'Try it with sample receipts'));
}

function renderDash() {
  const view = $('view-dash');
  if (!receipts.length) { fill(view, emptyState('Add a few receipts and your spending will show up here.')); return; }
  const month = within(receipts, 30);
  const s = summarize(month);
  const week = summarize(within(receipts, 7)).total;
  fill(view, 
    el('h2', {}, 'Last 30 days'),
    el('div', { class: 'tiles' },
      el('div', { class: 'tile' }, el('b', {}, money(s.total)), el('span', {}, 'spent')),
      el('div', { class: 'tile' }, el('b', {}, money(week)), el('span', {}, 'last 7 days')),
      el('div', { class: 'tile' }, el('b', {}, String(s.count)), el('span', {}, 'receipts'))),
    month.length ? [
      el('div', { class: 'card' }, el('h2', {}, 'What it went on'), bars(s.byCategory)),
      el('div', { class: 'card' }, el('h2', {}, 'Where you shopped'), bars(s.byStore.slice(0, 6))),
      el('div', { class: 'card' }, el('h2', {}, 'Day of the week'), bars(WEEKDAYS.map((d, i) => [d, s.byWeekday[i]]))),
    ] : el('p', { class: 'muted' }, 'No receipts dated in the last 30 days.'));
}

// ---------- insights ----------
function renderInsights() {
  const view = $('view-insights');
  if (!receipts.length) { fill(view, emptyState('Suggestions appear once there are receipts to learn from.')); return; }
  const list = generateInsights(receipts);
  fill(view, 
    el('h2', {}, 'What your receipts say'),
    list.length ? list.map((i) => el('div', { class: 'card insight' },
      el('h2', {}, i.title),
      el('p', {}, i.detail),
      i.list ? el('ul', {}, i.list.map((x) => el('li', {}, x))) : null))
      : el('p', { class: 'muted' }, 'Nothing stands out in the last 30 days.'));
}

// ---------- receipts list and backup ----------
function renderList() {
  const view = $('view-list');
  const sorted = [...receipts].sort((a, b) => b.date.localeCompare(a.date));
  const hasSample = receipts.some((r) => r.sample);
  fill(view, 
    el('h2', {}, `${receipts.length} receipt${receipts.length === 1 ? '' : 's'}`),
    sorted.map((r) => el('details', { class: 'card receipt' },
      el('summary', {}, el('span', {}, r.store || 'Unknown store', el('small', {}, r.date + (r.eatingOut ? ' · eating out' : ''))), el('span', {}, money(r.total))),
      el('table', {}, r.items.map((i) => el('tr', {}, el('td', {}, i.name, ' ', el('small', {}, i.category)), el('td', {}, money(i.price))))),
      el('button', { class: 'btn small danger', onclick: () => {
        if (!confirm('Delete this receipt?')) return;
        receipts = receipts.filter((x) => x.id !== r.id); save(receipts); renderList();
      } }, 'Delete'))),
    el('div', { class: 'card' },
      el('h2', {}, 'Backup'),
      el('p', { class: 'muted' }, 'Receipts are stored only on this device. Save a backup file to keep them safe or move them to another phone.'),
      el('button', { class: 'btn', onclick: exportData }, 'Save backup file'),
      el('label', { class: 'btn', for: 'import' }, 'Load backup file'),
      el('input', { id: 'import', type: 'file', accept: 'application/json,.json', hidden: true, onchange: importData }),
      hasSample ? el('button', { class: 'btn danger', onclick: () => { receipts = receipts.filter((r) => !r.sample); save(receipts); renderList(); } }, 'Remove sample receipts') : null));
}

function exportData() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(receipts, null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: `receipts-${toISODate(new Date())}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error('not a list');
    const good = data.filter((r) => r && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Array.isArray(r.items) && typeof r.total === 'number')
      .map((r) => ({
        id: String(r.id || `${Date.now()}-${Math.random()}`),
        store: String(r.store || ''), date: r.date, eatingOut: Boolean(r.eatingOut), total: r.total,
        items: r.items.filter((i) => i && typeof i.price === 'number').map((i) => ({ name: String(i.name || ''), price: i.price, category: CATEGORIES.includes(i.category) ? i.category : 'Other' })),
      }));
    const have = new Set(receipts.map((r) => r.id));
    const fresh = good.filter((r) => !have.has(r.id));
    receipts = receipts.concat(fresh);
    save(receipts);
    renderList();
    alert(`Added ${fresh.length} receipt${fresh.length === 1 ? '' : 's'} from the backup.`);
  } catch {
    alert('That file is not a Receipt Coach backup.');
  }
}
