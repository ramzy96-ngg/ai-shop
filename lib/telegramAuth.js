const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

if (!BOT_TOKEN) {
  console.warn('[WARN] BOT_TOKEN не задан.');
}

const users = new Map();

function validateInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const userJson = params.get('user');
  if (!userJson) return null;

  try {
    return JSON.parse(userJson);
  } catch {
    return null;
  }
}

function getOrCreateUser(tgUser) {
  const id = String(tgUser.id);
  let u = users.get(id);
  if (!u) {
    u = {
      id,
      firstName: tgUser.first_name || '',
      lastName: tgUser.last_name || '',
      username: tgUser.username || '',
      photoUrl: tgUser.photo_url || '',
      balance: 1250,
      createdAt: Date.now(),
    };
    users.set(id, u);
  } else {
    u.firstName = tgUser.first_name || u.firstName;
    u.lastName = tgUser.last_name || u.lastName;
    u.username = tgUser.username || u.username;
    u.photoUrl = tgUser.photo_url || u.photoUrl;
  }
  return u;
}

module.exports = { validateInitData, getOrCreateUser };
