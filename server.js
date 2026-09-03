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
const path = require('path');
const { validateInitData, getOrCreateUser } = require('./lib/telegramAuth');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/auth', (req, res) => {
  const { initData } = req.body || {};
  const tgUser = validateInitData(initData);

  if (!tgUser) {
    return res.status(401).json({ ok: false, error: 'invalid_init_data' });
  }

  const user = getOrCreateUser(tgUser);
  res.json({ ok: true, user });
});

// На обычном хостинге (Render/Railway и т.п.) сервер запускается напрямую —
// слушает порт как обычно. На Vercel файл вместо этого импортируется как
// serverless-функция, поэтому app.listen там не нужен и не должен вызываться.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI Shop server listening on port ${PORT}`);
  });
}

module.exports = app;
