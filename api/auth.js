const { validateInitData, getOrCreateUser } = require('../lib/telegramAuth');

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const initData = req.body && req.body.initData;
  const tgUser = validateInitData(initData);

  if (!tgUser) {
    res.status(401).json({ ok: false, error: 'invalid_init_data' });
    return;
  }

  const user = getOrCreateUser(tgUser);
  res.status(200).json({ ok: true, user });
};
