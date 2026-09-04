// Учёт остатков и выдача товара. Каждый товар — это список "кодов на выдачу"
// в Redis (ключ доступа, инвайт-ссылка, инструкция — что угодно текстовое).
// Остаток = длина списка. Списывается по одному через LPOP — это атомарная
// операция в Redis, поэтому два одновременных покупателя не смогут забрать
// один и тот же код (в отличие от "прочитать список, изменить, записать
// обратно", где как раз возможна гонка).

const { kv } = require('./db');

const stockKey = (productId) => `stock:${productId}`;

async function getStockCount(productId) {
  return (await kv.llen(stockKey(productId))) || 0;
}

async function getStockCounts(productIds) {
  const entries = await Promise.all(
    productIds.map(async (id) => [id, await getStockCount(id)])
  );
  return Object.fromEntries(entries);
}

// Забирает один код со склада (и удаляет его оттуда). Возвращает null,
// если товар закончился — на этот случай нужно проверять результат.
async function claimStockItem(productId) {
  const item = await kv.lpop(stockKey(productId));
  return item || null;
}

// Добавляет коды на склад (для админ-команды пополнения). Возвращает
// новый остаток.
async function addStock(productId, codes) {
  const clean = codes.map((c) => String(c).trim()).filter(Boolean);
  if (clean.length === 0) return getStockCount(productId);
  await kv.rpush(stockKey(productId), ...clean);
  return getStockCount(productId);
}

module.exports = { getStockCount, getStockCounts, claimStockItem, addStock };
