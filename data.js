// Публичные демонстрационные данные. Они не содержат реальные закупки,
// остатки или технологические карты мастерицы.
const initialState = {
  version: 3,
  settings: {
    hourlyRate: 600,
    markup: 70,
    roundingStep: 10,
    overheadEnabled: false,
    overheadFixed: 0,
    overheadPercent: 0,
  },
  products: [
    { id: "demo-apple", name: "Яблоки", category: "Продукты", unit: "г", unitPrice: 0.2, stock: 0, minStock: 500, packSize: 1000, emoji: "🍎", source: "Примерная цена" },
    { id: "demo-pear", name: "Груши", category: "Продукты", unit: "г", unitPrice: 0.32, stock: 0, minStock: 300, packSize: 500, emoji: "🍐", source: "Примерная цена" },
    { id: "demo-grape", name: "Виноград", category: "Продукты", unit: "г", unitPrice: 0.28, stock: 0, minStock: 300, packSize: 500, emoji: "🍇", source: "Примерная цена" },
    { id: "demo-strawberry", name: "Клубника", category: "Продукты", unit: "г", unitPrice: 0.8, stock: 0, minStock: 250, packSize: 250, emoji: "🍓", source: "Примерная цена" },
    { id: "demo-cheese", name: "Сыр", category: "Продукты", unit: "г", unitPrice: 1.2, stock: 0, minStock: 150, packSize: 200, emoji: "🧀", source: "Примерная цена" },
    { id: "demo-sausage", name: "Колбаски", category: "Продукты", unit: "г", unitPrice: 1, stock: 0, minStock: 150, packSize: 200, emoji: "🌭", source: "Примерная цена" },
    { id: "demo-nuts", name: "Орехи", category: "Продукты", unit: "г", unitPrice: 0.7, stock: 0, minStock: 100, packSize: 200, emoji: "🥜", source: "Примерная цена" },
    { id: "demo-chocolate", name: "Шоколад", category: "Продукты", unit: "шт.", unitPrice: 120, stock: 0, minStock: 2, packSize: 1, emoji: "🍫", source: "Примерная цена" },
    { id: "demo-kraft", name: "Бумага крафт", category: "Материалы", unit: "лист", unitPrice: 25, stock: 0, minStock: 5, packSize: 10, emoji: "📜", source: "Примерная цена" },
    { id: "demo-film", name: "Упаковочная плёнка", category: "Материалы", unit: "см", unitPrice: 0.3, stock: 0, minStock: 200, packSize: 1000, emoji: "🎁", source: "Примерная цена" },
    { id: "demo-tape", name: "Лента", category: "Материалы", unit: "см", unitPrice: 0.05, stock: 0, minStock: 200, packSize: 1000, emoji: "🎀", source: "Примерная цена" },
    { id: "demo-skewer", name: "Шпажки", category: "Материалы", unit: "шт.", unitPrice: 1, stock: 0, minStock: 30, packSize: 100, emoji: "🪵", source: "Примерная цена" },
    { id: "demo-greenery", name: "Декоративная зелень", category: "Цветы", unit: "ветка", unitPrice: 100, stock: 0, minStock: 2, packSize: 1, emoji: "🌿", source: "Примерная цена" },
    { id: "demo-box", name: "Подарочная коробка", category: "Материалы", unit: "шт.", unitPrice: 250, stock: 0, minStock: 1, packSize: 1, emoji: "🎁", source: "Примерная цена" },
  ],
  recipes: [
    {
      id: "demo-fruit-large", title: "Демо: фруктовый букет", type: "Букеты", image: "assets/image2.jpg", authorExample: true, minutes: 90,
      items: [
        ["demo-apple", 800], ["demo-pear", 400], ["demo-grape", 250], ["demo-strawberry", 200],
        ["demo-greenery", 2], ["demo-kraft", 2], ["demo-film", 120], ["demo-tape", 80], ["demo-skewer", 30],
      ].map(([productId, quantity]) => ({ productId, quantity })),
    },
    {
      id: "demo-snack", title: "Демо: закусочный букет", type: "Букеты", image: "assets/image1.jpg", authorExample: true, minutes: 60,
      items: [
        ["demo-cheese", 250], ["demo-sausage", 300], ["demo-nuts", 150], ["demo-kraft", 2],
        ["demo-film", 100], ["demo-tape", 70], ["demo-skewer", 25],
      ].map(([productId, quantity]) => ({ productId, quantity })),
    },
    {
      id: "demo-gift-box", title: "Демо: подарочная коробка", type: "Композиции", image: "assets/image3.jpg", authorExample: true, minutes: 45,
      items: [
        ["demo-box", 1], ["demo-chocolate", 3], ["demo-nuts", 120], ["demo-greenery", 1], ["demo-tape", 60],
      ].map(([productId, quantity]) => ({ productId, quantity })),
    },
    {
      id: "demo-fruit-mini", title: "Демо: мини-букет", type: "Букеты", image: "assets/image4.jpg", authorExample: true, minutes: 30,
      items: [
        ["demo-apple", 300], ["demo-pear", 200], ["demo-grape", 100], ["demo-film", 80],
        ["demo-tape", 50], ["demo-skewer", 10],
      ].map(([productId, quantity]) => ({ productId, quantity })),
    },
  ],
  shopping: [],
  history: [],
};
