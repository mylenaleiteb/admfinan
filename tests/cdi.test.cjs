const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function estimateFixedIncomeCdi('), source.indexOf('function renderFixedIncomeCdiStatus(')), context);
const asset = { id: 'a', type: 'fixed_income', cdiPercentage: 110 };
const movement = (date, value, type = 'contribution') => ({ assetId: 'a', date, value, type });
const state = movements => ({ movements, cdiCoverageStart: '2026-09-01', cdiCoverageEnd: '2026-09-08', cdiRates: [
  { date: '2026-09-01', value: 0.1 }, { date: '2026-09-02', value: 0.1 }, { date: '2026-09-03', value: 0.1 }
] });
const estimate = (data, custom = asset) => context.estimateFixedIncomeCdi(custom, data, '2026-09-08');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
test('compounds daily CDI at the contracted percentage, after the deposit day', () => {
  const result = estimate(state([movement('2026-09-01', 1000)]));
  close(result.balance, 1000 * 1.0011 ** 2);
  close(result.income, result.balance - 1000);
});
test('additional deposits and withdrawals affect only their respective dates', () => {
  const result = estimate(state([movement('2026-09-01', 1000), movement('2026-09-02', 500), movement('2026-09-03', 200, 'withdrawal')]));
  close(result.balance, (1000 * 1.0011 + 500 - 200) * 1.0011);
  close(result.income, result.balance - 1300);
});
test('maturity stops interest and future deposits are excluded', () => {
  const result = estimate(state([movement('2026-09-01', 1000), movement('2026-09-10', 900)]), { ...asset, maturityDate: '2026-09-02' });
  close(result.balance, 1001.1);
});
test('missing history or percentage does not invent earnings', () => {
  assert.equal(estimate({ ...state([movement('2026-08-01', 1000)]) }), null);
  assert.equal(estimate(state([]), { ...asset, cdiPercentage: null }), null);
});
test('zero percent and other investment classes', () => {
  close(estimate(state([movement('2026-09-01', 1000)]), { ...asset, cdiPercentage: 0 }).income, 0);
  assert.equal(estimate(state([]), { ...asset, type: 'treasury' }), null);
});
test('does not mutate recorded movements and uses only published rates', () => {
  const data = state([movement('2026-09-01', 1000)]);
  const before = JSON.stringify(data);
  assert.equal(estimate(data).lastRateDate, '2026-09-03');
  assert.equal(JSON.stringify(data), before);
});
