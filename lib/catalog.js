// Серверная копия каталога — нужна, чтобы считать сумму заказа на бэкенде,
// а не доверять цене, которую прислал браузер (клиент можно подделать).
// При добавлении/изменении товаров в index.html — обновляйте и здесь.

const CATALOG = {
  'gpt-go': { name: "ChatGPT · Go", price: 490 },
  'gpt-plus': { name: "ChatGPT · Plus", price: 1650 },
  'gpt-pro5': { name: "ChatGPT · Pro 5x", price: 8650 },
  'gpt-pro20': { name: "ChatGPT · Pro 20x", price: 13500 },
  'gpt-pro50': { name: "ChatGPT · Pro 50x", price: 41990 },
  'claude-pro': { name: "Claude Pro", price: 1890 },
  'gemini-pro-18': { name: "Gemini AI Pro · 18 мес. · 2 ТБ", price: 119 },
  'xbox-1m': { name: "Xbox Game Pass · 1 мес.", price: 899 },
  'xbox-2m': { name: "Xbox Game Pass · 2 мес.", price: 1119 },
  'xbox-3m': { name: "Xbox Game Pass · 3 мес.", price: 1999 },
  'xbox-4m': { name: "Xbox Game Pass · 4 мес.", price: 2299 },
  'xbox-5m': { name: "Xbox Game Pass · 5 мес.", price: 2499 },
  'xbox-6m': { name: "Xbox Game Pass · 6 мес.", price: 3399 },
  'xbox-7m': { name: "Xbox Game Pass · 7 мес.", price: 3999 },
  'xbox-8m': { name: "Xbox Game Pass · 8 мес.", price: 4499 },
  'xbox-9m': { name: "Xbox Game Pass · 9 мес.", price: 5199 },
  'xbox-10m': { name: "Xbox Game Pass · 10 мес.", price: 5599 },
  'xbox-11m': { name: "Xbox Game Pass · 11 мес.", price: 6190 },
  'xbox-12m': { name: "Xbox Game Pass · 12 мес.", price: 6590 },
  'spotify-ind-1m': { name: "Spotify Premium · Individual · 1 мес.", price: 250 },
  'spotify-ind-3m': { name: "Spotify Premium · Individual · 3 мес.", price: 599 },
  'spotify-ind-6m': { name: "Spotify Premium · Individual · 6 мес.", price: 999 },
  'spotify-ind-12m': { name: "Spotify Premium · Individual · 12 мес.", price: 1849 },
  'spotify-duo-1m': { name: "Spotify Premium · Duo · 1 мес.", price: 299 },
  'spotify-family-1m': { name: "Spotify Premium · Family · 1 мес.", price: 399 },
  'capcut-1m': { name: "CapCut Pro Team · 1 мес.", price: 299 },
  'capcut-6m': { name: "CapCut Pro Team · 6 мес.", price: 1119 },
  // Пополнение Steam: сумма произвольная и приходит с клиента (в рублях), сервер проверяет границы.
  'steam-topup': { name: "Пополнение Steam", price: 0, custom: true, rate: 85, min: 50, max: 100000 },
};

// Временный курс для пересчёта рублёвых цен каталога в звёзды Telegram
// (своей цены в звёздах пока нет). Поправьте на актуальный при необходимости.
const RUB_PER_STAR = 2;

// ВРЕМЕННО ДЛЯ ТЕСТОВ: любой заказ стоит 1 звезду, независимо от суммы —
// чтобы можно было гонять всю цепочку оплата -> выдача, не тратя реальные
// звёзды. Когда тестирование закончится, поставьте TEST_MODE = false, и
// снова заработает нормальный расчёт по курсу выше.
const TEST_MODE = true;

function priceToStars(rub) {
  if (TEST_MODE) return 1;
  return Math.max(1, Math.round(rub / RUB_PER_STAR));
}

module.exports = { CATALOG, priceToStars };
