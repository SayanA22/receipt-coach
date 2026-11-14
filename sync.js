// Family sharing: every phone that enters the same family code keeps the same
// receipts, shopping list, budget and settings.
//
// What is stored online is one scrambled blob per family. The code never leaves
// the phones: the place the blob is kept and the key that unscrambles it are
// both worked out from the code, so the database only ever sees unreadable text.
//
// No browser-only APIs here except fetch (passed in), so this file is tested with Node.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to mistype
const KEEP_DELETED_MS = 180 * 86400000;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- family code ----------
export function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => ALPHABET[b % 32]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

// Accepts the code however it was typed: lower case, spaces, missing dashes.
export function tidyCode(text) {
  const chars = String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (chars.length !== 16 || [...chars].some((c) => !ALPHABET.includes(c))) return null;
  return chars.match(/.{4}/g).join('-');
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// From the code: where the family's blob lives, and the key that opens it.
export async function familyFromCode(code) {
  const id = hex(await crypto.subtle.digest('SHA-256', enc.encode(`receipt-coach family ${code}`)));
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('receipt-coach key v1'), iterations: 150000 },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { id, key };
}

// ---------- scrambling ----------
async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// state -> text safe to store online. A leading "z" means it was compressed first.
export async function seal(state, key) {
  let bytes = enc.encode(JSON.stringify(state));
  let tag = 'p';
  if (typeof CompressionStream === 'function') { bytes = await pipe(bytes, new CompressionStream('gzip')); tag = 'z'; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const all = new Uint8Array(12 + body.length);
  all.set(iv); all.set(body, 12);
  return tag + toBase64(all);
}

export async function unseal(text, key) {
  const all = fromBase64(text.slice(1));
  let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12)));
  if (text[0] === 'z') bytes = await pipe(bytes, new DecompressionStream('gzip'));
  return JSON.parse(dec.decode(bytes));
}

// ---------- merging two phones' data ----------
// Shared state:
//   { receipts: [...], list: [...], budget: {value, t}, settings: {value, t}, rules: {value, t} }
// Every receipt and list entry carries `updated` (ms). A deleted one stays as
// { id, deleted: true, updated } so the deletion reaches the other phones too.
// Whichever phone changed a thing last wins.
export const emptyState = () => ({ receipts: [], list: [], budget: { value: 0, t: 0 }, settings: { value: null, t: 0 }, rules: { value: null, t: 0 } });

// Two versions changed at the same moment: every phone must pick the same one,
// or they would keep overwriting each other. A deletion wins; otherwise the
// choice is arbitrary but identical everywhere.
function tieGoesTo(x, have) {
  if (Boolean(x.deleted) !== Boolean(have.deleted)) return Boolean(x.deleted);
  return JSON.stringify(x) > JSON.stringify(have);
}

function newest(a = [], b = [], now) {
  const byId = new Map();
  for (const x of [...a, ...b]) {
    if (!x || x.id == null) continue;
    const have = byId.get(x.id);
    const dx = x.updated || 0, dh = have ? have.updated || 0 : 0;
    if (!have || dx > dh || (dx === dh && tieGoesTo(x, have))) byId.set(x.id, x);
  }
  return [...byId.values()]
    .filter((x) => !(x.deleted && now - (x.updated || 0) > KEEP_DELETED_MS))
    .sort((x, y) => String(x.id).localeCompare(String(y.id)));
}
function later(a, b) {
  const ta = a?.t || 0, tb = b?.t || 0;
  if (ta !== tb) return (tb > ta ? b : a) || { value: null, t: 0 };
  // Same moment (or neither phone ever set it): a set value beats an empty one,
  // then the same arbitrary-but-identical choice as above.
  const text = (x) => JSON.stringify(x?.value ?? null);
  const empty = (x) => x?.value == null || x.value === 0;
  if (empty(a) !== empty(b)) return (empty(a) ? b : a) || { value: null, t: 0 };
  return (text(b) > text(a) ? b : a) || { value: null, t: 0 };
}

export function mergeStates(a, b, now = Date.now()) {
  return {
    receipts: newest(a.receipts, b.receipts, now),
    list: newest(a.list, b.list, now),
    budget: later(a.budget, b.budget),
    settings: later(a.settings, b.settings),
    rules: later(a.rules, b.rules),
  };
}

// The same data always gives the same text, whatever order it was built in.
export function fingerprint(state) {
  const tidy = (v) => (Array.isArray(v) ? v.map(tidy)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, tidy(v[k])])) : v);
  return JSON.stringify(tidy(mergeStates(state, emptyState(), 0)));
}

// ---------- the online store (Cloud Firestore, plain web requests) ----------
// One document per family: families/{id} with a single text field "data".
export function firestoreStore({ projectId }, familyId, doFetch = fetch) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/families/${familyId}`;
  return {
    // -> { text, version } or { text: null } when the family has nothing stored yet
    async pull() {
      const res = await doFetch(url, { cache: 'no-store' });
      if (res.status === 404) return { text: null, version: null };
      if (!res.ok) throw new Error(`Could not reach the family data (${res.status}).`);
      const doc = await res.json();
      return { text: doc.fields?.data?.stringValue ?? null, version: doc.updateTime };
    },
    // Saves only if nobody else saved since `version`. -> true, or false to try again.
    async push(text, version) {
      const guard = version ? `currentDocument.updateTime=${encodeURIComponent(version)}` : 'currentDocument.exists=false';
      const res = await doFetch(`${url}?${guard}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { data: { stringValue: text } } }),
      });
      if (res.ok) return true;
      if ([400, 409, 412].includes(res.status)) return false; // someone else got there first
      throw new Error(`Could not save the family data (${res.status}).`);
    },
  };
}

// ---------- one round of syncing ----------
// getLocal() -> this phone's state; apply(state) stores what came from the others.
// Returns 'same', 'received', 'sent' or 'both'. With mustExist, a family that
// has nothing stored is an error (a mistyped code must not start a new family).
export async function syncOnce({ store, key, getLocal, apply, mustExist = false, now = () => Date.now() }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const remote = await store.pull();
    if (remote.text == null && mustExist) throw new Error('No family uses that code. Check it and try again.');
    let theirs = null;
    if (remote.text != null) {
      try { theirs = await unseal(remote.text, key); } catch { throw new Error('The family data could not be opened with this code.'); }
    }
    const mine = getLocal();
    const merged = theirs ? mergeStates(mine, theirs, now()) : mergeStates(mine, emptyState(), now());
    const print = fingerprint(merged);
    const received = print !== fingerprint(mine);
    if (received) await apply(merged);
    const send = !theirs || print !== fingerprint(theirs);
    if (send && !(await store.push(await seal(merged, key), remote.version))) continue;
    return received && send ? 'both' : received ? 'received' : send ? 'sent' : 'same';
  }
  throw new Error('The family data kept changing. It will try again shortly.');
}
