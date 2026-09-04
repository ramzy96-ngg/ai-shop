// Vercel serverless-функция: POST /api/telegram-webhook
// Сюда Telegram шлёт апдейты после того, как мы один раз зарегистрируем
// этот адрес через метод setWebhook. Нас интересуют три вида апдейтов:
//  - message с текстом "/start" — приветствие с фото и кнопками
//  - pre_checkout_query — Telegram спрашивает "можно списывать деньги?",
//    отвечать нужно в течение 10 секунд, иначе платёж сорвётся
//  - message.successful_payment — деньги реально списаны, можно выдавать доступ

const { recordOrder } = require('../lib/telegramAuth');

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
    res.status(200).json({ ok: true });
    return;
  }

  const update = req.body || {};
  const origin = `https://${req.headers.host}`;

  try {
    if (update.message && typeof update.message.text === 'string' && update.message.text.startsWith('/start')) {
      const chatId = update.message.chat.id;

      await callTelegram('sendPhoto', {
        chat_id: chatId,
        photo: `${origin}/banner.jpg`,
        caption:
          '<b>AI Shop</b> — подписки и токены для нейросетей\n\n' +
          'ChatGPT, Claude, Midjourney, Cursor и другое в одном месте. ' +
          'Оплата картой и СБП, доступ приходит прямо в этот чат.',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛍 Открыть магазин', web_app: { url: origin } }],
          ],
        },
      });
    } else if (update.pre_checkout_query) {
      // Подтверждаем: заказ валиден, можно списывать.
      // Тут же в реальной версии стоит перепроверить, что заказ ещё
      // существует и цена не разъехалась.
      await callTelegram('answerPreCheckoutQuery', {
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true,
      });
    } else if (update.message && update.message.successful_payment) {
      const chatId = update.message.chat.id;
      const fromId = update.message.from && update.message.from.id;
      const payment = update.message.successful_payment;

      // Записываем заказ на аккаунт того, кто платил (from.id — telegram_id
      // покупателя), а не просто на chat_id — в личке с ботом они совпадают,
      // но так правильнее по смыслу.
      if (fromId) {
        recordOrder(fromId, {
          title: 'Тестовая покупка',
          amount: payment.total_amount,
          currency: 'XTR',
        });
      }

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `✅ Оплата прошла! Списано ${payment.total_amount} ⭐.`,
      });
    }
  } catch (e) {
    console.error('telegram-webhook error', e);
  }

  // Telegram просто ждёт HTTP 200 — конкретное тело ответа не важно.
  res.status(200).json({ ok: true });
};
