// Configuración global de trading y comisiones (Sección 5.0 bis)
// Versión preliminar sin comisiones: COMISION = 0
export const COMISION = 0;

export const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatearPnlConSigno(val) {
  const n = Number(val || 0);
  const absStr = fmtUSD.format(Math.abs(n));
  if (n > 0.0001) return `+${absStr}`;
  if (n < -0.0001) return `−${absStr}`;
  return absStr;
}

export function formatearPctConSigno(val) {
  const n = Number(val || 0);
  const absStr = `${Math.abs(n).toFixed(2)}%`;
  if (n > 0.0001) return `+${absStr}`;
  if (n < -0.0001) return `−${absStr}`;
  return `${n.toFixed(2)}%`;
}

export function calcularPnlPosicion({
  side = 'LONG',
  entrada = 0,
  actual = 0,
  precioActual = 0,
  cantidad = 0,
  margen = 0,
}) {
  const e = Number(entrada || 0);
  const a = Number(actual || precioActual || 0);
  const q = Number(cantidad || 0);
  const m = Number(margen || 0) || e * q;
  if (e <= 0 || a <= 0 || q <= 0) {
    return { pnlUSD: 0, pnlPct: 0 };
  }
  const esShort = String(side).toUpperCase() === 'SHORT';
  const pnlUSD = esShort ? (e - a) * q : (a - e) * q;
  const pnlPct = m > 0 ? (pnlUSD / m) * 100 : 0;
  return { pnlUSD, pnlPct };
}
