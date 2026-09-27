
const STORAGE_KEY = "max-bouquet-prototype-v1";
const WELCOME_KEY = "max-bouquet-welcome-seen";
const clone = (value) => JSON.parse(JSON.stringify(value));

let state = loadState();
let ui = {
  route: "home",
  detailId: null,
  filter: "Все",
  inventoryFilter: "Все",
  search: "",
  historySearch: "",
  historyPreset: "30",
  historyFrom: "",
  historyTo: "",
  compareHistoryIds: [],
  detailsOpen: false,
  modal: null,
  production: null,
  showWelcome: localStorage.getItem(WELCOME_KEY) !== "yes",
  toast: "",
};

const app = document.querySelector("#app");
const modalRoot = document.querySelector("#modal-root");
const restoreInput = document.querySelector("#restore-file");
let timerHandle = null;
let toastHandle = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(initialState);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.recipes)) throw new Error("Invalid state");
    return sanitizeState(parsed);
  } catch {
    return clone(initialState);
  }
}

function sanitizeState(value) {
  value.version = 3;
  value.shopping ??= [];
  value.history = Array.isArray(value.history) ? value.history : [];
  return value;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    showToast("Не удалось сохранить данные. Попробуйте фотографию меньшего размера.");
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function calc(recipe) {
  return calculateRecipe(recipe, state.products, state.settings);
}

function getRecipe(id) {
  return state.recipes.find((recipe) => recipe.id === id);
}

function getProduct(id) {
  return state.products.find((product) => product.id === id);
}

function showToast(message) {
  ui.toast = message;
  renderToast();
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => {
    ui.toast = "";
    renderToast();
  }, 2800);
}

function navigate(route, options = {}) {
  ui.route = route;
  ui.detailId = options.detailId ?? ui.detailId;
  ui.detailsOpen = false;
  ui.modal = null;
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

const navItems = [
  ["home", "⌂", "Главная"],
  ["recipes", "◫", "Композиции"],
  ["inventory", "◇", "Запасы"],
  ["shopping", "✓", "Покупки"],
  ["history", "◷", "История"],
];

function renderNav() {
  const rootRoute = ui.route === "detail" || ui.route === "production" ? "recipes" : ui.route;
  return `<nav class="bottom-nav" aria-label="Основная навигация">
    ${navItems.map(([route, icon, label]) => `
      <button class="nav-button ${rootRoute === route ? "active" : ""}" data-action="navigate" data-route="${route}">
        <span aria-hidden="true">${icon}</span>${label}
      </button>`).join("")}
  </nav>`;
}

function render() {
  clearInterval(timerHandle);
  let content = "";
  if (ui.route === "home") content = renderHome();
  if (ui.route === "recipes") content = renderRecipes();
  if (ui.route === "inventory") content = renderInventory();
  if (ui.route === "shopping") content = renderShopping();
  if (ui.route === "history") content = renderHistory();
  if (ui.route === "more") content = renderMore();
  if (ui.route === "detail") content = renderDetail();
  if (ui.route === "production") content = renderProduction();

  app.innerHTML = `<div class="shell"><main class="app-main">${content}</main>${ui.route !== "production" ? renderNav() : ""}</div>${renderWelcome()}`;
  renderModal();
  renderToast();

  if (ui.route === "production" && ui.production?.startedAt) {
    timerHandle = setInterval(updateTimer, 1000);
    updateTimer();
  }
}

function renderHeader(eyebrow, title, subtitle = "") {
  return `<div class="topline">
    <div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div>
    <button class="avatar settings-button" data-action="navigate" data-route="more" aria-label="Открыть настройки">⚙</button>
  </div>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}`;
}

function renderHome() {
  const recipes = state.recipes.slice(0, 4);
  const lowStock = state.products.filter((product) => product.stock <= product.minStock);
  const shoppingCount = state.shopping.length;
  const recentHistory = state.history.filter((entry) => Date.now() - new Date(entry.completedAt).getTime() <= 30 * 86400000);
  const recentRevenue = recentHistory.reduce((sum, entry) => sum + entry.salePrice, 0);
  const recentProfit = recentHistory.reduce((sum, entry) => sum + entry.profit, 0);
  return `${renderHeader("Добрый день", "Ваши композиции", "Актуальные цены и запасы — без таблиц и пересчётов вручную.")}
    <section class="hero-card">
      <span class="badge">Быстрый расчёт</span>
      <h2>Узнайте цену букета по вашим закупкам</h2>
      <p>Выберите готовый пример или создайте свою композицию.</p>
      <button class="button compact" data-action="navigate" data-route="recipes">Посчитать композицию →</button>
    </section>

    ${lowStock.length ? `<div class="alert-card warning">
      <span class="alert-icon">⚠️</span><div><strong>Заканчиваются ${lowStock.length} позиций</strong><p>${lowStock.slice(0, 3).map((p) => p.name).join(", ")}${lowStock.length > 3 ? "…" : ""}</p></div>
    </div>` : `<div class="alert-card ok"><span class="alert-icon">✓</span><div><strong>Запасов достаточно</strong><p>Сейчас нет позиций ниже минимального остатка.</p></div></div>`}
    ${shoppingCount ? `<div class="alert-card"><span class="alert-icon">🛒</span><div><strong>В покупках ${shoppingCount} поз.</strong><p>Откройте список перед походом в магазин.</p></div></div>` : ""}

    <section class="history-teaser">
      <div class="section-head"><div><p class="eyebrow">Последние 30 дней</p><h2>История работ</h2></div><button class="text-button" data-action="navigate" data-route="history">Открыть →</button></div>
      <div class="mini-stats"><div><span>Сделано</span><strong>${recentHistory.length}</strong></div><div><span>Выручка</span><strong>${formatMoney(recentRevenue)}</strong></div><div><span>Прибыль</span><strong>${formatMoney(recentProfit)}</strong></div></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Демонстрационные примеры</h2><button class="text-button" data-action="navigate" data-route="recipes">Все</button></div>
      <div class="horizontal-cards">${recipes.map(renderRecipeCard).join("")}</div>
    </section>`;
}

function renderRecipeCard(recipe) {
  const result = calc(recipe);
  return `<article class="recipe-card">
    <button data-action="open-recipe" data-id="${recipe.id}" aria-label="Открыть ${escapeHtml(recipe.title)}">
      <img class="recipe-image" src="${recipe.image || "assets/image4.jpg"}" alt="${escapeHtml(recipe.title)}" />
      <div class="recipe-body">
        <div class="recipe-meta">${recipe.authorExample ? `<span class="badge">Демонстрационный пример</span>` : `<span class="badge soft">Моя композиция</span>`}</div>
        <h3>${escapeHtml(recipe.title)}</h3>
        <div class="recipe-price">${formatMoney(result.salePrice)}</div>
        <div class="availability ${result.canMake ? "" : "missing"}">${result.canMake ? "✓ Всё есть" : `🛒 Докупить ${result.missingLines.length} поз.`}</div>
      </div>
    </button>
  </article>`;
}

function renderRecipes() {
  const filters = ["Все", "Букеты", "Композиции", "Мои"];
  const q = ui.search.trim().toLowerCase();
  const recipes = state.recipes.filter((recipe) => {
    const byFilter = ui.filter === "Все" || (ui.filter === "Мои" ? !recipe.authorExample : recipe.type === ui.filter);
    return byFilter && (!q || recipe.title.toLowerCase().includes(q));
  });
  return `${renderHeader("Каталог", "Композиции", "Готовые примеры и ваши собственные рецепты.")}
    <button class="button" data-action="new-recipe">＋ Новая композиция</button>
    <div class="section"><input class="search" id="recipe-search" value="${escapeHtml(ui.search)}" placeholder="Найти композицию" aria-label="Найти композицию" /></div>
    <div class="chips">${filters.map((filter) => `<button class="chip ${ui.filter === filter ? "active" : ""}" data-action="recipe-filter" data-filter="${filter}">${filter}</button>`).join("")}</div>
    <div class="grid">${recipes.map(renderRecipeCard).join("")}</div>
    ${recipes.length ? "" : `<div class="empty"><span class="empty-emoji">🔎</span>Ничего не найдено. Попробуйте другой запрос.</div>`}`;
}

function renderDetail() {
  const recipe = getRecipe(ui.detailId);
  if (!recipe) return `<div class="empty">Композиция не найдена.</div>`;
  const result = calc(recipe);
  return `<div class="detail-hero">
      <img src="${recipe.image || "assets/image4.jpg"}" alt="${escapeHtml(recipe.title)}" />
      <button class="icon-button floating-back" data-action="navigate" data-route="recipes" aria-label="Назад">←</button>
    </div>
    <div class="detail-content">
      <div class="recipe-meta">${recipe.authorExample ? `<span class="badge">Демонстрационный пример</span>` : `<span class="badge soft">Моя композиция</span>`}<button class="badge badge-button soft" data-action="edit-time" data-id="${recipe.id}">⏱ ${recipe.minutes} мин · изменить</button></div>
      <div class="detail-title-row"><h1>${escapeHtml(recipe.title)}</h1></div>
      ${!recipe.authorExample ? `<button class="photo-action" data-action="edit-photo" data-id="${recipe.id}">📷 ${recipe.customImage ? "Изменить фотографию" : "Добавить свою фотографию"}</button>` : ""}
      <div class="status-box ${result.canMake ? "" : "warning"}">${result.canMake ? "✓ Всё необходимое есть — можно изготовить сейчас" : `⚠️ Нужно докупить ${result.missingLines.length} ${plural(result.missingLines.length, "позицию", "позиции", "позиций")}`}</div>

      <section class="price-panel">
        <div class="muted small">Себестоимость сегодня</div>
        <div class="big-price">${formatMoney(result.total)}</div>
        <div class="price-divider"></div>
        <div class="price-row"><span>Цена продажи</span><strong>${formatMoney(result.salePrice)}</strong></div>
        <div class="price-row muted"><span>Прибыль</span><strong>${formatMoney(result.profit)}</strong></div>
      </section>

      ${recipe.authorExample ? `<button class="button" data-action="copy-recipe" data-id="${recipe.id}">Добавить себе и посчитать по моим ценам</button>` : `<button class="button" data-action="start-production" data-id="${recipe.id}" ${result.canMake ? "" : "disabled"}>Собрать композицию</button>`}
      ${!result.canMake ? `<button class="button secondary" style="margin-top:9px" data-action="add-missing" data-id="${recipe.id}">Добавить недостающее в покупки</button>` : ""}

      <button class="accordion-button" data-action="toggle-details">${ui.detailsOpen ? "Скрыть расчёт ↑" : "Как рассчитана эта сумма? ↓"}</button>
      ${ui.detailsOpen ? `<div class="calc-details summary-card">
        <div class="price-row"><span>Продукты и материалы</span><strong>${formatMoney(result.materials)}</strong></div>
        <div class="price-row"><span>Работа · ${recipe.minutes} мин</span><strong>${formatMoney(result.labor)}</strong></div>
        ${result.overhead ? `<div class="price-row"><span>Дополнительные расходы</span><strong>${formatMoney(result.overhead)}</strong></div>` : ""}
      </div>` : ""}

      <section class="section">
        <div class="section-head"><h2>Состав</h2>${!recipe.authorExample ? `<button class="text-button" data-action="add-item" data-id="${recipe.id}">＋ Добавить</button>` : ""}</div>
        <div class="summary-card composition-list">${result.lines.length ? result.lines.map((line) => renderIngredient(line, recipe)).join("") : `<div class="empty">Добавьте первый продукт или материал.</div>`}</div>
      </section>
      ${!recipe.authorExample ? `<button class="button danger" style="margin-top:22px" data-action="delete-recipe" data-id="${recipe.id}">🗑 Удалить композицию</button>` : ""}
    </div>`;
}

function renderIngredient(line, recipe) {
  const { product } = line;
  const priceForPack = product.unitPrice * product.packSize;
  return `<div class="item-line">
    <div class="item-name"><span class="item-emoji">${product.emoji}</span><div><strong>${escapeHtml(product.name)}</strong><p>${formatQuantity(line.quantity, product.unit)} · ${line.missing > 0 ? `<span class="low">не хватает ${formatQuantity(line.missing, product.unit)}</span>` : "есть в запасах"}</p></div></div>
    <div class="item-cost">${formatMoney(line.cost)}<button class="text-button small" data-action="edit-price" data-product-id="${product.id}" data-recipe-id="${recipe.id}">${formatMoney(priceForPack)} / ${formatQuantity(product.packSize, product.unit)}</button></div>
  </div>`;
}

function renderInventory() {
  const filters = ["Все", "Продукты", "Материалы", "Заканчиваются"];
  const products = state.products.filter((product) => {
    if (ui.inventoryFilter === "Все") return true;
    if (ui.inventoryFilter === "Заканчиваются") return product.stock <= product.minStock;
    if (ui.inventoryFilter === "Продукты") return product.category === "Продукты" || product.category === "Цветы";
    return product.category === ui.inventoryFilter;
  });
  return `${renderHeader("Ваши данные", "Запасы", "Остатки и последняя закупочная цена каждого продукта.")}
    <div class="page-actions"><button class="button" data-action="new-inventory-product">＋ Добавить продукт или материал</button><button class="button danger" data-action="zero-all-stock">Обнулить все запасы</button></div>
    <div class="chips">${filters.map((filter) => `<button class="chip ${ui.inventoryFilter === filter ? "active" : ""}" data-action="inventory-filter" data-filter="${filter}">${filter}</button>`).join("")}</div>
    <div class="stock-list">${products.map((product) => {
      const isLow = product.stock <= product.minStock;
      return `<article class="stock-card">
        <div class="row-between"><div class="item-name"><span class="item-emoji">${product.emoji}</span><div><h3>${escapeHtml(product.name)}</h3><span class="badge ${product.source === "Моя цена" ? "" : "soft"}">${product.source}</span></div></div>${isLow ? `<span class="badge warning">Заканчивается</span>` : ""}</div>
        <div class="stock-number ${isLow ? "low" : ""}">${formatQuantity(product.stock, product.unit)}</div>
        <div class="stock-meta"><span>${formatMoney(product.unitPrice * product.packSize)} / ${formatQuantity(product.packSize, product.unit)}</span><div class="inline-actions"><button class="text-button" data-action="buy-product" data-product-id="${product.id}">Купила ещё</button><button class="trash-button" data-action="zero-stock" data-product-id="${product.id}" aria-label="Обнулить остаток ${escapeHtml(product.name)}">🗑</button></div></div>
      </article>`;
    }).join("")}</div>`;
}

function renderShopping() {
  const lines = state.shopping.map((item) => ({ ...item, product: getProduct(item.productId) })).filter((item) => item.product);
  const total = lines.reduce((sum, item) => sum + unitsToBuy(item.quantity, item.product.packSize) * item.product.packSize * item.product.unitPrice, 0);
  return `${renderHeader("Перед магазином", "Покупки", "Недостающее для композиций и то, что вы добавили вручную.")}
    ${lines.length ? `<button class="button danger" style="margin-bottom:16px" data-action="clear-shopping">Очистить весь список</button><div class="shopping-list">${lines.map((item) => {
      const packs = unitsToBuy(item.quantity, item.product.packSize);
      const estimate = packs * item.product.packSize * item.product.unitPrice;
      return `<article class="shopping-card">
        <div class="row-between"><div class="item-name"><span class="item-emoji">${item.product.emoji}</span><div><h3>${escapeHtml(item.product.name)}</h3><p class="muted small">Нужно докупить ${formatQuantity(item.quantity, item.product.unit)}</p></div></div><strong>${formatMoney(estimate)}</strong></div>
        <div class="stock-meta"><span>Купить: ${packs} ${plural(packs, "упаковку", "упаковки", "упаковок")}</span><div class="inline-actions"><button class="text-button" data-action="buy-shopping" data-product-id="${item.product.id}">Купила ✓</button><button class="trash-button" data-action="remove-shopping" data-product-id="${item.product.id}" aria-label="Удалить ${escapeHtml(item.product.name)} из покупок">🗑</button></div></div>
      </article>`;
    }).join("")}</div><div class="shopping-total"><div class="small">Примерно понадобится</div><strong>${formatMoney(total)}</strong></div>` : `<div class="empty"><span class="empty-emoji">🛍️</span><strong>Список пока пуст</strong><p>Добавьте недостающие продукты из карточки композиции.</p></div>`}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function historyRange() {
  const now = new Date();
  let from = null;
  let to = null;
  if (ui.historyPreset !== "all" && ui.historyPreset !== "custom") {
    from = new Date(now.getTime() - Number(ui.historyPreset) * 86400000);
  }
  if (ui.historyPreset === "custom") {
    if (ui.historyFrom) from = new Date(`${ui.historyFrom}T00:00:00`);
    if (ui.historyTo) to = new Date(`${ui.historyTo}T23:59:59.999`);
  }
  return { from, to };
}

function filteredHistory() {
  const { from, to } = historyRange();
  const query = ui.historySearch.trim().toLowerCase();
  return [...state.history].filter((entry) => {
    const completed = new Date(entry.completedAt);
    return (!from || completed >= from) && (!to || completed <= to) && (!query || entry.title.toLowerCase().includes(query));
  }).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
}

function renderHistory() {
  const entries = filteredHistory();
  const totals = entries.reduce((sum, entry) => ({
    cost: sum.cost + entry.total,
    revenue: sum.revenue + entry.salePrice,
    profit: sum.profit + entry.profit,
  }), { cost: 0, revenue: 0, profit: 0 });
  const compareCount = ui.compareHistoryIds.length;
  return `${renderHeader("Журнал работ", "История", "Снимок цены сохраняется в момент изготовления и больше не меняется.")}
    <div class="history-filters">
      <input class="search" id="history-search" value="${escapeHtml(ui.historySearch)}" placeholder="Найти композицию" aria-label="Найти в истории" />
      <div class="chips">${[["7", "7 дней"], ["30", "30 дней"], ["365", "Год"], ["all", "Всё"], ["custom", "Период"]].map(([value, label]) => `<button class="chip ${ui.historyPreset === value ? "active" : ""}" data-action="history-preset" data-value="${value}">${label}</button>`).join("")}</div>
      ${ui.historyPreset === "custom" ? `<div class="date-range"><label>С <input id="history-from" type="date" value="${ui.historyFrom}" /></label><label>По <input id="history-to" type="date" value="${ui.historyTo}" /></label></div>` : ""}
    </div>
    <div class="history-summary"><div><span>Композиции</span><strong>${entries.length}</strong></div><div><span>Потрачено</span><strong>${formatMoney(totals.cost)}</strong></div><div><span>Выручка</span><strong>${formatMoney(totals.revenue)}</strong></div><div><span>Прибыль</span><strong>${formatMoney(totals.profit)}</strong></div></div>
    <button class="button compare-button" data-action="open-history-comparison" ${compareCount < 2 ? "disabled" : ""}>Сравнить выбранные${compareCount ? ` · ${compareCount}` : ""}</button>
    ${entries.length ? `<div class="history-list">${entries.map(renderHistoryCard).join("")}</div>` : `<div class="empty"><span class="empty-emoji">🗓️</span><strong>За этот период записей нет</strong><p>Запись появится после завершения изготовления композиции.</p></div>`}`;
}

function renderHistoryCard(entry) {
  const selected = ui.compareHistoryIds.includes(entry.id);
  const margin = entry.salePrice > 0 ? Math.round(entry.profit / entry.salePrice * 100) : 0;
  return `<article class="history-card ${selected ? "selected" : ""}">
    <div class="history-card-head"><button class="compare-pick" data-action="toggle-history-compare" data-id="${entry.id}" aria-pressed="${selected}"><span>${selected ? "✓" : ""}</span>Сравнить</button><button class="trash-button" data-action="delete-history" data-id="${entry.id}" aria-label="Удалить запись">🗑</button></div>
    <p class="history-date">${formatDateTime(entry.completedAt)}</p><h3>${escapeHtml(entry.title)}</h3>
    <div class="history-money"><div><span>Себестоимость</span><strong>${formatMoney(entry.total)}</strong></div><div><span>Продано за</span><strong>${formatMoney(entry.salePrice)}</strong></div><div><span>Прибыль</span><strong class="profit">${formatMoney(entry.profit)}</strong></div></div>
    <div class="history-meta"><span>Материалы ${formatMoney(entry.materials)}</span><span>Работа ${formatMoney(entry.labor)}</span><span>${entry.actualMinutes} мин</span><span>Маржа ${margin}%</span></div>
  </article>`;
}

function renderHistoryComparison() {
  const entries = ui.compareHistoryIds.map((id) => state.history.find((entry) => entry.id === id)).filter(Boolean).sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
  if (entries.length < 2) return `<p class="muted">Выберите минимум две записи.</p>`;
  const best = [...entries].sort((a, b) => b.profit - a.profit)[0];
  const sameRecipe = entries.every((entry) => entry.recipeId === entries[0].recipeId || entry.title === entries[0].title);
  const costChange = entries[entries.length - 1].total - entries[0].total;
  const rows = [
    ["Дата", (entry) => formatDateTime(entry.completedAt)],
    ["Себестоимость", (entry) => formatMoney(entry.total)],
    ["Цена продажи", (entry) => formatMoney(entry.salePrice)],
    ["Прибыль", (entry) => formatMoney(entry.profit)],
    ["Материалы", (entry) => formatMoney(entry.materials)],
    ["Работа", (entry) => formatMoney(entry.labor)],
    ["Время", (entry) => `${entry.actualMinutes} мин`],
    ["Маржа", (entry) => `${entry.salePrice > 0 ? Math.round(entry.profit / entry.salePrice * 100) : 0}%`],
  ];
  return `<div class="comparison-insight"><strong>${sameRecipe ? `Изменение себестоимости: ${costChange >= 0 ? "+" : "−"}${formatMoney(Math.abs(costChange))}` : `Наибольшая прибыль: «${escapeHtml(best.title)}» — ${formatMoney(best.profit)}`}</strong><p>${sameRecipe ? "Сравнение первого и последнего изготовления из выбранных." : "Показатель рассчитан по выбранным работам."}</p></div><div class="comparison-scroll"><table class="comparison-table"><thead><tr><th>Показатель</th>${entries.map((entry) => `<th>${escapeHtml(entry.title)}</th>`).join("")}</tr></thead><tbody>${rows.map(([label, renderValue]) => `<tr><th>${label}</th>${entries.map((entry) => `<td>${renderValue(entry)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderMore() {
  return `${renderHeader("Приложение", "Ещё", "Настройки расчёта и резервная копия.")}
    <section class="settings-card">
      <h2>Моя работа</h2>
      <div class="settings-row"><div><strong>Стоимость часа</strong><div class="muted small">Для всех композиций</div></div><input type="number" min="0" step="50" value="${state.settings.hourlyRate}" data-setting="hourlyRate" aria-label="Стоимость часа" /></div>
      <div class="settings-row"><div><strong>Наценка</strong><div class="muted small">К полной себестоимости</div></div><input type="number" min="0" step="5" value="${state.settings.markup}" data-setting="markup" aria-label="Наценка" /></div>
      <div class="settings-row"><div><strong>Округлять цену до</strong></div><select data-setting="roundingStep" aria-label="Округление"><option value="10" ${state.settings.roundingStep === 10 ? "selected" : ""}>10 ₽</option><option value="50" ${state.settings.roundingStep === 50 ? "selected" : ""}>50 ₽</option><option value="100" ${state.settings.roundingStep === 100 ? "selected" : ""}>100 ₽</option></select></div>
    </section>
    <section class="settings-card">
      <h2>Мои данные</h2><p class="muted">Создайте копию, чтобы перенести данные или восстановить их после очистки приложения.</p>
      <div class="settings-actions"><button class="button secondary" data-action="export">Создать резервную копию</button><button class="button ghost" data-action="restore">Восстановить данные</button><button class="button danger" data-action="reset-demo">Сбросить прототип</button></div>
    </section>
    <p class="muted small" style="margin-top:20px">Версия 0.4 · данные, история и фотографии хранятся только в этом браузере.</p>`;
}

function renderProduction() {
  const recipe = getRecipe(ui.production?.recipeId);
  if (!recipe) return `<div class="empty">Композиция не найдена.</div>`;
  const started = Boolean(ui.production.startedAt);
  return `<div class="topline"><button class="icon-button" data-action="cancel-production" aria-label="Назад">←</button><span class="badge">Режим изготовления</span></div>
    <div class="timer-wrap">
      <p class="eyebrow">${escapeHtml(recipe.title)}</p><h1>${started ? "Время пошло" : "Всё готово к сборке"}</h1>
      <p class="subtitle">Плановое время: ${recipe.minutes} минут</p>
      <div class="timer-ring"><div><div id="timer-value" class="timer-value">${started ? "00:00:00" : `${recipe.minutes}:00`}</div><div class="muted small">${started ? "фактическое время" : "план"}</div></div></div>
      <div class="timer-actions">${started ? `<button class="button" data-action="finish-production">Готово</button>` : `<button class="button" data-action="run-timer">▶ Засечь время</button><button class="button secondary" data-action="finish-production">Начать без таймера</button>`}<button class="text-button" data-action="cancel-production">Отмена</button></div>
    </div>`;
}

function renderWelcome() {
  if (!ui.showWelcome) return "";
  return `<div class="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <div class="welcome-panel"><img class="welcome-photo" src="assets/image2.jpg" alt="Фруктовый букет" /><p class="eyebrow">Добро пожаловать</p><h1 id="welcome-title">Считайте цену букета спокойно</h1><p class="subtitle">Приложение учтёт продукты, упаковку и вашу работу. Начните с готового примера — ничего заполнять заранее не нужно.</p><div class="welcome-actions"><button class="button" data-action="welcome-example">Показать на примере</button><button class="button secondary" data-action="close-welcome">Начать самой</button></div></div>
  </div>`;
}

function renderModal() {
  if (!ui.modal) { modalRoot.innerHTML = ""; return; }
  const m = ui.modal;
  if (m.type === "price" || m.type === "purchase") {
    const product = getProduct(m.productId);
    const isPurchase = m.type === "purchase";
    modalRoot.innerHTML = modalShell(`${isPurchase ? "Купила ещё" : "Изменить цену"}`, `<form data-form="product-price" data-mode="${m.type}" data-product-id="${product.id}">
      <p class="muted">${product.emoji} ${escapeHtml(product.name)}</p>
      <div class="field-grid"><div><label for="qty">${isPurchase ? "Сколько купили" : "Количество"}</label><input id="qty" name="quantity" type="number" min="0.01" step="any" value="${m.quantity ?? product.packSize}" required /></div><div><label for="paid">${isPurchase ? "Сколько заплатили" : "Цена"}</label><input id="paid" name="paid" type="number" min="0" step="any" value="${Math.round((m.quantity ?? product.packSize) * product.unitPrice)}" required /></div></div>
      <p class="muted small">Новая цена за единицу будет рассчитана автоматически. Все текущие композиции пересчитаются.</p>
      <div class="modal-actions"><button class="button" type="submit">Сохранить</button><button class="button ghost" type="button" data-action="close-modal">Отмена</button></div>
    </form>`);
  }
  if (m.type === "newRecipe") {
    modalRoot.innerHTML = modalShell("Новая композиция", `<form data-form="new-recipe"><label for="title">Название</label><input id="title" name="title" placeholder="Например, Сырный букет" required /><label for="recipeImage">Своя фотография <span class="muted small">(необязательно)</span></label><input id="recipeImage" name="image" type="file" accept="image/*" /><div class="field-grid"><div><label for="type">Тип</label><select id="type" name="type"><option>Букеты</option><option>Композиции</option><option>Корзины</option><option>Коробки</option></select></div><div><label for="minutes">Время, мин</label><input id="minutes" name="minutes" type="number" min="1" value="60" required /></div></div><div class="modal-actions"><button class="button" type="submit">Создать и добавить состав</button><button class="button ghost" type="button" data-action="close-modal">Отмена</button></div></form>`);
  }
  if (m.type === "addItem") {
    modalRoot.innerHTML = modalShell("Добавить в состав", `<form data-form="add-item" data-recipe-id="${m.recipeId}"><label for="product">Продукт или материал</label><select id="product" name="productId">${state.products.map((p) => `<option value="${p.id}">${p.emoji} ${escapeHtml(p.name)} · ${p.unit}</option>`).join("")}</select><label for="useQty">Сколько нужно на композицию</label><input id="useQty" name="quantity" type="number" min="0.01" step="any" required /><div class="modal-actions"><button class="button" type="submit">Добавить</button><button class="button secondary" type="button" data-action="show-new-product" data-recipe-id="${m.recipeId}">＋ Создать новый продукт</button><button class="button ghost" type="button" data-action="close-modal">Отмена</button></div></form>`);
  }
  if (m.type === "newProduct") {
    const addToRecipe = Boolean(m.recipeId);
    modalRoot.innerHTML = modalShell("Новый продукт или материал", `<form data-form="new-product" data-recipe-id="${m.recipeId ?? ""}"><label for="name">Название</label><input id="name" name="name" required placeholder="Например, Сыр Маасдам" /><div class="field-grid"><div><label for="category">Категория</label><select id="category" name="category"><option>Продукты</option><option>Материалы</option><option>Цветы</option></select></div><div><label for="unit">Единица</label><select id="unit" name="unit"><option>г</option><option>мл</option><option>шт.</option><option>см</option><option>лист</option><option>ветка</option><option>уп.</option></select></div></div>${addToRecipe ? `<label for="useQtyNew">Расход на эту композицию</label><input id="useQtyNew" name="useQty" type="number" min="0.01" step="any" required />` : ""}<div class="field-grid"><div><label for="purchaseQty">Размер покупки</label><input id="purchaseQty" name="purchaseQty" type="number" min="0.01" step="any" required /></div><div><label for="paidNew">Заплатили</label><input id="paidNew" name="paid" type="number" min="0" step="any" required /></div></div><div class="field-grid"><div><label for="stock">Сейчас в запасе</label><input id="stock" name="stock" type="number" min="0" step="any" value="0" required /></div><div><label for="minStock">Напомнить при остатке</label><input id="minStock" name="minStock" type="number" min="0" step="any" value="0" required /></div></div><div class="modal-actions"><button class="button" type="submit">${addToRecipe ? "Сохранить и добавить" : "Сохранить в запасах"}</button><button class="button ghost" type="button" data-action="close-modal">Отмена</button></div></form>`);
  }
  if (m.type === "editTime") {
    const recipe = getRecipe(m.recipeId);
    modalRoot.innerHTML = modalShell("Время изготовления", `<form data-form="edit-time" data-recipe-id="${recipe.id}"><p class="muted">${escapeHtml(recipe.title)}</p><label for="recipeMinutes">Сколько минут вам обычно нужно</label><input id="recipeMinutes" name="minutes" type="number" min="1" step="1" value="${recipe.minutes}" required /><p class="muted small">Стоимость вашей работы и цена продажи пересчитаются автоматически.</p><div class="modal-actions"><button class="button" type="submit">Сохранить время</button><button class="button ghost" type="button" data-action="close-modal">Отмена</button></div></form>`);
  }
  if (m.type === "editPhoto") {
    const recipe = getRecipe(m.recipeId);
    modalRoot.innerHTML = modalShell("Фотография композиции", `<form data-form="edit-photo" data-recipe-id="${recipe.id}"><p class="muted">${escapeHtml(recipe.title)}</p><label for="photoFile">Выберите фотографию</label><input id="photoFile" name="image" type="file" accept="image/*" required /><p class="muted small">Изображение будет уменьшено и сохранено только на этом устройстве.</p><div class="modal-actions"><button class="button" type="submit">Сохранить фотографию</button>${recipe.customImage ? `<button class="button danger" type="button" data-action="remove-photo" data-id="${recipe.id}">Удалить фотографию</button>` : ""}<button class="button ghost" type="button" data-action="close-modal">Отмена</button></div></form>`);
  }
  if (m.type === "confirmProduction") {
    const recipe = getRecipe(m.recipeId);
    const actualMinutes = ui.production?.startedAt ? Math.max(1, Math.round((Date.now() - ui.production.startedAt) / 60000)) : recipe.minutes;
    const result = calculateRecipe({ ...recipe, minutes: actualMinutes }, state.products, state.settings);
    const completedLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    modalRoot.innerHTML = modalShell("Записать готовую композицию", `<form data-form="complete-production" data-recipe-id="${recipe.id}"><p class="muted">Расчёт сохранится в истории, а использованные запасы будут списаны.</p><div class="field-grid"><div><label for="completedAt">Дата и время</label><input id="completedAt" name="completedAt" type="datetime-local" value="${completedLocal}" required /></div><div><label for="actualMinutes">Фактическое время, мин</label><input id="actualMinutes" name="actualMinutes" type="number" min="1" step="1" value="${actualMinutes}" required /></div></div><label for="actualSalePrice">Фактическая цена продажи</label><input id="actualSalePrice" name="salePrice" type="number" min="0" step="1" value="${Math.round(result.salePrice)}" required /><div class="summary-card composition-list">${result.lines.map((line) => `<div class="item-line"><span>${line.product.emoji} ${escapeHtml(line.product.name)}</span><strong>−${formatQuantity(line.quantity, line.product.unit)}</strong></div>`).join("")}</div><div class="modal-actions"><button class="button" type="submit">Сохранить в историю и списать</button><button class="button ghost" type="button" data-action="close-modal">Не сейчас</button></div></form>`);
  }
  if (m.type === "confirmReset") {
    modalRoot.innerHTML = modalShell("Сбросить прототип?", `<p class="muted">Ваши изменения и покупки будут удалены. Демонстрационные данные восстановятся.</p><div class="modal-actions"><button class="button danger" data-action="confirm-reset">Да, сбросить</button><button class="button ghost" data-action="close-modal">Отмена</button></div>`);
  }
  if (m.type === "confirmZeroStock") {
    const product = getProduct(m.productId);
    modalRoot.innerHTML = modalShell("Обнулить остаток?", `<p class="muted">${product.emoji} ${escapeHtml(product.name)} останется в списке, но запас станет равен нулю.</p><div class="modal-actions"><button class="button danger" data-action="confirm-zero-stock" data-product-id="${product.id}">Да, обнулить</button><button class="button ghost" data-action="close-modal">Отмена</button></div>`);
  }
  if (m.type === "confirmZeroAllStock") {
    modalRoot.innerHTML = modalShell("Обнулить все запасы?", `<p class="muted">Остатки всех продуктов и материалов станут равны нулю. Названия и цены сохранятся.</p><div class="modal-actions"><button class="button danger" data-action="confirm-zero-all-stock">Да, обнулить всё</button><button class="button ghost" data-action="close-modal">Отмена</button></div>`);
  }
  if (m.type === "confirmClearShopping") {
    modalRoot.innerHTML = modalShell("Очистить покупки?", `<p class="muted">Все позиции будут удалены из списка покупок.</p><div class="modal-actions"><button class="button danger" data-action="confirm-clear-shopping">Да, очистить список</button><button class="button ghost" data-action="close-modal">Отмена</button></div>`);
  }
  if (m.type === "confirmDeleteRecipe") {
    const recipe = getRecipe(m.recipeId);
    modalRoot.innerHTML = modalShell("Удалить композицию?", `<p class="muted">«${escapeHtml(recipe.title)}» будет удалена без возможности восстановления. Продукты и материалы из запасов сохранятся.</p><div class="modal-actions"><button class="button danger" data-action="confirm-delete-recipe" data-id="${recipe.id}">Да, удалить композицию</button><button class="button ghost" data-action="close-modal">Отмена</button></div>`);
  }
  if (m.type === "compareHistory") {
    modalRoot.innerHTML = modalShell("Сравнение композиций", `${renderHistoryComparison()}<div class="modal-actions"><button class="button ghost" type="button" data-action="close-modal">Закрыть</button></div>`);
  }
  if (m.type === "confirmDeleteHistory") {
    const entry = state.history.find((item) => item.id === m.historyId);
    modalRoot.innerHTML = modalShell("Удалить запись из истории?", `<p class="muted">«${escapeHtml(entry?.title ?? "Композиция")}» и сохранённый расчёт будут удалены. Запасы автоматически не изменятся.</p><div class="modal-actions"><button class="button danger" data-action="confirm-delete-history" data-id="${m.historyId}">Да, удалить запись</button><button class="button ghost" type="button" data-action="close-modal">Отмена</button></div>`);
  }
}

function modalShell(title, body) {
  return `<div class="modal-backdrop" role="dialog" aria-modal="true"><div class="modal"><div class="modal-head"><h2>${title}</h2><button class="icon-button close" data-action="close-modal" aria-label="Закрыть">×</button></div>${body}</div></div>`;
}

function renderToast() {
  document.querySelectorAll(".toast").forEach((node) => node.remove());
  if (!ui.toast) return;
  document.body.insertAdjacentHTML("beforeend", `<div class="toast" role="status">${escapeHtml(ui.toast)}</div>`);
}

function plural(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function addMissingToShopping(recipe) {
  const result = calc(recipe);
  result.missingLines.forEach((line) => {
    const existing = state.shopping.find((item) => item.productId === line.product.id);
    if (existing) existing.quantity = Math.max(existing.quantity, line.missing);
    else state.shopping.push({ productId: line.product.id, quantity: line.missing, source: recipe.id });
  });
  saveState();
}

function startProduction(recipeId) {
  ui.production = { recipeId, startedAt: null };
  navigate("production");
}

function updateTimer() {
  const node = document.querySelector("#timer-value");
  if (!node || !ui.production?.startedAt) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - ui.production.startedAt) / 1000));
  const hours = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  node.textContent = `${hours}:${minutes}:${seconds}`;
}

async function compressPhoto(file) {
  if (!(file instanceof File) || !file.size) return null;
  if (!file.type.startsWith("image/")) throw new Error("Выберите файл изображения");
  if (file.size > 20 * 1024 * 1024) throw new Error("Фотография слишком большая. Выберите файл до 20 МБ");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("Не удалось прочитать фотографию"));
      node.src = url;
    });
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  } finally {
    URL.revokeObjectURL(url);
  }
}

app.addEventListener("click", handleClick);
modalRoot.addEventListener("click", handleClick);

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "navigate") navigate(button.dataset.route);
  if (action === "open-recipe") navigate("detail", { detailId: button.dataset.id });
  if (action === "recipe-filter") { ui.filter = button.dataset.filter; render(); }
  if (action === "inventory-filter") { ui.inventoryFilter = button.dataset.filter; render(); }
  if (action === "toggle-details") { ui.detailsOpen = !ui.detailsOpen; render(); }
  if (action === "close-modal") { ui.modal = null; renderModal(); }
  if (action === "close-welcome") { ui.showWelcome = false; localStorage.setItem(WELCOME_KEY, "yes"); render(); }
  if (action === "welcome-example") { ui.showWelcome = false; localStorage.setItem(WELCOME_KEY, "yes"); navigate("detail", { detailId: "demo-fruit-large" }); }
  if (action === "new-recipe") { ui.modal = { type: "newRecipe" }; renderModal(); }
  if (action === "new-inventory-product") { ui.modal = { type: "newProduct", recipeId: null }; renderModal(); }
  if (action === "add-item") { ui.modal = { type: "addItem", recipeId: button.dataset.id }; renderModal(); }
  if (action === "show-new-product") { ui.modal = { type: "newProduct", recipeId: button.dataset.recipeId }; renderModal(); }
  if (action === "edit-price") { ui.modal = { type: "price", productId: button.dataset.productId, recipeId: button.dataset.recipeId }; renderModal(); }
  if (action === "buy-product") { ui.modal = { type: "purchase", productId: button.dataset.productId }; renderModal(); }
  if (action === "edit-time") { ui.modal = { type: "editTime", recipeId: button.dataset.id }; renderModal(); }
  if (action === "edit-photo") { ui.modal = { type: "editPhoto", recipeId: button.dataset.id }; renderModal(); }
  if (action === "remove-photo") {
    const recipe = getRecipe(button.dataset.id);
    recipe.image = "assets/image4.jpg";
    recipe.customImage = false;
    saveState(); ui.modal = null; render(); showToast("Фотография удалена");
  }
  if (action === "history-preset") { ui.historyPreset = button.dataset.value; render(); }
  if (action === "toggle-history-compare") {
    const id = button.dataset.id;
    if (ui.compareHistoryIds.includes(id)) ui.compareHistoryIds = ui.compareHistoryIds.filter((item) => item !== id);
    else if (ui.compareHistoryIds.length < 3) ui.compareHistoryIds.push(id);
    else { showToast("Можно сравнить до трёх композиций одновременно"); return; }
    render();
  }
  if (action === "open-history-comparison" && ui.compareHistoryIds.length >= 2) { ui.modal = { type: "compareHistory" }; renderModal(); }
  if (action === "delete-history") { ui.modal = { type: "confirmDeleteHistory", historyId: button.dataset.id }; renderModal(); }
  if (action === "confirm-delete-history") {
    state.history = state.history.filter((entry) => entry.id !== button.dataset.id);
    ui.compareHistoryIds = ui.compareHistoryIds.filter((id) => id !== button.dataset.id);
    saveState(); ui.modal = null; render(); showToast("Запись удалена из истории");
  }
  if (action === "zero-stock") { ui.modal = { type: "confirmZeroStock", productId: button.dataset.productId }; renderModal(); }
  if (action === "zero-all-stock") { ui.modal = { type: "confirmZeroAllStock" }; renderModal(); }
  if (action === "clear-shopping") { ui.modal = { type: "confirmClearShopping" }; renderModal(); }
  if (action === "delete-recipe") { ui.modal = { type: "confirmDeleteRecipe", recipeId: button.dataset.id }; renderModal(); }
  if (action === "remove-shopping") { state.shopping = state.shopping.filter((item) => item.productId !== button.dataset.productId); saveState(); render(); showToast("Позиция удалена из покупок"); }
  if (action === "confirm-zero-stock") { const product = getProduct(button.dataset.productId); product.stock = 0; saveState(); ui.modal = null; render(); showToast("Остаток обнулён"); }
  if (action === "confirm-zero-all-stock") { state.products.forEach((product) => { product.stock = 0; }); saveState(); ui.modal = null; render(); showToast("Все запасы обнулены"); }
  if (action === "confirm-clear-shopping") { state.shopping = []; saveState(); ui.modal = null; render(); showToast("Список покупок очищен"); }
  if (action === "confirm-delete-recipe") {
    const recipeId = button.dataset.id;
    state.recipes = state.recipes.filter((recipe) => recipe.id !== recipeId);
    state.shopping = state.shopping.filter((item) => item.source !== recipeId);
    saveState(); ui.modal = null; navigate("recipes"); showToast("Композиция удалена");
  }
  if (action === "buy-shopping") {
    const shopping = state.shopping.find((item) => item.productId === button.dataset.productId);
    ui.modal = { type: "purchase", productId: button.dataset.productId, quantity: shopping?.quantity };
    renderModal();
  }
  if (action === "copy-recipe") {
    const source = getRecipe(button.dataset.id);
    const copyRecipe = clone(source);
    copyRecipe.id = `my-${Date.now()}`;
    copyRecipe.authorExample = false;
    copyRecipe.title = source.title.replace(" — премиум", "");
    state.recipes.push(copyRecipe);
    saveState();
    navigate("detail", { detailId: copyRecipe.id });
    showToast("Композиция добавлена в «Мои»");
  }
  if (action === "add-missing") {
    addMissingToShopping(getRecipe(button.dataset.id));
    render();
    showToast("Недостающее добавлено в покупки");
  }
  if (action === "start-production") startProduction(button.dataset.id);
  if (action === "cancel-production") navigate("detail", { detailId: ui.production?.recipeId });
  if (action === "run-timer") { ui.production.startedAt = Date.now(); render(); }
  if (action === "finish-production") { ui.modal = { type: "confirmProduction", recipeId: ui.production.recipeId }; renderModal(); }
  if (action === "export") exportBackup();
  if (action === "restore") restoreInput.click();
  if (action === "reset-demo") { ui.modal = { type: "confirmReset" }; renderModal(); }
  if (action === "confirm-reset") {
    state = clone(initialState);
    saveState();
    ui.modal = null;
    navigate("home");
    showToast("Демонстрационные данные восстановлены");
  }
}

app.addEventListener("input", (event) => {
  if (event.target.id === "recipe-search") {
    ui.search = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const next = document.querySelector("#recipe-search");
    next?.focus(); next?.setSelectionRange(cursor, cursor);
  }
  if (event.target.id === "history-search") {
    ui.historySearch = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const next = document.querySelector("#history-search");
    next?.focus(); next?.setSelectionRange(cursor, cursor);
  }
});

app.addEventListener("change", (event) => {
  if (event.target.id === "history-from") { ui.historyFrom = event.target.value; render(); return; }
  if (event.target.id === "history-to") { ui.historyTo = event.target.value; render(); return; }
  const key = event.target.dataset.setting;
  if (!key) return;
  state.settings[key] = Number(event.target.value);
  saveState();
  showToast("Настройки сохранены — цены пересчитаны");
});

modalRoot.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  if (form.dataset.form === "product-price") {
    const product = getProduct(form.dataset.productId);
    const quantity = Number(data.get("quantity"));
    const paid = Number(data.get("paid"));
    product.unitPrice = paid / quantity;
    product.packSize = quantity;
    product.source = "Моя цена";
    if (form.dataset.mode === "purchase") {
      product.stock += quantity;
      state.shopping = state.shopping.filter((item) => item.productId !== product.id);
    }
    saveState(); ui.modal = null; render();
    showToast(form.dataset.mode === "purchase" ? "Запасы обновлены, композиции пересчитаны" : "Цена сохранена, композиции пересчитаны");
  }
  if (form.dataset.form === "new-recipe") {
    try {
      const photo = await compressPhoto(data.get("image"));
      const recipe = { id: `custom-${Date.now()}`, title: String(data.get("title")), type: String(data.get("type")), image: photo || "assets/image4.jpg", customImage: Boolean(photo), authorExample: false, minutes: Number(data.get("minutes")), items: [] };
      state.recipes.push(recipe);
      if (!saveState()) { state.recipes.pop(); return; }
      ui.modal = null; navigate("detail", { detailId: recipe.id });
      showToast("Композиция создана — добавьте состав");
    } catch (error) { showToast(error instanceof Error ? error.message : "Не удалось добавить фотографию"); }
  }
  if (form.dataset.form === "add-item") {
    const recipe = getRecipe(form.dataset.recipeId);
    const productId = String(data.get("productId"));
    const quantity = Number(data.get("quantity"));
    const existing = recipe.items.find((item) => item.productId === productId);
    if (existing) existing.quantity += quantity; else recipe.items.push({ productId, quantity });
    saveState(); ui.modal = null; render(); showToast("Позиция добавлена в состав");
  }
  if (form.dataset.form === "new-product") {
    const purchaseQty = Number(data.get("purchaseQty"));
    const category = String(data.get("category"));
    const emoji = category === "Материалы" ? "📦" : category === "Цветы" ? "🌿" : "🍎";
    const product = { id: `product-${Date.now()}`, name: String(data.get("name")), category, unit: String(data.get("unit")), unitPrice: Number(data.get("paid")) / purchaseQty, stock: Number(data.get("stock")), minStock: Number(data.get("minStock")), packSize: purchaseQty, emoji, source: "Моя цена" };
    state.products.push(product);
    const recipeId = form.dataset.recipeId;
    if (recipeId) getRecipe(recipeId).items.push({ productId: product.id, quantity: Number(data.get("useQty")) });
    saveState(); ui.modal = null; render(); showToast(recipeId ? "Новая позиция добавлена в композицию" : "Новая позиция добавлена в запасы");
  }
  if (form.dataset.form === "edit-time") {
    const recipe = getRecipe(form.dataset.recipeId);
    recipe.minutes = Number(data.get("minutes"));
    saveState(); ui.modal = null; render(); showToast("Время сохранено — стоимость работы пересчитана");
  }
  if (form.dataset.form === "edit-photo") {
    const recipe = getRecipe(form.dataset.recipeId);
    const previousImage = recipe.image;
    const previousCustomImage = recipe.customImage;
    try {
      const photo = await compressPhoto(data.get("image"));
      if (!photo) throw new Error("Выберите фотографию");
      recipe.image = photo;
      recipe.customImage = true;
      if (!saveState()) { recipe.image = previousImage; recipe.customImage = previousCustomImage; return; }
      ui.modal = null; render(); showToast("Фотография сохранена");
    } catch (error) { showToast(error instanceof Error ? error.message : "Не удалось добавить фотографию"); }
  }
  if (form.dataset.form === "complete-production") completeProduction(data);
});

function completeProduction(data) {
  const recipe = getRecipe(ui.production.recipeId);
  const actualMinutes = Math.max(1, Number(data.get("actualMinutes")) || recipe.minutes);
  const salePrice = Math.max(0, Number(data.get("salePrice")) || 0);
  const completedAt = new Date(String(data.get("completedAt"))).toISOString();
  const result = calculateRecipe({ ...recipe, minutes: actualMinutes }, state.products, state.settings);
  const previousStocks = result.lines.map((line) => [line.product, line.product.stock]);
  const entry = createHistoryEntry({ id: `history-${Date.now()}`, recipe, products: state.products, settings: state.settings, completedAt, actualMinutes, salePrice });
  result.lines.forEach((line) => { line.product.stock = Math.max(0, line.product.stock - line.quantity); });
  state.history.push(entry);
  if (!saveState()) {
    state.history = state.history.filter((item) => item.id !== entry.id);
    previousStocks.forEach(([product, stock]) => { product.stock = stock; });
    return;
  }
  ui.modal = null; ui.production = null; ui.historyPreset = "30"; navigate("history"); showToast("Готово — расчёт сохранён в истории, запасы списаны");
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bouquet-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Резервная копия создана");
}

restoreInput.addEventListener("change", async () => {
  const file = restoreInput.files?.[0];
  if (!file) return;
  try {
    const restored = JSON.parse(await file.text());
    if (!Array.isArray(restored.products) || !Array.isArray(restored.recipes) || !restored.settings) throw new Error("bad file");
    state = sanitizeState(restored); saveState(); render(); showToast("Данные восстановлены");
  } catch {
    showToast("Не удалось восстановить: файл не подходит");
  } finally {
    restoreInput.value = "";
  }
});

render();
