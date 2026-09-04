// Vercel serverless-функция: POST /api/record-order
// Вызывается из корзины при "Оформить заказ". Реальных денег тут пока не
// списывается (это отдельная задача — подключить настоящую оплату), но
// заказ по-честному считается на сервере (по серверному каталогу цен, а
// не по тому, что прислал браузер), пишется на проверенный аккаунт и
// подтверждается сообщением в чат — чтобы это не было пустым тостом.

const { validateInitData, recordOrder } = require('../lib/telegramAuth');
const { CATALOG } = require('../lib/catalog');

const BOT_TOKEN = process.env.BOT_TOKEN;

async function callTelegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const { initData, items } = req.body || {};
  const tgUser = validateInitData(initData);

  if (!tgUser) {
    res.status(401).json({ ok: false, error: 'invalid_init_data' });
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ ok: false, error: 'empty_cart' });
    return;
  }

  let total = 0;
  const lines = [];
  for (const it of items) {
    const entry = CATALOG[it && it.id];
    if (!entry) continue;
    const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
    total += entry.price * qty;
    lines.push(`${entry.name} × ${qty}`);
  }

  if (total <= 0) {
    res.status(400).json({ ok: false, error: 'empty_cart' });
    return;
  }

  const title = lines.join(', ');
  const user = await recordOrder(tgUser.id, { title, amount: total, currency: 'RUB' });

  try {
    if (BOT_TOKEN) {
      await callTelegram('sendMessage', {
        chat_id: tgUser.id,
        text: `🧾 Новый заказ оформлен!\n${title}\nИтого: ${total} ₽\n\n(демо-режим — реальная оплата пока не подключена)`,
      });
    }
  } catch (e) {
    // Заказ уже записан на аккаунт — если сообщение не ушло, это не критично.
    console.error('record-order sendMessage failed', e);
  }

  res.status(200).json({ ok: true, user });
};
