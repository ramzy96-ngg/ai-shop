// AI Shop — минимальный бэкенд для привязки Telegram-аккаунта к мини-аппу.
//
// Что делает:
//  - Отдаёт статику мини-аппа (index.html и всё, что рядом с ним)
//  - POST /api/auth — проверяет initData, который присылает Telegram WebApp SDK,
//    по официальному алгоритму (HMAC-SHA256 с секретом от токена бота).
//    Если подпись верна — значит запрос точно пришёл из Telegram и от того
//    самого пользователя, а не подделан в браузере.
//
// Обязательная переменная окружения: BOT_TOKEN (токен бота из BotFather).
// Локально: BOT_TOKEN=xxxx:yyyy node server.js
// На хостинге (Render/Railway): задаётся в разделе Environment Variables.

const express = require('express');
const crypto = require('crypto');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // initData считаем свежим не дольше суток

if (!BOT_TOKEN) {
  console.warn('[WARN] BOT_TOKEN не задан — /api/auth всегда будет отвечать ошибкой. ' +
    'Задайте переменную окружения BOT_TOKEN (токен из BotFather).');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// В демо-версии — память процесса. Для реального продакшена замените
// на настоящую БД (Postgres/SQLite и т.п.) — так баланс и заказы не
// будут обнуляться при каждом перезапуске сервера.
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

  // timing-safe сравнение хэшей
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

function getOrCreateUser(tgUser) {
  const id = String(tgUser.id);
  let u = users.get(id);
  if (!u) {
    u = {
      id,
      firstName: tgUser.first_name || '',
      lastName: tgUser.last_name || '',
      username: tgUser.username || '',
      photoUrl: tgUser.photo_url || '',
      balance: 1250, // стартовый демо-баланс для нового пользователя
      createdAt: Date.now(),
    };
    users.set(id, u);
  } else {
    // обновляем на случай смены имени/юзернейма в Telegram
    u.firstName = tgUser.first_name || u.firstName;
    u.lastName = tgUser.last_name || u.lastName;
    u.username = tgUser.username || u.username;
    u.photoUrl = tgUser.photo_url || u.photoUrl;
  }
  return u;
}

app.post('/api/auth', (req, res) => {
  const { initData } = req.body || {};
  const tgUser = validateInitData(initData);

  if (!tgUser) {
    return res.status(401).json({ ok: false, error: 'invalid_init_data' });
  }

  const user = getOrCreateUser(tgUser);
  res.json({ ok: true, user });
});

app.listen(PORT, () => {
  console.log(`AI Shop server listening on port ${PORT}`);
});
