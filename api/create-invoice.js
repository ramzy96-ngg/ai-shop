// Vercel serverless-функция: POST /api/create-invoice
// Создаёт ссылку на оплату через Telegram Stars (валюта XTR) для
// ПРОВЕРЕННОГО (initData подтверждён) пользователя — без стороннего
// эквайринга, платёжный процессор тут сам Telegram.
//
// Сейчас это тестовая позиция за 1 звезду, чтобы проверить всю цепочку
// end-to-end (создание счёта -> оплата -> вебхук -> подтверждение).
// Реальный каталог с ценами в звёздах подключим отдельным шагом.

const { validateInitData } = require('../lib/telegramAuth');

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

  const initData = req.body && req.body.initData;
  const tgUser = validateInitData(initData);

  if (!tgUser) {
    res.status(401).json({ ok: false, error: 'invalid_init_data' });
    return;
  }

  const payload = `test_${tgUser.id}_${Date.now()}`;

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Тестовая покупка',
        description: 'Проверка оплаты через Telegram Stars',
        payload,
        currency: 'XTR',
        prices: [{ label: 'Тест', amount: 1 }],
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
