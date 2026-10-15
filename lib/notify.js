// Общие помощники для сообщений через Bot API.

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

async function callTelegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Сообщение владельцу магазина (о продажах и проблемах). Никогда не бросает
// исключение — уведомление не должно ломать выдачу товара покупателю.
async function notifyAdmin(text) {
  if (!BOT_TOKEN || !ADMIN_TELEGRAM_ID) return;
  try {
    await callTelegram('sendMessage', { chat_id: ADMIN_TELEGRAM_ID, text });
  } catch (e) {
    console.error('notifyAdmin failed', e);
  }
}

module.exports = { callTelegram, notifyAdmin };
