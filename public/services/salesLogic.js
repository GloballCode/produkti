export function parseSaleDate(sale) {
  if (!sale) return null;

  if (sale.createdAt?.toDate) return sale.createdAt.toDate();
  if (sale.saleDate?.toDate) return sale.saleDate.toDate();
  if (sale.createdAt instanceof Date) return sale.createdAt;
  if (sale.saleDate instanceof Date) return sale.saleDate;

  if (typeof sale.createdAt === 'string') {
    const date = new Date(sale.createdAt);
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (typeof sale.saleDate === 'string') {
    const date = new Date(sale.saleDate);
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (typeof sale.data === 'string') {
    const iso = new Date(sale.data);
    if (!Number.isNaN(iso.getTime())) return iso;

    const brMatch = sale.data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (brMatch) {
      const [, day, month, year, hour = '00', minute = '00'] = brMatch;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }

  return null;
}

export function getSaleProfit(sale, products) {
  return (sale.itens || []).reduce((acc, item) => {
    const product = products.find((p) => p.id === item.produtoId);
    const custo = product ? parseFloat(product.custo || 0) : 0;
    const precoVenda = parseFloat(item.preco || 0);
    const quantidade = parseInt(item.quantidade || 0, 10);
    return acc + (precoVenda - custo) * quantidade;
  }, 0);
}

export function formatMonthLabel(date) {
  return date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

export function summarizeSalesByMonth(sales, products) {
  const buckets = new Map();

  sales.forEach((sale) => {
    const date = parseSaleDate(sale);
    if (!date) return;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: formatMonthLabel(date),
        total: 0,
        transactions: 0,
        lucro: 0,
        dizimo: 0
      });
    }

    const bucket = buckets.get(key);
    const total = parseFloat(sale.total || 0);
    bucket.total += total;
    bucket.transactions += 1;
    bucket.lucro += getSaleProfit(sale, products);
    bucket.dizimo = bucket.lucro * 0.1;
  });

  return Array.from(buckets.values()).sort((a, b) => b.key.localeCompare(a.key));
}

export function filterSalesByPeriod(sales, filter, now = new Date()) {
  const normalizedNow = new Date(now);
  normalizedNow.setHours(0, 0, 0, 0);

  return sales.filter((sale) => {
    const saleDate = parseSaleDate(sale);
    if (!saleDate) return false;

    saleDate.setHours(0, 0, 0, 0);

    switch (filter) {
      case 'hoje':
        return saleDate.toDateString() === normalizedNow.toDateString();
      case 'semana': {
        const weekAgo = new Date(normalizedNow);
        weekAgo.setDate(normalizedNow.getDate() - 6);
        return saleDate >= weekAgo;
      }
      case 'mes':
        return saleDate.getMonth() === normalizedNow.getMonth() && saleDate.getFullYear() === normalizedNow.getFullYear();
      case 'ano':
        return saleDate.getFullYear() === normalizedNow.getFullYear();
      default:
        return true;
    }
  });
}
