// Vercel serverless-функция: POST /api/telegram-webhook
// Сюда Telegram шлёт апдейты после того, как мы один раз зарегистрируем
// этот адрес через метод setWebhook. Обрабатываем:
//  - message "/start" — приветствие с фото и кнопкой открытия магазина
//  - message "/addstock <id>" от админа — пополнение склада
//  - message "/stock" от админа — остатки по всем товарам
//  - pre_checkout_query — Telegram спрашивает "можно списывать деньги?",
//    тут же в последний момент проверяем остаток на складе
//  - message.successful_payment — деньги реально списаны: списываем товар
//    со склада и отправляем его покупателю; если вдруг не хватило —
//    возвращаем звёзды и извиняемся

const { recordOrder } = require('../lib/telegramAuth');
const { CATALOG } = require('../lib/catalog');
const { getStockCounts, claimStockItem, addStock } = require('../lib/stock');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID; // твой telegram_id, см. инструкцию

async function callTelegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function parsePayload(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.i)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function itemsTitle(payloadItems) {
  return payloadItems
    .map(([id, qty]) => {
      const entry = CATALOG[id];
      const name = entry ? entry.name : id;
      return qty > 1 ? `${name} × ${qty}` : name;
    })
    .join(', ');
}

async function handleAdminCommand(chatId, text) {
  if (text.startsWith('/addstock')) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0].split(/\s+/);
    const productId = firstLine[1];
    const codes = lines.slice(1);

    if (!productId || !CATALOG[productId]) {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: 'Формат: /addstock <id_товара>, дальше с новой строки — коды, по одному на строку.\n\nИзвестные id: ' + Object.keys(CATALOG).join(', '),
      });
      return true;
    }
    if (codes.length === 0) {
      await callTelegram('sendMessage', { chat_id: chatId, text: 'Не вижу кодов после первой строки. Каждый код — с новой строки.' });
      return true;
    }

    const newCount = await addStock(productId, codes);
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `✅ Добавлено ${codes.length} шт. в «${CATALOG[productId].name}». Остаток: ${newCount}.`,
    });
    return true;
  }

  if (text.startsWith('/stock')) {
    const ids = Object.keys(CATALOG);
    const counts = await getStockCounts(ids);
    const lines = ids.map((id) => `${CATALOG[id].name}: ${counts[id] || 0}`);
    await callTelegram('sendMessage', { chat_id: chatId, text: '📦 Остатки:\n' + lines.join('\n') });
    return true;
  }

  return false;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true });
    return;
  }

  const update = req.body || {};
  const origin = `https://${req.headers.host}`;

  try {
    const msg = update.message;
    const isAdmin = ADMIN_TELEGRAM_ID && msg && msg.from && String(msg.from.id) === String(ADMIN_TELEGRAM_ID);

    if (isAdmin && typeof msg.text === 'string' && (msg.text.startsWith('/addstock') || msg.text.startsWith('/stock'))) {
      await handleAdminCommand(msg.chat.id, msg.text);
    } else if (msg && typeof msg.text === 'string' && msg.text.startsWith('/start')) {
      await callTelegram('sendPhoto', {
        chat_id: msg.chat.id,
        photo: `${origin}/banner.jpg`,
        caption:
          '<b>AI Shop</b> — подписки и токены для нейросетей\n\n' +
          'ChatGPT, Claude, Midjourney, Cursor и другое в одном месте. ' +
          'Оплата картой и СБП, доступ приходит прямо в этот чат.',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🛍 Открыть магазин', web_app: { url: origin } }]],
        },
      });
    } else if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const parsed = parsePayload(q.invoice_payload);

      if (!parsed) {
        await callTelegram('answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok: false, error_message: 'Не удалось разобрать заказ, попробуйте оформить его заново.' });
      } else {
        const ids = parsed.i.map(([id]) => id);
        const counts = await getStockCounts(ids);
        const shortage = parsed.i.find(([id, qty]) => (counts[id] || 0) < qty);

        if (shortage) {
          const name = CATALOG[shortage[0]]?.name || shortage[0];
          await callTelegram('answerPreCheckoutQuery', {
            pre_checkout_query_id: q.id,
            ok: false,
            error_message: `«${name}» только что закончился на складе. Оформите заказ заново — без этой позиции.`,
          });
        } else {
          await callTelegram('answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok: true });
        }
      }
    } else if (msg && msg.successful_payment) {
      const chatId = msg.chat.id;
      const fromId = msg.from && msg.from.id;
      const payment = msg.successful_payment;
      const parsed = parsePayload(payment.invoice_payload);

      if (!parsed) {
        await callTelegram('sendMessage', { chat_id: chatId, text: '⚠️ Оплата прошла, но не удалось разобрать состав заказа. Напишите в поддержку — разберёмся вручную.' });
      } else {
        // Пытаемся выдать каждую позицию со склада. Если чего-то не хватило
        // (два покупателя успели одновременно) — откатываем всё, что успели
        // забрать, и возвращаем деньги целиком, честнее частичной выдачи.
        const claimed = []; // { id, code }
        let shortageItem = null;

        outer:
        for (const [id, qty] of parsed.i) {
          for (let k = 0; k < qty; k++) {
            const code = await claimStockItem(id);
            if (!code) { shortageItem = id; break outer; }
            claimed.push({ id, code });
          }
        }

        if (shortageItem) {
          // возвращаем то, что успели забрать, обратно на склад
          for (const c of claimed) await addStock(c.id, [c.code]);

          await callTelegram('refundStarPayment', {
            user_id: fromId,
            telegram_payment_charge_id: payment.telegram_payment_charge_id,
          });

          await callTelegram('sendMessage', {
            chat_id: chatId,
            text: `😔 «${CATALOG[shortageItem]?.name || shortageItem}» закончился в момент оплаты. Звёзды вернули полностью, попробуйте оформить заказ заново.`,
          });
        } else {
          const title = itemsTitle(parsed.i);
          const codesText = claimed.map((c) => `• ${CATALOG[c.id]?.name || c.id}: ${c.code}`).join('\n');

          if (fromId) {
            await recordOrder(fromId, {
              title,
              amount: payment.total_amount,
              currency: 'XTR',
              items: parsed.i,
              deliveredCodes: claimed.map((c) => c.code),
            });
          }

          await callTelegram('sendMessage', {
            chat_id: chatId,
            text: `✅ Оплата прошла! Списано ${payment.total_amount} ⭐.\n\nВаш заказ:\n${codesText}`,
          });
        }
      }
    }
  } catch (e) {
    console.error('telegram-webhook error', e);
  }

  res.status(200).json({ ok: true });
};
