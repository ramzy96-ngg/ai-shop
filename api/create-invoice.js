// Vercel serverless-функция: POST /api/create-invoice
// Создаёт ссылку на оплату через Telegram Stars (валюта XTR) для
// ПРОВЕРЕННОГО (initData подтверждён) пользователя — без стороннего
// эквайринга, платёжный процессор тут сам Telegram.
//
// Принимает реальные товары из корзины, считает сумму по серверному
// каталогу (клиенту не доверяем), проверяет остаток на складе — и только
// потом выставляет счёт. Состав заказа кодируется в payload инвойса, чтобы
// вебхук после оплаты знал, что именно выдавать.

const { validateInitData } = require('../lib/telegramAuth');
const { CATALOG, priceToStars } = require('../lib/catalog');
const { getStockCounts } = require('../lib/stock');

const BOT_TOKEN = process.env.BOT_TOKEN;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  if (!BOT_TOKEN) {
    res.status(500).json({ ok: false, error: 'bot_token_missing' });
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

  // Считаем сумму и одновременно нормализуем позиции по серверному каталогу.
  let totalRub = 0;
  const lines = [];
  const payloadItems = []; // [[id, qty], ...]
  const normalized = [];
  for (const it of items) {
    const entry = CATALOG[it && it.id];
    if (!entry) continue;
    const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
    totalRub += entry.price * qty;
    lines.push(`${entry.name} × ${qty}`);
    payloadItems.push([it.id, qty]);
    normalized.push({ id: it.id, qty });
  }

  if (totalRub <= 0) {
    res.status(400).json({ ok: false, error: 'empty_cart' });
    return;
  }

  // Проверяем остатки ДО выставления счёта — незачем предлагать оплатить
  // то, чего нет на складе.
  const stockCounts = await getStockCounts(normalized.map((n) => n.id));
  const outOfStock = normalized.filter((n) => (stockCounts[n.id] || 0) < n.qty);
  if (outOfStock.length > 0) {
    res.status(409).json({
      ok: false,
      error: 'out_of_stock',
      items: outOfStock.map((n) => ({ id: n.id, name: CATALOG[n.id]?.name, available: stockCounts[n.id] || 0 })),
    });
    return;
  }

  const amountStars = priceToStars(totalRub);
  const payload = JSON.stringify({ u: tgUser.id, i: payloadItems }).slice(0, 128);

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'AI Shop — заказ',
        description: lines.join(', ').slice(0, 250),
        payload,
        currency: 'XTR',
        prices: [{ label: 'Заказ', amount: amountStars }],
      }),
    });
    const data = await tgRes.json();

    if (!data.ok) {
      res.status(502).json({ ok: false, error: 'telegram_error', details: data.description });
      return;
    }

    res.status(200).json({ ok: true, invoiceLink: data.result });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error' });
  }
};
