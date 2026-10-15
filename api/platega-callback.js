// Vercel serverless-функция: POST /api/platega-callback
// Сюда Platega присылает уведомление о смене статуса платежа (адрес нужно
// указать в личном кабинете: Настройки → Callback URLs).
//
// Что делаем при CONFIRMED:
//  1) проверяем, что запрос пришёл от Platega (заголовки X-MerchantId/X-Secret);
//  2) перепроверяем статус и сумму напрямую через API Platega — телу callback
//     одному не доверяем;
//  3) списываем товар со склада и отправляем покупателю в чат;
//  4) записываем заказ на аккаунт и уведомляем владельца.
// Platega может повторить callback (до 3 раз), поэтому всё идемпотентно:
// блокировка на время обработки + сохранённые коды, чтобы не выдать дважды.

const { recordOrder, creditBalance } = require('../lib/telegramAuth');
const { CATALOG } = require('../lib/catalog');
const { claimStockItem, addStock, getStockCount } = require('../lib/stock');
const { kv } = require('../lib/db');
const platega = require('../lib/platega');
const { callTelegram, notifyAdmin } = require('../lib/notify');

const DAY = 24 * 60 * 60;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true });
    return;
  }

  if (!platega.verifyCallbackHeaders(req.headers)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const body = req.body || {};
  const id = body.id;
  if (!id) {
    res.status(400).json({ ok: false, error: 'no_id' });
    return;
  }

  const payKey = `pay:${id}`;
  const rec = await kv.get(payKey);
  if (!rec) {
    // Не наш платёж (или запись истекла) — подтверждаем приём, чтобы не было ретраев.
    res.status(200).json({ ok: true, ignored: 'unknown_transaction' });
    return;
  }

  if (body.status === 'CANCELED') {
    if (rec.status === 'pending') {
      rec.status = 'canceled';
      await kv.set(payKey, rec, { ex: 30 * DAY });
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (body.status !== 'CONFIRMED') {
    res.status(200).json({ ok: true, ignored: 'status' });
    return;
  }

  if (await kv.get(`paydone:${id}`)) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  // Блокировка от параллельной обработки одного и того же платежа.
  const locked = await kv.set(`paylock:${id}`, 1, { nx: true, ex: 120 });
  if (!locked) {
    res.status(503).json({ ok: false, error: 'processing' }); // Platega повторит позже
    return;
  }

  try {
    // Перепроверка у провайдера: статус и сумма.
    const tx = await platega.getTransaction(id);
    const paidAmount = Number(tx && tx.paymentDetails && tx.paymentDetails.amount);
    if (!tx || tx.status !== 'CONFIRMED' || paidAmount !== Number(rec.amount)) {
      await notifyAdmin(
        `⚠️ Callback Platega не прошёл сверку.\nПлатёж: ${id}\nСтатус в API: ${tx && tx.status}\nОжидалось: ${rec.amount} ₽, в API: ${paidAmount} ₽`
      );
      await kv.del(`paylock:${id}`);
      res.status(200).json({ ok: true, ignored: 'verification_failed' });
      return;
    }

    // Пополнение баланса: зачисляем ровно оплаченную сумму, один раз.
    if (rec.type === 'topup') {
      const first = await kv.set(`paycredit:${id}`, 1, { nx: true, ex: 30 * DAY });
      let user = null;
      if (first) {
        try {
          user = await creditBalance(rec.userId, Number(rec.amount), 'Пополнение баланса');
        } catch (err) {
          await kv.del(`paycredit:${id}`); // не зачислили — пусть Platega повторит
          throw err;
        }
      }
      rec.status = 'delivered';
      await kv.set(payKey, rec, { ex: 30 * DAY });
      await kv.set(`paydone:${id}`, 1, { ex: 30 * DAY });
      await kv.del(`paylock:${id}`);
      if (first) {
        await callTelegram('sendMessage', {
          chat_id: rec.userId,
          text: `✅ Баланс пополнен на ${rec.amount} ₽. Сейчас на счёте: ${user.balance} ₽`,
        });
        await notifyAdmin(`💳 Пополнение баланса\nСумма: ${rec.amount} ₽\nПокупатель: ${rec.userId}${rec.username ? ' @' + rec.username : ''}`);
      }
      res.status(200).json({ ok: true });
      return;
    }

    // Коды берём со склада один раз и сразу запоминаем — на случай повторного вызова.
    let claimed = await kv.get(`paycodes:${id}`);
    let shortageItem = null;

    if (!claimed) {
      claimed = [];
      outer:
      for (const [itemId, qty] of rec.items) {
        if (CATALOG[itemId] && CATALOG[itemId].custom) continue; // ручная выдача, склада нет
        for (let k = 0; k < qty; k++) {
          const code = await claimStockItem(itemId);
          if (!code) { shortageItem = itemId; break outer; }
          claimed.push({ id: itemId, code });
        }
      }

      if (shortageItem) {
        for (const c of claimed) await addStock(c.id, [c.code]);
        rec.status = 'shortage';
        await kv.set(payKey, rec, { ex: 30 * DAY });
        await kv.set(`paydone:${id}`, 1, { ex: 30 * DAY });
        await kv.del(`paylock:${id}`);

        const name = (CATALOG[shortageItem] && CATALOG[shortageItem].name) || shortageItem;
        await callTelegram('sendMessage', {
          chat_id: rec.userId,
          text: `😔 Оплата получена, но «${name}» закончился в момент оплаты. Мы вернём деньги — поддержка @ramzy988 уже уведомлена. Заказ: ${rec.orderId}`,
        });
        await notifyAdmin(
          `🚨 Нужен возврат: оплата прошла, но «${name}» закончился.\nСумма: ${rec.amount} ₽\nПокупатель: ${rec.userId}${rec.username ? ' @' + rec.username : ''}\nЗаказ: ${rec.orderId}\nПлатёж Platega: ${id}\nВерните деньги в личном кабинете Platega.`
        );
        res.status(200).json({ ok: true, shortage: true });
        return;
      }

      await kv.set(`paycodes:${id}`, claimed, { ex: 30 * DAY });
    }

    // Позиции с произвольной суммой (Steam) выдаём вручную: покупатель пишет логин в поддержку.
    const manual = rec.items.filter(([itemId]) => CATALOG[itemId] && CATALOG[itemId].custom);
    const manualLines = manual.map(([itemId, , rub]) => {
      const e = CATALOG[itemId];
      return `• ${e.name} на ${rub} ₽ (≈ ${Math.round((rub / e.rate) * 100) / 100} $): напишите логин Steam в поддержку @ramzy988 — пополним вручную`;
    });
    const codesText = claimed.map((c) => `• ${(CATALOG[c.id] && CATALOG[c.id].name) || c.id}: ${c.code}`)
      .concat(manualLines).join('\n');
    const sent = await callTelegram('sendMessage', {
      chat_id: rec.userId,
      text: `✅ Оплата прошла! Списано ${rec.amount} ₽.\n\nВаш заказ:\n${codesText}`,
    });
    if (!sent || sent.ok !== true) {
      throw new Error('telegram_send_failed');
    }

    await recordOrder(rec.userId, {
      title: rec.title,
      amount: rec.amount,
      currency: 'RUB',
      items: rec.items,
      deliveredCodes: claimed.map((c) => c.code),
      status: 'paid',
    });

    rec.status = 'delivered';
    await kv.set(payKey, rec, { ex: 30 * DAY });
    await kv.set(`paydone:${id}`, 1, { ex: 30 * DAY });
    await kv.del(`paylock:${id}`);

    const left = [];
    for (const [itemId] of rec.items) {
      if (CATALOG[itemId] && CATALOG[itemId].custom) continue;
      left.push(`${(CATALOG[itemId] && CATALOG[itemId].name) || itemId}: ${await getStockCount(itemId)}`);
    }
    await notifyAdmin(
      `💰 Новая продажа (карта/СБП)\n${rec.title}\nСумма: ${rec.amount} ₽\nПокупатель: ${rec.userId}${rec.username ? ' @' + rec.username : ''}\nОстаток: ${left.join(', ') || '—'}` +
      (manual.length ? `\n\n🎮 Нужно вручную пополнить Steam: ${manual.map(([, , rub]) => rub + ' ₽').join(', ')}. Покупатель напишет логин в поддержку.` : '')
    );

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('platega-callback error', e);
    await kv.del(`paylock:${id}`);
    res.status(500).json({ ok: false, error: 'internal' }); // Platega повторит
  }
};
