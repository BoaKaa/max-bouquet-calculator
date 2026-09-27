const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function calculateRecipe(recipe, products, settings) {
  const lines = recipe.items.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) throw new Error(`Unknown product: ${item.productId}`);
    const cost = roundMoney(item.quantity * product.unitPrice);
    const missing = Math.max(roundMoney(item.quantity - product.stock), 0);
    return { ...item, product, cost, missing };
  });

  const materials = roundMoney(lines.reduce((sum, line) => sum + line.cost, 0));
  const hourlyRate = recipe.hourlyRate ?? settings.hourlyRate;
  const labor = roundMoney((recipe.minutes / 60) * hourlyRate);
  const overheadFixed = settings.overheadEnabled ? settings.overheadFixed : 0;
  const overheadPercent = settings.overheadEnabled
    ? roundMoney((materials + labor) * (settings.overheadPercent / 100))
    : 0;
  const total = roundMoney(materials + labor + overheadFixed + overheadPercent);
  const rawSale = recipe.manualSalePrice ?? total * (1 + settings.markup / 100);
  const step = settings.roundingStep || 10;
  const salePrice = Math.ceil(rawSale / step) * step;
  const profit = roundMoney(salePrice - total);

  return {
    lines,
    materials,
    labor,
    overhead: roundMoney(overheadFixed + overheadPercent),
    total,
    salePrice,
    profit,
    missingLines: lines.filter((line) => line.missing > 0),
    canMake: lines.every((line) => line.missing <= 0),
  };
}

function unitsToBuy(missing, packSize) {
  if (!packSize || missing <= 0) return 0;
  return Math.ceil(missing / packSize);
}

function createHistoryEntry({ id, recipe, products, settings, completedAt, actualMinutes, salePrice }) {
  const snapshotRecipe = { ...recipe, minutes: actualMinutes };
  const result = calculateRecipe(snapshotRecipe, products, settings);
  return {
    id,
    recipeId: recipe.id,
    title: recipe.title,
    completedAt,
    actualMinutes,
    materials: result.materials,
    labor: result.labor,
    overhead: result.overhead,
    total: result.total,
    salePrice,
    profit: roundMoney(salePrice - result.total),
    items: result.lines.map((line) => ({
      productId: line.product.id,
      name: line.product.name,
      unit: line.product.unit,
      quantity: line.quantity,
      unitPrice: line.product.unitPrice,
      cost: line.cost,
    })),
  };
}

function formatQuantity(value, unit) {
  if (unit === "г" && value >= 1000) return `${(value / 1000).toLocaleString("ru-RU")} кг`;
  if (unit === "мл" && value >= 1000) return `${(value / 1000).toLocaleString("ru-RU")} л`;
  if (unit === "см" && value >= 100) return `${(value / 100).toLocaleString("ru-RU")} м`;
  return `${value.toLocaleString("ru-RU")} ${unit}`;
}

function formatMoney(value) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}
