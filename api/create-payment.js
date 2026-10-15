// Vercel serverless-функция: POST /api/create-payment
// Оплата картой / СБП через Platega. Принимает корзину, считает сумму по
// серверному каталогу (клиенту не доверяем), проверяет остатки, создаёт
// транзакцию в Platega и возвращает ссылку на страницу оплаты.
// Выдача товара происходит позже — в /api/platega-callback, когда Platega
// сообщит об успешной оплате.

const { validateInitData } = require('../lib/telegramAuth');
const { CATALOG } = require('../lib/catalog');
const { getStockCounts } = require('../lib/stock');
const { kv } = require('../lib/db');
const platega = require('../lib/platega');

const BOT_USERNAME = 'RamzyAlbot';
const PENDING_TTL_SECONDS = 7 * 24 * 60 * 60;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  if (!platega.isConfigured()) {
    res.status(500).json({ ok: false, error: 'platega_not_configured' });
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

  let totalRub = 0;
  const payloadItems = [];
  const lines = [];
  for (const it of items) {
    const entry = CATALOG[it && it.id];
    if (!entry) continue;
    const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
    totalRub += entry.price * qty;
    payloadItems.push([it.id, qty]);
    lines.push(qty > 1 ? `${entry.name} × ${qty}` : entry.name);
  }

  if (totalRub <= 0) {
    res.status(400).json({ ok: false, error: 'empty_cart' });
    return;
  }

  // Проверяем остатки до выставления счёта.
  const counts = await getStockCounts(payloadItems.map(([id]) => id));
  const outOfStock = payloadItems.filter(([id, qty]) => (counts[id] || 0) < qty);
  if (outOfStock.length > 0) {
    res.status(409).json({
      ok: false,
      error: 'out_of_stock',
      items: outOfStock.map(([id]) => ({ id, name: CATALOG[id].name, available: counts[id] || 0 })),
    });
    return;
  }

  // Тестовая сумма: пока переменная PLATEGA_AMOUNT_OVERRIDE задана в Vercel,
  // любой заказ оплачивается этой суммой (в рублях). Для боевого режима
  // переменную нужно удалить.
  const override = Number(process.env.PLATEGA_AMOUNT_OVERRIDE);
  const chargeAmount = override > 0 ? override : totalRub;

  const orderId = `ord_${Date.now()}_${tgUser.id}`;
  const origin = `https://${req.headers.host}`;
  const botLink = `https://t.me/${BOT_USERNAME}`;

  try {
    const tx = await platega.createTransaction({
      amount: chargeAmount,
      description: `AI Shop: ${lines.join(', ')}`.slice(0, 250),
      returnUrl: botLink,
      failedUrl: botLink,
      payload: orderId,
      orderId,
      userId: tgUser.id,
      userName: tgUser.username ? `@${tgUser.username}` : (tgUser.first_name || ''),
    });

    await kv.set(
      `pay:${tx.transactionId}`,
      {
        orderId,
        userId: String(tgUser.id),
        username: tgUser.username || '',
        items: payloadItems,
        title: lines.join(', '),
        amount: chargeAmount,
        catalogAmount: totalRub,
        status: 'pending',
        origin,
        createdAt: Date.now(),
      },
      { ex: PENDING_TTL_SECONDS }
    );

    res.status(200).json({ ok: true, url: tx.url, transactionId: tx.transactionId });
  } catch (e) {
    console.error('create-payment failed', e.status, e.details || e.message);
    res.status(502).json({ ok: false, error: 'payment_provider_error' });
  }
};
