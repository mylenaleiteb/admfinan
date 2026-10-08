const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');

function setup(state, categories = []) {
  const elements = {};
  const context = vm.createContext({
    state, categories, Set,
    $: id => elements[id] ||= { textContent: '' },
    money: value => value,
    renderHouseAnalysis() {}, renderExpenseTypePercentages() {}
  });
  vm.runInContext(source.slice(source.indexOf('function totals()'), source.indexOf('function expensesByCategory()')), context);
  vm.runInContext(source.slice(source.indexOf('function sumHouseExpenses('), source.indexOf('function renderHouseExpenses(')), context);
  vm.runInContext(source.slice(source.indexOf('function renderDashboard('), source.indexOf('function renderHouseAnalysis(')), context);
  return { context, elements };
}

test('dashboard cards follow their sources regardless of paid status and unrelated amounts', () => {
  const state = {
    incomes: [{ value: '3000' }, { value: 500 }],
    fixedExpenses: [{ value: '1000', categoryId: 'housing', paid: true }, { value: 200, categoryId: 'other', paid: false }],
    variableExpenses: [{ value: 150, categoryId: 'housing', paid: false }, { value: 50, categoryId: 'other', paid: true }],
    houseExpenses: { rent: 600, condo: '100', gas: 20, energy: 80, internet: 50 },
    supermarketExpenses: [{ value: 999 }], house: { total: 99999 },
    investments: [{ value: 999 }]
  };
  const { context, elements } = setup(state, [{ id: 'housing', name: 'Moradia' }, { id: 'other', name: 'Lazer' }]);
  context.renderDashboard();
  assert.equal(elements.dashIncome.textContent, 3500);
  assert.equal(elements.dashExpense.textContent, 1400);
  assert.equal(elements.dashBalance.textContent, 2100);
  assert.equal(elements.dashFixed.textContent, 1200);
  assert.equal(elements.dashHouseExpenses.textContent, 2000);
  assert.equal(elements.dashInvestments, undefined);
  state.variableExpenses.push({ value: 3000, categoryId: 'other' });
  context.renderDashboard();
  assert.equal(elements.dashBalance.textContent, -900);
  assert.equal(elements.dashHouseExpenses.textContent, 2000);
});

test('empty data and missing housing category produce valid house totals', () => {
  const state = { incomes: [], fixedExpenses: [], variableExpenses: [], houseExpenses: {} };
  const { context, elements } = setup(state);
  context.renderDashboard();
  for (const element of Object.values(elements)) assert.equal(element.textContent, 0);
  state.houseExpenses = { rent: 250 };
  state.fixedExpenses.push({ value: 100, categoryId: 'unknown' });
  assert.equal(context.dashboardHouseExpensesTotal(), 250);
});

test('housing is matched through category IDs and category name, including multiple matches', () => {
  const { context } = setup({
    incomes: [], fixedExpenses: [{ value: 100, categoryId: 'a' }],
    variableExpenses: [{ value: 50, categoryId: 'b' }, { value: 500, categoryId: 'c' }], houseExpenses: null
  }, [{ id: 'a', name: 'Moradia' }, { id: 'b', name: ' moradia ' }, { id: 'c', name: 'Alimentação' }]);
  assert.equal(context.dashboardHouseExpensesTotal(), 150);
});
