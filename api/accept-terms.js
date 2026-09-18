// Vercel serverless-функция: POST /api/accept-terms
// Фиксирует, что проверенный пользователь принял пользовательское соглашение
// (дата и версия сохраняются в его записи) — на случай споров и для банка.

const { validateInitData, getOrCreateUser } = require('../lib/telegramAuth');
const { kv } = require('../lib/db');

const TERMS_VERSION = '2026-09-18';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const tgUser = validateInitData(req.body && req.body.initData);
  if (!tgUser) {
    res.status(401).json({ ok: false, error: 'invalid_init_data' });
    return;
  }

  const user = await getOrCreateUser(tgUser);
  user.termsAcceptedAt = Date.now();
  user.termsVersion = TERMS_VERSION;
  await kv.set(`user:${user.id}`, user);

  res.status(200).json({ ok: true });
};
