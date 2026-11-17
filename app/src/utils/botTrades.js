/**
 * Helpers compartidos para formatear, clasificar y resumir operaciones del bot.
 */

export const CAPITAL_INICIAL_BOT_DEFAULT = 1000;

/**
 * Indica si el motivo corresponde a un cierre manual (app web o comando manual),
 * el cual se excluye al medir el desempeño puro de la estrategia.
 */
export function esCierreManualBot(motivo = '') {
  const m = String(motivo || '').trim().toLowerCase();
  return (
    m === 'cierre desde la app web' ||
    m === 'cierre manual' ||
    m.includes('cierre manual') ||
    m.includes('app web')
  );
}

/**
 * Convierte ISO UTC, segundos Unix o milisegundos Unix en epoch ms (o `null`).
 */
export function parseTsBotMs(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor <= 0) return null;
    return valor > 1e12 ? valor : valor * 1000;
  }
  const str = String(valor).trim();
  if (!str) return null;
  const num = Number(str);
  if (Number.isFinite(num) && num > 0) {
    return num > 1e12 ? num : num * 1000;
  }
  const parsed = Date.parse(str);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Recupera el timestamp de apertura real y el ID de orden de Testnet si existen en Firestore;
 * si no fueron registrados en versiones anteriores, devuelve null / "—" sin inventar datos.
 */
export function enriquecerTradesConApertura(trades = []) {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  return trades.map((tr) => {
    const finMs = parseTsBotMs(tr?.ts) || 0;
    const explicitaMs = parseTsBotMs(
      tr?.entrada_utc ?? tr?.entry_utc ?? tr?.apertura_utc ?? tr?.open_ts
    );
    const aperturaMs = explicitaMs && (!finMs || explicitaMs <= finMs) ? explicitaMs : null;
    const ordenReal = tr?.order_id || tr?.orden_id || tr?.testnet_order_id || null;
    return {
      ...tr,
      _aperturaMs: aperturaMs,
      _aperturaEstimada: false,
      _ordenTestnetId: ordenReal ? String(ordenReal) : '—',
    };
  });
}

/**
 * Formatea fecha/hora corta en español ("15 nov · 14:22"); devuelve "—" si falta.
 */
export function fmtFechaHoraBot(valor) {
  const ms = parseTsBotMs(valor);
  if (!ms) return '—';
  const d = new Date(ms);
  const fecha = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  const hora = d.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${fecha} · ${hora}`;
}

/**
 * Formatea duración legible entre apertura y cierre.
 */
export function fmtDuracionBot(entradaValor, cierreValor) {
  const ini = parseTsBotMs(entradaValor);
  const fin = parseTsBotMs(cierreValor);
  if (!ini || !fin || fin < ini) return '—';
  const totalSeg = Math.max(1, Math.round((fin - ini) / 1000));
  if (totalSeg < 60) return `${totalSeg} s`;
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  if (min < 60) return seg > 0 ? `${min}m ${seg}s` : `${min}m`;
  const hrs = Math.floor(min / 60);
  const remMin = min % 60;
  if (hrs < 24) return remMin > 0 ? `${hrs}h ${remMin}m` : `${hrs}h`;
  const dias = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${dias}d ${remHrs}h` : `${dias}d`;
}

/**
 * Formatea precios del bot con 4 decimales cuando el activo vale < $10 (ej. XRP, ADA) y 2 cuando >= $10.
 */
export function fmtPrecioBot(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return '0.00';
  const dec = n < 10 ? 4 : 2;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

/**
 * Explicación breve en español para una operación cerrada del bot.
 */
export function explicarTradeBotEs(tr) {
  const raw = String(tr?.motivo || '').trim();
  const up = raw.toUpperCase();
  if (up === 'TAKE PROFIT' || up.includes('TAKE PROFIT')) {
    return 'llegó al objetivo (Take Profit)';
  }
  if (up === 'STOP LOSS' || up.includes('STOP LOSS')) {
    return 'tocó el stop de protección (Stop Loss)';
  }
  if (esCierreManualBot(raw)) {
    return 'cierre manual (no cuenta para la estrategia)';
  }
  return raw ? `cierre por ${raw.toLowerCase()}` : 'cierre automático del bot';
}

/**
 * Calcula las métricas reales de desempeño a partir de las operaciones cerradas del bot.
 */
export function calcularMetricasRealesBot(trades = [], capitalInicial = CAPITAL_INICIAL_BOT_DEFAULT) {
  const capIni =
    Number(capitalInicial) > 0 ? Number(capitalInicial) : CAPITAL_INICIAL_BOT_DEFAULT;
  const total = trades.length;
  let ganadas = 0;
  let perdidas = 0;
  let sumaGan = 0;
  let sumaPerdAbs = 0;
  let pnlTotal = 0;
  let pnlSinManuales = 0;
  let opsSinManuales = 0;
  let longs = 0;
  let shorts = 0;
  const porEstrategia = {};

  for (const tr of trades) {
    const pnl = Number(tr?.pnl_usdt || 0);
    const lado = String(tr?.lado || '').toUpperCase();
    const est = String(tr?.estrategia || 'OTRA').toUpperCase();
    porEstrategia[est] = (porEstrategia[est] || 0) + 1;

    if (lado === 'LONG') longs += 1;
    else if (lado === 'SHORT') shorts += 1;

    pnlTotal += pnl;
    if (pnl > 0) {
      ganadas += 1;
      sumaGan += pnl;
    } else if (pnl < 0) {
      perdidas += 1;
      sumaPerdAbs += Math.abs(pnl);
    }

    if (!esCierreManualBot(tr?.motivo)) {
      opsSinManuales += 1;
      pnlSinManuales += pnl;
    }
  }

  const gananciaProm = ganadas > 0 ? sumaGan / ganadas : null;
  const perdidaProm = perdidas > 0 ? sumaPerdAbs / perdidas : null;
  const winRateReal = total > 0 ? (ganadas / total) * 100 : null;
  const winRateEquilibrio =
    gananciaProm !== null && perdidaProm !== null && gananciaProm + perdidaProm > 0
      ? (perdidaProm / (gananciaProm + perdidaProm)) * 100
      : null;
  const profitFactor =
    sumaPerdAbs > 0 ? sumaGan / sumaPerdAbs : sumaGan > 0 ? Infinity : null;

  return {
    total,
    ganadas,
    perdidas,
    longs,
    shorts,
    gananciaProm,
    perdidaProm,
    winRateReal,
    winRateEquilibrio,
    profitFactor,
    pnlTotal,
    pnlSinManuales,
    opsSinManuales,
    opsManuales: total - opsSinManuales,
    capitalInicial: capIni,
    saldoContable: capIni + pnlTotal,
    roiSimuladoPct: (pnlTotal / capIni) * 100,
    roiSinManualesPct: (pnlSinManuales / capIni) * 100,
    porEstrategia,
  };
}
