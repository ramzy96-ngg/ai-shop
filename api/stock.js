// Vercel serverless-функция: POST /api/stock
// Отдаёт текущие остатки по всем товарам каталога — фронтенд показывает
// "осталось N" и блокирует покупку того, чего нет.

const { CATALOG } = require('../lib/catalog');
const { getStockCounts } = require('../lib/stock');

module.exports = async (req, res) => {
  const counts = await getStockCounts(Object.keys(CATALOG));
  res.status(200).json({ ok: true, stock: counts });
};
