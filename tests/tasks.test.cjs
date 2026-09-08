const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function setup() {
  const elements = {};
  const get = id => elements[id] ||= { value: '', textContent: '', innerHTML: '' };
  let saves = 0;
  const context = vm.createContext({
    $: get, state: { tasks: [] }, uid: () => 'task-1', todayInput: () => '2026-09-08',
    validDateInput: value => /^\d{4}-\d{2}-\d{2}$/.test(value),
    taskStatuses: { todo: 'A fazer', doing: 'Fazendo', done: 'Feito' },
    escapeHTML: value => String(value), saveAll: () => saves++, toast: () => {},
  });
  for (const [start, end] of [
    ['function addDaysToDate(', 'function normalizeExpenseList('],
    ['function saveTask(', 'function resetTaskForm('],
    ['function isTaskOverdue(', 'function togglePackingItem('],
  ]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  context.resetTaskForm = () => {};
  get('taskTitle').value = 'Tarefa com prazo';
  get('taskDeadlineDays').value = '5';
  return { context, get, saves: () => saves };
}
for (const status of ['todo', 'doing', 'done']) {
  test(`saves and renders a task with a deadline in ${status}`, () => {
    const { context, get, saves } = setup();
    get('taskStatus').value = status;
    context.saveTask({ preventDefault() {} });
    assert.equal(context.state.tasks[0].dueDate, '2026-09-13');
    assert.equal(get(`taskCount-${status}`).textContent, 1);
    assert.match(get(`taskList-${status}`).innerHTML, /Tarefa com prazo/);
    assert.match(get(`taskList-${status}`).innerHTML, /13\/09\/2026/);
    assert.equal(saves(), 1);
  });
}
test('editing and reloading preserve the deadline based on creation date', () => {
  const { context, get } = setup();
  get('taskStatus').value = 'todo';
  context.saveTask({ preventDefault() {} });
  get('taskId').value = 'task-1';
  get('taskDeadlineDays').value = '10';
  context.saveTask({ preventDefault() {} });
  context.state.tasks = context.normalizeTaskList(JSON.parse(JSON.stringify(context.state.tasks)));
  context.renderTasks();
  assert.equal(context.state.tasks.length, 1);
  assert.equal(context.state.tasks[0].dueDate, '2026-09-18');
  assert.match(get('taskList-todo').innerHTML, /18\/09\/2026/);
});
test('tasks without deadlines still save', () => {
  const { context, get } = setup();
  get('taskDeadlineDays').value = '';
  context.saveTask({ preventDefault() {} });
  assert.equal(context.state.tasks[0].dueDate, '');
  assert.match(get('taskList-todo').innerHTML, /Sem prazo definido/);
});
test('calendar days cross weekends, month ends, leap days and year ends', () => {
  const { context } = setup();
  for (const [start, days, expected] of [
    ['2026-09-04', 3, '2026-09-07'], ['2026-01-31', 1, '2026-02-01'],
    ['2024-02-28', 1, '2024-02-29'], ['2026-12-31', 1, '2027-01-01'],
  ]) assert.equal(context.addDaysToDate(start, days), expected);
});
