// Общая логика проверки Telegram initData — используется и обычным
// Express-сервером (server.js, для Render/Railway), и serverless-функцией
// Vercel (api/auth.js), чтобы не дублировать код.

const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // initData считаем свежим не дольше суток

if (!BOT_TOKEN) {
  console.warn('[WARN] BOT_TOKEN не задан — проверка initData всегда будет отвечать ошибкой. ' +
    'Задайте переменную окружения BOT_TOKEN (токен из BotFather).');
}

// ВАЖНО: это память процесса, а не настоящая база данных. На serverless-
// хостинге (Vercel) каждый вызов может попасть в новый инстанс, так что
// баланс/данные могут не сохраняться между запросами. Для реального
// продакшена замените на Postgres/SQLite/что угодно постоянное.
const users = new Map(); // telegram_id -> { id, firstName, lastName, username, photoUrl, balance }

function validateInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const userJson = params.get('user');
  if (!userJson) return null;

  try {
    return JSON.parse(userJson);
  } catch {
    return null;
  }
}

function blankUser(id) {
  return {
    id,
    firstName: '',
    lastName: '',
    username: '',
    photoUrl: '',
    balance: 1250, // стартовый демо-баланс для нового пользователя
    ordersCount: 0,
    totalSpentStars: 0,
    totalSpentRub: 0,
    orders: [], // { title, amount, currency: 'XTR'|'RUB', date, status }
    createdAt: Date.now(),
  };
}

function getOrCreateUser(tgUser) {
  const id = String(tgUser.id);
  let u = users.get(id);
  if (!u) {
    u = blankUser(id);
    u.firstName = tgUser.first_name || '';
    u.lastName = tgUser.last_name || '';
    u.username = tgUser.username || '';
    u.photoUrl = tgUser.photo_url || '';
    users.set(id, u);
  } else {
    u.firstName = tgUser.first_name || u.firstName;
    u.lastName = tgUser.last_name || u.lastName;
    u.username = tgUser.username || u.username;
    u.photoUrl = tgUser.photo_url || u.photoUrl;
  }
  return u;
}

// Записывает заказ на счёт конкретного telegram_id и обновляет статистику.
// currency: 'XTR' — реальная оплата звёздами (из вебхука), 'RUB' — заказ
// оформлен через корзину (без реального списания денег, демо-режим).
function recordOrder(telegramId, { title, amount, currency }) {
  const id = String(telegramId);
  let u = users.get(id);
  if (!u) {
    // Заказ пришёл раньше, чем /api/auth успел завести пользователя —
    // на всякий случай создаём минимальную запись.
    u = blankUser(id);
    users.set(id, u);
  }
  u.ordersCount += 1;
  if (currency === 'XTR') u.totalSpentStars += amount;
  else u.totalSpentRub += amount;
  u.orders.unshift({ title, amount, currency, date: Date.now(), status: currency === 'XTR' ? 'paid' : 'placed' });
  return u;
}

module.exports = { validateInitData, getOrCreateUser, recordOrder };
