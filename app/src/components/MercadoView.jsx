import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CATALOGO_ACTIVOS, CATEGORIAS_CATALOGO, MAPA_ACTIVOS } from '../data/catalogo';
import TradingViewWidget from './TradingViewWidget';
import CerrarPosicionModal, { obtenerPrecioVivoPosicion } from './CerrarPosicionModal';
import { normalizarPosicionesAbiertas } from './MisPosicionesView';
import { COMISION, calcularPnlPosicion } from '../config/tradingConfig';
import {
  ejecutarOperacionUsuario,
  abrirPosicionApalancadaManual,
  escucharOrdenesUsuario,
  enviarComandoBot,
  publicarRanking,
  consultarGemini,
  SALDO_INICIAL,
} from '../services/firebase';

const MINI_ASSETS = [
  'BTC_USDT',
  'ETH_USDT',
  'SOL_USDT',
  'XRP_USDT',
  'BNB_USDT',
  'NVDA',
  'AAPL',
  'MSFT',
];

const TFS_MERCADO = [
  { id: '1m', tvInterval: '1', botTf: '1m', largo: '1 minuto' },
  { id: '5m', tvInterval: '5', botTf: '5m', largo: '5 minutos' },
  { id: '15m', tvInterval: '15', botTf: '15m', largo: '15 minutos' },
  { id: '1h', tvInterval: '60', botTf: '1h', largo: '1 hora' },
  { id: '4h', tvInterval: '240', botTf: '4h', largo: '4 horas' },
  { id: '1D', tvInterval: 'D', botTf: '1d', largo: '1 día' },
  { id: '1S', tvInterval: 'W', botTf: '1d', largo: '1 semana' },
  { id: '1A', tvInterval: 'M', botTf: '1d', largo: '1 mes' },
];

function fmtNum(n, dec = 2) {
  const val = Number(n);
  if (!Number.isFinite(val)) return '0.00';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtPrecio(p) {
  const val = Number(p);
  if (!Number.isFinite(val) || val <= 0) return '0.00';
  if (val < 1) return fmtNum(val, 4);
  return fmtNum(val, 2);
}

function fmtCant(c) {
  const val = Number(c);
  if (!Number.isFinite(val) || val <= 0) return '0.0000';
  if (val >= 100) return val.toFixed(2);
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(5);
}

function etiquetaClase(clase) {
  if (clase === 'STOCK') return 'Acciones';
  if (clase === 'ETF') return 'ETFs';
  return 'Cripto';
}

function generarSparklinePath(sym, chg) {
  let seed = 0;
  for (let i = 0; i < sym.length; i++) {
    seed = (seed * 31 + sym.charCodeAt(i)) % 997;
  }
  const sube = Number(chg || 0) >= 0;
  const pts = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const wave =
      Math.sin(t * Math.PI * 2.2 + seed * 0.1) * 3.5 + Math.cos(t * 4.5 + seed) * 2.0;
    const trend = sube ? (1 - t) * 7 - 3.5 : t * 7 - 3.5;
    const y = Math.max(3, Math.min(21, 12 + trend + wave));
    const x = 2 + t * 56;
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

export default function MercadoView({
  uid,
  perfil,
  precios,
  resumenFinanciero,
  botEstado = null,
  onSelectSeccion,
  onToast,
}) {
  const [symActivo, setSymActivo] = useState('BTC_USDT');
  const [tfId, setTfId] = useState('5m');
  const [filtroCat, setFiltroCat] = useState('DESTACADOS'); // 'DESTACADOS' | 'CRYPTO' | 'STOCK' | 'ETF' | 'TODOS'
  const [busquedaActivo, setBusquedaActivo] = useState('');

  // Boleta de orden
  const [tipoOrden, setTipoOrden] = useState('compra'); // 'compra' | 'venta'
  const [montoStr, setMontoStr] = useState('500.00');
  const [levStr, setLevStr] = useState('1'); // editable libremente (>= 1)
  const [slStr, setSlStr] = useState('3');
  const [tpStr, setTpStr] = useState('5');
  const [ejecutandoOrden, setEjecutandoOrden] = useState(false);
  const [ordenFlash, setOrdenFlash] = useState(null);

  const apalancamiento = useMemo(() => {
    const n = parseFloat(levStr);
    return Number.isFinite(n) && n >= 1 ? Math.round(n * 100) / 100 : 1;
  }, [levStr]);
  const slPct = useMemo(() => {
    const n = parseFloat(slStr);
    return Number.isFinite(n) && n > 0 ? Math.min(99, Math.round(n * 100) / 100) : 3;
  }, [slStr]);
  const tpPct = useMemo(() => {
    const n = parseFloat(tpStr);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 5;
  }, [tpStr]);

  useEffect(() => {
    if (!ordenFlash) return undefined;
    const t = setTimeout(() => setOrdenFlash(null), 900);
    return () => clearTimeout(t);
  }, [ordenFlash]);

  // Analista IA de portafolio
  const [analizandoIA, setAnalizandoIA] = useState(false);
  const [respuestaIA, setRespuestaIA] = useState('');

  // Tabla inferior
  const [tabInferior, setTabInferior] = useState('posiciones'); // 'posiciones' | 'hoy' | 'historial'
  const [ordenes, setOrdenes] = useState([]);
  const [posACerrar, setPosACerrar] = useState(null);

  const ultimaPublicacionRankingRef = useRef(0);

  useEffect(() => {
    if (!uid) return undefined;
    const uOrd = escucharOrdenesUsuario(uid, (lista) => setOrdenes(lista));
    return () => {
      uOrd();
    };
  }, [uid]);

  const efectivo = Number(resumenFinanciero?.efectivo ?? SALDO_INICIAL);
  const valorPosiciones = Number(resumenFinanciero?.valorPosiciones ?? 0);
  const patrimonio = Number(resumenFinanciero?.patrimonio ?? SALDO_INICIAL);
  const rendimientoPct = Number(resumenFinanciero?.rendimientoPct ?? 0);

  useEffect(() => {
    if (!uid || !perfil) return;
    const ahora = Date.now();
    if (ahora - ultimaPublicacionRankingRef.current < 60000) return;
    ultimaPublicacionRankingRef.current = ahora;
    publicarRanking(uid, {
      nombre: perfil.nombre || 'Estudiante',
      xp: Number(perfil.xp || 0),
      rend: Number(rendimientoPct.toFixed(2)),
    }).catch(() => {});
  }, [uid, perfil, rendimientoPct]);

  const activoInfo = MAPA_ACTIVOS[symActivo] || CATALOGO_ACTIVOS[0];
  const esCriptoActivo = activoInfo.clase === 'CRYPTO';
  const etiquetaPeriodo = esCriptoActivo ? '24h' : 'hoy';
  const symDisplay = symActivo.replace('_', '/');
  const symCorto = symActivo.replace('_USDT', '');

  const cotViva = precios?.[symActivo];
  const mercadoCerradoActivo =
    !esCriptoActivo && cotViva && cotViva.abierto === false;

  const precioActual =
    cotViva?.disponible && Number(cotViva.p) > 0
      ? Number(cotViva.p)
      : symActivo === botEstado?.asset && Number(botEstado?.price) > 0
        ? Number(botEstado.price)
        : esCriptoActivo
          ? 63904.6
          : 185.0;
  const cambioPct = Number(cotViva?.chg ?? (esCriptoActivo ? -8.21 : 0.45));
  const sube = cambioPct >= 0;
  const precioPrevio = precioActual / (1 + cambioPct / 100);
  const cambioAbs = precioActual - precioPrevio;

  const tfConfig = TFS_MERCADO.find((t) => t.id === tfId) || TFS_MERCADO[1];

  // Tenencia spot actual del activo elegido
  const posSpotActual = perfil?.posiciones?.[symActivo] || null;
  const cantTenencia = Number(posSpotActual?.cant || 0);
  const valorTenenciaUSD = precioActual > 0 ? cantTenencia * precioActual : 0;

  // Posiciones abiertas del usuario (Manual, Copia bot, Portafolio — nunca la cuenta simulada del bot)
  const posicionesUsuario = useMemo(() => {
    const todas = normalizarPosicionesAbiertas(perfil, null);
    return todas.filter((p) => p.origen !== 'bot');
  }, [perfil]);

  const inicioHoyMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const cerradasHoy = useMemo(
    () =>
      ordenes.filter(
        (o) =>
          o.tipo === 'venta' &&
          Number(o.ts || 0) >= inicioHoyMs &&
          o.origen !== 'bot'
      ),
    [ordenes, inicioHoyMs]
  );

  const pnlCerradoHoy = useMemo(
    () => cerradasHoy.reduce((acc, o) => acc + Number(o.pnl || 0), 0),
    [cerradasHoy]
  );

  const pnlAbiertoUsuario = useMemo(() => {
    return posicionesUsuario.reduce((acc, p) => {
      const px = obtenerPrecioVivoPosicion(p, precios, botEstado);
      const { pnlUSD } = calcularPnlPosicion({
        side: p.side,
        entrada: p.entrada,
        precioActual: px,
        cantidad: p.cantidad,
        margen: p.margen,
      });
      return acc + pnlUSD;
    }, 0);
  }, [posicionesUsuario, precios, botEstado]);

  const pnlHoyTotal = pnlCerradoHoy + pnlAbiertoUsuario;
  const pnlHoyPct = (pnlHoyTotal / SALDO_INICIAL) * 100;

  // Cálculos dinámicos de la boleta ("Si baja X% pierdes" y "Si sube X% ganas" según monto, apalancamiento y protección)
  const montoNum = parseFloat(montoStr);
  const montoValido = Number.isFinite(montoNum) && montoNum > 0 ? montoNum : 0;
  const exposicionNocional = montoValido * apalancamiento;
  const recibesCant = precioActual > 0 ? exposicionNocional / precioActual : 0;
  const comisionEstimadaUSD = exposicionNocional * COMISION;
  const perdidaEstimadaUSD = Math.min(montoValido, exposicionNocional * (slPct / 100));
  const gananciaEstimadaUSD = exposicionNocional * (tpPct / 100);

  const aplicarPorcentajeMonto = (pct) => {
    if (tipoOrden === 'venta' && apalancamiento === 1 && cantTenencia > 0 && precioActual > 0) {
      const montoVenta = (cantTenencia * precioActual * pct) / 100;
      setMontoStr(Math.max(0.5, Math.floor(montoVenta * 100) / 100).toFixed(2));
      return;
    }
    if (efectivo <= 0) {
      setMontoStr('0.00');
      return;
    }
    const bruto = pct === 100 ? efectivo / (1 + COMISION) : (efectivo * pct) / 100;
    setMontoStr(Math.max(1, Math.floor(bruto * 100) / 100).toFixed(2));
  };

  const handleEjecutarOrden = async (e) => {
    e.preventDefault();
    if (!uid || !perfil || ejecutandoOrden) return;
    if (montoValido <= 0.5) {
      onToast?.('Ingresa un monto mayor a $0.50 USD.', 'warn');
      return;
    }
    if (precioActual <= 0) {
      onToast?.('Precio no disponible en este momento.', 'error');
      return;
    }

    const dir = tipoOrden === 'compra' ? 'LONG' : 'SHORT';
    const factorSl = dir === 'LONG' ? 1 - slPct / 100 : 1 + slPct / 100;
    const factorTp = dir === 'LONG' ? 1 + tpPct / 100 : 1 - tpPct / 100;
    const precioSl = Number((precioActual * factorSl).toFixed(4));
    const precioTp = Number((precioActual * factorTp).toFixed(4));

    setEjecutandoOrden(true);
    try {
      if (apalancamiento === 1 && tipoOrden === 'compra') {
        await ejecutarOperacionUsuario(uid, perfil, {
          tipo: 'compra',
          sym: symActivo,
          precio: precioActual,
          montoUSD: montoValido,
          origen: 'manual',
          tp: precioTp,
          sl: precioSl,
          nota: `Spot SL -${slPct}% / TP +${tpPct}%`,
        });
        setOrdenFlash('buy');
        onToast?.(
          `Compra ejecutada: ${fmtCant(recibesCant)} ${symCorto} ($${fmtNum(montoValido, 2)} USD)`,
          'success'
        );
      } else if (
        apalancamiento === 1 &&
        tipoOrden === 'venta' &&
        Number(perfil?.posiciones?.[symActivo]?.cant || 0) > 1e-8
      ) {
        const res = await ejecutarOperacionUsuario(uid, perfil, {
          tipo: 'venta',
          sym: symActivo,
          precio: precioActual,
          montoUSD: montoValido,
          origen: 'manual',
          nota: 'Venta manual Spot',
        });
        setOrdenFlash('sell');
        onToast?.(
          `Venta ejecutada: ${symCorto} (P&L: ${res.pnl >= 0 ? '+' : '-'}$${fmtNum(Math.abs(res.pnl), 2)})`,
          'success'
        );
      } else {
        await abrirPosicionApalancadaManual(uid, perfil, {
          sym: symActivo,
          side: dir,
          precio: precioActual,
          montoUSD: montoValido,
          leverage: apalancamiento,
          tp: precioTp,
          sl: precioSl,
        });
        setOrdenFlash(dir === 'SHORT' ? 'sell' : 'buy');
        onToast?.(
          `Posición ${dir} ${apalancamiento}x abierta en ${symCorto} ($${fmtNum(montoValido, 2)} USD)`,
          'success'
        );
      }
    } catch (err) {
      onToast?.(err?.message || 'No se pudo ejecutar la operación.', 'error');
    } finally {
      setEjecutandoOrden(false);
    }
  };

  // Analizar portafolio con Gemini (función restaurada)
  const handleAnalizarPortafolioIA = async () => {
    if (!uid || analizandoIA) return;
    setAnalizandoIA(true);
    setRespuestaIA('');
    try {
      const lineasPos =
        posicionesUsuario.length === 0
          ? 'Sin posiciones abiertas (100% en efectivo).'
          : posicionesUsuario
              .map((p) => {
                const px = obtenerPrecioVivoPosicion(p, precios, botEstado);
                const { pnlUSD, pnlPct } = calcularPnlPosicion({
                  side: p.side,
                  entrada: p.entrada,
                  precioActual: px,
                  cantidad: p.cantidad,
                  margen: p.margen,
                });
                return `- ${p.sym} (${p.origenLabel}, ${p.side} ${p.leverage || 1}x): entrada=$${fmtPrecio(
                  p.entrada
                )}, actual=$${fmtPrecio(px)}, margen=$${fmtNum(p.margen, 2)}, P&L=$${fmtNum(
                  pnlUSD,
                  2
                )} (${pnlPct.toFixed(2)}%)`;
              })
              .join('\n');

      const contexto = [
        `Efectivo disponible: $${fmtNum(efectivo, 2)}`,
        `Invertido en posiciones: $${fmtNum(valorPosiciones, 2)}`,
        `Patrimonio total: $${fmtNum(patrimonio, 2)} (${rendimientoPct >= 0 ? '+' : ''}${rendimientoPct.toFixed(2)}%)`,
        `Activo en pantalla: ${activoInfo.nombre} (${symDisplay}) a $${fmtPrecio(precioActual)} (${sube ? '+' : ''}${cambioPct.toFixed(2)}% ${etiquetaPeriodo})`,
        `Posiciones actuales:\n${lineasPos}`,
      ].join('\n');

      const res = await consultarGemini({
        uid,
        pregunta:
          'Analiza la diversificación, el riesgo y el desempeño actual de mi portafolio y dame recomendaciones educativas concretas.',
        contexto,
      });
      setRespuestaIA(res?.respuesta || 'Sin respuesta disponible.');
    } catch {
      setRespuestaIA('El bot no respondió. Revisa que esté corriendo.');
    } finally {
      setAnalizandoIA(false);
    }
  };

  // Lista de activos filtrados para mostrar en la cuadrícula (8 destacados o las 3 categorías completas: 10 Cripto, 10 Acciones, 8 ETFs)
  const activosMostrados = useMemo(() => {
    const q = busquedaActivo.trim().toLowerCase();
    if (q) {
      return CATALOGO_ACTIVOS.filter(
        (a) =>
          a.sym.toLowerCase().includes(q) ||
          a.nombre.toLowerCase().includes(q)
      );
    }
    if (filtroCat === 'CRYPTO' || filtroCat === 'STOCK' || filtroCat === 'ETF') {
      return CATALOGO_ACTIVOS.filter((a) => a.clase === filtroCat);
    }
    if (filtroCat === 'TODOS') {
      return CATALOGO_ACTIVOS;
    }
    // DESTACADOS (8 tarjetas rápidas, incluyendo el activo seleccionado si no estaba en los 8)
    const base = [...MINI_ASSETS];
    if (!base.includes(symActivo)) {
      base[base.length - 1] = symActivo;
    }
    return base.map((s) => MAPA_ACTIVOS[s]).filter(Boolean);
  }, [filtroCat, busquedaActivo, symActivo]);

  const senalBotRaw = String(botEstado?.signal_now || 'HOLD').toUpperCase();
  const senalBadge =
    senalBotRaw.includes('LONG') || senalBotRaw.includes('BUY')
      ? 'LONG'
      : senalBotRaw.includes('SHORT') || senalBotRaw.includes('SELL')
        ? 'SHORT'
        : 'ESPERAR';

  const textoRecomendacionBot = useMemo(() => {
    const raw = String(botEstado?.signal_text || '');
    if (raw && !raw.startsWith('Señal no disponible')) {
      const primeraParte = raw
        .split('|')[0]
        .replace(/[^\p{L}\p{N}\s.,:()/%+-]/gu, '')
        .trim();
      if (primeraParte) {
        return `${primeraParte}; el bot ${
          senalBadge === 'ESPERAR'
            ? 'espera confirmación antes de comprar.'
            : `sugiere entrada ${senalBadge}.`
        }`;
      }
    }
    return 'El precio está en un canal bajista; el bot espera confirmación antes de comprar.';
  }, [botEstado?.signal_text, senalBadge]);

  return (
    <div className="mercado-terminal-page">
      <div className="mercado-terminal-grid">
        {/* COLUMNA IZQUIERDA */}
        <div className="mercado-left-col">
          {/* 1. TARJETA PRINCIPAL DE GRÁFICA CON BORDE MORADO (WIDGET TRADINGVIEW EN VIVO) */}
          <section className="mercado-chart-card">
            <div className="mercado-chart-header">
              <div className="mercado-chart-title-block">
                <div className="mercado-asset-crumb">
                  <span>
                    {activoInfo.nombre} · {symDisplay}
                  </span>
                  <span className="mercado-class-pill">
                    {etiquetaClase(activoInfo.clase)}
                  </span>
                  <span className="mercado-tv-sym-pill num">{activoInfo.tv}</span>
                </div>
                <div className="mercado-price-headline">
                  <span className="mercado-big-price num">
                    ${fmtPrecio(precioActual)}
                  </span>
                  <span
                    className={`mercado-big-chg num ${
                      sube ? 'text-green' : 'text-red'
                    }`}
                  >
                    {sube ? '+' : '-'}${fmtNum(Math.abs(cambioAbs), 2)} (
                    {sube ? '+' : ''}
                    {cambioPct.toFixed(2)}%) {etiquetaPeriodo}
                  </span>
                  {mercadoCerradoActivo && (
                    <span className="mercado-closed-chip">Mercado cerrado</span>
                  )}
                </div>
              </div>

              <div className="mercado-chart-controls">
                <div className="mercado-tf-pills" role="tablist" aria-label="Temporalidades">
                  {TFS_MERCADO.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`mercado-tf-pill num ${tfId === t.id ? 'active' : ''}`}
                      onClick={() => {
                        setTfId(t.id);
                        if (uid) enviarComandoBot(uid, 'tf', t.botTf).catch(() => {});
                      }}
                    >
                      {t.id}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mercado-chart-canvas-wrap">
              <TradingViewWidget
                tvSymbol={activoInfo.tv}
                interval={tfConfig.tvInterval}
                height={330}
              />
            </div>

            <div className="mercado-chart-edu-bar">
              Estás viendo velas de {tfConfig.largo} en vivo ({activoInfo.tv}): cada barra es lo
              que hizo el precio en {tfConfig.largo} (verde subió, roja bajó). Usa la barra de
              herramientas izquierda de la gráfica para trazar líneas de tendencia, soportes y
              Fibonacci.
            </div>
          </section>

          {/* 2. SELECTOR DE LOS 28 ACTIVOS POR CATEGORÍA + CUADRÍCULA CON SPARKLINE */}
          <section className="mercado-assets-section" aria-label="Catálogo de activos">
            <div className="mercado-cat-bar">
              <div className="mercado-cat-tabs" role="tablist">
                <button
                  type="button"
                  className={`mercado-cat-tab ${filtroCat === 'DESTACADOS' ? 'active' : ''}`}
                  onClick={() => setFiltroCat('DESTACADOS')}
                >
                  Destacados (<span className="num">8</span>)
                </button>
                {CATEGORIAS_CATALOGO.map((cat) => {
                  const count = CATALOGO_ACTIVOS.filter((a) => a.clase === cat.id).length;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      className={`mercado-cat-tab ${filtroCat === cat.id ? 'active' : ''}`}
                      onClick={() => setFiltroCat(cat.id)}
                    >
                      {cat.label} (<span className="num">{count}</span>)
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`mercado-cat-tab ${filtroCat === 'TODOS' ? 'active' : ''}`}
                  onClick={() => setFiltroCat('TODOS')}
                >
                  Todos (<span className="num">{CATALOGO_ACTIVOS.length}</span>)
                </button>
              </div>

              <input
                type="search"
                className="mercado-asset-search"
                placeholder="Buscar activo (BTC, NVDA, SPY...)"
                value={busquedaActivo}
                onChange={(e) => setBusquedaActivo(e.target.value)}
                aria-label="Buscar activo"
              />
            </div>

            <div className="mercado-mini-grid" aria-label="Activos disponibles">
              {activosMostrados.map((item) => {
                const sym = item.sym;
                const esCripto = item.clase === 'CRYPTO';
                const sufijo = esCripto ? '24h' : 'hoy';
                const cot = precios?.[sym];
                const cerrado = !esCripto && cot && cot.abierto === false;
                const px =
                  cot?.disponible && Number(cot.p) > 0
                    ? Number(cot.p)
                    : sym === symActivo
                      ? precioActual
                      : Number(cot?.p || 0);
                const chg = Number(cot?.chg ?? 0);
                const pos = chg >= 0;
                const corto = sym.replace('_USDT', '');
                const activo = sym === symActivo;
                return (
                  <button
                    key={sym}
                    type="button"
                    className={`mercado-mini-card ${activo ? 'active' : ''}`}
                    onClick={() => setSymActivo(sym)}
                  >
                    <div className="mini-card-left">
                      <div className="mini-card-sym-row">
                        <span className="mini-card-sym">{corto}</span>
                        {cerrado && (
                          <span className="mercado-closed-chip xs">Mercado cerrado</span>
                        )}
                      </div>
                      <span className="mini-card-px num">
                        {px > 0 ? `$${fmtPrecio(px)}` : 'sin precio'}
                      </span>
                    </div>
                    <svg
                      className="mini-card-spark"
                      viewBox="0 0 60 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d={generarSparklinePath(sym, chg)}
                        stroke={pos ? '#22C55E' : '#EF4444'}
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span
                      className={`mini-card-chg num ${pos ? 'text-green' : 'text-red'}`}
                    >
                      {pos ? '+' : ''}
                      {chg.toFixed(2)}% <small className="chg-period">{sufijo}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. TABLA INFERIOR DE POSICIONES Y OPERACIONES DEL USUARIO */}
          <section className="mercado-positions-panel">
            <div className="bot-bottom-tabs">
              <button
                type="button"
                className={`bot-bottom-tab ${tabInferior === 'posiciones' ? 'active' : ''}`}
                onClick={() => setTabInferior('posiciones')}
              >
                Mis posiciones (<span className="num">{posicionesUsuario.length}</span>)
              </button>
              <button
                type="button"
                className={`bot-bottom-tab ${tabInferior === 'hoy' ? 'active' : ''}`}
                onClick={() => setTabInferior('hoy')}
              >
                Cerradas hoy
              </button>
              <button
                type="button"
                className={`bot-bottom-tab ${tabInferior === 'historial' ? 'active' : ''}`}
                onClick={() => setTabInferior('historial')}
              >
                Historial
              </button>
              {onSelectSeccion && (
                <button
                  type="button"
                  className="mercado-history-link"
                  onClick={() => onSelectSeccion('posiciones')}
                >
                  Ver historial completo →
                </button>
              )}
            </div>

            <div key={tabInferior} className="bot-bottom-content subtab-enter">
              {tabInferior === 'posiciones' && (
                <table className="terminal-dense-table">
                  <thead>
                    <tr>
                      <th>ACTIVO</th>
                      <th>ORIGEN</th>
                      <th>LADO</th>
                      <th className="num">TAMAÑO</th>
                      <th className="num">ENTRADA</th>
                      <th className="num">PRECIO</th>
                      <th className="num">LIQ.</th>
                      <th className="num">MARGEN</th>
                      <th className="num">P&amp;L</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {posicionesUsuario.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="empty-dense-cell">
                          No tienes posiciones abiertas. Usa la boleta de la derecha para invertir.
                        </td>
                      </tr>
                    ) : (
                      posicionesUsuario.map((p) => {
                        const px = obtenerPrecioVivoPosicion(p, precios, botEstado);
                        const { pnlUSD, pnlPct } = calcularPnlPosicion({
                          side: p.side,
                          entrada: p.entrada,
                          precioActual: px,
                          cantidad: p.cantidad,
                          margen: p.margen,
                        });
                        const esSpot = p.mercado === 'Spot' || Number(p.leverage || 1) === 1;
                        const liqPrice = esSpot
                          ? null
                          : p.liq ||
                            p.entrada *
                              (p.side === 'SHORT'
                                ? 1 + 0.9 / Number(p.leverage || 10)
                                : 1 - 0.9 / Number(p.leverage || 10));
                        const infoPos = MAPA_ACTIVOS[p.sym];
                        const cerradoPos =
                          infoPos &&
                          infoPos.clase !== 'CRYPTO' &&
                          precios?.[p.sym]?.abierto === false;
                        return (
                          <tr
                            key={p.id}
                            onClick={() => {
                              if (MAPA_ACTIVOS[p.sym]) setSymActivo(p.sym);
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            <td>
                              <strong>{p.sym.replace('_', '/')}</strong>
                            </td>
                            <td className="text-sec">{p.origenLabel}</td>
                            <td>
                              {esSpot ? (
                                <span className="dense-side-pill spot">SPOT</span>
                              ) : (
                                <span
                                  className={`dense-side-pill ${
                                    p.side === 'SHORT' ? 'short' : 'long'
                                  }`}
                                >
                                  {p.side} {p.leverage}x
                                </span>
                              )}
                            </td>
                            <td className="num">{fmtCant(p.cantidad)}</td>
                            <td className="num">{fmtPrecio(p.entrada)}</td>
                            <td className="num">
                              {fmtPrecio(px)}
                              {cerradoPos && (
                                <span className="mercado-closed-chip xs" style={{ marginLeft: '6px' }}>
                                  Mercado cerrado
                                </span>
                              )}
                            </td>
                            <td className="num text-sec">
                              {liqPrice ? fmtPrecio(liqPrice) : '—'}
                            </td>
                            <td className="num">${fmtNum(p.margen, 2)}</td>
                            <td
                              className={`num ${
                                Math.abs(pnlUSD) < 0.005
                                  ? 'text-sec'
                                  : pnlUSD >= 0
                                    ? 'text-green'
                                    : 'text-red'
                              }`}
                            >
                              {pnlUSD >= 0 ? '+' : '-'}${fmtNum(Math.abs(pnlUSD), 2)} (
                              {pnlPct >= 0 ? '+' : ''}
                              {pnlPct.toFixed(2)}%)
                            </td>
                            <td className="num" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="dense-close-btn"
                                onClick={() => setPosACerrar(p)}
                              >
                                Cerrar
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}

              {tabInferior === 'hoy' && (
                <table className="terminal-dense-table">
                  <thead>
                    <tr>
                      <th>ACTIVO</th>
                      <th>ORIGEN</th>
                      <th className="num">CANTIDAD</th>
                      <th className="num">ENTRADA</th>
                      <th className="num">SALIDA</th>
                      <th className="num">P&amp;L</th>
                      <th>MOTIVO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cerradasHoy.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty-dense-cell">
                          Aún no has cerrado posiciones hoy.
                        </td>
                      </tr>
                    ) : (
                      cerradasHoy.map((o) => {
                        const pnl = Number(o.pnl || 0);
                        return (
                          <tr key={o.id}>
                            <td>
                              <strong>{(o.sym || '').replace('_', '/')}</strong>
                            </td>
                            <td className="text-sec">
                              {o.origen === 'copia'
                                ? 'Copia bot'
                                : o.origen === 'portafolio'
                                  ? 'Portafolio'
                                  : 'Manual'}
                            </td>
                            <td className="num">{fmtCant(o.cant)}</td>
                            <td className="num">{fmtPrecio(o.entrada || o.precio)}</td>
                            <td className="num">{fmtPrecio(o.salida || o.precio)}</td>
                            <td className={`num ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                              {pnl >= 0 ? '+' : '-'}${fmtNum(Math.abs(pnl), 2)}
                            </td>
                            <td className="text-sec">{o.nota || 'Cierre manual'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}

              {tabInferior === 'historial' && (
                <table className="terminal-dense-table">
                  <thead>
                    <tr>
                      <th>TIPO</th>
                      <th>ACTIVO</th>
                      <th>ORIGEN</th>
                      <th className="num">CANTIDAD</th>
                      <th className="num">PRECIO</th>
                      <th className="num">MONTO</th>
                      <th className="num">COMISIÓN</th>
                      <th className="num">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="empty-dense-cell">
                          Sin operaciones registradas en tu historial.
                        </td>
                      </tr>
                    ) : (
                      ordenes.slice(0, 30).map((o) => {
                        const pnl = Number(o.pnl || 0);
                        const esVenta = o.tipo === 'venta';
                        return (
                          <tr key={o.id}>
                            <td>
                              <span
                                className={`dense-side-pill ${
                                  esVenta ? 'short' : 'long'
                                }`}
                              >
                                {esVenta ? 'CIERRE' : 'APERTURA'}
                              </span>
                            </td>
                            <td>
                              <strong>{(o.sym || '').replace('_', '/')}</strong>
                            </td>
                            <td className="text-sec">
                              {o.origen === 'copia'
                                ? 'Copia bot'
                                : o.origen === 'portafolio'
                                  ? 'Portafolio'
                                  : 'Manual'}
                            </td>
                            <td className="num">{fmtCant(o.cant)}</td>
                            <td className="num">{fmtPrecio(o.precio)}</td>
                            <td className="num">${fmtNum(o.total, 2)}</td>
                            <td className="num text-sec">${fmtNum(o.comision || 0, 2)}</td>
                            <td
                              className={`num ${
                                !esVenta
                                  ? 'text-sec'
                                  : pnl >= 0
                                    ? 'text-green'
                                    : 'text-red'
                              }`}
                            >
                              {esVenta
                                ? `${pnl >= 0 ? '+' : '-'}$${fmtNum(Math.abs(pnl), 2)}`
                                : '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        {/* COLUMNA DERECHA */}
        <aside className="mercado-right-col">
          {/* 1. TARJETA MI PATRIMONIO */}
          <div className="mercado-side-card patrimonio">
            <span className="mercado-side-kicker">MI PATRIMONIO</span>
            <div className="mercado-patrimonio-big num">${fmtNum(patrimonio, 2)}</div>
            <div
              className={`mercado-patrimonio-chg num ${
                pnlHoyTotal >= 0 ? 'text-green' : 'text-red'
              }`}
            >
              {pnlHoyTotal >= 0 ? '+' : '-'}${fmtNum(Math.abs(pnlHoyTotal), 2)} (
              {pnlHoyPct >= 0 ? '+' : ''}
              {pnlHoyPct.toFixed(2)}%) hoy
            </div>

            <div className="mercado-patrimonio-split">
              <div>
                <span className="split-lbl">Efectivo</span>
                <strong className="split-val num">${fmtNum(efectivo, 2)}</strong>
              </div>
              <div>
                <span className="split-lbl">Invertido</span>
                <strong className="split-val num">${fmtNum(valorPosiciones, 2)}</strong>
              </div>
            </div>
          </div>

          {/* 2. BOLETA DE ORDEN */}
          <form
            className={`mercado-side-card order-ticket ${
              ordenFlash ? `tx-flash-${ordenFlash}` : ''
            } ${ejecutandoOrden ? 'is-submitting' : ''}`}
            onSubmit={handleEjecutarOrden}
          >
            <div className="mercado-order-tabs">
              <button
                type="button"
                className={`mercado-order-tab buy ${tipoOrden === 'compra' ? 'active' : ''}`}
                onClick={() => setTipoOrden('compra')}
              >
                Comprar
              </button>
              <button
                type="button"
                className={`mercado-order-tab sell ${tipoOrden === 'venta' ? 'active' : ''}`}
                onClick={() => setTipoOrden('venta')}
              >
                Vender
              </button>
            </div>

            <div className="mercado-field-label" style={{ justifyContent: 'space-between' }}>
              <span>¿Cuánto quieres invertir?</span>
              {cantTenencia > 0 && (
                <span className="num text-sec" style={{ fontSize: '10.5px' }}>
                  Tienes: {fmtCant(cantTenencia)} (${fmtNum(valorTenenciaUSD, 2)})
                </span>
              )}
            </div>
            <div className="mercado-amount-box">
              <input
                type="number"
                step="any"
                min="0"
                className="mercado-amount-input num"
                value={montoStr}
                onChange={(e) => setMontoStr(e.target.value)}
              />
              <span className="mercado-amount-unit">USD</span>
            </div>

            <div className="mercado-pct-row">
              {[
                { label: '10%', pct: 10 },
                { label: '25%', pct: 25 },
                { label: '50%', pct: 50 },
                { label: 'Todo', pct: 100 },
              ].map((b) => (
                <button
                  key={b.label}
                  type="button"
                  className="mercado-pct-btn num"
                  onClick={() => aplicarPorcentajeMonto(b.pct)}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div className="mercado-field-label">
              <span>Apalancamiento</span>
              <span
                className="mercado-help-dot"
                title="Elige un acceso rápido o escribe el apalancamiento que quieras (1x en adelante)."
              >
                ?
              </span>
            </div>
            <div className="mercado-lev-row">
              {[
                { id: 1, label: 'Sin apalancar' },
                { id: 5, label: '5x' },
                { id: 10, label: '10x' },
              ].map((lv) => (
                <button
                  key={lv.id}
                  type="button"
                  className={`mercado-lev-btn ${apalancamiento === lv.id ? 'active' : ''}`}
                  onClick={() => setLevStr(String(lv.id))}
                >
                  {lv.label}
                </button>
              ))}
              <label
                className={`mercado-lev-input-wrap ${
                  ![1, 5, 10].includes(apalancamiento) ? 'active' : ''
                }`}
                title="Escribe cualquier apalancamiento (ej. 2, 15, 25, 50)"
              >
                <input
                  type="number"
                  min="1"
                  step="any"
                  inputMode="decimal"
                  className="mercado-lev-input num"
                  aria-label="Apalancamiento personalizado"
                  value={levStr}
                  onChange={(e) => setLevStr(e.target.value)}
                  onBlur={() => {
                    const n = parseFloat(levStr);
                    setLevStr(
                      Number.isFinite(n) && n >= 1 ? String(Math.round(n * 100) / 100) : '1'
                    );
                  }}
                />
                <span className="mercado-lev-suffix">x</span>
              </label>
            </div>

            <div className="mercado-field-label">
              <span>Protección automática (SL / TP)</span>
              <span
                className="mercado-help-dot"
                title="Escribe el porcentaje de Stop Loss (pérdida máxima) y Take Profit (ganancia)."
              >
                ?
              </span>
            </div>
            <div className="mercado-prot-row">
              <label className="mercado-prot-box">
                <span className="prot-lbl">Pérdida máx.</span>
                <span className="mercado-prot-input-wrap text-red">
                  <span>-</span>
                  <input
                    type="number"
                    min="0.1"
                    max="99"
                    step="0.5"
                    inputMode="decimal"
                    className="mercado-prot-input num"
                    aria-label="Stop Loss porcentaje"
                    value={slStr}
                    onChange={(e) => setSlStr(e.target.value)}
                    onBlur={() => {
                      const n = parseFloat(slStr);
                      setSlStr(
                        Number.isFinite(n) && n > 0
                          ? String(Math.min(99, Math.round(n * 100) / 100))
                          : '3'
                      );
                    }}
                  />
                  <span>%</span>
                </span>
              </label>
              <label className="mercado-prot-box">
                <span className="prot-lbl">Ganancia</span>
                <span className="mercado-prot-input-wrap text-green">
                  <span>+</span>
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    inputMode="decimal"
                    className="mercado-prot-input num"
                    aria-label="Take Profit porcentaje"
                    value={tpStr}
                    onChange={(e) => setTpStr(e.target.value)}
                    onBlur={() => {
                      const n = parseFloat(tpStr);
                      setTpStr(
                        Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : '5'
                      );
                    }}
                  />
                  <span>%</span>
                </span>
              </label>
            </div>

            <div className="mercado-calc-rows">
              <div className="mercado-calc-row">
                <span>Recibes</span>
                <span className="num">
                  {fmtCant(recibesCant)} {symCorto}
                </span>
              </div>
              <div className="mercado-calc-row">
                <span>Comisión (0.10%)</span>
                <span className="num text-sec">${fmtNum(comisionEstimadaUSD, 2)}</span>
              </div>
              <div className="mercado-calc-row">
                <span>
                  Si {tipoOrden === 'compra' ? 'baja' : 'sube'} {slPct}% pierdes
                </span>
                <span className="num text-red">-${fmtNum(perdidaEstimadaUSD, 2)}</span>
              </div>
              <div className="mercado-calc-row">
                <span>
                  Si {tipoOrden === 'compra' ? 'sube' : 'baja'} {tpPct}% ganas
                </span>
                <span className="num text-green">+${fmtNum(gananciaEstimadaUSD, 2)}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={ejecutandoOrden}
              className={`mercado-submit-btn ${tipoOrden === 'compra' ? 'buy' : 'sell'}`}
            >
              {ejecutandoOrden
                ? 'Procesando...'
                : `${tipoOrden === 'compra' ? 'Comprar' : 'Vender'} $${fmtNum(
                    montoValido,
                    0
                  )} de ${symCorto}`}
            </button>
          </form>

          {/* 3. RECOMENDACIÓN DEL BOT */}
          <div className="mercado-side-card bot-rec">
            <div className="bot-side-card-head">
              <span className="bot-side-title">
                <span className="dot-purple" />
                <strong>Recomendación del bot</strong>
              </span>
              <span className="bot-side-meta">Opcional</span>
            </div>
            <p className="mercado-bot-rec-text">
              <span
                className={`signal-badge ${
                  senalBadge === 'LONG'
                    ? 'long'
                    : senalBadge === 'SHORT'
                      ? 'short'
                      : 'wait'
                }`}
                style={{ marginRight: '6px' }}
              >
                {senalBadge}
              </span>
              {textoRecomendacionBot}
            </p>
          </div>

          {/* 4. ANALISTA IA (CON BOTÓN ANALIZAR CON IA RESTAURADO) */}
          <div className="mercado-side-card ia-note">
            <div className="bot-side-card-head">
              <span className="bot-side-title">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M8 1L9.8 6.2L15 8L9.8 9.8L8 15L6.2 9.8L1 8L6.2 6.2L8 1Z"
                    fill="#A78BFA"
                  />
                </svg>
                <strong>Analista IA</strong>
              </span>
              <button
                type="button"
                className="mercado-ia-btn"
                disabled={analizandoIA}
                onClick={handleAnalizarPortafolioIA}
              >
                {analizandoIA ? 'Analizando...' : 'Analizar con IA'}
              </button>
            </div>
            <p className="mercado-ia-note-text">
              {respuestaIA || (
                <>
                  {symCorto} {sube ? 'subió' : 'cayó'} {Math.abs(cambioPct).toFixed(1)}%{' '}
                  {etiquetaPeriodo} junto con todo el sector{' '}
                  {etiquetaClase(activoInfo.clase).toLowerCase()}. Tu posición está protegida con
                  una pérdida máxima de {slPct}%.
                </>
              )}
            </p>
          </div>
        </aside>
      </div>

      {posACerrar && (
        <CerrarPosicionModal
          posicion={posACerrar}
          precios={precios}
          botEstado={botEstado}
          uid={uid}
          perfil={perfil}
          onClose={() => setPosACerrar(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}
