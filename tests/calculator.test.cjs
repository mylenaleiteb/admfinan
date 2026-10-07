const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const elements = {};
  const handlers = {};
  const get = id => elements[id] ||= {
    textContent: '', classList: { contains: () => id === 'calculator', toggle() {} },
    addEventListener: (type, callback) => { handlers[id + type] = callback; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../calculator.js'), 'utf8'), {
    document: { getElementById: get, addEventListener: (type, callback) => { handlers[type] = callback; } }
  });
  return {
    press: (...keys) => keys.forEach(key => handlers.calculatorKeysclick({ target: { closest: () => ({ dataset: { key } }) } })),
    display: () => get('calculatorDisplay').textContent,
    handlers, get
  };
}

test('basic operations, decimals and sequential calculations', () => {
  const c = setup();
  c.press('0', ',', '1', '+', '0', ',', '2', '=');
  assert.equal(c.display(), '0,3');
  c.press('*', '1', '0', '=');
  assert.equal(c.display(), '3');
  c.press('-', '5', '=');
  assert.equal(c.display(), '-2');
  c.press('/', '4', '=');
  assert.equal(c.display(), '-0,5');
});

test('editing, replacing operators, clearing and recovering from division by zero', () => {
  const c = setup();
  c.press('1', '2', 'backspace', 'sign', '+', '*', '3', '=');
  assert.equal(c.display(), '-3');
  c.press('/', '0', '=');
  assert.match(c.display(), /dividir por zero/);
  c.press('7');
  assert.equal(c.display(), '7');
  c.press('clear');
  assert.equal(c.display(), '0');
});

test('keyboard only handles calculator keys when its tab is active', () => {
  const c = setup();
  let prevented = 0;
  const event = { key: '8', target: { closest: () => null }, preventDefault: () => prevented++ };
  c.handlers.keydown(event);
  assert.equal(c.display(), '8');
  c.get('calculator').classList.contains = () => false;
  c.handlers.keydown(event);
  assert.equal(c.display(), '8');
  assert.equal(prevented, 1);
});
