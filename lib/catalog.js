// Серверная копия каталога — нужна, чтобы считать сумму заказа на бэкенде,
// а не доверять цене, которую прислал браузер (клиент можно подделать).
// При добавлении/изменении товаров в index.html — обновляйте и здесь.

const CATALOG = {
  'sub-gpt': { name: 'ChatGPT Plus', price: 990 },
  'sub-claude': { name: 'Claude Pro', price: 1090 },
  'sub-mj': { name: 'Midjourney Standard', price: 1450 },
  'sub-suno': { name: 'Suno Pro', price: 790 },
  'img-dalle': { name: 'DALL·E пакет', price: 650 },
  'tool-cursor': { name: 'Cursor Pro', price: 1590 },
  'tool-elevenlabs': { name: 'ElevenLabs Creator', price: 990 },
  'tok-gpt-100': { name: 'OpenAI API — 100k токенов', price: 390 },
  'tok-gpt-500': { name: 'OpenAI API — 500k токенов', price: 1690 },
  'tok-claude-100': { name: 'Anthropic API — 100k токенов', price: 450 },
  'tok-claude-500': { name: 'Anthropic API — 500k токенов', price: 1990 },
  'tok-mj-fast': { name: 'Midjourney Fast-часы ×10', price: 890 },
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
