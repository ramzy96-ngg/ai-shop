// Vercel serverless-функция: POST /api/create-topup
// Пополнение баланса картой / СБП через Platega. Сумму выбирает покупатель,
// сервер проверяет границы и создаёт транзакцию. Зачисление на баланс делает
// /api/platega-callback — только после подтверждённой оплаты.

const { validateInitData } = require('../lib/telegramAuth');
const { kv } = require('../lib/db');
const platega = require('../lib/platega');

const BOT_USERNAME = 'RamzyAlbot';
const PENDING_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_RUB = 50;
const MAX_RUB = 100000;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  if (!platega.isConfigured()) {
    res.status(500).json({ ok: false, error: 'platega_not_configured' });
    return;
  }

  const { initData, amount } = req.body || {};
  const tgUser = validateInitData(initData);
  if (!tgUser) {
    res.status(401).json({ ok: false, error: 'invalid_init_data' });
    return;
  }

  const rub = Math.ceil(Number(amount));
  if (!Number.isFinite(rub) || rub < MIN_RUB || rub > MAX_RUB) {
    res.status(400).json({ ok: false, error: 'invalid_amount', min: MIN_RUB, max: MAX_RUB });
    return;
  }

  // Тестовая сумма (как в create-payment): пока задана PLATEGA_AMOUNT_OVERRIDE,
  // оплачивается и зачисляется именно она.
  const override = Number(process.env.PLATEGA_AMOUNT_OVERRIDE);
  const chargeAmount = override > 0 ? override : rub;

  const orderId = `top_${Date.now()}_${tgUser.id}`;
  const origin = `https://${req.headers.host}`;
  const botLink = `https://t.me/${BOT_USERNAME}`;

  try {
    const tx = await platega.createTransaction({
      amount: chargeAmount,
      description: `AI Shop: Пополнение баланса ${chargeAmount} ₽`,
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
        type: 'topup',
        orderId,
        userId: String(tgUser.id),
        username: tgUser.username || '',
        items: [],
        title: 'Пополнение баланса',
        amount: chargeAmount,
        status: 'pending',
        origin,
        createdAt: Date.now(),
      },
      { ex: PENDING_TTL_SECONDS }
    );

    res.status(200).json({ ok: true, url: tx.url, transactionId: tx.transactionId });
  } catch (e) {
    console.error('create-topup failed', e.status, e.details || e.message);
    res.status(502).json({ ok: false, error: 'payment_provider_error' });
  }
};
