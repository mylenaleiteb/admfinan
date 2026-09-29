const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8').split('init().catch')[0];

function setup() {
  const elements = {};
  const storage = new Map();
  const context = vm.createContext({
    window: {}, console, setTimeout, clearTimeout,
    document: { getElementById: id => elements[id] ||= { value: '', reset() {}, classList: { toggle() {} } }, body: { classList: { toggle() {}, contains() { return false; } } } },
    localStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) || null }
  });
  vm.runInContext(source, context);
  vm.runInContext('renderAll = () => {}; toast = () => {}; resetForm = () => {};', context);
  return { context, storage, run: code => vm.runInContext(code, context) };
}

test('loading an old period preserves its data and month through a cache round trip', () => {
  const { run } = setup();
  run(`applyAppPayload({ version: 14, month: '2025-12', monthlyState: {
    incomes: [{ id: 'i', name: 'Extra', value: 50 }],
    fixedExpenses: [{ id: 'f', name: 'Rent', value: 20, createdAt: '2025-12-15' }],
    variableExpenses: [{ id: 'v', name: 'Bus', value: 5 }]
  }}); applyAppPayload(JSON.parse(JSON.stringify(buildAppPayload())));`);
  assert.equal(run('activeMonthKey'), '2025-12');
  assert.equal(run('state.incomes.length + state.fixedExpenses.length + state.variableExpenses.length'), 3);
  assert.equal(run('state.fixedExpenses[0].createdAt'), '2025-12-15');
});

for (const [module, prefix] of [['fixedExpenses', 'fixed'], ['variableExpenses', 'variable']]) {
  test(`${module}: creation date survives edits and legacy dates remain unknown`, () => {
    const { run } = setup();
    run(`$('${prefix}Name').value = 'Expense'; $('${prefix}Value').value = '10'; saveItem({ preventDefault() {} }, '${module}');`);
    assert.equal(run(`state.${module}[0].createdAt`), run('todayInput()'));
    run(`state.${module}[0].createdAt = '2025-12-15'; $('${prefix}Id').value = state.${module}[0].id; saveItem({ preventDefault() {} }, '${module}');`);
    assert.equal(run(`state.${module}[0].createdAt`), '2025-12-15');
    run(`delete state.${module}[0].createdAt; saveItem({ preventDefault() {} }, '${module}'); renderList('${module}');`);
    assert.equal(run(`state.${module}[0].createdAt`), '');
    assert.match(run(`$('${prefix}Table').innerHTML`), /—/);
  });
}

test('explicit close clears monthly cache only after successful PDF export', async () => {
  const { context, run, storage } = setup();
  run(`currentUser = { id: 'test' }; activeMonthKey = '2025-12'; state.incomes = [{ value: 50 }]; notesState = [{ text: 'Keep' }]; buildPDFReport = () => {}; saveRemoteNow = async () => false;`);
  let fail = true;
  context.html2canvas = async () => ({ width: 100, height: 100, toDataURL: () => 'image' });
  context.window.html2canvas = context.html2canvas;
  context.window.jspdf = { jsPDF: function () {
    this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    this.addImage = () => {};
    this.save = async () => { if (fail) throw new Error('Export failed'); };
  } };
  context.console = { error() {} };
  await context.closeMonth();
  assert.equal(run('state.incomes.length'), 1);
  fail = false;
  await context.closeMonth();
  const saved = JSON.parse(storage.get('pf_supabase_cache_test'));
  assert.equal(saved.payload.monthlyState.incomes.length, 0);
  assert.equal(saved.payload.notes.length, 1);
  assert.equal(saved.pending, true);
});
