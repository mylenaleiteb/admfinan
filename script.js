const STORAGE = {
  month: "pf_current_month",
  monthly: "pf_monthly_simple_data",
  legacyMonthly: "pf_monthly_data",
  categories: "pf_categories",
  theme: "pf_theme"
};

const defaultCategories = [
  { id: uid(), name: "Moradia", icon: "🏠", color: "#0f8f7f" },
  { id: uid(), name: "Alimentação", icon: "🛒", color: "#1466d8" },
  { id: uid(), name: "Transporte", icon: "🚌", color: "#6d5dfc" },
  { id: uid(), name: "Lazer", icon: "🎬", color: "#d98a16" },
  { id: uid(), name: "Saúde", icon: "💊", color: "#d64545" }
];

const emptyState = () => ({
  incomes: [],
  fixedExpenses: [],
  variableExpenses: [],
  supermarketExpenses: [],
  house: { person1: "", income1: 0, person2: "", income2: 0, total: 0 },
  houseExpenses: { rent: 0, condo: 0, gas: 0, energy: 0, internet: 0 }
});

let state = emptyState();
let categories = [];
let categoryChart;
let pendingConfirm = null;

const $ = (id) => document.getElementById(id);
const monthName = () => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date());
const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const modules = {
  incomes: {
    list: "incomes",
    section: "incomes",
    empty: "Nenhuma entrada cadastrada.",
    saved: "Entrada salva.",
    deleted: "Entrada excluída.",
    formTitle: "incomeFormTitle",
    newTitle: "Nova entrada",
    editTitle: "Editar entrada",
    id: "incomeId",
    name: "incomeName",
    value: "incomeValue",
    category: "incomeCategory",
    table: "incomeTable",
    total: "incomeTotal",
    footer: "incomeFooterTotal"
  },
  fixedExpenses: {
    list: "fixedExpenses",
    section: "fixed",
    empty: "Nenhuma despesa fixa cadastrada.",
    saved: "Despesa fixa salva.",
    deleted: "Despesa fixa excluída.",
    formTitle: "fixedFormTitle",
    newTitle: "Nova despesa fixa",
    editTitle: "Editar despesa fixa",
    id: "fixedId",
    name: "fixedName",
    value: "fixedValue",
    category: "fixedCategory",
    table: "fixedTable",
    total: "fixedTotal",
    footer: "fixedFooterTotal"
  },
  variableExpenses: {
    list: "variableExpenses",
    section: "variable",
    empty: "Nenhuma despesa variável cadastrada.",
    saved: "Despesa variável salva.",
    deleted: "Despesa variável excluída.",
    formTitle: "variableFormTitle",
    newTitle: "Nova despesa variável",
    editTitle: "Editar despesa variável",
    id: "variableId",
    name: "variableName",
    value: "variableValue",
    category: "variableCategory",
    table: "variableTable",
    total: "variableTotal",
    footer: "variableFooterTotal"
  }
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function ensureCurrentMonth() {
  const savedMonth = localStorage.getItem(STORAGE.month);
  if (savedMonth && savedMonth !== currentMonthKey()) {
    state = emptyState();
    localStorage.setItem(STORAGE.monthly, JSON.stringify(state));
    localStorage.setItem(STORAGE.month, currentMonthKey());
  }
}

function normalizeState(data) {
  const next = emptyState();
  next.incomes = Array.isArray(data?.incomes) ? data.incomes : [];
  next.fixedExpenses = normalizeExpenseList(data?.fixedExpenses);
  next.variableExpenses = normalizeExpenseList(data?.variableExpenses);
  next.supermarketExpenses = normalizeSupermarketList(data?.supermarketExpenses);
  next.house = data?.house || { person1: "", income1: 0, person2: "", income2: 0, total: 0 };
  next.houseExpenses = data?.houseExpenses || { rent: 0, condo: 0, gas: 0, energy: 0, internet: 0 };
  next.house.total = sumHouseExpenses(next.houseExpenses) || Number(next.house.total || 0);
  return next;
}

function normalizeExpenseList(list) {
  return Array.isArray(list) ? list.map(item => ({ ...item, paid: Boolean(item.paid) })) : [];
}

function normalizeSupermarketList(list) {
  return Array.isArray(list) ? list.map(item => ({
    id: item.id || uid(),
    value: Number(item.value || 0),
    payment: item.payment === "cartao" ? "cartao" : "pix"
  })) : [];
}

function migrateLegacyData() {
  const legacy = loadJSON(STORAGE.legacyMonthly, null);
  if (!legacy?.transactions?.length) return emptyState();

  return legacy.transactions.reduce((acc, item) => {
    const mapped = {
      id: item.id || uid(),
      name: item.desc || "Sem nome",
      value: Number(item.value || 0),
      categoryId: item.categoryId || categories[0]?.id || "",
      paid: Boolean(item.paid)
    };

    if (item.kind === "income") acc.incomes.push(mapped);
    else if (item.recurrence === "recurring") acc.fixedExpenses.push(mapped);
    else acc.variableExpenses.push(mapped);

    return acc;
  }, emptyState());
}

function saveAll() {
  localStorage.setItem(STORAGE.monthly, JSON.stringify(state));
  localStorage.setItem(STORAGE.categories, JSON.stringify(categories));
  localStorage.setItem(STORAGE.month, currentMonthKey());
}

function init() {
  ensureCurrentMonth();
  categories = loadJSON(STORAGE.categories, defaultCategories);
  if (!categories.length) categories = defaultCategories;

  const saved = loadJSON(STORAGE.monthly, null);
  state = saved ? normalizeState(saved) : migrateLegacyData();

  $("currentMonthLabel").textContent = monthName();
  if (localStorage.getItem(STORAGE.theme) === "dark") document.body.classList.add("dark");

  bindEvents();
  initEmojiPicker(); // NOVO: inicializa o seletor de emojis
  renderAll();
}

// ── NOVO: inicializa o emoji-picker-element ──────────────────────────────────
function initEmojiPicker() {
  const container = $("emojiPickerContainer");
  const trigger = $("emojiTrigger");
  const input = $("categoryIcon");

  // Cria o web component fornecido pela biblioteca emoji-picker-element
  const picker = document.createElement("emoji-picker");
  container.appendChild(picker);

  // Abre/fecha o picker ao clicar no botão de emoji
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    container.hidden = !container.hidden;
  });

  // Quando o usuário escolhe um emoji, atualiza o input hidden e o botão visual
  picker.addEventListener("emoji-click", (event) => {
    const emoji = event.detail.unicode;
    input.value = emoji;
    trigger.textContent = emoji;
    container.hidden = true;
  });

  // Fecha o picker ao clicar fora dele
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".emoji-picker-wrap")) {
      container.hidden = true;
    }
  });
}
// ────────────────────────────────────────────────────────────────────────────

function bindEvents() {
  $("nav").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-section]");
    if (!button) return;
    openSection(button.dataset.section);
  });

  $("mobileMenu").addEventListener("click", () => $("sidebar").classList.add("open"));
  document.addEventListener("click", (event) => {
    if (innerWidth <= 760 && !event.target.closest(".sidebar") && !event.target.closest("#mobileMenu")) {
      $("sidebar").classList.remove("open");
    }
  });

  $("themeToggle").addEventListener("click", toggleTheme);
  $("openHouseSplit").addEventListener("click", openHouseSplit);
  $("closeHouseSplit").addEventListener("click", closeHouseSplit);
  $("openHouseExpenses").addEventListener("click", openHouseExpenses);
  $("closeHouseExpenses").addEventListener("click", closeHouseExpenses);

  $("incomeForm").addEventListener("submit", (event) => saveItem(event, "incomes"));
  $("fixedForm").addEventListener("submit", (event) => saveItem(event, "fixedExpenses"));
  $("variableForm").addEventListener("submit", (event) => saveItem(event, "variableExpenses"));
  $("supermarketForm").addEventListener("submit", saveSupermarketExpense);

  $("clearIncomeForm").addEventListener("click", () => resetForm("incomes"));
  $("clearFixedForm").addEventListener("click", () => resetForm("fixedExpenses"));
  $("clearVariableForm").addEventListener("click", () => resetForm("variableExpenses"));
  $("clearSupermarketForm").addEventListener("click", resetSupermarketForm);

  $("categoryForm").addEventListener("submit", saveCategory);
  $("clearCategoryForm").addEventListener("click", resetCategoryForm);
  $("houseForm").addEventListener("submit", saveHouse);
  ["housePerson1", "houseIncome1", "housePerson2", "houseIncome2", "houseTotal"].forEach(id => {
    $(id).addEventListener("input", renderHousePreview);
  });
  $("houseExpensesForm").addEventListener("submit", saveHouseExpenses);
  houseExpenseInputIds().forEach(id => {
    $(id).addEventListener("input", renderHouseExpensesPreview);
  });

  $("closeMonth").addEventListener("click", () => {
    confirmAction(
      "Encerrar mês",
      "O PDF será gerado e entradas, despesas e rateio serão apagados. As categorias permanecerão salvas.",
      closeMonth
    );
  });

  $("modalCancel").addEventListener("click", closeModal);
  $("modalConfirm").addEventListener("click", () => {
    const action = pendingConfirm;
    closeModal();
    if (action) action();
  });
}

function openSection(id) {
  document.querySelectorAll(".section").forEach(section => section.classList.toggle("active", section.id === id));
  document.querySelectorAll(".nav button").forEach(button => button.classList.toggle("active", button.dataset.section === id));
  const label = document.querySelector(`.nav button[data-section="${id}"]`).textContent.replace(/^[^\wÀ-ú]+/, "").trim();
  $("pageTitle").textContent = label;
  $("sidebar").classList.remove("open");
  if (id === "dashboard") renderCharts();
}

function totals() {
  const income = sumList(state.incomes);
  const fixed = sumList(state.fixedExpenses);
  const variable = sumList(state.variableExpenses);
  const expense = fixed + variable;
  return { income, fixed, variable, expense, balance: income - expense };
}

function sumList(list) {
  return list.reduce((sum, item) => sum + Number(item.value || 0), 0);
}

function categoryById(id) {
  return categories.find(category => category.id === id) || { id: "", name: "Sem categoria", icon: "🏷️", color: "#63717d" };
}

function expenseItems() {
  return [...state.fixedExpenses, ...state.variableExpenses];
}

function expensesByCategory() {
  return categories
    .map(category => {
      const spent = expenseItems()
        .filter(item => item.categoryId === category.id)
        .reduce((sum, item) => sum + Number(item.value || 0), 0);
      return { ...category, spent };
    })
    .filter(item => item.spent > 0);
}

function renderAll() {
  renderSelects();
  renderDashboard();
  renderList("incomes");
  renderList("fixedExpenses");
  renderList("variableExpenses");
  renderSupermarketExpenses();
  renderCategories();
  renderHouseExpenses();
  renderHouse();
  renderCharts();
  saveAll();
}

function renderDashboard() {
  const t = totals();
  $("dashIncome").textContent = money(t.income);
  $("dashExpense").textContent = money(t.expense);
  $("dashBalance").textContent = money(t.balance);
  $("dashFixed").textContent = money(t.fixed);
  renderHouseAnalysis();
  renderExpenseTypePercentages();
}

function renderHouseAnalysis() {
  const house = state.house || emptyState().house;
  const incomeTotal = Number(house.income1 || 0) + Number(house.income2 || 0);
  const houseTotal = sumHouseExpenses(state.houseExpenses);
  const ratio = incomeTotal > 0 ? (houseTotal / incomeTotal) * 100 : 0;

  $("houseAnalysis").innerHTML = `
    <div class="analysis-main">
      <span class="muted">% da renda gasta com despesas da casa</span>
      <strong>${Math.round(ratio)}%</strong>
    </div>
    <div class="analysis-grid">
      <div><span>Renda total</span><strong>${money(incomeTotal)}</strong></div>
      <div><span>Despesas da casa</span><strong>${money(houseTotal)}</strong></div>
    </div>
    <p class="muted">${incomeTotal > 0 ? "Cálculo: despesas da casa ÷ renda total do rateio." : "Informe as rendas no rateio da casa para calcular o percentual."}</p>
  `;
}

function renderExpenseTypePercentages() {
  const t = totals();
  const items = [
    { label: "Despesas fixas", value: t.fixed },
    { label: "Despesas variáveis", value: t.variable },
    { label: "Supermercado", value: sumSupermarketExpenses() },
    { label: "Despesas da casa", value: sumHouseExpenses(state.houseExpenses) }
  ];
  const total = items.reduce((sum, item) => sum + item.value, 0);

  $("expenseTypePercentages").innerHTML = items.map(item => {
    const percentage = total > 0 ? (item.value / total) * 100 : 0;
    return `
      <div class="expense-percent-row">
        <div class="progress-meta">
          <strong>${item.label}</strong>
          <span>${money(item.value)} · ${Math.round(percentage)}%</span>
        </div>
        <div class="bar"><span style="width:${Math.min(percentage, 100)}%"></span></div>
      </div>
    `;
  }).join("") || `<div class="muted">Nenhuma despesa cadastrada.</div>`;
}

function renderSelects() {
  const options = categories.map(c => `<option value="${c.id}">${c.icon} ${escapeHTML(c.name)}</option>`).join("");
  ["incomeCategory", "fixedCategory", "variableCategory"].forEach(id => {
    $(id).innerHTML = options;
  });
}

function saveItem(event, moduleKey) {
  event.preventDefault();
  const config = modules[moduleKey];
  const id = $(config.id).value || uid();
  const index = state[config.list].findIndex(entry => entry.id === id);
  const isExpense = moduleKey === "fixedExpenses" || moduleKey === "variableExpenses";
  const item = {
    id,
    name: $(config.name).value.trim(),
    value: Number($(config.value).value),
    categoryId: $(config.category).value,
    ...(isExpense ? { paid: index >= 0 ? Boolean(state[config.list][index].paid) : false } : {})
  };

  if (index >= 0) state[config.list][index] = item;
  else state[config.list].push(item);

  resetForm(moduleKey);
  renderAll();
  toast(config.saved);
}

function renderList(moduleKey) {
  const config = modules[moduleKey];
  const list = state[config.list];
  const isExpense = moduleKey === "fixedExpenses" || moduleKey === "variableExpenses";
  const rows = list.map(item => {
    const category = categoryById(item.categoryId);
    return `<tr>
      <td>${escapeHTML(item.name)}</td>
      <td><strong>${money(item.value)}</strong></td>
      <td><span class="category-chip" style="background:${category.color}">${category.icon} ${escapeHTML(category.name)}</span></td>
      ${isExpense ? `<td>
        <label class="paid-check" title="Marcar como pago">
          <input type="checkbox" ${item.paid ? "checked" : ""} onchange="togglePaid('${moduleKey}', '${item.id}')" />
          <span></span>
        </label>
      </td>` : ""}
      <td><div class="actions">
        <button class="btn secondary small" onclick="editItem('${moduleKey}', '${item.id}')">Editar</button>
        <button class="btn danger small" onclick="deleteItem('${moduleKey}', '${item.id}')">Excluir</button>
      </div></td>
    </tr>`;
  }).join("");

  $(config.table).innerHTML = rows || `<tr><td colspan="${isExpense ? 5 : 4}" class="muted">${config.empty}</td></tr>`;
  $(config.total).textContent = money(sumList(list));
  $(config.footer).textContent = money(sumList(list));
}

function togglePaid(moduleKey, id) {
  if (moduleKey !== "fixedExpenses" && moduleKey !== "variableExpenses") return;
  const config = modules[moduleKey];
  const item = state[config.list].find(entry => entry.id === id);
  if (!item) return;

  item.paid = !item.paid;
  saveAll();
  renderList(moduleKey);
}

function saveSupermarketExpense(event) {
  event.preventDefault();
  const id = $("supermarketId").value || uid();
  const item = {
    id,
    value: Number($("supermarketValue").value),
    payment: $("supermarketPayment").value
  };
  const index = state.supermarketExpenses.findIndex(entry => entry.id === id);

  if (index >= 0) state.supermarketExpenses[index] = item;
  else state.supermarketExpenses.push(item);

  resetSupermarketForm();
  renderAll();
  toast("Despesa de supermercado salva.");
}

function renderSupermarketExpenses() {
  const list = state.supermarketExpenses || [];
  const rows = list.map(item => `
    <tr>
      <td><strong>${money(item.value)}</strong></td>
      <td>${labelSupermarketPayment(item.payment)}</td>
      <td><div class="actions">
        <button class="btn secondary small" onclick="editSupermarketExpense('${item.id}')">Editar</button>
        <button class="btn danger small" onclick="deleteSupermarketExpense('${item.id}')">Excluir</button>
      </div></td>
    </tr>
  `).join("");

  $("supermarketTable").innerHTML = rows || `<tr><td colspan="3" class="muted">Nenhuma despesa de supermercado cadastrada.</td></tr>`;
  $("supermarketTotal").textContent = money(sumSupermarketExpenses());
  $("supermarketFooterTotal").textContent = money(sumSupermarketExpenses());
}

function editSupermarketExpense(id) {
  const item = state.supermarketExpenses.find(entry => entry.id === id);
  if (!item) return;

  $("supermarketId").value = item.id;
  $("supermarketValue").value = item.value;
  $("supermarketPayment").value = item.payment;
  $("supermarketFormTitle").textContent = "Editar despesa de supermercado";
  openSection("supermarket");
}

function deleteSupermarketExpense(id) {
  confirmAction("Excluir despesa de supermercado", "Esta ação remove o item do mês vigente.", () => {
    state.supermarketExpenses = state.supermarketExpenses.filter(item => item.id !== id);
    renderAll();
    toast("Despesa de supermercado excluída.");
  });
}

function resetSupermarketForm() {
  $("supermarketForm").reset();
  $("supermarketId").value = "";
  $("supermarketPayment").value = "pix";
  $("supermarketFormTitle").textContent = "Nova despesa de supermercado";
}

function sumSupermarketExpenses() {
  return (state.supermarketExpenses || []).reduce((sum, item) => sum + Number(item.value || 0), 0);
}

function labelSupermarketPayment(value) {
  return value === "cartao" ? "Cartão" : "Pix";
}

function editItem(moduleKey, id) {
  const config = modules[moduleKey];
  const item = state[config.list].find(entry => entry.id === id);
  if (!item) return;

  $(config.id).value = item.id;
  $(config.name).value = item.name;
  $(config.value).value = item.value;
  $(config.category).value = item.categoryId;
  $(config.formTitle).textContent = config.editTitle;
  openSection(config.section);
}

function deleteItem(moduleKey, id) {
  const config = modules[moduleKey];
  confirmAction("Excluir registro", "Esta ação remove o item do mês vigente.", () => {
    state[config.list] = state[config.list].filter(item => item.id !== id);
    renderAll();
    toast(config.deleted);
  });
}

function resetForm(moduleKey) {
  const config = modules[moduleKey];
  const formId = config.section === "incomes" ? "incomeForm" : `${config.section}Form`;
  $(formId).reset();
  $(config.id).value = "";
  $(config.formTitle).textContent = config.newTitle;
}

function saveCategory(event) {
  event.preventDefault();
  const id = $("categoryId").value || uid();
  const item = {
    id,
    name: $("categoryName").value.trim(),
    icon: $("categoryIcon").value.trim() || "🏷️",
    color: $("categoryColor").value
  };
  const index = categories.findIndex(c => c.id === id);
  if (index >= 0) categories[index] = item;
  else categories.push(item);

  resetCategoryForm();
  renderAll();
  toast("Categoria salva.");
}

function renderCategories() {
  $("categoriesList").innerHTML = categories.map(c => {
    const usage = [...state.incomes, ...expenseItems()].filter(item => item.categoryId === c.id).length;
    return `<article class="category-item">
      <div class="row-between">
        <span class="category-chip" style="background:${c.color}">${c.icon} ${escapeHTML(c.name)}</span>
        <span class="muted">${usage} registros</span>
      </div>
      <div class="actions">
        <button class="btn secondary small" onclick="editCategory('${c.id}')">Editar</button>
        <button class="btn danger small" onclick="deleteCategory('${c.id}')">Excluir</button>
      </div>
    </article>`;
  }).join("");
}

function editCategory(id) {
  const category = categories.find(item => item.id === id);
  if (!category) return;

  $("categoryId").value = category.id;
  $("categoryName").value = category.name;
  // ALTERADO: atualiza o input hidden e o botão visual do picker
  $("categoryIcon").value = category.icon;
  $("emojiTrigger").textContent = category.icon;
  $("categoryColor").value = category.color;
  $("categoryFormTitle").textContent = "Editar categoria";
}

function deleteCategory(id) {
  const inUse = [...state.incomes, ...expenseItems()].some(item => item.categoryId === id);
  if (inUse) {
    toast("Categoria em uso não pode ser excluída.", "error");
    return;
  }

  confirmAction("Excluir categoria", "A categoria será removida definitivamente.", () => {
    categories = categories.filter(category => category.id !== id);
    renderAll();
    toast("Categoria excluída.");
  });
}

function resetCategoryForm() {
  $("categoryForm").reset();
  $("categoryId").value = "";
  // ALTERADO: reseta o input hidden e o botão visual do picker
  $("categoryIcon").value = "🏷️";
  $("emojiTrigger").textContent = "🏷️";
  $("categoryColor").value = "#0f8f7f";
  $("categoryFormTitle").textContent = "Nova categoria";
}

function houseExpenseInputIds() {
  return ["houseExpenseRent", "houseExpenseCondo", "houseExpenseGas", "houseExpenseEnergy", "houseExpenseInternet"];
}

function openHouseExpenses() {
  renderHouseExpenses();
  $("houseExpensesModal").classList.add("active");
}

function closeHouseExpenses() {
  $("houseExpensesModal").classList.remove("active");
}

function houseExpensesFromInputs() {
  return {
    rent: Number($("houseExpenseRent").value || 0),
    condo: Number($("houseExpenseCondo").value || 0),
    gas: Number($("houseExpenseGas").value || 0),
    energy: Number($("houseExpenseEnergy").value || 0),
    internet: Number($("houseExpenseInternet").value || 0)
  };
}

function sumHouseExpenses(expenses = state.houseExpenses) {
  return Object.values(expenses || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function renderHouseExpenses() {
  const expenses = state.houseExpenses || emptyState().houseExpenses;
  $("houseExpenseRent").value = expenses.rent || "";
  $("houseExpenseCondo").value = expenses.condo || "";
  $("houseExpenseGas").value = expenses.gas || "";
  $("houseExpenseEnergy").value = expenses.energy || "";
  $("houseExpenseInternet").value = expenses.internet || "";
  $("houseExpensesTotal").textContent = money(sumHouseExpenses(expenses));
}

function renderHouseExpensesPreview() {
  $("houseExpensesTotal").textContent = money(sumHouseExpenses(houseExpensesFromInputs()));
}

function saveHouseExpenses(event) {
  event.preventDefault();
  state.houseExpenses = houseExpensesFromInputs();
  state.house.total = sumHouseExpenses(state.houseExpenses);
  renderHouseExpenses();
  renderHouse();
  saveAll();
  toast("Despesas da casa salvas.");
}

function openHouseSplit() {
  renderHouse();
  $("houseModal").classList.add("active");
}

function closeHouseSplit() {
  $("houseModal").classList.remove("active");
}

function houseFromInputs() {
  return {
    person1: $("housePerson1").value.trim(),
    income1: Number($("houseIncome1").value || 0),
    person2: $("housePerson2").value.trim(),
    income2: Number($("houseIncome2").value || 0),
    total: sumHouseExpenses(state.houseExpenses)
  };
}

function saveHouse(event) {
  event.preventDefault();
  state.house = houseFromInputs();
  renderHouseResult(state.house);
  saveAll();
  toast("Rateio salvo.");
}

function renderHouse() {
  const house = state.house || emptyState().house;
  const total = sumHouseExpenses(state.houseExpenses);
  const houseWithCurrentTotal = { ...house, total };
  $("housePerson1").value = house.person1 || "";
  $("houseIncome1").value = house.income1 || "";
  $("housePerson2").value = house.person2 || "";
  $("houseIncome2").value = house.income2 || "";
  $("houseTotal").value = total.toFixed(2) || "";
  renderHouseResult(houseWithCurrentTotal);
}

function renderHousePreview() {
  renderHouseResult(houseFromInputs());
}

function houseResultRows(data = state.house) {
  const house = data || emptyState().house;
  const incomeTotal = Number(house.income1 || 0) + Number(house.income2 || 0);
  return [1, 2].map(n => {
    const ratio = incomeTotal > 0 ? Number(house[`income${n}`] || 0) / incomeTotal : 0;
    return {
      name: house[`person${n}`] || `Pessoa ${n}`,
      ratio,
      value: ratio * Number(house.total || 0)
    };
  });
}

function renderHouseResult(data) {
  $("houseResult").innerHTML = houseResultRows(data).map(item => `
    <article class="person-result">
      <span class="muted">${escapeHTML(item.name)} · ${Math.round(item.ratio * 100)}%</span>
      <strong>${money(item.value)}</strong>
    </article>
  `).join("");
}

function renderCharts() {
  if (!window.Chart) return;

  const categoryItems = expensesByCategory();

  if (categoryChart) categoryChart.destroy();

  categoryChart = new Chart($("categoryChart"), {
    type: "pie",
    data: {
      labels: categoryItems.length ? categoryItems.map(item => `${item.icon} ${item.name}`) : ["Sem despesas"],
      datasets: [{
        data: categoryItems.length ? categoryItems.map(item => item.spent) : [1],
        backgroundColor: categoryItems.length ? categoryItems.map(item => item.color) : ["#dbe7ec"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } }
    }
  });
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem(STORAGE.theme, document.body.classList.contains("dark") ? "dark" : "light");
  renderCharts();
}

function confirmAction(title, text, callback) {
  pendingConfirm = callback;
  $("modalTitle").textContent = title;
  $("modalText").textContent = text;
  $("confirmModal").classList.add("active");
}

function closeModal() {
  pendingConfirm = null;
  $("confirmModal").classList.remove("active");
}

async function closeMonth() {
  try {
    buildPDFReport();
    if (!window.jspdf || !window.html2canvas) {
      toast("Bibliotecas de PDF não carregaram. Verifique a internet.", "error");
      return;
    }

    const report = $("pdfReport");
    const canvas = await html2canvas(report, { scale: 2, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new window.jspdf.jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgHeight = (canvas.height * pageWidth) / canvas.width;
    let position = 0;
    let remaining = imgHeight;

    pdf.addImage(imgData, "PNG", 0, position, pageWidth, imgHeight);
    remaining -= pageHeight;

    while (remaining > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, pageWidth, imgHeight);
      remaining -= pageHeight;
    }

    pdf.save(`relatorio-financeiro-${currentMonthKey()}.pdf`);
    state = emptyState();
    localStorage.setItem(STORAGE.monthly, JSON.stringify(state));
    localStorage.setItem(STORAGE.month, currentMonthKey());
    renderAll();
    toast("PDF exportado e dados mensais apagados.");
  } catch (error) {
    console.error(error);
    toast("Não foi possível gerar o PDF.", "error");
  }
}

function buildPDFReport() {
  const t = totals();
  const categoryRows = expensesByCategory();
  const houseRows = houseResultRows();
  const houseExpensesRows = houseExpenseReportRows();

  $("pdfReport").innerHTML = `
    <h1>Relatório financeiro · ${monthName()}</h1>
    <p>Gerado em ${new Date().toLocaleDateString("pt-BR")}</p>

    <h2>Resumo geral</h2>
    <table>
      <tr><th>Receitas</th><th>Despesas fixas</th><th>Despesas variáveis</th><th>Total despesas</th><th>Saldo</th></tr>
      <tr><td>${money(t.income)}</td><td>${money(t.fixed)}</td><td>${money(t.variable)}</td><td>${money(t.expense)}</td><td>${money(t.balance)}</td></tr>
    </table>

    <h2>Entradas</h2>
    ${reportTable(state.incomes)}

    <h2>Despesas fixas</h2>
    ${reportTable(state.fixedExpenses, true)}

    <h2>Despesas variáveis</h2>
    ${reportTable(state.variableExpenses, true)}

    <h2>Supermercado</h2>
    ${supermarketReportTable()}

    <h2>Gastos por categoria</h2>
    <table>
      <tr><th>Categoria</th><th>Valor</th></tr>
      ${categoryRows.map(item => `<tr><td>${item.icon} ${escapeHTML(item.name)}</td><td>${money(item.spent)}</td></tr>`).join("") || `<tr><td colspan="2">Sem despesas.</td></tr>`}
    </table>

    <h2>Despesas da casa</h2>
    <table>
      <tr><th>Despesa</th><th>Valor</th></tr>
      ${houseExpensesRows.map(item => `<tr><td>${item.name}</td><td>${money(item.value)}</td></tr>`).join("")}
      <tr><th>Total</th><th>${money(sumHouseExpenses(state.houseExpenses))}</th></tr>
    </table>

    <h2>Rateio proporcional da casa</h2>
    <table>
      <tr><th>Pessoa</th><th>Percentual</th><th>Valor</th></tr>
      ${houseRows.map(item => `<tr><td>${escapeHTML(item.name)}</td><td>${Math.round(item.ratio * 100)}%</td><td>${money(item.value)}</td></tr>`).join("")}
    </table>
  `;
}

function houseExpenseReportRows() {
  const expenses = state.houseExpenses || emptyState().houseExpenses;
  return [
    { name: "Aluguel", value: expenses.rent },
    { name: "Condomínio", value: expenses.condo },
    { name: "Gás", value: expenses.gas },
    { name: "Energia", value: expenses.energy },
    { name: "Internet", value: expenses.internet }
  ];
}

function reportTable(list, includePaid = false) {
  return `<table>
    <tr><th>Nome</th><th>Categoria</th><th>Valor</th>${includePaid ? "<th>Pago</th>" : ""}</tr>
    ${list.map(item => `<tr><td>${escapeHTML(item.name)}</td><td>${escapeHTML(categoryById(item.categoryId).name)}</td><td>${money(item.value)}</td>${includePaid ? `<td>${item.paid ? "Sim" : "Não"}</td>` : ""}</tr>`).join("") || `<tr><td colspan="${includePaid ? 4 : 3}">Sem registros.</td></tr>`}
    <tr><th colspan="2">Total</th><th>${money(sumList(list))}</th>${includePaid ? "<th></th>" : ""}</tr>
  </table>`;
}

function supermarketReportTable() {
  const list = state.supermarketExpenses || [];
  return `<table>
    <tr><th>Valor</th><th>Forma de pagamento</th></tr>
    ${list.map(item => `<tr><td>${money(item.value)}</td><td>${labelSupermarketPayment(item.payment)}</td></tr>`).join("") || `<tr><td colspan="2">Sem registros.</td></tr>`}
    <tr><th>Total</th><th>${money(sumSupermarketExpenses())}</th></tr>
  </table>`;
}

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.textContent = message;
  item.style.borderLeftColor = type === "error" ? "var(--danger)" : "var(--primary)";
  $("toast").appendChild(item);
  setTimeout(() => item.remove(), 3200);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

window.editItem = editItem;
window.deleteItem = deleteItem;
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.togglePaid = togglePaid;
window.editSupermarketExpense = editSupermarketExpense;
window.deleteSupermarketExpense = deleteSupermarketExpense;

init();
