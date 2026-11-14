import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCode, tidyCode, familyFromCode, seal, unseal, mergeStates, fingerprint, emptyState, firestoreStore, syncOnce } from '../sync.js';

// A stand-in for Cloud Firestore that follows the same rules for the calls the
// app makes: 404 when missing, and a save is refused unless its guard holds.
function fakeFirestore() {
  const docs = new Map();
  let clock = 0;
  const calls = [];
  const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const doFetch = async (url, opts = {}) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    calls.push(`${opts.method || 'GET'} ${path}`);
    const doc = docs.get(path);
    if (!opts.method) return doc ? json(200, doc) : json(404, { error: { status: 'NOT_FOUND' } });
    const exists = u.searchParams.get('currentDocument.exists');
    const stamp = u.searchParams.get('currentDocument.updateTime');
    if (exists === 'false' && doc) return json(409, { error: { status: 'ALREADY_EXISTS' } });
    if (stamp && (!doc || doc.updateTime !== stamp)) return json(400, { error: { status: 'FAILED_PRECONDITION' } });
    const saved = { name: path, fields: JSON.parse(opts.body).fields, updateTime: `2026-11-14T00:00:${String(++clock).padStart(2, '0')}Z` };
    docs.set(path, saved);
    return json(200, saved);
  };
  return { doFetch, docs, calls };
}

// One phone: its own data, and a way to sync it.
async function phone(code, server, start = emptyState()) {
  const { id, key } = await familyFromCode(code);
  const store = firestoreStore({ projectId: 'demo' }, id, server.doFetch);
  const me = { state: start };
  me.sync = (extra = {}) => syncOnce({ store, key, getLocal: () => me.state, apply: (s) => { me.state = s; }, now: () => 1000000, ...extra });
  return me;
}

const rec = (id, updated, total = 10, extra = {}) => ({ id, updated, store: 'Shop', date: '2026-11-10', eatingOut: false, total, items: [], ...extra });

test('family codes', async () => {
  const code = makeCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.equal(tidyCode(code.toLowerCase().replace(/-/g, ' ')), code);
  assert.equal(tidyCode('too short'), null);
  assert.equal(tidyCode('ABCD-EFGH-JKLM-NPQ0'), null); // 0 is never used
  const a = await familyFromCode(code), b = await familyFromCode(code), c = await familyFromCode(makeCode());
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.match(a.id, /^[0-9a-f]{64}$/);
});

test('what is stored online cannot be read without the code', async () => {
  const { key } = await familyFromCode('ABCD-EFGH-JKLM-NPQR');
  const state = { ...emptyState(), receipts: [rec('a', 5, 12.5, { store: 'Fresh Market' })] };
  const text = await seal(state, key);
  assert.equal(text.includes('Fresh'), false);
  assert.equal(text === await seal(state, key), false); // scrambled differently every time
  assert.deepEqual(await unseal(text, key), state);
  const other = await familyFromCode('ABCD-EFGH-JKLM-NPQS');
  await assert.rejects(unseal(text, other.key));
});

test('merging: the latest change wins, deletions spread, old deletions are dropped', () => {
  const day = 86400000, now = 400 * day, t = (n) => now - 2 * day + n;
  const a = { ...emptyState(), receipts: [rec('a', t(10), 1), rec('b', t(20), 2), rec('c', t(5), 3)], budget: { value: 600, t: 50 }, list: [{ id: 'milk', name: 'Milk', done: false, updated: t(5) }] };
  const b = { ...emptyState(), receipts: [rec('a', t(30), 99), { id: 'b', deleted: true, updated: t(25) }, { id: 'old', deleted: true, updated: now - 200 * day }, { id: 'recent', deleted: true, updated: now - day }],
    budget: { value: 500, t: 40 }, list: [{ id: 'milk', name: 'Milk', done: true, updated: t(9) }, { id: 'eggs', name: 'Eggs', done: false, updated: t(1) }] };
  const m = mergeStates(a, b, now);
  assert.deepEqual(m.receipts.map((r) => [r.id, r.deleted ? 'deleted' : r.total]), [['a', 99], ['b', 'deleted'], ['c', 3], ['recent', 'deleted']]);
  assert.deepEqual(m.list.map((i) => [i.id, i.done]), [['eggs', false], ['milk', true]]);
  assert.equal(m.budget.value, 600);
  assert.equal(fingerprint(mergeStates(b, a, now)), fingerprint(m)); // same result either way round
  assert.equal(fingerprint(mergeStates(m, a, now)), fingerprint(m)); // merging again changes nothing
  // An edit after a deletion brings the receipt back; a tie goes to the deletion.
  assert.equal(mergeStates({ ...emptyState(), receipts: [rec('b', t(26))] }, b, now).receipts.find((r) => r.id === 'b').deleted, undefined);
  assert.equal(mergeStates({ ...emptyState(), receipts: [rec('b', t(25))] }, b, now).receipts.find((r) => r.id === 'b').deleted, true);
});

test('two phones end up with the same data', async () => {
  const server = fakeFirestore();
  const code = makeCode();
  const mum = await phone(code, server, { ...emptyState(), receipts: [rec('m1', 100, 20)], budget: { value: 600, t: 100 } });
  assert.equal(await mum.sync(), 'sent');
  assert.equal(await mum.sync(), 'same');

  // A mistyped code must not quietly start a second family.
  const typo = await phone(makeCode(), server);
  await assert.rejects(typo.sync({ mustExist: true }), /No family uses that code/);

  const dad = await phone(code, server, { ...emptyState(), receipts: [rec('d1', 200, 35)] });
  assert.equal(await dad.sync({ mustExist: true }), 'both');
  assert.deepEqual(dad.state.receipts.map((r) => r.id), ['d1', 'm1']);
  assert.equal(dad.state.budget.value, 600);
  assert.equal(await mum.sync(), 'received');
  assert.equal(fingerprint(mum.state), fingerprint(dad.state));

  // Dad deletes Mum's receipt and edits his own; Mum adds one at the same time.
  dad.state = { ...dad.state, receipts: [{ id: 'm1', deleted: true, updated: 300 }, rec('d1', 310, 40)] };
  mum.state = { ...mum.state, receipts: [...mum.state.receipts, rec('m2', 320, 8)], list: [{ id: 'bread', name: 'Bread', done: false, updated: 320 }] };
  await dad.sync(); await mum.sync(); await dad.sync();
  assert.equal(fingerprint(mum.state), fingerprint(dad.state));
  assert.deepEqual(mum.state.receipts.map((r) => [r.id, r.deleted ? 'deleted' : r.total]), [['d1', 40], ['m1', 'deleted'], ['m2', 8]]);
  assert.equal(await mum.sync(), 'same');
  assert.equal(await dad.sync(), 'same');

  // Only one unreadable document exists, under an address made from the code.
  assert.equal(server.docs.size, 1);
  const [[path, doc]] = [...server.docs];
  assert.match(path, /^\/v1\/projects\/demo\/databases\/\(default\)\/documents\/families\/[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(doc.fields), ['data']);
  assert.equal(doc.fields.data.stringValue.includes('Shop'), false);
});

test('a save that loses a race is retried with the other phone\'s data', async () => {
  const server = fakeFirestore();
  const code = makeCode();
  const a = await phone(code, server, { ...emptyState(), receipts: [rec('a1', 1)] });
  await a.sync();
  const b = await phone(code, server, { ...emptyState(), receipts: [rec('b1', 2)] });
  // Between B reading and B saving, A saves something new.
  const { id, key } = await familyFromCode(code);
  const store = firestoreStore({ projectId: 'demo' }, id, server.doFetch);
  let raced = false;
  const racing = { pull: () => store.pull(), push: async (text, version) => {
    if (!raced) { raced = true; a.state = { ...a.state, receipts: [...a.state.receipts, rec('a2', 3)] }; await a.sync(); }
    return store.push(text, version);
  } };
  await syncOnce({ store: racing, key, getLocal: () => b.state, apply: (s) => { b.state = s; }, now: () => 1000 });
  assert.deepEqual(b.state.receipts.map((r) => r.id), ['a1', 'a2', 'b1']);
  await a.sync();
  assert.equal(fingerprint(a.state), fingerprint(b.state));
});
