const STORAGE = {
  month: "pf_current_month",
  monthly: "pf_monthly_simple_data",
  legacyMonthly: "pf_monthly_data",
  categories: "pf_categories",
  investments: "pf_investments",
  remoteCachePrefix: "pf_supabase_cache_",
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
  appointments: [],
  house: { person1: "", income1: 0, person2: "", income2: 0, total: 0 },
  houseExpenses: { rent: 0, condo: 0, gas: 0, energy: 0, internet: 0 }
});

let state = emptyState();
let categories = [];
let categoryChart;
let investmentAllocationChart;
let investmentEvolutionChart;
let investmentState = { assets: [], movements: [], snapshots: [], cdiRates: [], cdiLastSync: "" };
let cdiSyncMessage = "";
let supabaseClient = null;
let currentUser = null;
let remoteReady = false;
let isHydratingRemote = false;
let cloudSaveTimer = null;
let activeMonthKey = "";
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

const investmentTypes = {
  fixed_income: { label: "Renda fixa", color: "#1466d8" },
  stocks: { label: "Ações", color: "#0f8f7f" },
  real_estate_funds: { label: "Fundos imobiliários", color: "#6d5dfc" },
  funds: { label: "Fundos", color: "#d98a16" },
  crypto: { label: "Criptomoedas", color: "#d64545" },
  pension: { label: "Previdência", color: "#7b4f9d" },
  other: { label: "Outros", color: "#63717d" }
};

const movementTypes = {
  contribution: "Aporte",
  withdrawal: "Resgate",
  income: "Provento recebido",
  fee: "Taxa"
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function todayInput() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function validDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
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
  next.appointments = normalizeAppointmentList(data?.appointments);
  next.house = data?.house || { person1: "", income1: 0, person2: "", income2: 0, total: 0 };
  next.houseExpenses = data?.houseExpenses || { rent: 0, condo: 0, gas: 0, energy: 0, internet: 0 };
  next.house.total = sumHouseExpenses(next.houseExpenses) || Number(next.house.total || 0);
  return next;
}

function normalizeAppointmentList(list) {
  return Array.isArray(list) ? list
    .filter(item => validDateInput(item?.date) && String(item?.name || "").trim())
    .map(item => ({
      id: item.id || uid(),
      name: String(item.name).trim().slice(0, 100),
      date: item.date,
      time: /^\d{2}:\d{2}$/.test(String(item.time || "")) ? item.time : "",
      note: String(item.note || "").trim().slice(0, 500)
    })) : [];
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

function normalizeInvestmentState(data) {
  return {
    assets: Array.isArray(data?.assets) ? data.assets.map(item => ({
      id: item.id || uid(),
      name: String(item.name || "Sem nome"),
      type: investmentTypes[item.type] ? item.type : "other",
      institution: String(item.institution || ""),
      currentValue: Math.max(0, Number(item.currentValue || 0)),
      yieldMode: item.yieldMode === "cdi" ? "cdi" : "manual",
      cdiPercentage: Number(item.cdiPercentage) >= 0 ? Number(item.cdiPercentage) : 100,
      cdiBaseDate: validDateInput(item.cdiBaseDate) ? item.cdiBaseDate : todayInput(),
      cdiBaseValue: Math.max(0, Number(item.cdiBaseValue ?? item.currentValue ?? 0))
    })) : [],
    movements: Array.isArray(data?.movements) ? data.movements.map(item => ({
      id: item.id || uid(),
      assetId: String(item.assetId || ""),
      date: validDateInput(item.date) ? item.date : todayInput(),
      type: movementTypes[item.type] ? item.type : "contribution",
      value: Math.max(0, Number(item.value || 0)),
      note: String(item.note || "")
    })) : [],
    snapshots: Array.isArray(data?.snapshots) ? data.snapshots
      .filter(item => validDateInput(item.date))
      .map(item => ({ date: item.date, total: Math.max(0, Number(item.total || 0)) })) : [],
    cdiRates: Array.isArray(data?.cdiRates) ? data.cdiRates
      .filter(item => validDateInput(item.date) && Number.isFinite(Number(item.value)))
      .map(item => ({ date: item.date, value: Number(item.value) })) : [],
    cdiLastSync: String(data?.cdiLastSync || "")
  };
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

function buildAppPayload() {
  return {
    version: 3,
    month: activeMonthKey || currentMonthKey(),
    monthlyState: state,
    categories,
    investments: investmentState,
    theme: document.body.classList.contains("dark") ? "dark" : "light"
  };
}

function legacyLocalPayload() {
  categories = loadJSON(STORAGE.categories, defaultCategories);
  if (!categories.length) categories = defaultCategories.map(category => ({ ...category }));
  const savedMonth = localStorage.getItem(STORAGE.month) || currentMonthKey();
  const saved = loadJSON(STORAGE.monthly, null);
  const monthlyState = saved ? normalizeState(saved) : migrateLegacyData();
  return {
    version: 3,
    month: savedMonth,
    monthlyState,
    categories,
    investments: normalizeInvestmentState(loadJSON(STORAGE.investments, null)),
    theme: localStorage.getItem(STORAGE.theme) === "dark" ? "dark" : "light"
  };
}

function applyAppPayload(payload) {
  activeMonthKey = String(payload?.month || currentMonthKey());
  state = normalizeState(payload?.monthlyState);
  categories = Array.isArray(payload?.categories) && payload.categories.length
    ? payload.categories
    : defaultCategories.map(category => ({ ...category }));
  investmentState = normalizeInvestmentState(payload?.investments);

  const monthRolled = activeMonthKey !== currentMonthKey();
  if (monthRolled) {
    activeMonthKey = currentMonthKey();
    state = emptyState();
  }

  document.body.classList.toggle("dark", payload?.theme === "dark");
  return monthRolled;
}

function userCacheKey() {
  return currentUser ? `${STORAGE.remoteCachePrefix}${currentUser.id}` : "";
}

function loadUserCache() {
  const key = userCacheKey();
  if (!key) return null;
  const saved = loadJSON(key, null);
  if (!saved) return null;
  return saved.payload ? saved : { payload: saved, pending: false, savedAt: "" };
}

function saveUserCache(payload = buildAppPayload(), pending = true) {
  const key = userCacheKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify({ payload, pending, savedAt: new Date().toISOString() }));
}

function setCloudStatus(message, type = "pending") {
  $("cloudSyncStatus").textContent = message;
  $("cloudSyncStatus").classList.toggle("synced", type === "synced");
  $("cloudSyncStatus").classList.toggle("error", type === "error");
}

function scheduleCloudSave() {
  if (!remoteReady || !currentUser || !supabaseClient || isHydratingRemote) return;
  clearTimeout(cloudSaveTimer);
  setCloudStatus("Alterações pendentes...");
  cloudSaveTimer = setTimeout(() => saveRemoteNow(), 650);
}

async function saveRemoteNow() {
  if (!currentUser || !supabaseClient) return false;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  const payload = buildAppPayload();
  saveUserCache(payload, true);
  setCloudStatus("Sincronizando...");

  try {
    const { error } = await supabaseClient
      .from("finance_app_state")
      .upsert({ user_id: currentUser.id, payload, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
  } catch (error) {
    console.error(error);
    setCloudStatus("Não sincronizado", "error");
    return false;
  }
  saveUserCache(payload, false);
  setCloudStatus("Salvo na nuvem", "synced");
  return true;
}

function saveAll() {
  if (isHydratingRemote) return;
  saveUserCache(buildAppPayload(), true);
  scheduleCloudSave();
}

function clearLegacyAppStorage() {
  [STORAGE.month, STORAGE.monthly, STORAGE.legacyMonthly, STORAGE.categories, STORAGE.investments]
    .forEach(key => localStorage.removeItem(key));
}

async function loadAuthenticatedData() {
  setCloudStatus("Carregando da nuvem...");
  const { data, error } = await supabaseClient
    .from("finance_app_state")
    .select("payload, updated_at")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  isHydratingRemote = true;
  let importedLegacy = false;
  let uploadPendingCache = false;
  let monthRolled = false;
  const cached = loadUserCache();

  if (error) {
    console.error(error);
    monthRolled = applyAppPayload(cached?.payload || legacyLocalPayload());
    setCloudStatus("Modo local · tente sincronizar", "error");
  } else if (data?.payload) {
    if (cached?.pending) {
      monthRolled = applyAppPayload(cached.payload);
      uploadPendingCache = true;
      setCloudStatus("Enviando alterações pendentes...");
    } else {
      monthRolled = applyAppPayload(data.payload);
      saveUserCache(data.payload, false);
      setCloudStatus("Salvo na nuvem", "synced");
    }
  } else {
    monthRolled = applyAppPayload(cached?.payload || legacyLocalPayload());
    importedLegacy = true;
  }

  remoteReady = true;
  renderAll();
  isHydratingRemote = false;

  if (!error && (importedLegacy || uploadPendingCache || monthRolled)) {
    const saved = await saveRemoteNow();
    if (saved && importedLegacy) {
      clearLegacyAppStorage();
      toast("Dados deste navegador migrados para o Supabase.");
    }
  }
}

function setAuthMessage(message, type = "") {
  $("authMessage").textContent = message;
  $("authMessage").className = `auth-message ${type}`.trim();
}

function setAuthBusy(isBusy) {
  $("signInButton").disabled = isBusy;
  $("signUpButton").disabled = isBusy;
  $("authEmail").disabled = isBusy;
  $("authPassword").disabled = isBusy;
}

async function startAuthenticatedApp(user) {
  currentUser = user;
  remoteReady = false;
  $("userEmail").textContent = user.email || "Usuário autenticado";
  $("userSession").hidden = false;
  setAuthMessage("Carregando seus dados...");
  await loadAuthenticatedData();
  $("authScreen").classList.remove("active");
  setAuthMessage("");
  refreshCdiRates({ silent: true });
}

async function signIn(event) {
  event.preventDefault();
  setAuthBusy(true);
  setAuthMessage("Entrando...");
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: $("authEmail").value.trim(),
    password: $("authPassword").value
  });
  setAuthBusy(false);
  if (error) {
    setAuthMessage(authErrorMessage(error), "error");
    return;
  }
  await startAuthenticatedApp(data.user);
}

async function signUp() {
  if (!$("authForm").reportValidity()) return;
  setAuthBusy(true);
  setAuthMessage("Criando sua conta...");
  const { data, error } = await supabaseClient.auth.signUp({
    email: $("authEmail").value.trim(),
    password: $("authPassword").value
  });
  setAuthBusy(false);
  if (error) {
    setAuthMessage(authErrorMessage(error), "error");
    return;
  }
  if (data.session && data.user) {
    await startAuthenticatedApp(data.user);
  } else {
    setAuthMessage("Conta criada. Confirme o e-mail recebido e depois entre com sua senha.", "success");
  }
}

function authErrorMessage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (message.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (message.includes("user already registered")) return "Este e-mail já possui uma conta.";
  if (message.includes("password")) return "A senha deve ter pelo menos 6 caracteres.";
  return "Não foi possível concluir o acesso. Tente novamente.";
}

async function signOut() {
  await saveRemoteNow();
  await supabaseClient.auth.signOut();
  currentUser = null;
  remoteReady = false;
  state = emptyState();
  categories = [];
  investmentState = normalizeInvestmentState(null);
  $("userSession").hidden = true;
  $("authPassword").value = "";
  $("authScreen").classList.add("active");
  setAuthMessage("Você saiu da sua conta.", "success");
}

function bindAuthEvents() {
  $("authForm").addEventListener("submit", signIn);
  $("signUpButton").addEventListener("click", signUp);
  $("signOutButton").addEventListener("click", signOut);
  $("retryCloudSync").addEventListener("click", saveRemoteNow);
  window.addEventListener("online", () => saveRemoteNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && cloudSaveTimer) saveRemoteNow();
  });
}

async function init() {
  activeMonthKey = currentMonthKey();
  $("currentMonthLabel").textContent = monthName();
  $("movementDate").value = todayInput();
  $("movementMonthFilter").value = currentMonthKey();
  if (localStorage.getItem(STORAGE.theme) === "dark") document.body.classList.add("dark");

  bindEvents();
  bindAuthEvents();
  initEmojiPicker();

  const config = window.SUPABASE_CONFIG;
  if (!window.supabase?.createClient || !config?.url || !config?.publishableKey) {
    setAuthMessage("A configuração do Supabase não foi carregada.", "error");
    setAuthBusy(true);
    return;
  }

  supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    setAuthMessage("Não foi possível verificar sua sessão.", "error");
    return;
  }
  if (data.session?.user) await startAuthenticatedApp(data.session.user);
  else setAuthMessage("Entre ou crie uma conta para continuar.");
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
  $("calendarForm").addEventListener("submit", saveAppointment);
  $("calendarGrid").addEventListener("click", (event) => {
    const day = event.target.closest("button[data-date]");
    if (day) openAppointmentModal(day.dataset.date);
  });
  $("appointmentDate").addEventListener("change", () => {
    const date = $("appointmentDate").value;
    if (!validDateInput(date)) return;
    updateCalendarModalTitle(date);
    renderDayAppointments(date);
  });
  $("dayAppointments").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-appointment-id]");
    if (button) deleteAppointment(button.dataset.appointmentId, button.dataset.date);
  });
  $("closeCalendarModal").addEventListener("click", closeAppointmentModal);
  $("calendarModal").addEventListener("click", (event) => {
    if (event.target === $("calendarModal")) closeAppointmentModal();
  });
  $("investmentForm").addEventListener("submit", saveInvestment);
  $("movementForm").addEventListener("submit", saveInvestmentMovement);
  $("investmentYieldMode").addEventListener("change", renderInvestmentYieldFields);
  $("refreshCdiRates").addEventListener("click", () => refreshCdiRates());

  $("clearIncomeForm").addEventListener("click", () => resetForm("incomes"));
  $("clearFixedForm").addEventListener("click", () => resetForm("fixedExpenses"));
  $("clearVariableForm").addEventListener("click", () => resetForm("variableExpenses"));
  $("clearSupermarketForm").addEventListener("click", resetSupermarketForm);
  $("clearInvestmentForm").addEventListener("click", resetInvestmentForm);
  $("clearMovementForm").addEventListener("click", resetMovementForm);
  $("movementMonthFilter").addEventListener("input", renderMovementHistory);
  $("movementAssetFilter").addEventListener("change", renderMovementHistory);
  $("clearMovementFilters").addEventListener("click", clearMovementFilters);
  $("exportInvestments").addEventListener("click", exportInvestmentBackup);
  $("importInvestments").addEventListener("click", () => $("investmentBackupFile").click());
  $("investmentBackupFile").addEventListener("change", importInvestmentBackup);

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
      "O PDF será gerado e entradas, despesas e rateio serão apagados. Categorias, investimentos e movimentações permanecerão salvos.",
      closeMonth
    );
  });

  $("modalCancel").addEventListener("click", closeModal);
  $("modalConfirm").addEventListener("click", () => {
    const action = pendingConfirm;
    closeModal();
    if (action) action();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("calendarModal").classList.contains("active")) closeAppointmentModal();
  });
}

function openSection(id) {
  document.querySelectorAll(".section").forEach(section => section.classList.toggle("active", section.id === id));
  document.querySelectorAll(".nav button").forEach(button => button.classList.toggle("active", button.dataset.section === id));
  const label = document.querySelector(`.nav button[data-section="${id}"]`).textContent.replace(/^[^\wÀ-ú]+/, "").trim();
  $("pageTitle").textContent = label;
  $("sidebar").classList.remove("open");
  if (id === "dashboard") renderCharts();
  if (id === "investments") renderInvestmentCharts();
  if (id === "calendar") renderCalendar();
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
  renderCalendar();
  renderCategories();
  renderHouseExpenses();
  renderHouse();
  renderInvestments();
  renderCharts();
  saveAll();
}

function calendarDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function currentMonthBounds() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return {
    min: calendarDate(now.getFullYear(), now.getMonth(), 1),
    max: calendarDate(now.getFullYear(), now.getMonth(), lastDay)
  };
}

function appointmentsForDate(date) {
  return state.appointments
    .filter(item => item.date === date)
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.name.localeCompare(b.name, "pt-BR"));
}

function renderCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthKey = currentMonthKey();
  const monthAppointments = state.appointments.filter(item => item.date.startsWith(monthKey));

  $("calendarMonthTitle").textContent = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(now);
  $("calendarAppointmentCount").textContent = monthAppointments.length
    ? `${monthAppointments.length} compromisso${monthAppointments.length === 1 ? "" : "s"} neste mês.`
    : "Nenhum compromisso cadastrado.";

  const cells = Array.from({ length: firstWeekday }, () => '<div class="calendar-day empty" aria-hidden="true"></div>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = calendarDate(year, month, day);
    const appointments = appointmentsForDate(date);
    const preview = appointments.slice(0, 3).map(item => `
      <span class="calendar-event"><b>${item.time || "•"}</b> ${escapeHTML(item.name)}</span>
    `).join("");
    const extra = appointments.length > 3 ? `<span class="calendar-more">+${appointments.length - 3} compromisso(s)</span>` : "";
    cells.push(`
      <button class="calendar-day${date === todayInput() ? " today" : ""}${appointments.length ? " has-events" : ""}" type="button" data-date="${date}" aria-label="Dia ${day}, ${appointments.length} compromisso(s)">
        <span class="calendar-day-number">${day}</span>
        <span class="calendar-events">${preview}${extra}</span>
      </button>
    `);
  }
  $("calendarGrid").innerHTML = cells.join("");
}

function openAppointmentModal(date) {
  const bounds = currentMonthBounds();
  $("calendarForm").reset();
  $("appointmentDate").min = bounds.min;
  $("appointmentDate").max = bounds.max;
  $("appointmentDate").value = date;
  updateCalendarModalTitle(date);
  renderDayAppointments(date);
  $("calendarModal").classList.add("active");
  requestAnimationFrame(() => $("appointmentName").focus());
}

function closeAppointmentModal() {
  $("calendarModal").classList.remove("active");
  $("calendarForm").reset();
}

function updateCalendarModalTitle(date) {
  const [year, month, day] = date.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" })
    .format(new Date(year, month - 1, day));
  $("calendarModalTitle").textContent = `Novo compromisso · ${label}`;
}

function saveAppointment(event) {
  event.preventDefault();
  const name = $("appointmentName").value.trim();
  const date = $("appointmentDate").value;
  if (!name || !validDateInput(date)) return;
  if (!date.startsWith(currentMonthKey())) {
    toast("Selecione uma data do mês vigente.", "error");
    return;
  }

  state.appointments.push({
    id: uid(),
    name,
    date,
    time: $("appointmentTime").value,
    note: $("appointmentNote").value.trim()
  });
  renderCalendar();
  saveAll();
  closeAppointmentModal();
  toast("Compromisso salvo.");
}

function renderDayAppointments(date) {
  const appointments = appointmentsForDate(date);
  $("dayAppointments").innerHTML = appointments.length ? appointments.map(item => `
    <article class="day-appointment">
      <div>
        <strong>${item.time ? `${item.time} · ` : ""}${escapeHTML(item.name)}</strong>
        ${item.note ? `<p>${escapeHTML(item.note)}</p>` : ""}
      </div>
      <button class="btn danger small" type="button" data-appointment-id="${escapeHTML(item.id)}" data-date="${date}">Excluir</button>
    </article>
  `).join("") : '<p class="muted empty-appointments">Nenhum compromisso neste dia.</p>';
}

function deleteAppointment(id, date) {
  const appointment = state.appointments.find(item => item.id === id);
  if (!appointment) return;
  confirmAction("Excluir compromisso", `Deseja excluir “${appointment.name}”?`, () => {
    state.appointments = state.appointments.filter(item => item.id !== id);
    renderCalendar();
    renderDayAppointments(date);
    saveAll();
    toast("Compromisso excluído.");
  });
}

function renderDashboard() {
  const t = totals();
  $("dashIncome").textContent = money(t.income);
  $("dashExpense").textContent = money(t.expense);
  $("dashBalance").textContent = money(t.balance);
  $("dashFixed").textContent = money(t.fixed);
  $("dashInvestments").textContent = money(investmentMovementsForMonth(currentMonthKey(), "contribution"));
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

function investmentAssetById(id) {
  return investmentState.assets.find(asset => asset.id === id);
}

function investmentMovementTotals(assetId = null) {
  const movements = investmentState.movements.filter(item => !assetId || item.assetId === assetId);
  return movements.reduce((totals, item) => {
    totals[item.type] += Number(item.value || 0);
    return totals;
  }, { contribution: 0, withdrawal: 0, income: 0, fee: 0 });
}

function investmentSummary(assetId = null) {
  const movementTotals = investmentMovementTotals(assetId);
  const current = investmentState.assets
    .filter(asset => !assetId || asset.id === assetId)
    .reduce((sum, asset) => sum + Number(asset.currentValue || 0), 0);
  const netContributed = movementTotals.contribution - movementTotals.withdrawal;
  const result = current + movementTotals.income - netContributed;
  const percentage = netContributed > 0 ? (result / netContributed) * 100 : 0;
  return { ...movementTotals, current, netContributed, result, percentage };
}

function investmentMovementsForMonth(month, type = null) {
  return investmentState.movements
    .filter(item => item.date.slice(0, 7) === month && (!type || item.type === type))
    .reduce((sum, item) => sum + Number(item.value || 0), 0);
}

function renderInvestments() {
  const summary = investmentSummary();
  $("investmentPatrimony").textContent = money(summary.current);
  $("investmentNetContributed").textContent = money(summary.netContributed);
  $("investmentResult").textContent = `${money(summary.result)} · ${summary.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  $("investmentResult").classList.toggle("negative-value", summary.result < 0);
  $("investmentIncome").textContent = money(summary.income);

  renderInvestmentSelects();
  renderInvestmentYieldFields();
  renderCdiSyncStatus();
  renderInvestmentTable();
  renderMovementHistory();
  renderInvestmentCharts();
}

function renderInvestmentSelects() {
  const movementValue = $("movementInvestment").value;
  const filterValue = $("movementAssetFilter").value;
  const options = investmentState.assets
    .map(asset => `<option value="${asset.id}">${escapeHTML(asset.name)}</option>`)
    .join("");

  $("movementInvestment").innerHTML = options || `<option value="">Cadastre um investimento primeiro</option>`;
  $("movementInvestment").value = investmentAssetById(movementValue) ? movementValue : (investmentState.assets[0]?.id || "");
  $("movementAssetFilter").innerHTML = `<option value="">Todos</option>${options}`;
  $("movementAssetFilter").value = investmentAssetById(filterValue) ? filterValue : "";
  $("movementForm").querySelector('button[type="submit"]').disabled = !investmentState.assets.length;
}

function renderInvestmentTable() {
  const rows = investmentState.assets.map(asset => {
    const summary = investmentSummary(asset.id);
    const type = investmentTypes[asset.type] || investmentTypes.other;
    const resultClass = summary.result < 0 ? "negative-value" : "positive-value";
    return `<tr>
      <td><strong>${escapeHTML(asset.name)}</strong></td>
      <td><span class="category-chip" style="background:${type.color}">${type.label}</span></td>
      <td>${escapeHTML(asset.institution)}</td>
      <td>${asset.yieldMode === "cdi" ? `<span class="status cdi-status">${Number(asset.cdiPercentage).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% do CDI</span>` : `<span class="muted">Manual</span>`}</td>
      <td>${money(summary.netContributed)}</td>
      <td><strong>${money(summary.current)}</strong></td>
      <td class="${resultClass}"><strong>${money(summary.result)}</strong> · ${summary.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</td>
      <td><div class="actions">
        <button class="btn secondary small" onclick="editInvestment('${asset.id}')">Atualizar</button>
        <button class="btn danger small" onclick="deleteInvestment('${asset.id}')">Excluir</button>
      </div></td>
    </tr>`;
  }).join("");
  const total = investmentSummary();

  $("investmentTable").innerHTML = rows || `<tr><td colspan="8" class="muted">Nenhum investimento cadastrado.</td></tr>`;
  $("investmentTableNetTotal").textContent = money(total.netContributed);
  $("investmentTableValueTotal").textContent = money(total.current);
  $("investmentTableResultTotal").textContent = money(total.result);
}

function saveInvestment(event) {
  event.preventDefault();
  const id = $("investmentId").value || uid();
  const index = investmentState.assets.findIndex(asset => asset.id === id);
  const isNew = index < 0;
  const previous = isNew ? null : investmentState.assets[index];
  const yieldMode = $("investmentYieldMode").value;
  const inputValue = Number($("investmentCurrentValue").value || 0);
  const inputBaseDate = $("investmentBaseDate").value || todayInput();
  const shouldResetCdiBase = yieldMode === "cdi" && (
    isNew ||
    previous?.yieldMode !== "cdi" ||
    previous?.cdiBaseDate !== inputBaseDate ||
    Math.abs(Number(previous?.currentValue || 0) - inputValue) > 0.011
  );
  const asset = {
    ...(previous || {}),
    id,
    name: $("investmentName").value.trim(),
    type: $("investmentType").value,
    institution: $("investmentInstitution").value.trim(),
    currentValue: inputValue,
    yieldMode,
    cdiPercentage: Number($("investmentCdiPercentage").value || 100),
    cdiBaseDate: shouldResetCdiBase ? inputBaseDate : (previous?.cdiBaseDate || inputBaseDate),
    cdiBaseValue: shouldResetCdiBase ? inputValue : Number(previous?.cdiBaseValue ?? inputValue)
  };

  if (isNew) investmentState.assets.push(asset);
  else investmentState.assets[index] = asset;

  const informedInitialContribution = Number($("investmentInitialContribution").value || 0);
  const initialContribution = isNew && yieldMode === "cdi" && informedInitialContribution <= 0
    ? asset.cdiBaseValue
    : informedInitialContribution;
  if (isNew && initialContribution > 0) {
    investmentState.movements.push({
      id: uid(), assetId: id, date: yieldMode === "cdi" ? asset.cdiBaseDate : todayInput(), type: "contribution", value: initialContribution, note: "Aporte inicial"
    });
  }

  if (asset.yieldMode === "cdi") recalculateCdiAsset(asset);

  recordInvestmentSnapshot();
  resetInvestmentForm();
  renderAll();
  if (asset.yieldMode === "cdi") refreshCdiRates({ silent: true });
  toast(isNew ? "Investimento cadastrado." : (shouldResetCdiBase ? "Saldo-base do investimento atualizado." : "Investimento atualizado."));
}

function editInvestment(id) {
  const asset = investmentAssetById(id);
  if (!asset) return;
  $("investmentId").value = asset.id;
  $("investmentName").value = asset.name;
  $("investmentType").value = asset.type;
  $("investmentInstitution").value = asset.institution;
  $("investmentYieldMode").value = asset.yieldMode || "manual";
  $("investmentCdiPercentage").value = asset.cdiPercentage ?? 100;
  $("investmentBaseDate").value = asset.cdiBaseDate || todayInput();
  $("investmentCurrentValue").value = Number(asset.currentValue || 0).toFixed(2);
  $("investmentInitialContribution").value = "";
  $("investmentInitialContribution").disabled = true;
  $("investmentFormTitle").textContent = "Atualizar investimento";
  renderInvestmentYieldFields();
  openSection("investments");
  $("investmentName").focus();
}

function deleteInvestment(id) {
  const asset = investmentAssetById(id);
  if (!asset) return;
  confirmAction(
    "Excluir investimento",
    `O investimento ${asset.name} e todo o histórico ligado a ele serão apagados definitivamente.`,
    () => {
      investmentState.assets = investmentState.assets.filter(item => item.id !== id);
      investmentState.movements = investmentState.movements.filter(item => item.assetId !== id);
      resetInvestmentForm();
      resetMovementForm();
      recordInvestmentSnapshot();
      renderAll();
      toast("Investimento excluído.");
    }
  );
}

function resetInvestmentForm() {
  $("investmentForm").reset();
  $("investmentId").value = "";
  $("investmentInitialContribution").disabled = false;
  $("investmentType").value = "fixed_income";
  $("investmentYieldMode").value = "manual";
  $("investmentCdiPercentage").value = "100";
  $("investmentBaseDate").value = todayInput();
  $("investmentFormTitle").textContent = "Novo investimento";
  renderInvestmentYieldFields();
}

function renderInvestmentYieldFields() {
  const isCdi = $("investmentYieldMode").value === "cdi";
  $("investmentCdiPercentageField").hidden = !isCdi;
  $("investmentBaseDateField").hidden = !isCdi;
  $("investmentCdiHelp").hidden = !isCdi;
  $("investmentCdiPercentage").required = isCdi;
  $("investmentBaseDate").required = isCdi;
  $("investmentCurrentValueLabel").textContent = isCdi ? "Saldo na data-base" : "Saldo atual";
  if (isCdi && !$("investmentBaseDate").value) $("investmentBaseDate").value = todayInput();
}

function movementBalanceEffect(movement) {
  if (movement.type === "contribution") return Number(movement.value || 0);
  if (movement.type === "withdrawal" || movement.type === "fee") return -Number(movement.value || 0);
  return 0;
}

function applyMovementToBalance(movement, direction = 1) {
  const asset = investmentAssetById(movement.assetId);
  if (!asset) return;
  asset.currentValue = Number(asset.currentValue || 0) + movementBalanceEffect(movement) * direction;
}

function clampInvestmentBalances() {
  investmentState.assets.forEach(asset => {
    asset.currentValue = Math.max(0, Number(asset.currentValue || 0));
  });
}

function recalculateCdiAsset(asset) {
  if (!asset || asset.yieldMode !== "cdi") return Number(asset?.currentValue || 0);
  const baseDate = validDateInput(asset.cdiBaseDate) ? asset.cdiBaseDate : todayInput();
  const today = todayInput();
  const rateByDate = new Map(investmentState.cdiRates
    .filter(item => item.date > baseDate && item.date <= today)
    .map(item => [item.date, Number(item.value || 0)]));
  const movementsByDate = new Map();

  investmentState.movements
    .filter(item => item.assetId === asset.id && item.date > baseDate && item.date <= today)
    .forEach(item => {
      if (!movementsByDate.has(item.date)) movementsByDate.set(item.date, []);
      movementsByDate.get(item.date).push(item);
    });

  const dates = [...new Set([...rateByDate.keys(), ...movementsByDate.keys()])].sort();
  let balance = Math.max(0, Number(asset.cdiBaseValue ?? asset.currentValue ?? 0));
  let lastRateDate = "";

  dates.forEach(date => {
    if (rateByDate.has(date)) {
      const dailyCdi = rateByDate.get(date) / 100;
      balance *= 1 + dailyCdi * (Number(asset.cdiPercentage || 0) / 100);
      lastRateDate = date;
    }
    (movementsByDate.get(date) || []).forEach(movement => {
      balance += movementBalanceEffect(movement);
    });
    balance = Math.max(0, balance);
  });

  asset.currentValue = balance;
  asset.cdiLastRateDate = lastRateDate;
  return balance;
}

function recalculateAllCdiAssets() {
  investmentState.assets.filter(asset => asset.yieldMode === "cdi").forEach(recalculateCdiAsset);
}

function renderCdiSyncStatus() {
  const cdiAssets = investmentState.assets.filter(asset => asset.yieldMode === "cdi");
  const button = $("refreshCdiRates");
  button.disabled = !cdiAssets.length;

  if (!cdiAssets.length) {
    $("cdiSyncStatus").textContent = "Nenhum investimento automático cadastrado.";
    return;
  }
  if (cdiSyncMessage) {
    $("cdiSyncStatus").textContent = cdiSyncMessage;
    return;
  }

  const lastRate = [...investmentState.cdiRates].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!lastRate) {
    $("cdiSyncStatus").textContent = "Aguardando a primeira sincronização com o Banco Central.";
    return;
  }
  const rateDate = new Date(`${lastRate.date}T00:00:00`).toLocaleDateString("pt-BR");
  const syncDate = investmentState.cdiLastSync
    ? new Date(investmentState.cdiLastSync).toLocaleString("pt-BR")
    : "não informada";
  $("cdiSyncStatus").textContent = `CDI disponível até ${rateDate}. Última consulta: ${syncDate}.`;
}

function bcbDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function addYearsToDate(value, years) {
  const date = new Date(`${value}T12:00:00`);
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString().slice(0, 10);
}

function addDaysToDate(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function refreshCdiRates({ silent = false } = {}) {
  const cdiAssets = investmentState.assets.filter(asset => asset.yieldMode === "cdi");
  if (!cdiAssets.length) {
    cdiSyncMessage = "";
    renderCdiSyncStatus();
    return;
  }

  const button = $("refreshCdiRates");
  button.disabled = true;
  cdiSyncMessage = "Consultando as taxas diárias do Banco Central...";
  renderCdiSyncStatus();

  try {
    const today = todayInput();
    const neededStart = cdiAssets.map(asset => asset.cdiBaseDate).filter(validDateInput).sort()[0] || today;
    const cachedDates = investmentState.cdiRates.map(item => item.date).sort();
    let periodStart = cachedDates.length && cachedDates[0] <= neededStart
      ? addDaysToDate(cachedDates[cachedDates.length - 1], 1)
      : neededStart;
    const received = [];

    while (periodStart <= today) {
      const nineYearsLater = addYearsToDate(periodStart, 9);
      const periodEnd = nineYearsLater < today ? nineYearsLater : today;
      const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${encodeURIComponent(bcbDate(periodStart))}&dataFinal=${encodeURIComponent(bcbDate(periodEnd))}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Banco Central respondeu com status ${response.status}`);
      const data = await response.json();
      data.forEach(item => {
        const [day, month, year] = String(item.data || "").split("/");
        const value = Number(String(item.valor || "").replace(",", "."));
        if (year && Number.isFinite(value)) received.push({ date: `${year}-${month}-${day}`, value });
      });
      periodStart = addDaysToDate(periodEnd, 1);
    }

    const merged = new Map(investmentState.cdiRates.map(item => [item.date, item]));
    received.forEach(item => merged.set(item.date, item));
    investmentState.cdiRates = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
    investmentState.cdiLastSync = new Date().toISOString();
    cdiSyncMessage = "";
    recalculateAllCdiAssets();
    recordInvestmentSnapshot();
    renderAll();
    if (!silent) toast("CDI atualizado e investimentos recalculados.");
  } catch (error) {
    console.error(error);
    cdiSyncMessage = "Não foi possível consultar o Banco Central. Usando as taxas já salvas no navegador.";
    renderCdiSyncStatus();
    if (!silent) toast("Não foi possível atualizar o CDI. Verifique a conexão.", "error");
  } finally {
    button.disabled = false;
    renderCdiSyncStatus();
  }
}

function saveInvestmentMovement(event) {
  event.preventDefault();
  if (!investmentAssetById($("movementInvestment").value)) {
    toast("Cadastre um investimento antes da movimentação.", "error");
    return;
  }

  const id = $("movementId").value || uid();
  const index = investmentState.movements.findIndex(item => item.id === id);
  const previous = index >= 0 ? investmentState.movements[index] : null;
  const previousAsset = previous ? investmentAssetById(previous.assetId) : null;
  if (previous && previousAsset?.yieldMode !== "cdi") applyMovementToBalance(previous, -1);

  const movement = {
    id,
    assetId: $("movementInvestment").value,
    date: $("movementDate").value,
    type: $("movementType").value,
    value: Number($("movementValue").value),
    note: $("movementNote").value.trim()
  };
  const targetAsset = investmentAssetById(movement.assetId);
  if (targetAsset?.yieldMode !== "cdi" && Number(targetAsset.currentValue || 0) + movementBalanceEffect(movement) < 0) {
    if (previous && previousAsset?.yieldMode !== "cdi") applyMovementToBalance(previous);
    clampInvestmentBalances();
    toast("O valor da saída não pode ser maior que o saldo do investimento.", "error");
    return;
  }
  if (index >= 0) investmentState.movements[index] = movement;
  else investmentState.movements.push(movement);
  if (targetAsset.yieldMode === "cdi") recalculateCdiAsset(targetAsset);
  else applyMovementToBalance(movement);
  if (previousAsset?.yieldMode === "cdi" && previousAsset.id !== targetAsset.id) recalculateCdiAsset(previousAsset);
  clampInvestmentBalances();

  recordInvestmentSnapshot();
  resetMovementForm();
  renderAll();
  toast("Movimentação salva e saldo atualizado.");
}

function renderMovementHistory() {
  const month = $("movementMonthFilter").value;
  const assetId = $("movementAssetFilter").value;
  const movements = [...investmentState.movements]
    .filter(item => (!month || item.date.slice(0, 7) === month) && (!assetId || item.assetId === assetId))
    .sort((a, b) => b.date.localeCompare(a.date));

  $("movementTable").innerHTML = movements.map(item => {
    const asset = investmentAssetById(item.assetId);
    return `<tr>
      <td>${new Date(`${item.date}T00:00:00`).toLocaleDateString("pt-BR")}</td>
      <td>${escapeHTML(asset?.name || "Investimento removido")}</td>
      <td><span class="status movement-${item.type}">${movementTypes[item.type]}</span></td>
      <td><strong>${money(item.value)}</strong></td>
      <td>${escapeHTML(item.note || "—")}</td>
      <td><div class="actions">
        <button class="btn secondary small" onclick="editInvestmentMovement('${item.id}')">Editar</button>
        <button class="btn danger small" onclick="deleteInvestmentMovement('${item.id}')">Excluir</button>
      </div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">Nenhuma movimentação encontrada para os filtros selecionados.</td></tr>`;
}

function editInvestmentMovement(id) {
  const movement = investmentState.movements.find(item => item.id === id);
  if (!movement) return;
  $("movementId").value = movement.id;
  $("movementInvestment").value = movement.assetId;
  $("movementDate").value = movement.date;
  $("movementType").value = movement.type;
  $("movementValue").value = movement.value;
  $("movementNote").value = movement.note;
  $("movementFormTitle").textContent = "Editar movimentação";
  openSection("investments");
}

function deleteInvestmentMovement(id) {
  const movement = investmentState.movements.find(item => item.id === id);
  if (!movement) return;
  confirmAction("Excluir movimentação", "O registro será removido e o saldo do investimento será recalculado.", () => {
    const asset = investmentAssetById(movement.assetId);
    if (asset?.yieldMode !== "cdi") applyMovementToBalance(movement, -1);
    investmentState.movements = investmentState.movements.filter(item => item.id !== id);
    if (asset?.yieldMode === "cdi") recalculateCdiAsset(asset);
    clampInvestmentBalances();
    recordInvestmentSnapshot();
    renderAll();
    toast("Movimentação excluída.");
  });
}

function resetMovementForm() {
  $("movementForm").reset();
  $("movementId").value = "";
  $("movementDate").value = todayInput();
  $("movementType").value = "contribution";
  $("movementFormTitle").textContent = "Nova movimentação";
  renderInvestmentSelects();
}

function clearMovementFilters() {
  $("movementMonthFilter").value = "";
  $("movementAssetFilter").value = "";
  renderMovementHistory();
}

function recordInvestmentSnapshot() {
  const snapshot = { date: todayInput(), total: investmentSummary().current };
  const index = investmentState.snapshots.findIndex(item => item.date === snapshot.date);
  if (index >= 0) investmentState.snapshots[index] = snapshot;
  else investmentState.snapshots.push(snapshot);
  investmentState.snapshots.sort((a, b) => a.date.localeCompare(b.date));
}

function renderInvestmentCharts() {
  if (!window.Chart) return;
  const grouped = Object.keys(investmentTypes).map(type => ({
    type,
    value: investmentState.assets
      .filter(asset => asset.type === type)
      .reduce((sum, asset) => sum + Number(asset.currentValue || 0), 0)
  })).filter(item => item.value > 0);
  const snapshots = [...investmentState.snapshots].sort((a, b) => a.date.localeCompare(b.date));

  if (investmentAllocationChart) investmentAllocationChart.destroy();
  investmentAllocationChart = new Chart($("investmentAllocationChart"), {
    type: "doughnut",
    data: {
      labels: grouped.length ? grouped.map(item => investmentTypes[item.type].label) : ["Sem investimentos"],
      datasets: [{
        data: grouped.length ? grouped.map(item => item.value) : [1],
        backgroundColor: grouped.length ? grouped.map(item => investmentTypes[item.type].color) : ["#dbe7ec"],
        borderWidth: 0
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });

  if (investmentEvolutionChart) investmentEvolutionChart.destroy();
  investmentEvolutionChart = new Chart($("investmentEvolutionChart"), {
    type: "line",
    data: {
      labels: snapshots.length ? snapshots.map(item => new Date(`${item.date}T00:00:00`).toLocaleDateString("pt-BR")) : ["Sem histórico"],
      datasets: [{
        label: "Patrimônio",
        data: snapshots.length ? snapshots.map(item => item.total) : [0],
        borderColor: "#1466d8",
        backgroundColor: "rgba(20, 102, 216, .15)",
        fill: true,
        tension: .25
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
}

function exportInvestmentBackup() {
  const backup = { version: 1, exportedAt: new Date().toISOString(), investments: investmentState };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `backup-investimentos-${todayInput()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Backup de investimentos exportado.");
}

function importInvestmentBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const data = parsed?.investments || parsed;
      if (!Array.isArray(data?.assets) || !Array.isArray(data?.movements)) throw new Error("Formato inválido");
      confirmAction("Importar backup", "Os investimentos atuais serão substituídos pelos dados deste arquivo.", () => {
        investmentState = normalizeInvestmentState(data);
        resetInvestmentForm();
        resetMovementForm();
        renderAll();
        toast("Backup importado com sucesso.");
      });
    } catch {
      toast("O arquivo selecionado não é um backup válido.", "error");
    }
  };
  reader.readAsText(file);
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
  renderInvestmentCharts();
  saveAll();
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
    const appointments = state.appointments;
    state = emptyState();
    state.appointments = appointments;
    activeMonthKey = currentMonthKey();
    renderAll();
    await saveRemoteNow();
    toast("PDF exportado e dados mensais apagados.");
  } catch (error) {
    console.error(error);
    toast("Não foi possível gerar o PDF.", "error");
  }
}

function buildPDFReport() {
  const t = totals();
  const investmentTotals = investmentSummary();
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

    <h2>Investimentos</h2>
    <table>
      <tr><th>Patrimônio atual</th><th>Aportado líquido</th><th>Aportes no mês</th><th>Resultado acumulado</th><th>Proventos</th></tr>
      <tr><td>${money(investmentTotals.current)}</td><td>${money(investmentTotals.netContributed)}</td><td>${money(investmentMovementsForMonth(currentMonthKey(), "contribution"))}</td><td>${money(investmentTotals.result)}</td><td>${money(investmentTotals.income)}</td></tr>
    </table>

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
window.editInvestment = editInvestment;
window.deleteInvestment = deleteInvestment;
window.editInvestmentMovement = editInvestmentMovement;
window.deleteInvestmentMovement = deleteInvestmentMovement;

init().catch(error => {
  console.error(error);
  setAuthMessage("Não foi possível iniciar o aplicativo.", "error");
});
