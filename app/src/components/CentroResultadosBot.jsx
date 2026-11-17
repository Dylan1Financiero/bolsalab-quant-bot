import React, { useEffect, useMemo, useRef, useState } from 'react';
import { calcularMetricasRealesBot } from '../utils/botTrades';
import { formatearPnlConSigno } from '../config/tradingConfig';

export const FILTROS_RESULTADOS = [
  { id: 'todo', label: 'Todo' },
  { id: 'reportes', label: 'Reportes' },
  { id: 'sentimiento', label: 'Sentimiento' },
  { id: 'winrate', label: 'Win rate' },
  { id: 'diebold', label: 'Diebold-Mariano' },
  { id: 'ordenes', label: 'Órdenes' },
];

const CAPTIONS_TRIVIALES = new Set(['📊 gráfico', '📊 grafico', 'gráfico', 'grafico', '📎 archivo']);

function formatearHoraTarjeta(tsMs) {
  const n = Number(tsMs || 0);
  if (!Number.isFinite(n) || n <= 0) return '--:--';
  const d = new Date(n);
  const hoy = new Date();
  const mismoDia =
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate();
  const hora = d.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  if (mismoDia) return hora;
  const fecha = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  return `${fecha} · ${hora}`;
}

function esMenuBot(texto = '') {
  const up = String(texto || '').toUpperCase();
  if (
    up.includes('REPORTE QUANT') ||
    up.includes('SENTIMIENTO') ||
    up.includes('WINRATE') ||
    up.includes('WIN RATE') ||
    up.includes('DIEBOLD') ||
    up.includes('ORDEN EJECUTADA') ||
    up.includes('POSICIÓN CERRADA') ||
    up.includes('POSICION CERRADA')
  ) {
    return false;
  }
  const primeraLinea = (up.split('\n').find((l) => l.trim()) || '').trim();
  return (
    primeraLinea.includes('TERMINAL QUANT') ||
    primeraLinea.includes('TEMPORALIDAD DE OPERACIÓN') ||
    primeraLinea.includes('TEMPORALIDAD DE OPERACION') ||
    primeraLinea.includes('SELECCIÓN DE MERCADO') ||
    primeraLinea.includes('SELECCION DE MERCADO') ||
    primeraLinea.includes('CRIPTOMONEDAS') ||
    primeraLinea.includes('ESTRATEGIAS DEL BOT') ||
    primeraLinea.includes('BOT QUANT X10 EN LÍNEA') ||
    primeraLinea.includes('BOT QUANT X10 EN LINEA') ||
    up.includes('ELIGE UN INSTRUMENTO')
  );
}

function extraerTituloFallback(texto = '') {
  const lineas = texto
    .split('\n')
    .map((l) => l.replace(/[━─]+/g, '').trim())
    .filter((l) => l && !CAPTIONS_TRIVIALES.has(l.toLowerCase()));
  if (!lineas.length) return 'Respuesta del bot';
  const primera = lineas[0];
  return primera.length > 64 ? `${primera.slice(0, 61)}...` : primera;
}

export function clasificarTextoResultado(texto = '', adjuntos = []) {
  const up = texto.toUpperCase();
  if (up.includes('REPORTE QUANT')) {
    return { categoria: 'reportes', titulo: 'Reporte' };
  }
  if (up.includes('SENTIMIENTO')) {
    return { categoria: 'sentimiento', titulo: 'Sentimiento de mercado' };
  }
  if (up.includes('WINRATE') || up.includes('WIN RATE')) {
    return { categoria: 'winrate', titulo: 'Win rate' };
  }
  if (up.includes('DIEBOLD')) {
    return { categoria: 'diebold', titulo: 'Diebold-Mariano' };
  }
  if (up.includes('ORDEN EJECUTADA') || up.includes('POSICIÓN CERRADA') || up.includes('POSICION CERRADA')) {
    return { categoria: 'ordenes', titulo: 'Orden' };
  }
  if (adjuntos.some((a) => a.tipo && a.tipo !== 'image/png')) {
    const fileAdj = adjuntos.find((a) => a.tipo && a.tipo !== 'image/png');
    return {
      categoria: 'reportes',
      titulo: fileAdj?.nombre ? `Archivo · ${fileAdj.nombre}` : 'Archivo exportado',
    };
  }
  return { categoria: 'otros', titulo: extraerTituloFallback(texto) };
}

function limpiarTextoCaption(texto = '') {
  const trimmed = String(texto || '').trim();
  if (CAPTIONS_TRIVIALES.has(trimmed.toLowerCase())) return '';
  return String(texto || '').replace(/\r\n/g, '\n').trimEnd();
}

/**
 * Agrupa mensajes consecutivos del bot enviados con menos de 10 s de diferencia,
 * conservando imágenes, archivos, emojis y saltos de línea completos.
 */
export function agruparMensajesResultados(mensajesTg = []) {
  const soloBot = [...mensajesTg]
    .filter((m) => m && m.de === 'bot')
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

  const grupos = [];

  for (const m of soloBot) {
    const ts = Number(m.ts || 0);
    const texto = limpiarTextoCaption(m.texto || '');
    const rawTexto = String(m.texto || '').trim();
    const tieneAdjunto = Boolean(m.adjunto_b64);
    const adjunto = tieneAdjunto
      ? {
          b64: m.adjunto_b64,
          tipo: m.adjunto_tipo || 'application/octet-stream',
          nombre: m.adjunto_nombre || (m.adjunto_tipo === 'image/png' ? 'grafica_bot.png' : 'archivo_bot'),
        }
      : null;

    const prev = grupos[grupos.length - 1];
    const dentroDeVentana = prev && ts - prev.ultimoTs >= 0 && ts - prev.ultimoTs < 10000;

    let debeAgrupar = false;
    if (dentroDeVentana) {
      const prevSinCuerpo = prev.partesTexto.length === 0 && prev.adjuntos.length > 0;
      const msgSoloAdjunto = tieneAdjunto && texto.length === 0;
      const prevTextoUnido = prev.partesTexto.join('\n\n');
      const catPrev = clasificarTextoResultado(prevTextoUnido, prev.adjuntos).categoria;
      const catMsg = clasificarTextoResultado(texto, adjunto ? [adjunto] : []).categoria;

      if (prevSinCuerpo && !esMenuBot(rawTexto)) {
        // Caso habitual: el bot manda primero la imagen ("📊 Gráfico") y ~2s después el texto largo
        debeAgrupar = true;
      } else if (msgSoloAdjunto && !esMenuBot(prevTextoUnido) && prev.adjuntos.length === 0) {
        // Caso inverso: texto seguido de foto/Excel en < 10s
        debeAgrupar = true;
      } else if (catMsg !== 'otros' && catMsg === catPrev && prev.partesTexto.length > 0 && texto.length > 0) {
        // Mismo reporte partido en dos mensajes consecutivos en < 10s
        debeAgrupar = true;
      }
    }

    if (debeAgrupar) {
      prev.ids.push(m.id);
      prev.ultimoTs = ts;
      if (texto) prev.partesTexto.push(texto);
      if (adjunto) prev.adjuntos.push(adjunto);
      if (rawTexto && !prev.rawCaptionFallback) prev.rawCaptionFallback = rawTexto;
    } else {
      grupos.push({
        id: m.id,
        ids: [m.id],
        primerTs: ts,
        ultimoTs: ts,
        partesTexto: texto ? [texto] : [],
        adjuntos: adjunto ? [adjunto] : [],
        rawCaptionFallback: rawTexto,
      });
    }
  }

  return grupos
    .map((g) => {
      const textoFinal = g.partesTexto.join('\n\n') || g.rawCaptionFallback || '';
      const { categoria, titulo } = clasificarTextoResultado(textoFinal, g.adjuntos);
      return {
        id: g.id,
        ids: g.ids,
        ts: g.ultimoTs || g.primerTs,
        hora: formatearHoraTarjeta(g.ultimoTs || g.primerTs),
        categoria,
        titulo,
        texto: textoFinal,
        adjuntos: g.adjuntos,
      };
    })
    .reverse();
}

function construirUrlArchivo(adj) {
  const mime = adj?.tipo || 'application/octet-stream';
  return `data:${mime};base64,${adj?.b64 || ''}`;
}

export function nombreDescargaPng(card, idx = 0) {
  const slug = (card?.titulo || 'bot')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const d = new Date(Number(card?.ts || Date.now()));
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const suf = idx > 0 ? `_${idx + 1}` : '';
  return `bolsalab_${slug || 'reporte'}_${stamp}${suf}.png`;
}

export default function CentroResultadosBot({
  mensajesTg = [],
  trades = [],
  capitalInicialBot = 1000,
  esperaBot = null,
  autoAbrirCardId = null,
  onAbrirImagen,
  onLimpiarEspera,
}) {
  const [filtro, setFiltro] = useState('todo');
  const [modoVersion, setModoVersion] = useState('bollinger'); // 'todas' | 'bollinger' | 'previas'
  const [usuarioEligioVersion, setUsuarioEligioVersion] = useState(false);
  const [expandidas, setExpandidas] = useState({});
  const cardRefs = useRef({});

  const tradesBollinger = useMemo(
    () =>
      trades.filter((t) =>
        String(t?.estrategia || '').toUpperCase().includes('BOLLINGER')
      ),
    [trades]
  );

  const tradesEtapa2 = useMemo(
    () =>
      trades.filter(
        (t) => !String(t?.estrategia || '').toUpperCase().includes('BOLLINGER')
      ),
    [trades]
  );

  useEffect(() => {
    if (usuarioEligioVersion) return;
    if (tradesBollinger.length > 0) {
      setModoVersion('bollinger');
    } else if (trades.length > 0) {
      setModoVersion('todas');
    }
  }, [tradesBollinger.length, trades.length, usuarioEligioVersion]);

  const tradesSegunVersion = useMemo(() => {
    if (modoVersion === 'bollinger') return tradesBollinger;
    if (modoVersion === 'previas') return tradesEtapa2;
    return trades;
  }, [trades, tradesBollinger, tradesEtapa2, modoVersion]);

  const metricas = useMemo(
    () => calcularMetricasRealesBot(tradesSegunVersion, capitalInicialBot),
    [tradesSegunVersion, capitalInicialBot]
  );

  const metricasBollinger = useMemo(
    () => calcularMetricasRealesBot(tradesBollinger, capitalInicialBot),
    [tradesBollinger, capitalInicialBot]
  );

  const metricasEtapa2 = useMemo(
    () => calcularMetricasRealesBot(tradesEtapa2, capitalInicialBot),
    [tradesEtapa2, capitalInicialBot]
  );

  const metricasTotales = useMemo(
    () => calcularMetricasRealesBot(trades, capitalInicialBot),
    [trades, capitalInicialBot]
  );

  const tarjetas = useMemo(() => agruparMensajesResultados(mensajesTg), [mensajesTg]);

  const conteos = useMemo(() => {
    const map = { todo: tarjetas.length, reportes: 0, sentimiento: 0, winrate: 0, diebold: 0, ordenes: 0 };
    for (const t of tarjetas) {
      if (map[t.categoria] !== undefined) map[t.categoria] += 1;
    }
    return map;
  }, [tarjetas]);

  const tarjetasVisibles = useMemo(() => {
    if (filtro === 'todo') return tarjetas;
    return tarjetas.filter((t) => t.categoria === filtro);
  }, [tarjetas, filtro]);

  useEffect(() => {
    if (!autoAbrirCardId) return;
    const encontrada = tarjetas.find((t) => t.id === autoAbrirCardId || t.ids.includes(autoAbrirCardId));
    if (!encontrada) return;
    if (filtro !== 'todo' && filtro !== encontrada.categoria) {
      setFiltro('todo');
    }
    setExpandidas((prev) => ({ ...prev, [encontrada.id]: true }));
    const timer = setTimeout(() => {
      const el = cardRefs.current[encontrada.id];
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [autoAbrirCardId, tarjetas, filtro]);

  const toggleExpand = (id) => {
    setExpandidas((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="bot-results-wrap">
      <section className="bot-metrics-card" aria-label="Métricas reales del bot">
        <div className="bot-metrics-head">
          <div>
            <h4 className="bot-metrics-title">
              Métricas reales del bot y comparativa Backtest vs. En vivo
            </h4>
            <span className="bot-metrics-sub">
              Capital inicial{' '}
              <span className="num">${metricas.capitalInicial.toLocaleString('en-US')} USDT</span> ·
              Saldo contable actual{' '}
              <strong className="num">${metricasTotales.saldoContable.toFixed(2)} USDT</strong>
            </span>
          </div>
          <div className="bot-results-filters" role="group" aria-label="Filtrar operaciones por versión">
            {[
              { id: 'bollinger', label: `Versión final: Bollinger (${tradesBollinger.length})` },
              { id: 'previas', label: `Etapa 2: Fibonacci/SuperTrend (${tradesEtapa2.length})` },
              { id: 'todas', label: `Historial completo (${trades.length})` },
            ].map((v) => (
              <button
                key={v.id}
                type="button"
                className={`bot-results-pill ${modoVersion === v.id ? 'is-active' : ''}`}
                onClick={() => {
                  setUsuarioEligioVersion(true);
                  setModoVersion(v.id);
                }}
              >
                <span>{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tabla lado a lado: En vivo Bollinger vs Backtest vs Etapa 2 */}
        <div className="ml-dense-table-wrap" style={{ marginBottom: '10px' }}>
          <table className="terminal-dense-table">
            <thead>
              <tr>
                <th>ETAPA / CONFIGURACIÓN</th>
                <th>ESTRATEGIA</th>
                <th className="num">OPERACIONES</th>
                <th className="num">WIN RATE</th>
                <th className="num">GANANCIA / PÉRDIDA PROM.</th>
                <th className="num">PROFIT FACTOR</th>
                <th className="num">RESULTADO NETO</th>
              </tr>
            </thead>
            <tbody>
              <tr className="ml-purple-best-row">
                <td>
                  <strong>En vivo — Versión final activa</strong>
                </td>
                <td>Bollinger + EMA 200 (XRP 1m, TP 2.0 / SL 0.4 ATR)</td>
                <td className="num">{metricasBollinger.total} (en vivo)</td>
                <td className="num">
                  {metricasBollinger.winRateReal !== null
                    ? `${metricasBollinger.winRateReal.toFixed(1)}%`
                    : '—'}
                </td>
                <td className="num">
                  +${metricasBollinger.gananciaProm?.toFixed(2) || '0.00'} / −$
                  {metricasBollinger.perdidaProm?.toFixed(2) || '0.00'}
                </td>
                <td
                  className={`num ${
                    metricasBollinger.profitFactor !== null &&
                    metricasBollinger.profitFactor >= 1
                      ? 'text-green'
                      : 'text-red'
                  }`}
                >
                  <strong>
                    {metricasBollinger.profitFactor === null
                      ? '—'
                      : Number.isFinite(metricasBollinger.profitFactor)
                        ? metricasBollinger.profitFactor.toFixed(2)
                        : '∞'}
                  </strong>
                </td>
                <td
                  className={`num ${
                    metricasBollinger.pnlTotal >= 0 ? 'text-green' : 'text-red'
                  }`}
                >
                  <strong>
                    {formatearPnlConSigno(metricasBollinger.pnlTotal)} (
                    {metricasBollinger.roiSimuladoPct >= 0 ? '+' : ''}
                    {metricasBollinger.roiSimuladoPct.toFixed(2)}%)
                  </strong>
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Backtest configuración final (9–15 nov)</strong>
                </td>
                <td>Bollinger + EMA 200 sin filtro RF (TP 2.0 / SL 0.4 ATR)</td>
                <td className="num">133 (XRP 1m)</td>
                <td className="num">24.8%</td>
                <td className="num">TP 2.0 / SL 0.4 ATR (5:1)</td>
                <td className="num text-green">
                  <strong>2.25</strong>
                </td>
                <td className="num text-green">
                  <strong>+$69.54 (+6.95%)</strong>
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Backtest 4 criptos (XRP, BTC, ETH, SOL)</strong>
                </td>
                <td>Bollinger + EMA 200 (sin filtro vs. con filtro estricto)</td>
                <td className="num">491 / 229</td>
                <td className="num">—</td>
                <td className="num">TP 2.0 / SL 0.4 ATR (5:1)</td>
                <td className="num text-green">
                  <strong>1.64 / 2.00</strong>
                </td>
                <td className="num text-sec">Sin comisiones</td>
              </tr>
              <tr>
                <td>
                  <strong>Historial en vivo previo (Etapa 2)</strong>
                </td>
                <td>Fibonacci / SuperTrend / Chartismo (TP corto ~0.05%)</td>
                <td className="num">{metricasEtapa2.total}</td>
                <td className="num">
                  {metricasEtapa2.winRateReal !== null
                    ? `${metricasEtapa2.winRateReal.toFixed(1)}%`
                    : '—'}
                </td>
                <td className="num">
                  +${metricasEtapa2.gananciaProm?.toFixed(2) || '0.00'} / −$
                  {metricasEtapa2.perdidaProm?.toFixed(2) || '0.00'}
                </td>
                <td className="num text-red">
                  <strong>
                    {metricasEtapa2.profitFactor !== null
                      ? metricasEtapa2.profitFactor.toFixed(2)
                      : '—'}
                  </strong>
                </td>
                <td className="num text-red">
                  {formatearPnlConSigno(metricasEtapa2.pnlTotal)} (
                  {metricasEtapa2.roiSimuladoPct.toFixed(2)}%)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="ml-plain-guide" style={{ marginBottom: '10px' }}>
          <span>
            <strong>Evidencia comparativa en vivo:</strong> Las{' '}
            <strong className="num">{metricasEtapa2.total}</strong> operaciones previas de la{' '}
            <strong>Etapa 2</strong> (Fibonacci/SuperTrend,{' '}
            <strong className="num">
              {metricasEtapa2.winRateReal !== null ? `${metricasEtapa2.winRateReal.toFixed(0)}%` : '81%'}
            </strong>{' '}
            aciertos) perdieron dinero (PF <strong className="num">{metricasEtapa2.profitFactor?.toFixed(2) || '0.46'}</strong>)
            porque el Take Profit corto no cubría las pérdidas. Con la{' '}
            <strong>versión final activa (Bollinger + EMA 200)</strong> el bot ya suma{' '}
            <strong className="num">{metricasBollinger.total}</strong> operaciones reales en vivo con{' '}
            <strong>{formatearPnlConSigno(metricasBollinger.pnlTotal)} USDT</strong> (PF{' '}
            <strong className="num">
              {metricasBollinger.profitFactor !== null && Number.isFinite(metricasBollinger.profitFactor)
                ? metricasBollinger.profitFactor.toFixed(2)
                : '∞'}
            </strong>
            ).
          </span>
        </div>

        <div className="bot-metrics-grid">
          <div className="bot-metric-item">
            <span className="bot-metric-lbl">Win rate real (% de aciertos)</span>
            <strong
              className={`bot-metric-val num ${
                metricas.winRateReal !== null &&
                metricas.winRateEquilibrio !== null &&
                metricas.winRateReal >= metricas.winRateEquilibrio
                  ? 'text-green'
                  : 'text-red'
              }`}
            >
              {metricas.winRateReal !== null ? `${metricas.winRateReal.toFixed(1)}%` : '—'}
            </strong>
            <span className="bot-metric-hint num">
              {metricas.ganadas} ganadas / {metricas.perdidas} perdidas
            </span>
          </div>

          <div className="bot-metric-item">
            <span className="bot-metric-lbl">Win rate de equilibrio (mínimo para no perder)</span>
            <strong className="bot-metric-val num">
              {metricas.winRateEquilibrio !== null
                ? `${metricas.winRateEquilibrio.toFixed(1)}%`
                : '—'}
            </strong>
            <span className="bot-metric-hint">
              pérdida prom / (ganancia + pérdida)
            </span>
          </div>

          <div className="bot-metric-item">
            <span className="bot-metric-lbl">Profit factor ($ ganados por cada $1 perdido)</span>
            <strong
              className={`bot-metric-val num ${
                metricas.profitFactor !== null && Number.isFinite(metricas.profitFactor)
                  ? metricas.profitFactor >= 1
                    ? 'text-green'
                    : 'text-red'
                  : ''
              }`}
            >
              {metricas.profitFactor === null
                ? '—'
                : Number.isFinite(metricas.profitFactor)
                  ? metricas.profitFactor.toFixed(2)
                  : '∞'}
            </strong>
            <span className="bot-metric-hint num">
              &gt;1.0 es rentable · prom +${metricas.gananciaProm !== null ? metricas.gananciaProm.toFixed(2) : '0.00'} / -$
              {metricas.perdidaProm !== null ? metricas.perdidaProm.toFixed(2) : '0.00'}
            </span>
          </div>

          <div className="bot-metric-item">
            <span className="bot-metric-lbl">PnL total (ganancia/pérdida neta)</span>
            <strong
              className={`bot-metric-val num ${
                metricas.pnlTotal >= 0 ? 'text-green' : 'text-red'
              }`}
            >
              {formatearPnlConSigno(metricas.pnlTotal)}
            </strong>
            <span className="bot-metric-hint num">
              ROI simulado: {metricas.roiSimuladoPct >= 0 ? '+' : ''}
              {metricas.roiSimuladoPct.toFixed(2)}%
            </span>
          </div>

          <div className="bot-metric-item">
            <span className="bot-metric-lbl">PnL sin cierres manuales (solo estrategia)</span>
            <strong
              className={`bot-metric-val num ${
                metricas.pnlSinManuales >= 0 ? 'text-green' : 'text-red'
              }`}
            >
              {formatearPnlConSigno(metricas.pnlSinManuales)}
            </strong>
            <span className="bot-metric-hint num">
              {metricas.opsSinManuales} ops cerradas solo por TP/SL (ROI {metricas.roiSinManualesPct >= 0 ? '+' : ''}
              {metricas.roiSinManualesPct.toFixed(2)}%)
            </span>
          </div>

          <div className="bot-metric-item">
            <span className="bot-metric-lbl">Operaciones</span>
            <strong className="bot-metric-val num">{metricas.total}</strong>
            <span className="bot-metric-hint num">
              {metricas.longs} LONG · {metricas.shorts} SHORT · {metricas.opsManuales} manuales
            </span>
          </div>
        </div>

        <p className="bot-metrics-legend">
          Resultados sin comisiones · cierres manuales excluidos donde se indica
        </p>
      </section>

      <div className="bot-results-toolbar">
        <div className="bot-results-filters" role="tablist" aria-label="Filtros del centro de resultados">
          {FILTROS_RESULTADOS.map((f) => {
            const count = conteos[f.id] ?? 0;
            const activo = filtro === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={activo}
                className={`bot-results-pill ${activo ? 'is-active' : ''}`}
                onClick={() => setFiltro(f.id)}
              >
                <span>{f.label}</span>
                <span className="bot-results-pill-count num">{count}</span>
              </button>
            );
          })}
        </div>
        <span className="bot-results-meta">
          Últimos {mensajesTg.length} reportes de Telegram en vivo
        </span>
      </div>

      {esperaBot?.activo && (
        <div className="bot-results-banner is-waiting" role="status">
          <div className="bot-results-banner-left">
            <span className="bot-results-spinner" aria-hidden="true" />
            <div>
              <strong>Esperando respuesta del bot…</strong>
              <span className="bot-results-banner-sub">
                {esperaBot.esSentimiento
                  ? 'El sentimiento tarda hasta 60 s.'
                  : esperaBot.subtexto || `Consultando: ${esperaBot.label || 'comando del bot'}.`}
              </span>
            </div>
          </div>
          {onLimpiarEspera && (
            <button type="button" className="bot-results-banner-close" onClick={onLimpiarEspera}>
              Ocultar
            </button>
          )}
        </div>
      )}

      {!esperaBot?.activo && esperaBot?.error && (
        <div className="bot-results-banner is-error" role="alert">
          <div className="bot-results-banner-left">
            <span>{esperaBot.error}</span>
          </div>
          {onLimpiarEspera && (
            <button type="button" className="bot-results-banner-close" onClick={onLimpiarEspera}>
              Cerrar
            </button>
          )}
        </div>
      )}

      {tarjetasVisibles.length === 0 ? (
        <div className="bot-results-empty">
          {tarjetas.length === 0
            ? 'Aún no hay reportes registrados del bot en Telegram.'
            : 'No hay resultados en esta categoría dentro de los últimos 50 mensajes.'}
        </div>
      ) : (
        <div className="bot-results-list">
          {tarjetasVisibles.map((card) => {
            const imgs = card.adjuntos.filter((a) => a.tipo === 'image/png');
            const files = card.adjuntos.filter((a) => a.tipo !== 'image/png');
            const lineas = card.texto ? card.texto.split('\n') : [];
            const esLargo = lineas.length > 25;
            const abierto = Boolean(expandidas[card.id]);
            const textoMostrado = esLargo && !abierto ? lineas.slice(0, 25).join('\n') : card.texto;
            const esReciente =
              Boolean(autoAbrirCardId) && (card.id === autoAbrirCardId || card.ids.includes(autoAbrirCardId));

            return (
              <article
                key={card.id}
                ref={(el) => {
                  if (el) cardRefs.current[card.id] = el;
                }}
                className={`bot-result-card ${esReciente ? 'is-highlighted' : ''}`}
              >
                <header className="bot-result-head">
                  <div className="bot-result-title-group">
                    <h4 className="bot-result-title">{card.titulo}</h4>
                    {imgs.length > 0 && <span className="bot-result-tag">Gráfico PNG</span>}
                    {files.length > 0 && <span className="bot-result-tag">Archivo</span>}
                    {esReciente && <span className="bot-result-tag is-new">Nuevo</span>}
                  </div>
                  <time className="bot-result-time num">{card.hora}</time>
                </header>

                {imgs.length > 0 && (
                  <div className="bot-result-media-grid">
                    {imgs.map((img, idx) => {
                      const src = `data:image/png;base64,${img.b64}`;
                      const filename =
                        img.nombre && img.nombre !== 'grafica_bot.png'
                          ? img.nombre
                          : nombreDescargaPng(card, idx);
                      return (
                        <button
                          key={`${card.id}-img-${idx}`}
                          type="button"
                          className="bot-result-img-btn"
                          onClick={() =>
                            onAbrirImagen?.({
                              src,
                              nombre: filename,
                              titulo: card.titulo,
                              hora: card.hora,
                            })
                          }
                          title="Clic para ampliar y descargar PNG"
                        >
                          <img src={src} alt={`${card.titulo} (${card.hora})`} className="bot-result-img" />
                          <span className="bot-result-img-hint">Ampliar PNG</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {files.length > 0 && (
                  <div className="bot-result-files">
                    {files.map((file, idx) => (
                      <a
                        key={`${card.id}-file-${idx}`}
                        href={construirUrlArchivo(file)}
                        download={file.nombre || 'archivo_bot'}
                        className="bot-result-file-btn"
                      >
                        Descargar {file.nombre || 'archivo'}
                      </a>
                    ))}
                  </div>
                )}

                {textoMostrado && <div className="bot-result-text">{textoMostrado}</div>}

                {esLargo && (
                  <div className="bot-result-footer">
                    <button
                      type="button"
                      className="bot-result-toggle-btn"
                      onClick={() => toggleExpand(card.id)}
                    >
                      {abierto ? 'Ver menos' : `Ver más (${lineas.length - 25} líneas restantes)`}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
