// Клиент платёжной системы Platega (карты, СБП). Документация: https://docs.platega.io/
// Ключи берутся из переменных окружения (задаются в Vercel → Environment Variables):
//   PLATEGA_MERCHANT_ID — Merchant ID из личного кабинета / письма
//   PLATEGA_SECRET      — API-ключ (Secret) оттуда же
// Никогда не вписывайте их прямо в код и не присылайте в чаты.

const crypto = require('crypto');

const BASE_URL = 'https://app.platega.io';
const MERCHANT_ID = process.env.PLATEGA_MERCHANT_ID;
const SECRET = process.env.PLATEGA_SECRET;

function isConfigured() {
  return Boolean(MERCHANT_ID && SECRET);
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-MerchantId': MERCHANT_ID,
    'X-Secret': SECRET,
  };
}

// Создаёт платёж без заданного метода: плательщик сам выбирает на странице
// Platega (СБП, карта и т.д. — то, что подключено в вашем кабинете).
// Возвращает { transactionId, status, url, expiresIn, rate }.
async function createTransaction({ amount, description, returnUrl, failedUrl, payload, orderId, userId, userName }) {
  const res = await fetch(`${BASE_URL}/v2/transaction/process`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      paymentDetails: { amount, currency: 'RUB' },
      description,
      return: returnUrl,
      failedUrl,
      payload,
      orderId,
      metadata: { userId: String(userId), userName: userName || '' },
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.url || !data.transactionId) {
    const err = new Error('platega_create_failed');
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// Статус транзакции: PENDING | CONFIRMED | CANCELED | CHARGEBACKED.
async function getTransaction(id) {
  const res = await fetch(`${BASE_URL}/transaction/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = new Error('platega_status_failed');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Platega присылает в callback те же заголовки X-MerchantId / X-Secret,
// что и мы шлём им. Сверяем с нашими — так отсекаются поддельные вызовы.
function verifyCallbackHeaders(headers) {
  if (!isConfigured()) return false;
  return safeEqual(headers['x-merchantid'], MERCHANT_ID) && safeEqual(headers['x-secret'], SECRET);
}

module.exports = { isConfigured, createTransaction, getTransaction, verifyCallbackHeaders };
