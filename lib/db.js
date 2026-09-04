// Тонкая обёртка над Vercel KV (это Redis) — единая точка подключения к базе.
// Переменные окружения (KV_REST_API_URL, KV_REST_API_TOKEN и т.п.) Vercel
// добавляет сам, когда в проекте подключено хранилище KV (Storage → Create
// Database → KV → Connect to Project). Руками их вписывать не нужно.

const { kv } = require('@vercel/kv');

module.exports = { kv };
