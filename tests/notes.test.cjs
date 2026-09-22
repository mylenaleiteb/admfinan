const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');

function setup() {
  const elements = {};
  const get = id => elements[id] ||= { value: '', textContent: '', innerHTML: '', focus() {}, reset() {
    for (const field of ['noteId', 'noteTitle', 'noteBody']) get(field).value = '';
  } };
  let saves = 0;
  let confirmation;
  const context = vm.createContext({
    $: get, notesState: [], uid: () => 'note-1',
    escapeHTML: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    saveAll: () => saves++, toast() {},
    confirmAction: (title, text, callback) => { confirmation = callback; }
  });
  vm.runInContext(source.slice(source.indexOf('function normalizeNotes('), source.indexOf('function saveTask(')), context);
  return { context, get, saves: () => saves, confirm: () => confirmation() };
}

test('create, edit and reload a note preserving multiline text and escaping HTML', () => {
  const { context, get, saves } = setup();
  get('noteBody').value = 'Primeira linha\n<script>alert(1)</script>';
  context.saveNote({ preventDefault() {} });
  assert.equal(context.notesState.length, 1);
  assert.match(get('notesList').innerHTML, /&lt;script>/);
  assert.doesNotMatch(get('notesList').innerHTML, /<script>/);
  get('noteTitle').value = 'Minha nota';
  context.saveNote({ preventDefault() {} });
  context.notesState = context.normalizeNotes(JSON.parse(JSON.stringify(context.notesState)));
  assert.equal(context.notesState.length, 1);
  assert.equal(context.notesState[0].title, 'Minha nota');
  assert.equal(context.notesState[0].body, 'Primeira linha\n<script>alert(1)</script>');
  assert.equal(saves(), 2);
});

test('blank notes are rejected and old payloads load without notes', () => {
  const { context, get, saves } = setup();
  get('noteBody').value = '   ';
  context.saveNote({ preventDefault() {} });
  assert.equal(saves(), 0);
  assert.equal(context.normalizeNotes(undefined).length, 0);
  assert.equal(context.normalizeNotes([null, {}, { title: 'Nota', updatedAt: 'invalid' }])[0].updatedAt, '');
});

test('deletion and discarding unsaved changes require confirmation', () => {
  const { context, get, confirm } = setup();
  get('noteTitle').value = 'Nota';
  context.saveNote({ preventDefault() {} });
  get('noteBody').value = 'Edição pendente';
  context.changeNoteEditor();
  assert.equal(get('noteBody').value, 'Edição pendente');
  confirm();
  assert.equal(get('noteBody').value, '');
  context.deleteNote('note-1');
  assert.equal(context.notesState.length, 1);
  confirm();
  assert.equal(context.notesState.length, 0);
});

test('notes persist outside monthly state in the account payload', () => {
  const { context } = setup();
  Object.assign(context, {
    activeMonthKey: '2026-09', state: {}, categories: [], investmentState: {}, workState: {}, travelState: {},
    document: { body: { classList: { contains: () => false } } }
  });
  vm.runInContext(source.slice(source.indexOf('function buildAppPayload('), source.indexOf('function legacyLocalPayload(')), context);
  context.notesState.push({ id: 'note-1', title: 'Continuar no próximo mês', body: '', updatedAt: '' });
  context.state = {};
  context.activeMonthKey = '2026-10';
  assert.equal(context.buildAppPayload().notes[0].title, 'Continuar no próximo mês');
});
