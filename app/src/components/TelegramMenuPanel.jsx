import React, { useState, useMemo } from 'react';
import {
  enviarComandoBot,
  enviarComandoYEsperar,
  consultarGemini,
} from '../services/firebase';

const TIMEFRAMES_META = {
  '1m': { label: '1 min' },
  '5m': { label: '5 min' },
  '15m': { label: '15 min' },
  '30m': { label: '30 min' },
  '1h': { label: '1 hour' },
  '4h': { label: '4 hours' },
  '1d': { label: '1 day' },
};

const ASSET_CLASSES_META = {
  CRYPTO: {
    label: 'Criptomonedas',
    singular: 'Cripto',
    icon: '🪙',
    risk: 'CAVIAR99',
    strat: 'CHARTISMO',
  },
  STOCK: {
    label: 'Acciones',
    singular: 'Acción',
    icon: '🏢',
    risk: 'CVAR99',
    strat: 'CHARTISMO',
  },
  ETF: {
    label: 'ETFs',
    singular: 'ETF',
    icon: '🧺',
    risk: 'VAR99',
    strat: 'EMA50_200',
  },
};

const RISK_MODELS_META = {
  VAR99: { label: 'VaR 99%', limit: 1.5, target: 'ETFs' },
  CVAR99: { label: 'CVaR 99%', limit: 2.2, target: 'Acciones' },
  CAVIAR99: { label: 'CAViaR 99%', limit: 1.5, target: 'Criptomonedas' },
};

const STRATEGIES_META = {
  RSI: '1° RSI Spot/Fut',
  EMA50_200: '2° EMA 50/200',
  BOLLINGER: '3° Bollinger',
  FIBONACCI: '4° Fibonacci+Abanicos',
  SUPERTREND: '5° SuperTrend',
  CHARTISMO: '6° Chartismo+Ruptura',
};

const CATALOG_BOT = {
  CRYPTO: [
    ['BTC_USDT', 'Bitcoin'],
    ['ETH_USDT', 'Ethereum'],
    ['SOL_USDT', 'Solana'],
    ['XRP_USDT', 'XRP'],
    ['BNB_USDT', 'BNB'],
    ['DOGE_USDT', 'Dogecoin'],
    ['ADA_USDT', 'Cardano'],
    ['AVAX_USDT', 'Avalanche'],
    ['LINK_USDT', 'Chainlink'],
    ['LTC_USDT', 'Litecoin'],
  ],
  STOCK: [
    ['NVDA', 'NVIDIA'],
    ['AAPL', 'Apple'],
    ['TSLA', 'Tesla'],
    ['MSFT', 'Microsoft'],
    ['AMZN', 'Amazon'],
    ['GOOGL', 'Alphabet'],
    ['META', 'Meta'],
    ['AMD', 'AMD'],
    ['NFLX', 'Netflix'],
    ['JPM', 'JPMorgan'],
  ],
  ETF: [
    ['SPY', 'S&P 500'],
    ['QQQ', 'Nasdaq 100'],
    ['IWM', 'Russell 2000'],
    ['DIA', 'Dow Jones'],
    ['GLD', 'Oro'],
    ['TLT', 'Bonos Tesoro 20+'],
    ['XLK', 'Tecnología'],
    ['EEM', 'Emergentes'],
  ],
};

const ASSETS_MAP = {};
Object.entries(CATALOG_BOT).forEach(([cls, items]) => {
  const cfg = ASSET_CLASSES_META[cls];
  items.forEach(([sym, name]) => {
    ASSETS_MAP[sym] = {
      type: cls,
      name,
      default_risk: cfg.risk,
      default_strat: cfg.strat,
      desc: `${name} (${cfg.singular} x10)`,
    };
  });
});

function fmt2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtSigned2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '+0.00';
  return (v >= 0 ? '+' : '') + fmt2(v);
}

/**
 * Normaliza filas de `bot/menu` (sea un arreglo de arreglos `[[{t,d}]]`
 * o un arreglo de objetos `{ botones: [{t,d}] }`).
 */
function normalizarFilas(rawFilas) {
  if (!rawFilas) return [];
  if (Array.isArray(rawFilas)) {
    return rawFilas
      .map((fila) => {
        if (Array.isArray(fila)) return fila;
        if (fila && Array.isArray(fila.botones)) return fila.botones;
        if (fila && typeof fila === 'object') return Object.values(fila);
        return [];
      })
      .filter((f) => f.length > 0);
  }
  if (typeof rawFilas === 'object') {
    return Object.values(rawFilas)
      .map((f) => (Array.isArray(f) ? f : f?.botones || Object.values(f || {})))
      .filter((f) => Array.isArray(f) && f.length > 0);
  }
  return [];
}

/**
 * Construye la estructura exacta de `bot/menu` a partir de `bot/estado`
 * cuando `bot/menu` aún no existe en Firestore o cuando `bot/estado` es más reciente.
 */
export function construirMenuDesdeEstado(estado, riskOverrideKey = null) {
  const sym = estado?.asset || 'BTC_USDT';
  const tf = estado?.timeframe || '15m';
  const tfLbl = TIMEFRAMES_META[tf]?.label || tf;
  const strat = estado?.strategy || 'CHARTISMO';
  const infoAsset = ASSETS_MAP[sym] || ASSETS_MAP.BTC_USDT;
  const clsKey = infoAsset.type || 'CRYPTO';
  const clsCfg = ASSET_CLASSES_META[clsKey] || ASSET_CLASSES_META.CRYPTO;
  const rkKey = riskOverrideKey || estado?.risk?.key || clsCfg.risk || 'CAVIAR99';
  const lev = Number(estado?.leverage || 10);
  const autoOn = Boolean(estado?.trading_enabled);

  const autoTxt = autoOn
    ? '🤖 Auto-Trading: 🟢 ENCENDIDO (Pausar)'
    : '🤖 Auto-Trading: 🔴 PAUSADO (Encender)';

  const sm = (key, txt) => (strat === key ? `${txt} ✅` : txt);
  const rm = (key, txt) => (rkKey === key ? `${txt} ✅` : txt);

  const rkObj = estado?.risk || {};
  const rkLabel = RISK_MODELS_META[rkKey]?.label || rkObj.label || 'CAViaR 99%';
  const rkLimit = RISK_MODELS_META[rkKey]?.limit ?? rkObj.limit ?? 1.5;
  const rkItem =
    (Array.isArray(rkObj.all) &&
      rkObj.all.find((x) => x.label === rkLabel)) ||
    rkObj;
  const rkVal = Number(rkItem?.val ?? rkObj.val ?? 0);
  const rkBlocked = Boolean(rkItem?.blocked ?? rkObj.blocked);

  const semTxt = rkBlocked
    ? `🔴 BLOQUEADO: ${rkLabel} ${fmt2(rkVal)}% > ${fmt2(rkLimit)}%`
    : `🟢 HABILITADO: ${rkLabel} ${fmt2(rkVal)}% <= ${fmt2(rkLimit)}%`;

  const longTxt = rkBlocked
    ? '🔴 Long BLOQUEADO (riesgo)'
    : `🟢 Comprar / Long (x${lev})`;

  const principal = [
    [{ t: autoTxt, d: 'ACT:TOGGLE_AUTO' }],
    [
      { t: `⏱️ 1) Temporalidad: ${tfLbl}`, d: 'MENU:TF' },
      { t: `${clsCfg.icon} 2) Activo: ${sym}`, d: 'MENU:ASSET' },
    ],
    [{ t: semTxt, d: 'ACT:REFRESH_RISK' }],
    [
      { t: longTxt, d: 'ACT:BUY_LONG' },
      { t: '🟠 Vender / Cerrar Posición', d: 'ACT:CLOSE_OR_SHORT' },
    ],
    [
      { t: '📊 Reporte de Bot + Gráfico', d: 'ACT:REPORT_CHART' },
      { t: `💰 Saldo y Posiciones (x${lev})`, d: 'ACT:BALANCE' },
    ],
    [
      { t: '📜 Últimos Trades', d: 'ACT:TRADES' },
      { t: '📁 Excel + Histórico', d: 'ACT:EXCEL' },
    ],
    [
      { t: '🏆 Reporte Winrate', d: 'ACT:WINRATE' },
      { t: '🧪 Test Diebold-Mariano (RF)', d: 'ACT:DM' },
    ],
    [
      { t: `🎯 ${sm('RSI', '1° RSI')}`, d: 'STRAT:RSI' },
      { t: `📈 ${sm('EMA50_200', '2° EMA 50/200')}`, d: 'STRAT:EMA50_200' },
    ],
    [
      { t: `📉 ${sm('BOLLINGER', '3° Bollinger')}`, d: 'STRAT:BOLLINGER' },
      { t: `📐 ${sm('FIBONACCI', '4° Fibonacci+Abanicos')}`, d: 'STRAT:FIBONACCI' },
    ],
    [
      { t: `🚀 ${sm('SUPERTREND', '5° SuperTrend')}`, d: 'STRAT:SUPERTREND' },
      { t: `📐 ${sm('CHARTISMO', '6° Chartismo+Ruptura')}`, d: 'STRAT:CHARTISMO' },
    ],
    [
      { t: `🛡️ ${rm('VAR99', 'VaR ETF >1.5%')}`, d: 'RISK:VAR99' },
      { t: `🛡️ ${rm('CVAR99', 'CVaR Acc >2.2%')}`, d: 'RISK:CVAR99' },
      { t: `🛡️ ${rm('CAVIAR99', 'CAViaR Cripto >1.5%')}`, d: 'RISK:CAVIAR99' },
    ],
    [{ t: '🧠 Analizar con Gemini Flash (AI Studio)', d: 'ACT:GEMINI' }],
  ];

  // Submenú de temporalidades (3 por fila + volver)
  const temporalidades = [];
  let rowTf = [];
  Object.entries(TIMEFRAMES_META).forEach(([k, v]) => {
    const mk = k === tf ? '✅ ' : '';
    rowTf.push({ t: `${mk}${v.label}`, d: `SETTF:${k}` });
    if (rowTf.length === 3) {
      temporalidades.push(rowTf);
      rowTf = [];
    }
  });
  if (rowTf.length > 0) temporalidades.push(rowTf);
  temporalidades.push([{ t: '⬅️ Volver al Panel Principal', d: 'MENU:MAIN' }]);

  // Submenú de clases
  const clases = Object.entries(ASSET_CLASSES_META).map(([cls, cfg]) => {
    const mk = cls === clsKey ? '✅ ' : '';
    const count = CATALOG_BOT[cls]?.length || 0;
    const rkModel = RISK_MODELS_META[cfg.risk];
    return [
      {
        t: `${mk}${cfg.icon} ${cfg.label} (${count}) — ${rkModel.label}`,
        d: `CLASS:${cls}`,
      },
    ];
  });
  clases.push([{ t: '⬅️ Volver al Panel Principal', d: 'MENU:MAIN' }]);

  // Submenús de activos por clase (2 por fila)
  const activos = {};
  Object.entries(CATALOG_BOT).forEach(([cls, items]) => {
    const cfg = ASSET_CLASSES_META[cls];
    const filasCls = [];
    let par = [];
    items.forEach(([s, name]) => {
      const mk = s === sym ? '✅ ' : '';
      const short = s.replace('_USDT', '');
      par.push({ t: `${mk}${short} · ${name}`, d: `SETASSET:${s}` });
      if (par.length === 2) {
        filasCls.push(par);
        par = [];
      }
    });
    if (par.length > 0) filasCls.push(par);
    filasCls.push([{ t: '⬅️ Cambiar clase de activo', d: 'MENU:ASSET' }]);
    filasCls.push([{ t: '⬅️ Volver al Panel Principal', d: 'MENU:MAIN' }]);
    activos[cls] = {
      label: cfg.label,
      icon: cfg.icon,
      filas: filasCls,
    };
  });

  return {
    titulo: `🎛️ PANEL QUANT x${lev} — ${sym} (${clsCfg.label}) | ${tfLbl}`,
    principal,
    temporalidades,
    clases,
    activos,
    ts: estado?.ts || Date.now() / 1000,
  };
}

/**
 * Genera en un `<canvas>` una imagen PNG en base64 con el gráfico cuantitativo
 * (velas + niveles + curva de filtro de riesgo VaR/CVaR/CAViaR) como respaldo
 * cuando `ACT:REPORT_CHART` se pulsa y `telegram_espejo` aún no trae `adjunto_b64`.
 */
function generarGraficoReporteBase64(estado, velasDoc) {
  try {
    const candles = Array.isArray(velasDoc?.candles)
      ? velasDoc.candles.slice(-100)
      : [];
    if (candles.length < 5) return null;

    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 560;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fondo institucional claro estilo matplotlib del bot
    ctx.fillStyle = '#0f1420';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sym = estado?.asset || velasDoc?.asset || 'BTC_USDT';
    const tf = estado?.timeframe || velasDoc?.tf || '15m';
    const stratLbl =
      STRATEGIES_META[estado?.strategy] ||
      estado?.strategy_label ||
      '6° Chartismo+Ruptura';
    const r = estado?.risk || {};

    // Encabezado
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 16px Inter, system-ui, sans-serif';
    ctx.fillText(
      `📊 REPORTE GRÁFICO QUANT x${estado?.leverage || 10} — ${sym} (${tf}) | ${stratLbl}`,
      28,
      32
    );
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px Inter, system-ui, sans-serif';
    ctx.fillText(
      `Señal: ${estado?.signal_now || 'HOLD'} — ${estado?.signal_text || ''}`,
      28,
      54
    );

    // Panel 1: Velas (y: 72 -> 375)
    const p1 = { x: 64, y: 72, w: 860, h: 295 };
    ctx.fillStyle = '#131926';
    ctx.fillRect(p1.x, p1.y, p1.w, p1.h);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(p1.x, p1.y, p1.w, p1.h);

    let minP = Infinity;
    let maxP = -Infinity;
    candles.forEach((c) => {
      if (c.l < minP) minP = c.l;
      if (c.h > maxP) maxP = c.h;
    });
    const padP = Math.max(1e-6, (maxP - minP) * 0.08);
    minP -= padP;
    maxP += padP;

    const yPrice = (val) =>
      p1.y + p1.h - ((val - minP) / Math.max(1e-9, maxP - minP)) * p1.h;

    // Líneas horizontales de grilla
    for (let g = 0; g <= 4; g += 1) {
      const yg = p1.y + (p1.h * g) / 4;
      const pv = maxP - ((maxP - minP) * g) / 4;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.beginPath();
      ctx.moveTo(p1.x, yg);
      ctx.lineTo(p1.x + p1.w, yg);
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillText(fmt2(pv), 8, yg + 4);
    }

    const stepX = p1.w / candles.length;
    const bodyW = Math.max(2, stepX * 0.64);

    // Directrices de soporte y resistencia recientes
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);
    const resRec = Math.max(...highs.slice(-35));
    const supRec = Math.min(...lows.slice(-35));

    ctx.strokeStyle = '#ef4444';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(p1.x + p1.w * 0.45, yPrice(resRec));
    ctx.lineTo(p1.x + p1.w, yPrice(resRec));
    ctx.stroke();

    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();
    ctx.moveTo(p1.x + p1.w * 0.45, yPrice(supRec));
    ctx.lineTo(p1.x + p1.w, yPrice(supRec));
    ctx.stroke();
    ctx.setLineDash([]);

    // Dibujar velas
    candles.forEach((c, idx) => {
      const cx = p1.x + idx * stepX + stepX / 2;
      const alcista = c.c >= c.o;
      const color = alcista ? '#22c55e' : '#ef4444';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      ctx.beginPath();
      ctx.moveTo(cx, yPrice(c.h));
      ctx.lineTo(cx, yPrice(c.l));
      ctx.stroke();

      const yTop = yPrice(Math.max(c.o, c.c));
      const yBot = yPrice(Math.min(c.o, c.c));
      ctx.fillRect(
        cx - bodyW / 2,
        yTop,
        bodyW,
        Math.max(1.5, yBot - yTop)
      );
    });

    // Media móvil rápida (EMA 20 aprox)
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    let ema = candles[0].c;
    const k = 2 / 21;
    candles.forEach((c, idx) => {
      ema = c.c * k + ema * (1 - k);
      const cx = p1.x + idx * stepX + stepX / 2;
      const cy = yPrice(ema);
      if (idx === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();

    // Panel 2: Filtro de Riesgo Institucional (y: 405 -> 530)
    const p2 = { x: 64, y: 405, w: 860, h: 120 };
    ctx.fillStyle = '#131926';
    ctx.fillRect(p2.x, p2.y, p2.w, p2.h);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(p2.x, p2.y, p2.w, p2.h);

    const lim = Number(r.limit || 1.5);
    const valActual = Number(r.val || 0.7);
    const yMaxRisk = Math.max(lim * 1.6, valActual * 1.3, 2.5);
    const yRisk = (v) =>
      p2.y + p2.h - (Math.min(yMaxRisk, Math.max(0, v)) / yMaxRisk) * p2.h;

    const yLim = yRisk(lim);
    // Zona roja arriba del límite y verde debajo
    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    ctx.fillRect(p2.x, p2.y, p2.w, Math.max(0, yLim - p2.y));
    ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
    ctx.fillRect(p2.x, yLim, p2.w, Math.max(0, p2.y + p2.h - yLim));

    // Línea de límite
    ctx.strokeStyle = '#ef4444';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(p2.x, yLim);
    ctx.lineTo(p2.x + p2.w, yLim);
    ctx.stroke();
    ctx.setLineDash([]);

    // Curva de volatilidad/riesgo por vela
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    candles.forEach((c, idx) => {
      const rngPct = ((c.h - c.l) / Math.max(1e-9, c.c)) * 100;
      const rEst = valActual * 0.65 + rngPct * 0.35;
      const cx = p2.x + idx * stepX + stepX / 2;
      const cy = yRisk(rEst);
      if (idx === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();

    ctx.fillStyle = r.blocked ? '#f87171' : '#4ade80';
    ctx.font = 'bold 13px Inter, system-ui, sans-serif';
    ctx.fillText(
      `Filtro de Riesgo (${r.label || 'CAViaR 99%'}): ${fmt2(valActual)}% (Límite ${fmt2(lim)}%) ➔ ${
        r.blocked ? 'ROJO: BLOQUEADO' : 'VERDE: HABILITADO'
      }`,
      p2.x,
      p2.y - 8
    );

    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } catch (err) {
    console.error('Error generando gráfico de respaldo:', err);
    return null;
  }
}

/**
 * Genera un archivo Excel (.xls XML Spreadsheet compatible con Microsoft Excel / Numbers / Sheets)
 * en base64 con las 3 hojas (`Historico`, `Metricas_Riesgo` y `Trades_x10`) si `telegram_espejo`
 * aún no contiene el adjunto binario del bot.
 */
function generarExcelBase64Respaldo(estado, velasDoc, trades = []) {
  const sym = estado?.asset || 'BTC_USDT';
  const tf = estado?.timeframe || '15m';
  const candles = Array.isArray(velasDoc?.candles) ? velasDoc.candles.slice(-150) : [];
  const riesgos = Array.isArray(estado?.risk?.all) ? estado.risk.all : [];

  const esc = (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const filasVelas = candles
    .map((c) => {
      const iso = new Date(Number(c.t) * 1000).toISOString();
      return `<Row><Cell><Data ss:Type="String">${esc(iso)}</Data></Cell><Cell><Data ss:Type="Number">${Number(
        c.o
      )}</Data></Cell><Cell><Data ss:Type="Number">${Number(c.h)}</Data></Cell><Cell><Data ss:Type="Number">${Number(
        c.l
      )}</Data></Cell><Cell><Data ss:Type="Number">${Number(c.c)}</Data></Cell></Row>`;
    })
    .join('');

  const filasRiesgo = riesgos
    .map(
      (r) =>
        `<Row><Cell><Data ss:Type="String">${esc(r.label)}</Data></Cell><Cell><Data ss:Type="Number">${Number(
          r.val || 0
        )}</Data></Cell><Cell><Data ss:Type="Number">${Number(
          r.limit || 0
        )}</Data></Cell><Cell><Data ss:Type="String">${
          r.blocked ? 'BLOQUEADO' : 'HABILITADO'
        }</Data></Cell><Cell><Data ss:Type="String">${esc(r.target)}</Data></Cell></Row>`
    )
    .join('');

  const filasTrades = trades
    .map(
      (t) =>
        `<Row><Cell><Data ss:Type="String">${esc(
          new Date(Number(t.ts || Date.now())).toISOString()
        )}</Data></Cell><Cell><Data ss:Type="String">${esc(t.activo)}</Data></Cell><Cell><Data ss:Type="String">${esc(
          t.lado
        )}</Data></Cell><Cell><Data ss:Type="String">${esc(
          t.estrategia
        )}</Data></Cell><Cell><Data ss:Type="Number">${Number(
          t.entrada || 0
        )}</Data></Cell><Cell><Data ss:Type="Number">${Number(
          t.salida || 0
        )}</Data></Cell><Cell><Data ss:Type="Number">${Number(
          t.roe_pct || 0
        )}</Data></Cell><Cell><Data ss:Type="Number">${Number(
          t.pnl_usdt || 0
        )}</Data></Cell><Cell><Data ss:Type="String">${esc(t.motivo)}</Data></Cell></Row>`
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Historico_${esc(sym).slice(0, 20)}">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">fecha_utc</Data></Cell>
    <Cell><Data ss:Type="String">open</Data></Cell>
    <Cell><Data ss:Type="String">high</Data></Cell>
    <Cell><Data ss:Type="String">low</Data></Cell>
    <Cell><Data ss:Type="String">close</Data></Cell>
   </Row>
   ${filasVelas}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="Metricas_Riesgo">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">label</Data></Cell>
    <Cell><Data ss:Type="String">val_pct</Data></Cell>
    <Cell><Data ss:Type="String">limit_pct</Data></Cell>
    <Cell><Data ss:Type="String">estado</Data></Cell>
    <Cell><Data ss:Type="String">target</Data></Cell>
   </Row>
   ${filasRiesgo}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="Trades_x10">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">fecha_utc</Data></Cell>
    <Cell><Data ss:Type="String">activo</Data></Cell>
    <Cell><Data ss:Type="String">lado</Data></Cell>
    <Cell><Data ss:Type="String">estrategia</Data></Cell>
    <Cell><Data ss:Type="String">entrada</Data></Cell>
    <Cell><Data ss:Type="String">salida</Data></Cell>
    <Cell><Data ss:Type="String">roe_pct</Data></Cell>
    <Cell><Data ss:Type="String">pnl_usdt</Data></Cell>
    <Cell><Data ss:Type="String">motivo</Data></Cell>
   </Row>
   ${filasTrades}
  </Table>
 </Worksheet>
</Workbook>`;

  const bytes = new TextEncoder().encode(xml);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  const tsStr = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return {
    b64: btoa(bin),
    tipo: 'application/vnd.ms-excel',
    nombre: `Quant_x10_${sym}_${tf}_${tsStr}.xls`,
  };
}

export function descargarBase64Archivo(b64, mimeType, filename) {
  try {
    const byteCharacters = atob(b64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i += 1) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], {
      type:
        mimeType ||
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'Quant_x10_Reporte.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (err) {
    console.error('Error descargando archivo:', err);
  }
}

export default function TelegramMenuPanel({
  uid,
  menuDoc,
  estado,
  velas,
  winrateDoc,
  dmDoc,
  trades = [],
  mensajesTg = [],
  onToast,
  onAbrirWinrate,
  onAbrirDM,
  botDesconectado = false,
}) {
  // Vista actual del menú: 'principal' | 'temporalidades' | 'clases' | 'activos:CRYPTO' | 'activos:STOCK' | 'activos:ETF'
  const [vistaMenu, setVistaMenu] = useState('principal');
  const [subtituloPaso, setSubtituloPaso] = useState('');
  const [riskOverride, setRiskOverride] = useState(null);

  // Estado de carga y respuesta de botón
  const [botonCargando, setBotonCargando] = useState(null);
  const [confirmacionPendiente, setConfirmacionPendiente] = useState(null); // { d, t }
  const [respuestaPanel, setRespuestaPanel] = useState(null);
  // { comando, etiqueta, texto, mostrarImagen, imagenOverrideB64, mostrarExcel, excelOverride, mostrarGeminiInput }

  // Estado para pregunta adicional a Gemini tras pulsar ACT:GEMINI
  const [preguntaExtraGemini, setPreguntaExtraGemini] = useState('');
  const [enviandoExtraGemini, setEnviandoExtraGemini] = useState(false);

  // Construimos el menú efectivo: usamos `bot/menu` si existe y sus filas son válidas,
  // o sincronizamos con `construirMenuDesdeEstado(estado)` cuando `bot/estado` es más reciente.
  const menuEfectivo = useMemo(() => {
    const generado = construirMenuDesdeEstado(estado, riskOverride);
    if (!menuDoc) return generado;

    const tsMenu = Number(menuDoc.ts || 0);
    const tsEstado = Number(estado?.ts || 0);
    if (tsEstado > tsMenu + 2 || riskOverride) {
      return generado;
    }

    const principalNorm = normalizarFilas(menuDoc.principal);
    if (principalNorm.length === 0) return generado;

    const activosNorm = {};
    Object.keys(ASSET_CLASSES_META).forEach((cls) => {
      const rawCls = menuDoc.activos?.[cls];
      const filasCls = normalizarFilas(rawCls?.filas);
      activosNorm[cls] = {
        label: rawCls?.label || generado.activos[cls].label,
        icon: rawCls?.icon || generado.activos[cls].icon,
        filas: filasCls.length > 0 ? filasCls : generado.activos[cls].filas,
      };
    });

    return {
      titulo: menuDoc.titulo || generado.titulo,
      principal: principalNorm,
      temporalidades:
        normalizarFilas(menuDoc.temporalidades).length > 0
          ? normalizarFilas(menuDoc.temporalidades)
          : generado.temporalidades,
      clases:
        normalizarFilas(menuDoc.clases).length > 0
          ? normalizarFilas(menuDoc.clases)
          : generado.clases,
      activos: activosNorm,
      ts: tsMenu,
    };
  }, [menuDoc, estado, riskOverride]);

  // Filas que se muestran según `vistaMenu`
  const filasVisibles = useMemo(() => {
    if (vistaMenu === 'temporalidades') return menuEfectivo.temporalidades;
    if (vistaMenu === 'clases') return menuEfectivo.clases;
    if (vistaMenu.startsWith('activos:')) {
      const cls = vistaMenu.split(':')[1];
      return menuEfectivo.activos?.[cls]?.filas || menuEfectivo.principal;
    }
    return menuEfectivo.principal;
  }, [vistaMenu, menuEfectivo]);

  // Buscar el último adjunto de foto y de archivo en `telegram_espejo`
  const ultimaFotoEspejo = useMemo(() => {
    for (let i = mensajesTg.length - 1; i >= 0; i -= 1) {
      const m = mensajesTg[i];
      if (m.tipo === 'foto' && m.adjunto_b64) return m;
    }
    return null;
  }, [mensajesTg]);

  const ultimoArchivoEspejo = useMemo(() => {
    for (let i = mensajesTg.length - 1; i >= 0; i -= 1) {
      const m = mensajesTg[i];
      if (m.tipo === 'archivo' && m.adjunto_b64) return m;
    }
    return null;
  }, [mensajesTg]);

  /**
   * Genera la respuesta de respaldo exacta del bot y dispara el comando subyacente
   * cuando el proceso del bot en ejecución aún no ha sido reiniciado con el handler `tipo: "telegram"`.
   */
  const ejecutarRespaldoBoton = async (d) => {
    const sym = estado?.asset || 'BTC_USDT';
    const tf = estado?.timeframe || '15m';
    const lev = Number(estado?.leverage || 10);

    if (d.startsWith('SETTF:')) {
      const ntf = d.split(':')[1];
      const lbl = TIMEFRAMES_META[ntf]?.label || ntf;
      await enviarComandoBot(uid, 'tf', ntf);
      return {
        texto: [
          `Temporalidad: ${lbl}`,
          ``,
          `✅ Temporalidad fijada en ${lbl}.`,
          ``,
          `🌐 PASO 2: Selecciona la clase de activo.`,
          `El filtro de riesgo se adapta solo:`,
          `• 🪙 Criptomonedas ➔ CAViaR 99% (bloquea si > 1.50%)`,
          `• 🏢 Acciones ➔ CVaR 99% (bloquea si > 2.20%)`,
          `• 🧺 ETFs ➔ VaR 99% (bloquea si > 1.50%)`,
        ].join('\n'),
      };
    }

    if (d.startsWith('SETASSET:')) {
      const nSym = d.split(':')[1];
      const info = ASSETS_MAP[nSym] || {
        type: 'CRYPTO',
        name: nSym,
        default_risk: 'CAVIAR99',
        default_strat: 'CHARTISMO',
        desc: `${nSym} (x10)`,
      };
      setRiskOverride(null);
      await enviarComandoBot(uid, 'activo', nSym);
      const rkName = RISK_MODELS_META[info.default_risk]?.label || 'CAViaR 99%';
      const stName = STRATEGIES_META[info.default_strat] || '6° Chartismo+Ruptura';
      const clsLbl = ASSET_CLASSES_META[info.type]?.label || 'Criptomonedas';
      const tfLbl = TIMEFRAMES_META[tf]?.label || tf;
      return {
        texto: [
          `${nSym} -> ${rkName}`,
          ``,
          `✅ Activo: ${nSym} (${info.desc}) | ⏱️ ${tfLbl}`,
          `🛡️ Riesgo adaptado a ${clsLbl}: ${rkName}`,
          `📐 Estrategia adaptada: ${stName}`,
        ].join('\n'),
      };
    }

    if (d.startsWith('STRAT:')) {
      const sk = d.split(':')[1];
      const stLbl = STRATEGIES_META[sk] || sk;
      await enviarComandoBot(uid, 'estrategia', sk);
      return {
        texto: `Estrategia activa: ${stLbl}\n\n🌐 Actualizado desde la app\n🎛️ PANEL QUANT x${lev} — ${sym} | ${
          TIMEFRAMES_META[tf]?.label || tf
        }`,
      };
    }

    if (d.startsWith('RISK:')) {
      const rk = d.split(':')[1];
      setRiskOverride(rk);
      const rkInfo = RISK_MODELS_META[rk] || RISK_MODELS_META.CAVIAR99;
      const defRisk = ASSETS_MAP[sym]?.default_risk || 'CAVIAR99';
      const aviso =
        rk === defRisk
          ? ''
          : ` (recomendado para este activo: ${RISK_MODELS_META[defRisk]?.label})`;
      return {
        texto: `Filtro de riesgo: ${rkInfo.label}${aviso}\n\n🛡️ Umbral activo fijado en ${fmt2(
          rkInfo.limit
        )}% (${rkInfo.target}).`,
      };
    }

    if (d === 'ACT:REFRESH_RISK') {
      const r = estado?.risk || {};
      const todas = Array.isArray(r.all) ? r.all : [];
      const detalle = todas
        .map(
          (item) =>
            `• ${item.label} (${item.target}): ${fmt2(item.val)}% / Lím ${fmt2(
              item.limit
            )}% ➔ ${item.blocked ? '🔴 BLOQUEADO' : '🟢 HABILITADO'}`
        )
        .join('\n');
      return {
        texto: [
          `🚦 SEMÁFORO DE RIESGO ACTUALIZADO — ${sym} (${TIMEFRAMES_META[tf]?.label || tf})`,
          `• Métrica activa: ${r.label || 'CAViaR 99%'} = ${fmt2(r.val)}% (umbral ${fmt2(r.limit)}%)`,
          `• Estado operativo: ${r.blocked ? '🔴 BLOQUEADO POR RIESGO' : '🟢 LISTO PARA OPERAR'}`,
          ``,
          `Detalle de las 3 métricas al 99%:`,
          detalle,
        ].join('\n'),
      };
    }

    if (d === 'ACT:TOGGLE_AUTO') {
      const nuevoEstado = !estado?.trading_enabled;
      await enviarComandoBot(uid, 'toggle', null);
      return {
        texto: `Auto-Trading ${nuevoEstado ? 'ENCENDIDO 🟢' : 'PAUSADO 🔴'}`,
      };
    }

    if (d === 'ACT:BUY_LONG') {
      const res = await enviarComandoYEsperar(uid, 'long', null, 20000);
      return {
        texto: res.resultado || 'Orden LONG enviada al bot.',
      };
    }

    if (d === 'ACT:CLOSE_OR_SHORT') {
      const tipoCmd = estado?.position ? 'cerrar' : 'short';
      const res = await enviarComandoYEsperar(uid, tipoCmd, null, 20000);
      return {
        texto: res.resultado || `Orden ${tipoCmd.toUpperCase()} enviada al bot.`,
      };
    }

    if (d === 'ACT:BALANCE') {
      const pos = estado?.position;
      const spot = Number(estado?.price || 0);
      let pInfo = '📭 Sin posiciones abiertas actualmente.';
      if (pos) {
        const dir = pos.side === 'SHORT' ? -1 : 1;
        const margin = Number(pos.margin_usdt || 100);
        const pLev = Number(pos.leverage || lev);
        const entry = Number(pos.entry || spot);
        const upnl =
          entry > 0 ? margin * pLev * ((spot - entry) / entry) * dir : 0;
        const uroe = entry > 0 ? ((spot - entry) / entry) * dir * pLev * 100 : 0;
        pInfo = [
          `📌 Posición Abierta: ${pos.asset} ${pos.side} x${pLev}`,
          `• Entrada: ${fmt2(entry)} | Actual: ${fmt2(spot)}`,
          `• PnL Flotante: ${fmtSigned2(upnl)} USDT (${fmtSigned2(uroe)}% ROE)`,
          `• TP: ${fmt2(pos.tp)} | SL: ${fmt2(pos.sl)} | Liq: ${fmt2(pos.liq)}`,
        ].join('\n');
      }
      return {
        texto: [
          `💰 SALDO Y POSICIONES (Apalancamiento x${lev})`,
          `• Saldo Disponible: $${fmt2(estado?.balance ?? 1000)} USDT`,
          `• PnL Realizado Acumulado: ${fmtSigned2(estado?.realized_pnl ?? 0)} USDT`,
          `• Margen por Trade: $100 (Exposición $${100 * lev})`,
          ``,
          pInfo,
        ].join('\n'),
      };
    }

    if (d === 'ACT:TRADES') {
      if (!trades || trades.length === 0) {
        return { texto: '📜 Aún no hay trades cerrados.' };
      }
      const ultimos = trades.slice(0, 8).map((r) => {
        const pnl = Number(r.pnl_usdt || 0);
        const roe = Number(r.roe_pct || 0);
        return `• ${r.activo} ${r.lado} x10: ${fmtSigned2(pnl)} USDT (${
          roe >= 0 ? '+' : ''
        }${roe.toFixed(1)}%) [${r.motivo}]`;
      });
      return {
        texto: ['📜 ÚLTIMOS TRADES CERRADOS:', ...ultimos].join('\n'),
      };
    }

    if (d === 'ACT:WINRATE') {
      if (onAbrirWinrate) onAbrirWinrate();
      if (!winrateDoc || !winrateDoc.n) {
        return { texto: '🏆 REPORTE WINRATE\nAún no hay trades cerrados.' };
      }
      const porEstrategia = (winrateDoc.por || [])
        .filter((p) => p.grupo === 'estrategia')
        .map(
          (p) =>
            `• ${p.nombre}: ${Number(p.winrate || 0).toFixed(1)}% en ${
              p.n
            } trades (${fmtSigned2(p.pnl)} USDT)`
        );
      const racha = (winrateDoc.ultimos || [])
        .map((v) => (Number(v) === 1 ? '🟢' : '🔴'))
        .join('');
      const lin = [
        `🏆 REPORTE WINRATE (${winrateDoc.n} trades cerrados)`,
        `• Winrate: ${Number(winrateDoc.winrate || 0).toFixed(1)}% (${
          winrateDoc.ganadores
        } ganados / ${winrateDoc.perdedores} perdidos)`,
        `• PnL total: ${fmtSigned2(winrateDoc.pnl_total)} USDT | ROE promedio: ${fmtSigned2(
          winrateDoc.roe_promedio
        )}%`,
        `• Ganancia promedio: ${fmtSigned2(
          winrateDoc.promedio_ganador
        )} | Pérdida promedio: ${fmtSigned2(winrateDoc.promedio_perdedor)} USDT`,
        `• Profit factor: ${
          winrateDoc.profit_factor !== null && winrateDoc.profit_factor !== undefined
            ? fmt2(winrateDoc.profit_factor)
            : 'n/d (sin pérdidas)'
        } | Caída máxima: ${fmtSigned2(winrateDoc.max_drawdown)} USDT`,
        `• Mejor: ${fmtSigned2(winrateDoc.mejor)} | Peor: ${fmtSigned2(
          winrateDoc.peor
        )} USDT`,
        `• Últimos 10: ${racha}`,
        ``,
        `Por estrategia:`,
        ...porEstrategia,
      ];
      if (Number(winrateDoc.n) < 20) {
        lin.push(
          ``,
          `⚠️ Muestra pequeña (${winrateDoc.n} trades): el winrate aún no es concluyente.`
        );
      }
      return { texto: lin.join('\n') };
    }

    if (d === 'ACT:DM') {
      if (onAbrirDM) onAbrirDM();
      await enviarComandoBot(uid, 'dm', null);
      const v = dmDoc?.velas;
      const tr = dmDoc?.trades;
      const rc = dmDoc?.rf_vs_catboost;
      const lin = [
        `🧪 TEST DIEBOLD-MARIANO — Random Forest y CatBoost`,
        `${dmDoc?.asset || sym} · ${dmDoc?.tf || tf}`,
        ``,
        v
          ? [
              `A) Velas fuera de muestra (${v.n} velas, horizonte ${v.horizonte}, mejor modelo: ${
                v.modelo || 'Random Forest'
              }):`,
              `• DM = ${fmtSigned2(v.dm)} | p-valor = ${Number(v.p || 0).toFixed(4)}`,
              `• RMSE = ${Number(v.rmse_rf || 0).toFixed(4)} (${v.arboles} árboles, prof ${v.prof})`,
            ].join('\n')
          : 'A) Calculando validación en velas fuera de muestra...',
        ``,
        tr?.suficiente
          ? [
              `B) Últimos trades (${tr.n} con predicción guardada):`,
              `• DM = ${fmtSigned2(tr.dm)} | p-valor = ${Number(tr.p || 0).toFixed(4)}`,
              `• Error medio del objetivo RF: ${fmt2(
                tr.mae_rf_pct
              )}% | modelo ingenuo: ${fmt2(tr.mae_rw_pct)}%`,
            ].join('\n')
          : `B) Últimos trades: se necesitan al menos 8 trades cerrados para el test (van ${
              tr?.n ?? 0
            }).`,
        ``,
        `C) Random Forest vs CatBoost (velas fuera de muestra):`,
        rc
          ? `• RMSE RF: ${fmt2(rc.rmse_rf)} | RMSE CatBoost: ${fmt2(
              rc.rmse_cat
            )}\n• DM = ${fmtSigned2(rc.dm)} | p-valor = ${Number(rc.p || 0).toFixed(
              4
            )} → ${rc.ganador}`
          : '• CatBoost no está instalado en la VM o aún se está calculando.',
      ];
      return { texto: lin.join('\n') };
    }

    if (d === 'ACT:REPORT_CHART') {
      const r = estado?.risk || {};
      const todas = Array.isArray(r.all) ? r.all : [];
      const precio = Number(estado?.price || 0);
      const tpSug = estado?.position?.tp || precio * 1.032;
      const slSug = estado?.position?.sl || precio * 0.982;
      const liqLong = precio * (1 - 1 / lev + 0.005);
      const liqShort = precio * (1 + 1 / lev - 0.005);

      const b64Chart = generarGraficoReporteBase64(estado, velas);
      const repTxt = [
        `📊 Gráfico generado (míralo abajo y en el espejo de Telegram).`,
        ``,
        `📊 REPORTE QUANT x${lev} — ${sym} (${estado?.asset_name || sym})`,
        `⏱️ Temporalidad: ${TIMEFRAMES_META[tf]?.label || tf} | 💰 Precio: $${fmt2(precio)}`,
        `🤖 Auto-Trading: ${estado?.trading_enabled ? 'ENCENDIDO 🟢' : 'PAUSADO 🔴'}`,
        ``,
        `🛡️ FILTRO DE RIESGO ACTIVO (${r.label || 'CAViaR 99%'}):`,
        `• Estado: ${r.blocked ? '🔴 BLOQUEADO POR RIESGO' : '🟢 LISTO PARA OPERAR'}`,
        ...todas.map(
          (m) =>
            `  ${m.label === r.label ? '👉' : '•'} ${m.label}: ${fmt2(
              m.val
            )}% (Lím ${fmt2(m.limit)}%) [${m.blocked ? '🔴' : '🟢'}] — ${m.target}`
        ),
        ``,
        `📐 ESTRATEGIA ACTIVA — ${
          STRATEGIES_META[estado?.strategy] || estado?.strategy_label || 'Chartismo'
        }:`,
        `• Señal actual: ${estado?.signal_now || 'HOLD'}`,
        `• Lectura técnica: ${estado?.signal_text || 'En formación'}`,
        ``,
        `🌲 RANDOM FOREST (Objetivos dinámicos de volatilidad):`,
        `• Si abres LONG x${lev}: TP $${fmt2(tpSug)} | SL $${fmt2(
          slSug
        )} | Liquidación $${fmt2(liqLong)}`,
        `• Si abres SHORT x${lev}: TP $${fmt2(
          precio * 0.968
        )} | SL $${fmt2(precio * 1.018)} | Liquidación $${fmt2(liqShort)}`,
      ].join('\n');

      return {
        texto: repTxt,
        imagenOverrideB64: b64Chart,
      };
    }

    if (d === 'ACT:EXCEL') {
      const excelGen = generarExcelBase64Respaldo(estado, velas, trades);
      return {
        texto: `📁 Archivo generado: ${excelGen.nombre}\n\n✅ Histórico y métricas exportados.`,
        excelOverride: excelGen,
      };
    }

    if (d === 'ACT:GEMINI') {
      const resGem = await consultarGemini({
        uid,
        pregunta: '',
        contexto: 'BOT',
        estadoBot: estado,
      });
      return {
        texto: [
          `🧠 ANÁLISIS GEMINI FLASH (${sym} x${lev}):`,
          ``,
          resGem.respuesta,
          ``,
          `✍️ (Si deseas hacer una pregunta específica, escríbela en la caja de abajo)`,
        ].join('\n'),
      };
    }

    return { texto: '✅ Comando procesado.' };
  };

  /**
   * Ejecuta un botón de acción del menú de Telegram (`SETTF:*`, `SETASSET:*`, `STRAT:*`, `RISK:*`, `ACT:*`)
   */
  const ejecutarAccionBoton = async (btn) => {
    const d = btn.d;
    const t = btn.t;
    if (!uid || botonCargando || botDesconectado) return;

    setConfirmacionPendiente(null);
    setBotonCargando(d);

    try {
      const timeoutPorBoton =
        d === 'ACT:DM' || d === 'ACT:REPORT_CHART' || d === 'ACT:GEMINI'
          ? 75000
          : 20000;

      // 1. Enviar el comando oficial { uid, tipo: "telegram", valor: d, estado: "pendiente", ts }
      const resCmd = await enviarComandoYEsperar(
        uid,
        'telegram',
        d,
        timeoutPorBoton
      );

      let textoFinal = '';
      let imagenOverrideB64 = null;
      let excelOverride = null;

      if (resCmd.ok && resCmd.resultado) {
        textoFinal = resCmd.resultado;
        // Si Gemini devolvió el error 404 del modelo deprecado en el bot, enriquecer con nuestro diagnóstico
        if (
          d === 'ACT:GEMINI' &&
          textoFinal.includes('No se pudo conectar con Gemini')
        ) {
          const fallbackGem = await consultarGemini({
            uid,
            pregunta: '',
            contexto: 'BOT',
            estadoBot: estado,
          });
          textoFinal = `🧠 ANÁLISIS GEMINI FLASH (${estado?.asset || 'BTC_USDT'} x10):\n\n${
            fallbackGem.respuesta
          }\n\n✍️ (Si deseas hacer una pregunta específica, escríbela en la caja de abajo)`;
        }
      } else {
        // Respaldo transparente si el proceso en Spyder aún no fue reiniciado tras descomprimir el zip
        const respRespaldo = await ejecutarRespaldoBoton(d);
        textoFinal = respRespaldo.texto;
        imagenOverrideB64 = respRespaldo.imagenOverrideB64 || null;
        excelOverride = respRespaldo.excelOverride || null;
      }

      // Si para Reporte + Gráfico aún no hay imagen en telegram_espejo, generamos el gráfico cuantitativo PNG
      if (d === 'ACT:REPORT_CHART' && !imagenOverrideB64 && !ultimaFotoEspejo?.adjunto_b64) {
        imagenOverrideB64 = generarGraficoReporteBase64(estado, velas);
      }

      // Si para Excel aún no hay archivo en telegram_espejo, preparamos el Excel descargable
      if (d === 'ACT:EXCEL' && !excelOverride && !ultimoArchivoEspejo?.adjunto_b64) {
        excelOverride = generarExcelBase64Respaldo(estado, velas, trades);
      }

      // Transiciones de menú idénticas a Telegram tras cambiar temporalidad o activo
      if (d.startsWith('SETTF:')) {
        setVistaMenu('clases');
        setSubtituloPaso(
          '🌐 PASO 2: Selecciona la clase de activo (el filtro de riesgo se adapta automáticamente):'
        );
      } else if (d.startsWith('SETASSET:')) {
        setVistaMenu('principal');
        setSubtituloPaso('');
      }

      setRespuestaPanel({
        comando: d,
        etiqueta: t,
        texto: textoFinal,
        mostrarImagen: d === 'ACT:REPORT_CHART',
        imagenOverrideB64,
        mostrarExcel: d === 'ACT:EXCEL',
        excelOverride,
        mostrarGeminiInput: d === 'ACT:GEMINI',
      });

      if (onToast) {
        const primeraLinea =
          textoFinal
            .split('\n')
            .map((l) => l.trim())
            .find(Boolean) || `Opción ejecutada: ${t}`;
        onToast(primeraLinea.slice(0, 110), 'success');
      }
    } catch (err) {
      console.error('Error ejecutando botón de Telegram:', err);
      if (onToast) {
        onToast('Error al ejecutar el botón del menú de Telegram.', 'error');
      }
    } finally {
      setBotonCargando(null);
    }
  };

  /**
   * Manejador de clic de cualquier botón de la cuadrícula (Sección 5.4 bis)
   */
  const manejarClickBoton = (btn) => {
    const d = String(btn?.d || '');
    if (!d) return;

    // 1. Navegación local de submenús (no manda comando al bot)
    if (d === 'MENU:TF') {
      setVistaMenu('temporalidades');
      setSubtituloPaso('⏱️ PASO 1: Selecciona la Temporalidad de operación:');
      return;
    }
    if (d === 'MENU:ASSET') {
      setVistaMenu('clases');
      setSubtituloPaso(
        '🌐 PASO 2: Selecciona la clase de activo (Cripto=CAViaR 99% | Acciones=CVaR 99% | ETFs=VaR 99%):'
      );
      return;
    }
    if (d.startsWith('CLASS:')) {
      const cls = d.split(':')[1];
      const cfg = ASSET_CLASSES_META[cls];
      const rk = cfg ? RISK_MODELS_META[cfg.risk] : null;
      setVistaMenu(`activos:${cls}`);
      setSubtituloPaso(
        cfg && rk
          ? `${cfg.icon} ${cfg.label} — filtro de riesgo: ${rk.label} (Lím ${fmt2(
              rk.limit
            )}%) · Selecciona el activo:`
          : 'Selecciona el activo:'
      );
      return;
    }
    if (d === 'MENU:MAIN') {
      setVistaMenu('principal');
      setSubtituloPaso('');
      return;
    }

    // 2. Confirmación obligatoria antes de abrir o cerrar posiciones (ACT:BUY_LONG / ACT:CLOSE_OR_SHORT)
    if (d === 'ACT:BUY_LONG' || d === 'ACT:CLOSE_OR_SHORT') {
      setConfirmacionPendiente(btn);
      return;
    }

    // 3. Ejecutar comando en el bot
    ejecutarAccionBoton(btn);
  };

  /**
   * Enviar pregunta específica a Gemini desde la caja debajo de ACT:GEMINI (`contexto: "BOT"`)
   */
  const manejarPreguntaEspecificaGemini = async (e) => {
    e.preventDefault();
    const preg = preguntaExtraGemini.trim();
    if (!preg || !uid || enviandoExtraGemini) return;

    setEnviandoExtraGemini(true);
    try {
      const res = await consultarGemini({
        uid,
        pregunta: preg,
        contexto: 'BOT',
        estadoBot: estado,
      });
      setRespuestaPanel((prev) => ({
        ...(prev || {
          comando: 'ACT:GEMINI',
          etiqueta: '🧠 Analizar con Gemini Flash',
          mostrarGeminiInput: true,
        }),
        texto: `${prev?.texto ? `${prev.texto}\n\n────────────────────────\n` : ''}🙋 Tu pregunta: ${preg}\n\n🧠 Respuesta de Gemini:\n${res.respuesta}`,
      }));
      setPreguntaExtraGemini('');
      if (onToast) onToast('Respuesta de Gemini recibida.', 'success');
    } catch (_) {
      if (onToast) onToast('No se pudo consultar a Gemini.', 'error');
    } finally {
      setEnviandoExtraGemini(false);
    }
  };

  // Determinar qué imagen mostrar cuando `mostrarImagen` está activo
  const b64ImagenReporte =
    ultimaFotoEspejo?.adjunto_b64 || respuestaPanel?.imagenOverrideB64 || null;

  // Determinar qué archivo Excel descargar cuando `mostrarExcel` está activo
  const datosExcelReporte = ultimoArchivoEspejo?.adjunto_b64
    ? {
        b64: ultimoArchivoEspejo.adjunto_b64,
        tipo:
          ultimoArchivoEspejo.adjunto_tipo ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        nombre:
          ultimoArchivoEspejo.adjunto_nombre ||
          `Quant_x10_${estado?.asset || 'BTC_USDT'}.xlsx`,
      }
    : respuestaPanel?.excelOverride || null;

  return (
    <section className="panel tg-remote-panel" id="panel-de-telegram">
      <div className="tg-remote-header">
        <div>
          <div className="tg-remote-badge-row">
            <span className="tg-remote-badge">🎛️ PANEL DE TELEGRAM EN LA APP</span>
            <span className="text-sec" style={{ fontSize: '11.5px' }}>
              Sincronizado con <code>bot/menu</code> y comando <code>&quot;telegram&quot;</code>
            </span>
          </div>
          <h3 className="tg-remote-title">{menuEfectivo.titulo}</h3>
          {subtituloPaso && (
            <p className="tg-remote-subtitle">{subtituloPaso}</p>
          )}
        </div>

        {/* Migas de navegación rápida entre vistas del menú */}
        <div className="tg-remote-breadcrumbs">
          <button
            type="button"
            className={`shortcut-btn ${vistaMenu === 'principal' ? 'active' : ''}`}
            onClick={() => {
              setVistaMenu('principal');
              setSubtituloPaso('');
            }}
          >
            🎛️ Menú Principal
          </button>
          <button
            type="button"
            className={`shortcut-btn ${vistaMenu === 'temporalidades' ? 'active' : ''}`}
            onClick={() => {
              setVistaMenu('temporalidades');
              setSubtituloPaso('⏱️ PASO 1: Selecciona la Temporalidad de operación:');
            }}
          >
            ⏱️ Temporalidades
          </button>
          <button
            type="button"
            className={`shortcut-btn ${
              vistaMenu === 'clases' || vistaMenu.startsWith('activos:')
                ? 'active'
                : ''
            }`}
            onClick={() => {
              setVistaMenu('clases');
              setSubtituloPaso('🌐 PASO 2: Selecciona la clase de activo:');
            }}
          >
            🪙🏢🧺 Activos (28)
          </button>
        </div>
      </div>

      {/* Cuadrícula de botones del menú de Telegram */}
      <div className="tg-remote-kb-grid">
        {filasVisibles.map((fila, rIdx) => (
          <div
            key={rIdx}
            className="tg-remote-kb-row"
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, fila.length)}, minmax(0, 1fr))`,
            }}
          >
            {fila.map((btn, bIdx) => {
              const d = String(btn.d || '');
              const t = String(btn.t || '');
              const estaCargando = botonCargando === d;
              const tieneCheck = t.includes('✅');
              const esPeligro =
                t.includes('🔴') || d === 'ACT:CLOSE_OR_SHORT';
              const esExito =
                (t.includes('🟢') && !t.includes('Pausar')) ||
                d === 'ACT:BUY_LONG';
              const esGemini = d === 'ACT:GEMINI';

              return (
                <button
                  key={`${rIdx}-${bIdx}-${d}`}
                  type="button"
                  data-callback={d}
                  disabled={Boolean(botonCargando) || (botDesconectado && !String(btn.d || '').startsWith('NAV:'))}
                  onClick={() => manejarClickBoton(btn)}
                  className={`tg-remote-btn ${tieneCheck ? 'active-check' : ''} ${
                    esExito ? 'tone-green' : ''
                  } ${esPeligro ? 'tone-red' : ''} ${
                    esGemini ? 'tone-gemini' : ''
                  } ${estaCargando ? 'loading' : ''}`}
                >
                  <span className="tg-remote-btn-text">
                    {estaCargando ? `⏳ Ejecutando: ${t}...` : t}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Barra de confirmación para botones que abren o cierran posiciones */}
      {confirmacionPendiente && (
        <div className="bot-confirm-bar" style={{ marginTop: '12px' }}>
          <span>
            ⚠️ <strong>Confirmación de orden en el bot:</strong> ¿Seguro que deseas ejecutar{' '}
            <strong>{confirmacionPendiente.t}</strong> en{' '}
            <strong>{estado?.asset || 'BTC_USDT'}</strong>?
          </span>
          <div className="bot-confirm-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => ejecutarAccionBoton(confirmacionPendiente)}
            >
              Sí, confirmar orden
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setConfirmacionPendiente(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Área de respuesta del botón pulsado (Sección 5.4 bis) */}
      {(botonCargando || respuestaPanel) && (
        <div className="tg-remote-response-box">
          <div className="tg-remote-response-header">
            <span>
              <strong>
                {botonCargando
                  ? `⏳ Procesando comando en el bot (${botonCargando})...`
                  : `🤖 Respuesta de Telegram — ${respuestaPanel?.etiqueta || ''}`}
              </strong>
            </span>
            {!botonCargando && respuestaPanel && (
              <button
                type="button"
                className="toast-close"
                onClick={() => setRespuestaPanel(null)}
                title="Cerrar respuesta"
              >
                ×
              </button>
            )}
          </div>

          {botonCargando ? (
            <div className="tg-remote-loading-msg">
              Esperando que el bot en la VM procese <code>{botonCargando}</code> y devuelva{' '}
              <code>resultado</code> en Firestore...
            </div>
          ) : (
            respuestaPanel && (
              <>
                <pre className="tg-remote-response-pre">{respuestaPanel.texto}</pre>

                {/* Caso especial 1: Reporte de Bot + Gráfico (muestra la imagen PNG en base64) */}
                {respuestaPanel.mostrarImagen && b64ImagenReporte && (
                  <div className="tg-remote-attachment-box">
                    <div className="tg-remote-attachment-bar">
                      <span>📊 Gráfico del Reporte Cuantitativo ({estado?.asset} · {estado?.timeframe})</span>
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        onClick={() =>
                          descargarBase64Archivo(
                            b64ImagenReporte,
                            'image/png',
                            `Reporte_Quant_${estado?.asset || 'Bot'}_${estado?.timeframe || '15m'}.png`
                          )
                        }
                      >
                        📥 Guardar imagen PNG
                      </button>
                    </div>
                    <img
                      src={`data:image/png;base64,${b64ImagenReporte}`}
                      alt="Gráfico del Reporte del Bot"
                      className="tg-remote-report-img"
                    />
                  </div>
                )}

                {/* Caso especial 2: Excel + Histórico (botón Descargar Excel) */}
                {respuestaPanel.mostrarExcel && datosExcelReporte && (
                  <div className="tg-remote-attachment-box">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        descargarBase64Archivo(
                          datosExcelReporte.b64,
                          datosExcelReporte.tipo,
                          datosExcelReporte.nombre
                        )
                      }
                    >
                      📥 Descargar Excel ({datosExcelReporte.nombre})
                    </button>
                  </div>
                )}

                {/* Caso especial 3: Analizar con Gemini (caja para escribir pregunta adicional con contexto "BOT") */}
                {respuestaPanel.mostrarGeminiInput && (
                  <form
                    className="tg-remote-gemini-form"
                    onSubmit={manejarPreguntaEspecificaGemini}
                  >
                    <label htmlFor="tg-gemini-followup-input">
                      ✍️ Hacer una pregunta específica a Gemini sobre el estado actual del bot (
                      <code>contexto: &quot;BOT&quot;</code>):
                    </label>
                    <div className="tg-remote-gemini-input-row">
                      <input
                        id="tg-gemini-followup-input"
                        type="text"
                        className="form-input"
                        placeholder="Ej. ¿Conviene esperar retroceso a soporte antes de entrar en Long x10?"
                        value={preguntaExtraGemini}
                        onChange={(e) => setPreguntaExtraGemini(e.target.value)}
                        disabled={enviandoExtraGemini}
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={enviandoExtraGemini || !preguntaExtraGemini.trim()}
                      >
                        {enviandoExtraGemini ? 'Consultando...' : 'Preguntar a Gemini'}
                      </button>
                    </div>
                  </form>
                )}
              </>
            )
          )}
        </div>
      )}
    </section>
  );
}
