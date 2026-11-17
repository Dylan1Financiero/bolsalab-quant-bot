import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import { MAPA_ACTIVOS } from '../data/catalogo';
import { PRO_GRATIS, tieneAccesoPro } from '../config/planConfig';
import {
  SALDO_INICIAL,
  reiniciarPortafolio10k,
  actualizarConfigBotUsuario,
  ejecutarOperacionUsuario,
} from '../services/firebase';

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtSignedUSD(v) {
  const n = Number(v || 0);
  const sign = n > 0 ? '+' : '';
  return `${sign}${fmtUSD.format(n)}`;
}

function fmtSignedPct(v) {
  const n = Number(v || 0);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtHoraCorta(ts) {
  if (!ts) return '—';
  try {
    return new Date(Number(ts)).toLocaleString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return '—';
  }
}

export default function PortfolioDashboard({
  uid,
  perfil,
  precios,
  resumenFinanciero,
  ordenes = [],
  botEstado = null,
  onSelectAsset,
  onGoToBot,
  onSelectSeccion,
  onCambiarObjetivo,
  onToast,
}) {
  const [modoGrafico, setModoGrafico] = useState('patrimonio'); // 'patrimonio' | 'pnl'
  const [vistaDerecha, setVistaDerecha] = useState('activos'); // 'activos' | 'transacciones'
  const [ejecutandoBot, setEjecutandoBot] = useState(false);
  const [confirmandoReset, setConfirmandoReset] = useState(false);

  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const areaSeriesRef = useRef(null);
  const baseLineRef = useRef(null);

  const esPro = tieneAccesoPro(perfil);
  const botAutoUser = Boolean(perfil?.botAutoUser);
  const botPctSaldo = Number(perfil?.botPctSaldo || 15);

  const efectivo = Number(resumenFinanciero?.efectivo ?? SALDO_INICIAL);
  const valorPosiciones = Number(resumenFinanciero?.valorPosiciones ?? 0);
  const patrimonio = Number(resumenFinanciero?.patrimonio ?? SALDO_INICIAL);
  const pnlTotal = patrimonio - SALDO_INICIAL;
  const rendimientoPct = ((patrimonio - SALDO_INICIAL) / SALDO_INICIAL) * 100;

  // Desglose detallado de posiciones abiertas con PnL individual en vivo
  const detallePosiciones = useMemo(() => {
    const posMap = perfil?.posiciones || {};
    const items = [];
    let costoTotalAbierto = 0;
    let valorMercadoAbierto = 0;

    for (const [sym, pos] of Object.entries(posMap)) {
      const cant = Number(pos?.cant || 0);
      if (cant <= 1e-8) continue;
      const costoUnit = Number(pos?.costo || 0);
      const cot = precios?.[sym];
      const precioActual =
        cot?.disponible && Number(cot.p) > 0 ? Number(cot.p) : costoUnit;

      const costoPosicion = cant * costoUnit;
      const valorActual = cant * precioActual;
      const pnlAbierto = valorActual - costoPosicion;
      const pnlPct = costoPosicion > 0 ? (pnlAbierto / costoPosicion) * 100 : 0;

      costoTotalAbierto += costoPosicion;
      valorMercadoAbierto += valorActual;

      items.push({
        sym,
        nombre: MAPA_ACTIVOS[sym]?.nombre || sym,
        clase: MAPA_ACTIVOS[sym]?.clase || 'CRYPTO',
        cant,
        costoUnit,
        precioActual,
        costoPosicion,
        valorActual,
        pnlAbierto,
        pnlPct,
        origen: pos?.origen || 'manual',
        tp: pos?.tp || null,
        sl: pos?.sl || null,
      });
    }

    items.sort((a, b) => b.valorActual - a.valorActual);

    const pnlNoRealizado = valorMercadoAbierto - costoTotalAbierto;
    const pnlRealizado = pnlTotal - pnlNoRealizado;

    return {
      items,
      costoTotalAbierto,
      valorMercadoAbierto,
      pnlNoRealizado,
      pnlRealizado,
    };
  }, [perfil?.posiciones, precios, pnlTotal]);

  // Estadísticas de transacciones
  const statsTransacciones = useMemo(() => {
    let compras = 0;
    let ventas = 0;
    let opsBot = 0;
    let volumenUSD = 0;
    let ventasGanadoras = 0;

    for (const o of ordenes) {
      const total = Number(o.total || 0);
      volumenUSD += total;
      if (o.tipo === 'compra') compras += 1;
      if (o.tipo === 'venta') {
        ventas += 1;
        if (Number(o.pnl || 0) >= 0) ventasGanadoras += 1;
      }
      if (o.origen && o.origen !== 'manual') {
        opsBot += 1;
      }
    }

    const winrateVentas = ventas > 0 ? (ventasGanadoras / ventas) * 100 : null;

    return {
      total: ordenes.length,
      compras,
      ventas,
      opsBot,
      volumenUSD,
      winrateVentas,
    };
  }, [ordenes]);

  // Construcción de la serie temporal de Crecimiento del Portafolio ($10,000 USD base -> presente)
  const puntosCurva = useMemo(() => {
    const baseTimeSec = Math.floor(Date.now() / 1000) - 3600 * 12;
    const ordenadasAsc = [...ordenes].sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

    const pts = [];
    const tInicio =
      ordenadasAsc.length > 0
        ? Math.floor(Number(ordenadasAsc[0].ts) / 1000) - 300
        : baseTimeSec;

    pts.push({
      time: tInicio,
      patrimonio: SALDO_INICIAL,
      pnl: 0,
    });

    // Reconstruimos la trayectoria acumulada orden por orden
    let pnlAcum = 0;
    let ultimoTime = tInicio;

    for (const ord of ordenadasAsc) {
      let t = Math.floor(Number(ord.ts || Date.now()) / 1000);
      if (t <= ultimoTime) t = ultimoTime + 1;
      ultimoTime = t;

      const deltaPnl =
        typeof ord.pnl === 'number' && Number.isFinite(ord.pnl)
          ? Number(ord.pnl)
          : -Number(ord.comision || 0);
      pnlAcum += deltaPnl;

      const patPunto = SALDO_INICIAL + pnlAcum;
      pts.push({
        time: t,
        patrimonio: Number(patPunto.toFixed(2)),
        pnl: Number(pnlAcum.toFixed(2)),
      });
    }

    // Punto final en tiempo real con el patrimonio actual (incluyendo PnL flotante en vivo)
    let tAhora = Math.floor(Date.now() / 1000);
    if (tAhora <= ultimoTime) tAhora = ultimoTime + 1;

    pts.push({
      time: tAhora,
      patrimonio: Number(patrimonio.toFixed(2)),
      pnl: Number(pnlTotal.toFixed(2)),
    });

    return pts;
  }, [ordenes, patrimonio, pnlTotal]);

  const maxPatrimonio = useMemo(() => {
    return puntosCurva.reduce((max, p) => Math.max(max, p.patrimonio), SALDO_INICIAL);
  }, [puntosCurva]);

  // Inicializar gráfico lightweight-charts para la curva de crecimiento / PnL
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return undefined;

    const chart = createChart(container, {
      width: container.clientWidth || 640,
      height: 225,
      layout: {
        background: { type: ColorType.Solid, color: '#0d111a' },
        textColor: '#8b95a5',
        fontFamily: "'Inter', -apple-system, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#151b28' },
        horzLines: { color: '#151b28' },
      },
      rightPriceScale: {
        borderColor: '#1e2433',
      },
      timeScale: {
        borderColor: '#1e2433',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const areaSeries = chart.addAreaSeries({
      lineColor: '#16c784',
      topColor: 'rgba(22, 199, 132, 0.28)',
      bottomColor: 'rgba(22, 199, 132, 0.02)',
      lineWidth: 2,
    });

    chartInstanceRef.current = chart;
    areaSeriesRef.current = areaSeries;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0 && chartInstanceRef.current) {
          chartInstanceRef.current.applyOptions({ width });
        }
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chartInstanceRef.current = null;
      areaSeriesRef.current = null;
      baseLineRef.current = null;
      chart.remove();
    };
  }, []);

  // Actualizar datos y color de la curva cuando cambia patrimonio, ordenes o modoGrafico
  useEffect(() => {
    const series = areaSeriesRef.current;
    const chart = chartInstanceRef.current;
    if (!series || !chart) return;

    const esPositivo = pnlTotal >= 0;
    series.applyOptions({
      lineColor: esPositivo ? '#16c784' : '#ea3943',
      topColor: esPositivo
        ? 'rgba(22, 199, 132, 0.28)'
        : 'rgba(234, 57, 67, 0.28)',
      bottomColor: esPositivo
        ? 'rgba(22, 199, 132, 0.02)'
        : 'rgba(234, 57, 67, 0.02)',
    });

    const dataFormateada = puntosCurva.map((p) => ({
      time: p.time,
      value: modoGrafico === 'patrimonio' ? p.patrimonio : p.pnl,
    }));

    series.setData(dataFormateada);

    if (baseLineRef.current) {
      try {
        series.removePriceLine(baseLineRef.current);
      } catch (_) {}
      baseLineRef.current = null;
    }

    baseLineRef.current = series.createPriceLine({
      price: modoGrafico === 'patrimonio' ? SALDO_INICIAL : 0,
      color: '#6366f1',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: modoGrafico === 'patrimonio' ? 'Base $10,000' : 'Break-even $0',
    });

    chart.timeScale().fitContent();
  }, [puntosCurva, modoGrafico, pnlTotal]);

  // Señal actual del Bot para operar con el saldo del usuario
  const botSym = botEstado?.asset || 'BTC_USDT';
  const botSignal = botEstado?.signal_now || (botEstado?.position ? botEstado.position.side : 'HOLD');
  const botCotizacion = precios?.[botSym];
  const botPrecio =
    (botCotizacion?.disponible && Number(botCotizacion.p) > 0
      ? Number(botCotizacion.p)
      : Number(botEstado?.price || 0)) || 0;

  const aplicarRecomendacionBot = async () => {
    if (!uid || !perfil) return;
    if (!esPro) {
      if (onGoToBot) onGoToBot();
      return;
    }
    if (botPrecio <= 0) {
      onToast('Esperando cotización del activo recomendado por el bot.', 'warn');
      return;
    }

    const posActualEnBotSym = perfil?.posiciones?.[botSym];
    const tieneTenencia = Number(posActualEnBotSym?.cant || 0) > 1e-8;

    setEjecutandoBot(true);
    try {
      // Si el bot señala SHORT y el usuario tiene el activo, vendemos para proteger ganancia
      if (botSignal === 'SHORT' && tieneTenencia) {
        const res = await ejecutarOperacionUsuario(uid, perfil, {
          tipo: 'venta',
          sym: botSym,
          precio: botPrecio,
          fraccionVenta: 1,
          origen: 'bot_senal',
          nota: `Venta sugerida por Bot (${botEstado?.strategy || 'Quant'})`,
        });
        onToast(
          `Señal del Bot aplicada: Vendiste ${botSym} por ${fmtUSD.format(res.total)} (PnL: ${fmtSignedUSD(res.pnl)}).`,
          'success'
        );
      } else {
        // Invertir el % configurado del saldo propio del usuario en el activo que analiza/recomienda el bot
        const montoInversion = Math.max(25, (efectivo * botPctSaldo) / 100);
        const tpSugerido =
          botEstado?.position?.tp || Number((botPrecio * 1.035).toFixed(4));
        const slSugerido =
          botEstado?.position?.sl || Number((botPrecio * 0.98).toFixed(4));

        const res = await ejecutarOperacionUsuario(uid, perfil, {
          tipo: 'compra',
          sym: botSym,
          precio: botPrecio,
          montoUSD: montoInversion,
          origen: 'bot_senal',
          nota: `Recomendación Bot (${botEstado?.strategy || 'Chartismo'})`,
          tp: tpSugerido,
          sl: slSugerido,
        });
        onToast(
          `Compraste ${fmtUSD.format(res.total)} de ${botSym} con tu propio saldo siguiendo al Bot.`,
          'success'
        );
      }
    } catch (err) {
      onToast(err?.message || 'No se pudo aplicar la señal del bot.', 'error');
    } finally {
      setEjecutandoBot(false);
    }
  };

  const cambiarAutoBotUsuario = async () => {
    if (!uid || !perfil) return;
    if (!esPro) {
      onToast('Activa el Plan Pro en la pestaña Bot de trading para usar Auto-Compra.', 'info');
      if (onGoToBot) onGoToBot();
      return;
    }
    const nuevoEstado = !botAutoUser;
    try {
      await actualizarConfigBotUsuario(uid, { botAutoUser: nuevoEstado });
      onToast(
        nuevoEstado
          ? `Auto-Trading Pro activado: el bot operará automáticamente usando el ${botPctSaldo}% de tu saldo.`
          : 'Auto-Trading Pro pausado en tu cuenta.',
        nuevoEstado ? 'success' : 'info'
      );
    } catch (_) {
      onToast('No se pudo actualizar la configuración de Auto-Trading.', 'error');
    }
  };

  const cambiarPctBot = async (nuevoPct) => {
    if (!uid) return;
    try {
      await actualizarConfigBotUsuario(uid, { botPctSaldo: Number(nuevoPct) });
    } catch (_) {}
  };

  const confirmarReiniciar10k = async () => {
    if (!uid) return;
    try {
      await reiniciarPortafolio10k(uid);
      setConfirmandoReset(false);
      onToast('Tu cuenta de casa de bolsa se restableció a $10,000.00 USD.', 'success');
    } catch (_) {
      onToast('No se pudo reiniciar el saldo.', 'error');
    }
  };

  const pctInvertido =
    patrimonio > 0 ? Math.min(100, (valorPosiciones / patrimonio) * 100) : 0;

  return (
    <section className="dashboard-exec-section" aria-label="Dashboard principal del portafolio">
      {/* Encabezado Ejecutivo del Dashboard */}
      <div className="dashboard-exec-header">
        <div>
          <div className="dashboard-title-row">
            <h2 className="dashboard-exec-title">
              Dashboard de Casa de Bolsa · Cuenta de {perfil?.nombre || 'Inversionista'}
            </h2>
            <span className="dashboard-sim-pill">
              💵 Capital Virtual Asignado: $10,000.00 USD
            </span>
          </div>
          <p className="text-sec" style={{ fontSize: '12px', marginTop: '2px' }}>
            Opera libremente con tus $10,000 USD en acciones, ETFs y cripto. El Bot Quant actúa como tu asesor de señales y puede comprar automáticamente usando tu propio saldo.
          </p>
        </div>

        <div className="dashboard-header-actions">
          {!confirmandoReset ? (
            <button
              type="button"
              className="btn btn-outline btn-xs"
              onClick={() => setConfirmandoReset(true)}
            >
              ↺ Reiniciar a $10,000 USD
            </button>
          ) : (
            <div className="reset-confirm-inline">
              <span>¿Restablecer saldo a $10,000?</span>
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={confirmarReiniciar10k}
              >
                Sí, reiniciar
              </button>
              <button
                type="button"
                className="btn btn-outline btn-xs"
                onClick={() => setConfirmandoReset(false)}
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tarjeta "Tu plan" (Sección 5.1 bis) */}
      {perfil?.onboarding_ok && (
        <div className="panel tu-plan-card">
          <div className="tu-plan-info">
            <span className="onb-badge">TU PLAN EN BOLSALAB</span>
            <div>
              <strong>
                Objetivo:{' '}
                {perfil.objetivo === 'graficos'
                  ? '📈 Aprender a leer gráficos'
                  : perfil.objetivo === 'trading'
                  ? '⚡ Trading de corto plazo (day trading)'
                  : perfil.objetivo === 'largo_plazo'
                  ? '💼 Invertir a largo plazo con Portafolio ML'
                  : '🧭 Explorar toda la plataforma'}
              </strong>
              {perfil.perfil_riesgo && (
                <span className="text-sec" style={{ marginLeft: '10px', fontSize: '12.5px' }}>
                  Perfil de riesgo: <strong>{String(perfil.perfil_riesgo).toUpperCase()}</strong>
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {onSelectSeccion && (
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={() =>
                  onSelectSeccion(
                    perfil.objetivo === 'graficos'
                      ? 'juego'
                      : perfil.objetivo === 'largo_plazo'
                      ? 'portafolio'
                      : 'mercado'
                  )
                }
              >
                Ir a mi sección recomendada →
              </button>
            )}
            {onCambiarObjetivo && (
              <button
                type="button"
                className="btn btn-outline btn-xs"
                onClick={onCambiarObjetivo}
              >
                Cambiar mi objetivo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Fila 1: 4 Tarjetas KPI del Dashboard */}
      <div className="dashboard-kpi-grid">
        {/* KPI 1: Valor del Portafolio y Crecimiento */}
        <div className="panel dash-kpi-card highlight-card">
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">VALOR TOTAL DEL PORTAFOLIO</span>
            <span
              className={`dash-badge tabular ${
                rendimientoPct >= 0 ? 'pos' : 'neg'
              }`}
            >
              {fmtSignedPct(rendimientoPct)}
            </span>
          </div>
          <div className="dash-kpi-main tabular">{fmtUSD.format(patrimonio)}</div>
          <div className="dash-kpi-subrow tabular">
            <span>Capital inicial: {fmtUSD.format(SALDO_INICIAL)}</span>
            <span className={pnlTotal >= 0 ? 'text-green' : 'text-red'}>
              {fmtSignedUSD(pnlTotal)}
            </span>
          </div>
        </div>

        {/* KPI 2: Profit & Loss (PnL Total, Abierto y Realizado) */}
        <div className="panel dash-kpi-card">
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">PROFIT &amp; LOSS (P&amp;L NETO)</span>
            <span className="dash-mini-tag">En tiempo real</span>
          </div>
          <div
            className={`dash-kpi-main tabular ${
              pnlTotal >= 0 ? 'text-green' : 'text-red'
            }`}
          >
            {fmtSignedUSD(pnlTotal)}
          </div>
          <div className="dash-pnl-split tabular">
            <div>
              <span className="text-sec">P&amp;L Abierto: </span>
              <strong
                className={
                  detallePosiciones.pnlNoRealizado >= 0 ? 'text-green' : 'text-red'
                }
              >
                {fmtSignedUSD(detallePosiciones.pnlNoRealizado)}
              </strong>
            </div>
            <div>
              <span className="text-sec">P&amp;L Realizado: </span>
              <strong
                className={
                  detallePosiciones.pnlRealizado >= 0 ? 'text-green' : 'text-red'
                }
              >
                {fmtSignedUSD(detallePosiciones.pnlRealizado)}
              </strong>
            </div>
          </div>
        </div>

        {/* KPI 3: Efectivo Disponible vs Capital Invertido */}
        <div className="panel dash-kpi-card">
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">MI SALDO DISPONIBLE (EFECTIVO)</span>
            <span className="dash-mini-tag tabular">
              {detallePosiciones.items.length} activos
            </span>
          </div>
          <div className="dash-kpi-main tabular">{fmtUSD.format(efectivo)}</div>
          <div className="dash-alloc-bar">
            <div
              className="dash-alloc-fill"
              style={{ width: `${pctInvertido.toFixed(1)}%` }}
            />
          </div>
          <div className="dash-kpi-subrow tabular">
            <span>Invertido: {fmtUSD.format(valorPosiciones)}</span>
            <span>{pctInvertido.toFixed(1)}% en activos</span>
          </div>
        </div>

        {/* KPI 4: Señal del Bot Quant & Auto-Compra con tu Saldo */}
        {(() => {
          const tsBot = Number(botEstado?.ts || 0);
          const botDesconectado = tsBot <= 0 || Math.round(Date.now() / 1000 - tsBot) > 60;
          return (
        <div className="panel dash-kpi-card bot-signal-kpi">
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">
              SEÑAL DEL BOT QUANT{PRO_GRATIS ? '' : ' (PRO)'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {botDesconectado && (
                <span className="status-pill offline" style={{ fontSize: '11px', padding: '2px 8px' }}>
                  Bot desconectado
                </span>
              )}
              <button
                type="button"
                className={`bot-auto-pill ${botAutoUser && esPro ? 'on' : 'off'}`}
                onClick={cambiarAutoBotUsuario}
              >
                {esPro
                  ? botAutoUser
                    ? '🪞 Copiar operaciones del bot (cuenta espejo): ON'
                    : '🪞 Copiar operaciones del bot (cuenta espejo): OFF'
                  : '🔒 Plan Pro'}
              </button>
            </div>
          </div>

          {botDesconectado && botEstado?.position && (
            <div style={{ fontSize: '11.5px', color: '#fbbf24', marginTop: '4px' }}>
              Última posición conocida: {botEstado.position.asset} {botEstado.position.side}
            </div>
          )}

          <div className="dash-bot-signal-row">
            <div>
              <span className="dash-bot-asset">{botSym.replace('_USDT', '')}</span>
              <span
                className={`dash-signal-badge ${
                  botSignal === 'LONG'
                    ? 'buy'
                    : botSignal === 'SHORT'
                    ? 'sell'
                    : 'hold'
                }`}
              >
                {botSignal === 'LONG'
                  ? '▲ COMPRA SUGERIDA'
                  : botSignal === 'SHORT'
                  ? '▼ VENTA / TOMAR GANANCIA'
                  : `⚪ VIGILANDO (${botEstado?.chart_pattern || 'Ruptura'})`}
              </span>
            </div>
            <span className="tabular dash-bot-price">
              {botPrecio > 0 ? fmtUSD.format(botPrecio) : '—'}
            </span>
          </div>

          <div className="dash-bot-actions-row">
            <select
              className="dash-pct-select"
              value={botPctSaldo}
              onChange={(e) => cambiarPctBot(e.target.value)}
              title="Porcentaje de tu saldo disponible a invertir por señal del bot"
            >
              <option value={10}>Usar 10% de mi saldo</option>
              <option value={15}>Usar 15% de mi saldo</option>
              <option value={25}>Usar 25% de mi saldo</option>
              <option value={50}>Usar 50% de mi saldo</option>
            </select>

            <button
              type="button"
              className="btn btn-primary btn-xs"
              disabled={ejecutandoBot}
              onClick={aplicarRecomendacionBot}
            >
              {esPro
                ? ejecutandoBot
                  ? 'Ejecutando...'
                  : `⚡ Operar ${botSym.replace('_USDT', '')} con mi saldo`
                : '🔓 Desbloquear Bot Pro'}
            </button>
          </div>
        </div>
          );
        })()}
      </div>

      {/* Fila 2: Gráfico de Crecimiento del Portafolio + Desglose de P&L y Transacciones */}
      <div className="dashboard-charts-row">
        {/* Gráfico de Crecimiento del Portafolio y Profit & Loss */}
        <div className="panel dash-growth-panel">
          <div className="dash-panel-header">
            <div>
              <h3 className="dash-panel-title">
                {modoGrafico === 'patrimonio'
                  ? '📈 Crecimiento del Portafolio ($ USD)'
                  : '💹 Curva de Profit & Loss Acumulado ($ USD)'}
              </h3>
              <span className="text-sec tabular" style={{ fontSize: '12px' }}>
                Base inicial: $10,000.00 USD · Máximo alcanzado:{' '}
                <strong>{fmtUSD.format(maxPatrimonio)}</strong> · Transacciones:{' '}
                <strong>{statsTransacciones.total}</strong> · Volumen:{' '}
                <strong>{fmtUSD.format(statsTransacciones.volumenUSD)}</strong>
              </span>
            </div>

            <div className="dash-toggle-group">
              <button
                type="button"
                className={`dash-toggle-btn ${
                  modoGrafico === 'patrimonio' ? 'active' : ''
                }`}
                onClick={() => setModoGrafico('patrimonio')}
              >
                Crecimiento ($10k+)
              </button>
              <button
                type="button"
                className={`dash-toggle-btn ${
                  modoGrafico === 'pnl' ? 'active' : ''
                }`}
                onClick={() => setModoGrafico('pnl')}
              >
                Profit &amp; Loss ($)
              </button>
            </div>
          </div>

          <div ref={chartContainerRef} className="dash-growth-chart-box" />
        </div>

        {/* Panel derecho: PnL por Activo y Últimas Transacciones */}
        <div className="panel dash-breakdown-panel">
          <div className="dash-panel-header">
            <div className="dash-toggle-group">
              <button
                type="button"
                className={`dash-toggle-btn ${
                  vistaDerecha === 'activos' ? 'active' : ''
                }`}
                onClick={() => setVistaDerecha('activos')}
              >
                Mis operaciones abiertas ({detallePosiciones.items.length})
              </button>
              <button
                type="button"
                className={`dash-toggle-btn ${
                  vistaDerecha === 'transacciones' ? 'active' : ''
                }`}
                onClick={() => setVistaDerecha('transacciones')}
              >
                Transacciones ({statsTransacciones.total})
              </button>
            </div>

            <span className="text-sec tabular" style={{ fontSize: '11px' }}>
              {statsTransacciones.opsBot > 0
                ? `${statsTransacciones.opsBot} vía Bot`
                : `${statsTransacciones.compras}C / ${statsTransacciones.ventas}V`}
            </span>
          </div>

          {vistaDerecha === 'activos' ? (
            <div className="dash-list-scroll">
              {detallePosiciones.items.length === 0 ? (
                <div className="dash-empty-box">
                  <p>Tu portafolio está 100% en efectivo ({fmtUSD.format(efectivo)}).</p>
                  <p className="text-sec" style={{ fontSize: '12px', marginTop: '4px' }}>
                    Compra cualquier acción, ETF o cripto abajo, o pulsa{' '}
                    <strong>“Operar con mi saldo”</strong> en la señal del Bot Quant.
                  </p>
                </div>
              ) : (
                detallePosiciones.items.map((item) => {
                  const pesoPct =
                    patrimonio > 0 ? (item.valorActual / patrimonio) * 100 : 0;
                  return (
                    <div
                      key={item.sym}
                      className="dash-asset-pnl-row"
                      onClick={() =>
                        onSelectAsset && onSelectAsset(item.sym, item.clase)
                      }
                    >
                      <div className="dash-asset-left">
                        <div className="dash-asset-sym-line">
                          <strong>{item.sym.replace('_USDT', '')}</strong>
                          <span className="dash-weight-pill tabular">
                            {pesoPct.toFixed(1)}%
                          </span>
                          {item.origen && item.origen !== 'manual' && (
                            <span
                              className={`dash-origin-pill ${
                                item.origen === 'portafolio' ? 'portafolio' : ''
                              }`}
                            >
                              {item.origen === 'portafolio'
                                ? '💼 Portafolio'
                                : item.origen === 'copia' || item.origen === 'bot_auto'
                                ? '🤖 Copia bot'
                                : '🤖 Bot'}
                            </span>
                          )}
                        </div>
                        <span className="text-sec tabular" style={{ fontSize: '11px' }}>
                          {item.cant.toFixed(4)} u. · Costo {fmtUSD.format(item.costoUnit)}
                        </span>
                      </div>

                      <div className="dash-asset-right tabular">
                        <strong>{fmtUSD.format(item.valorActual)}</strong>
                        <span
                          className={
                            item.pnlAbierto >= 0 ? 'text-green' : 'text-red'
                          }
                          style={{ fontSize: '12px', fontWeight: 600 }}
                        >
                          {fmtSignedUSD(item.pnlAbierto)} ({fmtSignedPct(item.pnlPct)})
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="dash-list-scroll">
              {ordenes.length === 0 ? (
                <div className="dash-empty-box">
                  <p>Aún no has realizado transacciones.</p>
                </div>
              ) : (
                ordenes.slice(0, 12).map((o) => {
                  const labelOrigen =
                    o.origen === 'copia' || o.origen === 'bot_auto'
                      ? '🤖 Copia bot'
                      : o.origen === 'portafolio'
                      ? '💼 Portafolio'
                      : o.origen === 'bot'
                      ? '🤖 Bot'
                      : null;
                  return (
                    <div key={o.id} className="dash-tx-row tabular">
                      <div>
                        <div className="dash-asset-sym-line">
                          <span
                            className={`order-type-pill ${
                              o.tipo === 'compra' ? 'buy' : 'sell'
                            }`}
                          >
                            {o.tipo === 'compra' ? 'COMPRA' : 'VENTA'}
                          </span>
                          <strong>{(o.sym || '').replace('_USDT', '')}</strong>
                          {labelOrigen && (
                            <span
                              className={`dash-origin-pill ${
                                o.origen === 'portafolio' ? 'portafolio' : ''
                              }`}
                            >
                              {labelOrigen}
                            </span>
                          )}
                        </div>
                        <span className="text-sec" style={{ fontSize: '11px' }}>
                          {fmtHoraCorta(o.ts)} · @ {fmtUSD.format(Number(o.precio || 0))}
                        </span>
                      </div>

                      <div className="dash-asset-right">
                        <strong>{fmtUSD.format(Number(o.total || 0))}</strong>
                        {o.tipo === 'venta' && typeof o.pnl === 'number' ? (
                          <span
                            className={o.pnl >= 0 ? 'text-green' : 'text-red'}
                            style={{ fontSize: '11px', fontWeight: 600 }}
                          >
                            P&amp;L: {fmtSignedUSD(o.pnl)}
                          </span>
                        ) : (
                          <span className="text-sec" style={{ fontSize: '11px' }}>
                            Com: {fmtUSD.format(Number(o.comision || 0))}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
