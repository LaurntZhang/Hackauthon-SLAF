// Run against a disposable API: node scripts/check-live.cjs http://127.0.0.1:8017
const assert = require('node:assert/strict');
const base = process.argv[2];
if (!base) throw new Error('Pass the URL of a disposable API (this test creates transactions).');
global.window = global;
// Minimal SSE client for Node; the application uses the browser's native EventSource.
class SSE {
  constructor(url) {
    this.listeners = new Map();
    this.abort = new AbortController();
    this.read(url).catch(error => { if (error.name !== 'AbortError') this.onerror?.(error); });
  }
  addEventListener(action, fn) { this.listeners.set(action, fn); }
  close() { this.abort.abort(); }
  async read(url) {
    const response = await fetch(url, { signal: this.abort.signal });
    assert.equal(response.status, 200);
    this.onopen?.();
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '))?.slice(6);
        const action = frame.split('\n').find(line => line.startsWith('event: '))?.slice(7);
        if (data) (this.listeners.get(action) || this.onmessage)?.({ data });
      }
    }
  }
}
global.EventSource = SSE;
for (const name of ['crypto', 'config', 'simulator', 'store', 'transport']) require(`../src/engine/legacy/${name}.js`);
const MA = global.ManAgent;
const clients = [];
function client() {
  const store = new MA.Store();
  const transport = new MA.LiveTransport(store, base);
  clients.push(transport);
  return { store, transport };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) { if (check()) return; await sleep(100); }
  throw new Error(`Timeout: ${label}`);
}
async function main() {
  const { store, transport } = client();
  await transport.ready;
  const s1 = await transport.runScenario('nominal');
  const corr1 = s1.steps[0].correlation_id;
  await until(() => store.txs.get(corr1)?.final?.status === 'filled', 'S1 SSE');
  assert.equal(store.txs.get(corr1).intent.amount, '4000');
  const s2 = await transport.runScenario('veto_hitl');
  const corr2 = s2.steps[0].correlation_id;
  await until(() => store.pending?.corr === corr2 && store.txs.get(corr2)?.hitl?.card, 'S2 card');
  assert.equal(Number(store.pending.card.intent.amount), 85000);
  assert.ok(store.pending.card.asset_label);
  const second = client(); await second.transport.ready;
  assert.equal(second.store.pending.corr, corr2, 'standalone manager hydrates S2');
  assert.ok(second.store.pending.card.requested_at, 'hydrated card has audit timestamp');
  await sleep(800);
  assert.equal(new Set(second.store.events.map(e => e.hash)).size, second.store.events.length, 'SSE replay deduplicated');
  const thread = store.pending.thread_id;
  assert.equal((await transport.decide(thread, { action: 'approve', pin: '0000' })).ok, false);
  const decision = await transport.decide(thread, { action: 'approve', pin: '1234' });
  assert.equal(decision.ok, true);
  assert.match(decision.signature, /^[0-9a-f]{64}$/);
  await until(() => store.txs.get(corr2)?.final?.status === 'filled' && !store.pending, 'S2 approved and executed');
  await until(() => second.store.txs.get(corr2)?.hitl?.status === 'approved', 'decision on another screen');
  global.prompt = () => '1234';
  const lastTransaction = store.lastCorr;
  await transport.killSwitch(true);
  await until(() => store.kill.global, 'kill SSE');
  await transport.killSwitch(false);
  assert.equal(store.kill.global, false);
  assert.equal(store.lastCorr, lastTransaction, 'operator events do not replace the transaction');
  await transport.runScenario('salami');
  assert.equal(store.risk.breaker, 'open');
  await transport.resetBreaker();
  assert.equal(store.risk.breaker, 'closed');
  await transport.runScenario('injection');
  assert.equal(store.agents.proposer.quarantined, true);
  await transport.liftQuarantine('proposer');
  assert.equal(store.agents.proposer.quarantined, false);
  const manual = await transport.submitObjective({ asset: 'OAT-10A', side: 'buy', amount: 4000, counterparty: 'Banque Horizon BFI' });
  assert.equal(manual.status, 'executed');
  assert.equal(transport.runtimeId, 'main');
  await until(() => store.txs.get(manual.correlation_id)?.final?.status === 'filled', 'manual proposal');
  assert.equal(store.invalid, 0);
  assert.equal((await transport.verify()).valid, true);
  const index = store.events.findIndex(e => e.action === 'intent.proposed');
  assert.equal(store.journalLine(index).rawEvent.action, 'intent_proposed', 'export keeps original signed event');
  // The simulation remains independent of fetch/SSE.
  const simStore = new MA.Store(); const sim = new MA.SimTransport(simStore);
  sim.setFast(true); await sim.runScenario('nominal');
  assert.ok([...simStore.txs.values()].some(tx => tx.final?.status === 'filled'));
  console.log('PASS: hydration, named SSE, replay, S1, S2/PIN, second screen, operator controls, raw audit, local simulation');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clients.forEach(t => t.dispose()));
