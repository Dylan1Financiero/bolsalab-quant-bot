import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw, ChevronDown, X, Download } from 'lucide-react';
import BotCandlesChart from './BotCandlesChart';
import CentroResultadosBot, { agruparMensajesResultados } from './CentroResultadosBot';
import CerrarPosicionModal, { obtenerPrecioVivoPosicion } from './CerrarPosicionModal';
import { tieneAccesoPro } from '../config/planConfig';
import { calcularPnlPosicion, formatearPnlConSigno } from '../config/tradingConfig';
import {
  enriquecerTradesConApertura,
  explicarTradeBotEs,
  fmtDuracionBot,
  fmtFechaHoraBot,
  fmtPrecioBot,
  parseTsBotMs,
} from '../utils/botTrades';
import {
  activarPlanPro,
  escucharBotEstado,
  escucharBotVelas,
  escucharBotAnalisis,
  escucharTradesBot,
  escucharTelegramEspejo,
  enviarComandoBot,
  enviarComandoYEsperar,
} from '../services/firebase';

const TFS_BARRA = ['1m', '5m', '15m', '1h', '4h'];
const TFS_TODOS = [
  { id: '1m', label: '1 min (1m)' },
  { id: '5m', label: '5 min (5m)' },
  { id: '15m', label: '15 min (15m)' },
  { id: '30m', label: '30 min (30m)' },
  { id: '1h', label: '1 hora (1h)' },
  { id: '4h', label: '4 horas (4h)' },
  { id: '1d', label: '1 día (1d)' },
];

const ESTRATEGIAS_BOT = [
  { id: 'RSI', label: '1° RSI Spot/Fut', corto: 'RSI' },
  { id: 'EMA50_200', label: '2° EMA 50/200', corto: 'EMA 50/200' },
  { id: 'BOLLINGER', label: '3° Bollinger', corto: 'Bollinger' },
  { id: 'FIBONACCI', label: '4° Fibonacci+Abanicos', corto: 'Fibonacci' },
  { id: 'SUPERTREND', label: '5° SuperTrend', corto: 'SuperTrend' },
  { id: 'CHARTISMO', label: '6° Chartismo+Ruptura', corto: 'Chartismo' },
];

const CATALOGO_BOT = {
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
    ['TLT', 'Bonos 20+'],
    ['XLK', 'Tecnología'],
    ['EEM', 'Emergentes'],
  ],
};

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtNum(val, dec = 2) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtHoraCorta(tsMs) {
  if (!tsMs) return '21:40';
  try {
    const ms = Number(tsMs) > 1e12 ? Number(tsMs) : Number(tsMs) * 1000;
    return new Date(ms).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '21:40';
  }
}

function limpiarTextoSinEmojis(raw = '') {
  return String(raw || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}─━]+/gu, '')
    .trim();
}

function formatearOrigenBot(estadoObj) {
  const raw = String(estadoObj?.origen || '').trim();
  if (!raw) return '';
  if (/google cloud/i.test(raw)) return 'VM Google Cloud';
  if (/spyder/i.test(raw)) return 'Spyder local';
  if (/\bvm\b/i.test(raw)) return 'VM Google Cloud';
  return raw;
}

function csvCell(val) {
  const s = String(val ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function nombreEstrategiaCorto(raw) {
  const s = String(raw || 'Chartismo').toUpperCase();
  if (s.includes('CHART')) return 'Chartismo';
  if (s.includes('EMA')) return 'EMA 50/200';
  if (s.includes('BOLL')) return 'Bollinger';
  if (s.includes('SUPER')) return 'SuperTrend';
  if (s.includes('FIB')) return 'Fibonacci';
  if (s.includes('RSI')) return 'RSI';
  return raw || 'Chartismo';
}

export default function BotView({
  uid,
  perfil,
  precios = {},
  onToast,
}) {
  const esPro = tieneAccesoPro(perfil);
  const [activandoPro, setActivandoPro] = useState(false);

  const [estado, setEstado] = useState(undefined);
  const [velas, setVelas] = useState(null);
  const [trades, setTrades] = useState([]);
  const [mensajesTg, setMensajesTg] = useState([]);
  const [analisisDoc, setAnalisisDoc] = useState(null);
  const [filtroOpRango, setFiltroOpRango] = useState('todo'); // 'hoy' | '7d' | 'todo'
  const [filtroOpLado, setFiltroOpLado] = useState('todos'); // 'todos' | 'LONG' | 'SHORT'
  const [filtroOpResultado, setFiltroOpResultado] = useState('todos'); // 'todos' | 'ganadas' | 'perdidas'
  const [filtroOpEstrategia, setFiltroOpEstrategia] = useState('todas'); // 'todas' | 'BOLLINGER' | 'ETAPA2'

  const [mostrarDibujoAnalisis, setMostrarDibujoAnalisis] = useState(true);
  const [analisisEnVivo, setAnalisisEnVivo] = useState(true);
  const [cargandoAnalisis, setCargandoAnalisis] = useState(false);

  const [herramientaDibujo, setHerramientaDibujo] = useState('tendencia');
  const [dibujosPorActivo, setDibujosPorActivo] = useState({});
  const [fitTrigger, setFitTrigger] = useState(0);

  const [tabInferior, setTabInferior] = useState('posicion');
  const [posACerrarModal, setPosACerrarModal] = useState(null);
  const [enviandoCmd, setEnviandoCmd] = useState(false);
  const [eventosLocalesTg, setEventosLocalesTg] = useState([]);
  const [esperaBot, setEsperaBot] = useState(null);
  const [autoAbrirCardId, setAutoAbrirCardId] = useState(null);
  const [imagenModal, setImagenModal] = useState(null);
  const [chartOverride, setChartOverride] = useState(null);

  useEffect(() => {
    const onOverride = (ev) => {
      setChartOverride(ev?.detail ?? null);
    };
    window.addEventListener('bolsalab:chart-test-override', onOverride);
    return () => window.removeEventListener('bolsalab:chart-test-override', onOverride);
  }, []);

  const tarjetasResultados = useMemo(() => agruparMensajesResultados(mensajesTg), [mensajesTg]);

  // Submenú interactivo del bot de Telegram ('tf' | 'activo' | 'estrategia' | null)
  const [menuTgAbierto, setMenuTgAbierto] = useState(null);
  const [claseActivoMenu, setClaseActivoMenu] = useState('CRYPTO');

  const [ahoraMs, setAhoraMs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhoraMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const chatScrollRef = useRef(null);

  useEffect(() => {
    if (!esPro) return undefined;
    const uEstado = escucharBotEstado((d) => setEstado(d));
    const uVelas = escucharBotVelas((d) => setVelas(d));
    const uAnalisis = escucharBotAnalisis((d) => setAnalisisDoc(d));
    const uTrades = escucharTradesBot((d) => setTrades(d), 500);
    const uTg = escucharTelegramEspejo((d) => setMensajesTg(d), 50);

    return () => {
      uEstado();
      uVelas();
      uAnalisis();
      uTrades();
      uTg();
    };
  }, [esPro]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [mensajesTg, eventosLocalesTg, menuTgAbierto]);

  const agregarEventoLocal = (autor, titulo, detalle = '', colorDot = null) => {
    setEventosLocalesTg((prev) => [
      ...prev.slice(-14),
      {
        id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
        autor,
        titulo: limpiarTextoSinEmojis(titulo),
        detalle: limpiarTextoSinEmojis(detalle),
        colorDot,
      },
    ]);
  };

  // Detecta cuando llega a telegram_espejo la tarjeta esperada tras pulsar un botón del bot
  useEffect(() => {
    if (!esperaBot?.activo) return undefined;
    const tarjetas = agruparMensajesResultados(mensajesTg);
    const encontrada = tarjetas.find((card) => {
      const tieneNuevo = card.ids.some((id) => !esperaBot.baselineIds.has(id));
      if (!tieneNuevo) return false;
      if (esperaBot.categoria) return card.categoria === esperaBot.categoria;
      return card.texto && card.texto !== '📊 Gráfico';
    });

    if (encontrada) {
      setEsperaBot(null);
      setAutoAbrirCardId(encontrada.id);
      setTabInferior('resultados');
    }
    return undefined;
  }, [mensajesTg, esperaBot]);

  useEffect(() => {
    if (!imagenModal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setImagenModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imagenModal]);

  // Envía el comando real a Firestore (`comandos`) y espera la respuesta real del bot de Python
  const ejecutarComandoBot = async (tipo, valor = null, etiquetaUsuario = '', opts = {}) => {
    if (!uid || enviandoCmd) return;
    setEnviandoCmd(true);
    setMenuTgAbierto(null);
    if (etiquetaUsuario) {
      agregarEventoLocal('tu', etiquetaUsuario);
    }
    const esperaResultado = Boolean(opts?.esperarResultado);
    if (esperaResultado) {
      setTabInferior('resultados');
      setEsperaBot({
        activo: true,
        categoria: opts.categoria || null,
        label: opts.label || etiquetaUsuario || 'comando del bot',
        esSentimiento: Boolean(opts.esSentimiento),
        subtexto: opts.subtexto || null,
        baselineIds: new Set(mensajesTg.map((m) => m.id)),
        inicioTs: Date.now(),
        error: null,
      });
    }
    try {
      const timeoutMs = opts?.timeoutMs || (opts?.esSentimiento ? 65000 : 25000);
      const res = await enviarComandoYEsperar(uid, tipo, valor, timeoutMs);
      if (res?.ok && (tipo === 'tf' || tipo === 'activo' || tipo === 'estrategia')) {
        enviarComandoBot(uid, 'analisis').catch(() => {});
      }
      if (res?.resultado) {
        const limpio = limpiarTextoSinEmojis(res.resultado);
        const lineas = limpio.split('\n').filter(Boolean);
        agregarEventoLocal(
          'bot',
          lineas[0] || 'Comando procesado',
          lineas.slice(1, 3).join(' · '),
          res.ok ? 'green' : 'red'
        );
      }
      if (!res?.ok && res?.estado === 'timeout') {
        if (esperaResultado) {
          setEsperaBot((prev) =>
            prev?.activo
              ? {
                  ...prev,
                  activo: false,
                  error: res.resultado || 'El bot no respondió a tiempo. Revisa que esté corriendo.',
                }
              : null
          );
        }
        onToast?.(res.resultado, 'error');
      }
    } catch (err) {
      const msgErr = err?.message || 'Error al enviar comando al bot.';
      if (esperaResultado) {
        setEsperaBot((prev) => (prev?.activo ? { ...prev, activo: false, error: msgErr } : null));
      }
      onToast?.(msgErr, 'error');
    } finally {
      setEnviandoCmd(false);
    }
  };

  const handleActualizarAnalisis = async () => {
    if (!uid) return;
    setCargandoAnalisis(true);
    try {
      await enviarComandoBot(uid, 'analisis');
      onToast?.('Solicitando actualización de análisis al bot...', 'info');
    } catch (e) {
      onToast?.(e?.message || 'Error al pedir análisis.', 'error');
    } finally {
      setTimeout(() => setCargandoAnalisis(false), 900);
    }
  };

  const handleToggleEnVivo = async () => {
    if (!uid) return;
    const next = !analisisEnVivo;
    setAnalisisEnVivo(next);
    try {
      await enviarComandoBot(uid, 'analisis', next ? 'vivo' : 'off');
    } catch (e) {
      setAnalisisEnVivo(!next);
      onToast?.(e?.message || 'Error cambiando modo en vivo.', 'error');
    }
  };

  if (!esPro) {
    return (
      <div className="panel" style={{ margin: '24px' }}>
        <h2>Trading (bot)</h2>
        <p className="text-sec" style={{ margin: '8px 0 16px' }}>
          Activa el acceso Pro educativo (sin costo real) para conectar con el bot cuantitativo.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={activandoPro}
          onClick={async () => {
            setActivandoPro(true);
            try {
              await activarPlanPro(uid);
            } finally {
              setActivandoPro(false);
            }
          }}
        >
          {activandoPro ? 'Activando...' : 'Activar acceso Pro'}
        </button>
      </div>
    );
  }

  if (estado === undefined) {
    return (
      <div className="bot-terminal-loading num">
        Conectando con el bot cuantitativo en tiempo real...
      </div>
    );
  }

  const estadoEf = chartOverride?.estado
    ? { ...(estado || {}), ...chartOverride.estado }
    : estado;
  const analisisEf =
    chartOverride && 'analisis' in chartOverride
      ? chartOverride.analisis
      : analisisDoc;
  const tradesEf = chartOverride?.newTrade ? [chartOverride.newTrade, ...trades] : trades;

  const symActual = estadoEf?.asset || velas?.asset || 'BTC_USDT';
  const symDisplay = symActual.replace('_', '/');
  const symCorto = symActual.replace('_USDT', '');
  const tfActual = estadoEf?.timeframe || velas?.tf || '5m';
  const estrategiaCorto = nombreEstrategiaCorto(
    estadoEf?.strategy_label ||
      estadoEf?.strategy ||
      analisisEf?.estrategia_label ||
      analisisEf?.estrategia
  );

  const cotViva = precios?.[symActual];
  const esCriptoBot = symActual.endsWith('_USDT');
  const sufijoPeriodoBot = esCriptoBot ? '24h' : 'hoy';
  const mercadoCerradoBot = !esCriptoBot && cotViva && cotViva.abierto === false;
  const precioVivo =
    cotViva?.disponible && Number(cotViva.p) > 0
      ? Number(cotViva.p)
      : Number(estado?.price || 0);
  const cambio24h = Number(cotViva?.chg ?? cotViva?.cambio ?? -8.21);
  const sube24h = cambio24h >= 0;

  const tsSegundos = Number(estado?.ts || 0);
  const segundosDesdeLatido =
    tsSegundos > 0 ? Math.max(0, Math.round(ahoraMs / 1000 - tsSegundos)) : null;
  const botDesconectado = segundosDesdeLatido === null || segundosDesdeLatido > 60;
  const vmEnLinea = !botDesconectado;
  const origenBot = formatearOrigenBot(estadoEf);
  const capitalInicialBot = Number(
    estadoEf?.capital_inicial || estadoEf?.balance_inicial || 1000
  );

  const tradesEnriquecidos = enriquecerTradesConApertura(tradesEf);

  const tradesFiltrados = tradesEnriquecidos.filter((tr) => {
    const lado = String(tr?.lado || 'LONG').toUpperCase();
    if (filtroOpLado !== 'todos' && lado !== filtroOpLado) return false;
    const estUp = String(tr?.estrategia || '').toUpperCase();
    if (filtroOpEstrategia === 'BOLLINGER' && !estUp.includes('BOLLINGER')) return false;
    if (filtroOpEstrategia === 'ETAPA2' && estUp.includes('BOLLINGER')) return false;
    const pnl = Number(tr?.pnl_usdt || 0);
    if (filtroOpResultado === 'ganadas' && pnl <= 0) return false;
    if (filtroOpResultado === 'perdidas' && pnl >= 0) return false;
    if (filtroOpRango !== 'todo') {
      const tsMs = parseTsBotMs(tr?.ts);
      if (!tsMs) return false;
      if (filtroOpRango === 'hoy') {
        const inicioHoy = new Date(ahoraMs);
        inicioHoy.setHours(0, 0, 0, 0);
        if (tsMs < inicioHoy.getTime()) return false;
      } else if (filtroOpRango === '7d') {
        if (tsMs < ahoraMs - 7 * 86400 * 1000) return false;
      }
    }
    return true;
  });

  const exportarOperacionesCsv = () => {
    const headers = [
      'Orden_Testnet',
      'Apertura',
      'Cierre',
      'Duracion',
      'Activo',
      'Lado',
      'Estrategia',
      'Entrada',
      'Salida',
      'Motivo',
      'Explicacion',
      'PnL_USDT',
      'ROE_s_margen_pct',
    ];
    const filas = tradesFiltrados.map((tr) => [
      tr._ordenTestnetId || 'GT-SIM',
      fmtFechaHoraBot(tr._aperturaMs),
      fmtFechaHoraBot(tr.ts),
      fmtDuracionBot(tr._aperturaMs, tr.ts),
      String(tr.activo || '').replace('_', '/'),
      String(tr.lado || 'LONG').toUpperCase(),
      tr.estrategia || 'Chartismo',
      fmtPrecioBot(tr.entrada),
      fmtPrecioBot(tr.salida),
      tr.motivo || 'Cierre bot',
      explicarTradeBotEs(tr),
      Number(tr.pnl_usdt || 0).toFixed(2),
      Number(tr.roe_pct ?? Number(tr.pnl_usdt || 0)).toFixed(2),
    ]);
    const contenido = [headers, ...filas].map((r) => r.map(csvCell).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${contenido}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bolsalab_operaciones_bot_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const tsAnalisisRaw = Number(analisisDoc?.ts || 0);
  const tsAnalisisDocMs =
    tsAnalisisRaw > 1e12 ? tsAnalisisRaw : tsAnalisisRaw > 0 ? tsAnalisisRaw * 1000 : 0;
  const tsEstadoMs = tsSegundos > 0 ? tsSegundos * 1000 : 0;
  const tsAnalisisMs = Math.max(tsAnalisisDocMs, tsEstadoMs);
  const diffAnalisisSeg =
    tsAnalisisMs > 0 ? Math.max(0, Math.floor((ahoraMs - tsAnalisisMs) / 1000)) : null;
  const haceAnalisisTxt =
    diffAnalisisSeg === null
      ? 'en vivo'
      : diffAnalisisSeg < 60
        ? `hace ${diffAnalisisSeg} s`
        : `hace ${Math.max(1, Math.floor(diffAnalisisSeg / 60))} min`;

  const bPos =
    chartOverride && 'position' in chartOverride
      ? chartOverride.position
      : estadoEf?.position;
  const posBotAbierta =
    bPos && Number(bPos.qty || 0) > 0 && Number(bPos.entry || 0) > 0
      ? {
          id: `bot-${bPos.asset || symActual}`,
          origen: 'bot',
          origenLabel: 'Bot',
          strategy: bPos.strategy || estadoEf?.strategy || 'Chartismo',
          sym: bPos.asset || symActual,
          nombre: (bPos.asset || symActual).replace('_USDT', ''),
          side: String(bPos.side || 'LONG').toUpperCase(),
          leverage: Number(bPos.leverage || estadoEf?.leverage || 10),
          entrada: Number(bPos.entry),
          cantidad: Number(bPos.qty),
          margen: Number(bPos.margin_usdt || 500),
          sl: bPos.sl ? Number(bPos.sl) : null,
          tp: bPos.tp ? Number(bPos.tp) : null,
          liq: bPos.liq
            ? Number(bPos.liq)
            : Number(bPos.entry) * (String(bPos.side || 'LONG').toUpperCase() === 'SHORT' ? 1.091 : 0.909),
          ts: bPos.entry_utc ? Date.parse(bPos.entry_utc) : null,
          rawBot: bPos,
        }
      : null;

  const estrategiaPosBot = posBotAbierta
    ? nombreEstrategiaCorto(posBotAbierta.strategy)
    : null;
  const hayDesfaseEstrategiaPos = Boolean(
    posBotAbierta && estrategiaPosBot && estrategiaPosBot !== estrategiaCorto
  );
  const ultimoTradeBot = tradesEf.length > 0 ? tradesEf[0] : null;

  const precioPosBot = posBotAbierta
    ? obtenerPrecioVivoPosicion(posBotAbierta, precios, estadoEf)
    : precioVivo;
  const pnlPosBot = posBotAbierta
    ? calcularPnlPosicion({
        side: posBotAbierta.side,
        entrada: posBotAbierta.entrada,
        actual: precioPosBot,
        cantidad: posBotAbierta.cantidad,
        margen: posBotAbierta.margen,
      })
    : { pnlUSD: 0, pnlPct: 0 };

  const senalRaw = String(analisisEf?.senal || estadoEf?.signal || '').toUpperCase();
  const senalMsg = String(estadoEf?.last_signal || '').toUpperCase();
  const senalTag =
    senalRaw === 'LONG' || senalRaw === 'BUY' || senalMsg.includes('SEÑAL DE COMPRA (LONG')
      ? 'LONG'
      : senalRaw === 'SHORT' || senalRaw === 'SELL' || senalMsg.includes('SEÑAL DE VENTA (SHORT')
        ? 'SHORT'
        : 'EN ESPERA';
  const patronResumen =
    analisisEf?.patron?.nombre ||
    analisisEf?.senal_txt ||
    analisisEf?.resumen ||
    estadoEf?.last_signal_reason ||
    'Sin señal activa';

  const riesgoObj = estado?.risk || {};
  const caviarVal = Number(riesgoObj.caviar ?? riesgoObj.caviar_pct ?? 0.6);
  const caviarUmbral = Number(riesgoObj.threshold ?? riesgoObj.umbral ?? 1.5);
  const tradingEnabled = estado?.trading_enabled !== false;

  const dibujosActuales = dibujosPorActivo[symActual] || [];
  const agregarDibujo = (nuevo) => {
    setDibujosPorActivo((prev) => ({
      ...prev,
      [symActual]: [...(prev[symActual] || []), nuevo],
    }));
  };
  const borrarDibujosActivo = () => {
    setDibujosPorActivo((prev) => ({
      ...prev,
      [symActual]: [],
    }));
  };

  const burbujasTelegram = (() => {
    const lista = [];
    const nombrePatron =
      analisisDoc?.patron?.nombre || analisisDoc?.resumen || 'Monitoreo activo';
    const nivelesTxt =
      Array.isArray(analisisDoc?.niveles) && analisisDoc.niveles.length >= 2
        ? `${analisisDoc.niveles[0].nombre || 'techo'} ${fmtPrecioBot(analisisDoc.niveles[0].precio)} · ${analisisDoc.niveles[1].nombre || 'base'} ${fmtPrecioBot(analisisDoc.niveles[1].precio)}`
        : `techo ${fmtPrecioBot(precioVivo * 1.045)} · base ${fmtPrecioBot(precioVivo * 0.985)}`;

    const seedTs = tsAnalisisMs || ahoraMs - 60000;
    lista.push({
      id: 'seed_wait',
      tsSort: seedTs,
      hora: fmtHoraCorta(seedTs),
      autor: 'Bot',
      lado: 'left',
      dot: 'gray',
      linea1: `${senalTag} · ${symCorto} ${tfActual}`,
      linea2: `${nombrePatron} · ${nivelesTxt}`,
    });

    for (const m of mensajesTg.slice(-12)) {
      const txt = String(m.texto || m.text || m.mensaje || '').trim();
      const tieneImg = Boolean(m.adjunto_b64 && m.adjunto_tipo === 'image/png');
      const tieneArch = Boolean(m.adjunto_b64 && m.adjunto_tipo && m.adjunto_tipo !== 'image/png');
      if (!txt && !tieneImg && !tieneArch) continue;
      const cleanTxt = limpiarTextoSinEmojis(txt);
      const lineas = cleanTxt
        .split('\n')
        .map((l) => l.replace(/^[^\wÁÉÍÓÚÑáéíóúñ$+%-]+/, '').trim())
        .filter(Boolean);
      if (!lineas.length && !tieneImg && !tieneArch) continue;
      const msgTs = parseTsBotMs(m.ts) || ahoraMs;
      lista.push({
        id: `tg_${m.id}`,
        tsSort: msgTs,
        hora: fmtHoraCorta(msgTs),
        autor: m.de === 'usuario' ? 'Tú (Telegram)' : 'Bot',
        lado: m.de === 'usuario' ? 'right' : 'left',
        dot:
          m.de === 'usuario'
            ? null
            : txt.includes('LONG')
              ? 'green'
              : txt.includes('SHORT')
                ? 'red'
                : 'purple',
        linea1: lineas[0] || (tieneImg ? 'Gráfico PNG' : m.adjunto_nombre || 'Archivo'),
        linea2: lineas.slice(1, 3).join(' · '),
        imgSrc: tieneImg ? `data:image/png;base64,${m.adjunto_b64}` : null,
        adjuntoNombre: m.adjunto_nombre || null,
        fileUrl: tieneArch ? `data:${m.adjunto_tipo};base64,${m.adjunto_b64}` : null,
      });
    }

    if (posBotAbierta) {
      const posTs = parseTsBotMs(posBotAbierta.ts) || ahoraMs - 30000;
      lista.push({
        id: 'seed_pos',
        tsSort: posTs,
        hora: fmtHoraCorta(posTs),
        autor: 'Bot',
        lado: 'left',
        dot: posBotAbierta.side === 'SHORT' ? 'red' : 'green',
        linea1: `${posBotAbierta.side} x${posBotAbierta.leverage} ${symCorto} ${fmtPrecioBot(posBotAbierta.entrada)} (${estrategiaPosBot})`,
        linea2: `TP ${posBotAbierta.tp ? fmtPrecioBot(posBotAbierta.tp) : '—'} · SL ${posBotAbierta.sl ? fmtPrecioBot(posBotAbierta.sl) : '—'}`,
      });
    }

    if (ultimoTradeBot) {
      const yaEnEspejo = mensajesTg.slice(-12).some((m) => {
        const t = String(m.texto || m.text || m.mensaje || '');
        return (
          t.includes('POSICIÓN CERRADA') &&
          Math.abs((parseTsBotMs(m.ts) || 0) - (parseTsBotMs(ultimoTradeBot.ts) || 0)) < 120000
        );
      });
      if (!yaEnEspejo) {
        const pnlUltimo = Number(ultimoTradeBot.pnl_usdt || 0);
        const ladoUltimo = String(ultimoTradeBot.lado || 'LONG').toUpperCase();
        const actUltimo = String(ultimoTradeBot.activo || symActual).replace('_USDT', '');
        const closeTs = parseTsBotMs(ultimoTradeBot.ts) || ahoraMs - 120000;
        lista.push({
          id: `seed_close_${ultimoTradeBot.id || ultimoTradeBot.ts || 'last'}`,
          tsSort: closeTs,
          hora: fmtHoraCorta(closeTs),
          autor: 'Bot',
          lado: 'left',
          dot: pnlUltimo >= 0 ? 'green' : 'red',
          linea1: `Cierre ${ladoUltimo} ${actUltimo} · ${pnlUltimo >= 0 ? '+' : '−'}$${Math.abs(pnlUltimo).toFixed(2)} USD`,
          linea2: `${fmtPrecioBot(ultimoTradeBot.entrada)} -> ${fmtPrecioBot(ultimoTradeBot.salida)} (${ultimoTradeBot.motivo || 'Cierre bot'})`,
        });
      }
    }

    for (const ev of eventosLocalesTg) {
      const evTs = parseTsBotMs(ev.ts) || ahoraMs;
      lista.push({
        id: ev.id,
        tsSort: evTs,
        hora: fmtHoraCorta(evTs),
        autor: ev.autor === 'tu' ? 'Tú (app)' : 'Bot',
        lado: ev.autor === 'tu' ? 'right' : 'left',
        dot: ev.colorDot || (ev.autor === 'tu' ? null : 'green'),
        linea1: ev.titulo,
        linea2: ev.detalle,
      });
    }

    return lista.sort((a, b) => a.tsSort - b.tsSort).slice(-8);
  })();

  return (
    <div className="bot-terminal-page">
      {/* 1. SUB-ENCABEZADO DE LA TERMINAL DEL BOT */}
      <div className="bot-subheader">
        <div className="bot-subheader-left">
          <button
            type="button"
            className="bot-sub-sym-btn"
            onClick={() => setMenuTgAbierto((m) => (m === 'activo' ? null : 'activo'))}
            title="Cambiar activo del bot"
          >
            <span>{symDisplay}</span>
            <ChevronDown size={13} />
          </button>

          <span className={`bot-sub-price num ${sube24h ? 'text-green' : 'text-red'}`}>
            {fmtPrecioBot(precioVivo)} {sube24h ? '+' : ''}{cambio24h.toFixed(2)}% {sufijoPeriodoBot}
          </span>
          {mercadoCerradoBot && (
            <span className="mercado-closed-chip xs">Mercado cerrado</span>
          )}

          <span className="bot-sub-sep">|</span>

          <div className="bot-tf-group" role="tablist" aria-label="Temporalidades">
            {TFS_BARRA.map((tf) => (
              <button
                key={tf}
                type="button"
                className={`bot-tf-btn num ${tfActual === tf ? 'active' : ''}`}
                disabled={botDesconectado || enviandoCmd}
                onClick={() => ejecutarComandoBot('tf', tf, `Temporalidad -> ${tf}`)}
              >
                {tf}
              </button>
            ))}
          </div>

          <span className="bot-sub-sep">|</span>

          <button
            type="button"
            className="bot-sub-strat-btn"
            onClick={() => setMenuTgAbierto((m) => (m === 'estrategia' ? null : 'estrategia'))}
            title="Cambiar estrategia del bot"
          >
            <span>Estrategia:</span> <strong>{estrategiaCorto}</strong>
            <ChevronDown size={12} />
          </button>
        </div>

        <div className="bot-subheader-right">
          <button
            type="button"
            className={`bot-pill-btn purple ${mostrarDibujoAnalisis ? 'active' : ''}`}
            onClick={() => setMostrarDibujoAnalisis((v) => !v)}
          >
            <span className="dot-purple" />
            <span>Análisis del bot · {haceAnalisisTxt}</span>
          </button>

          <button
            type="button"
            className="bot-pill-btn dark"
            disabled={botDesconectado || cargandoAnalisis}
            onClick={handleActualizarAnalisis}
          >
            <RefreshCw size={12} />
            <span>Actualizar</span>
          </button>

          <button
            type="button"
            className={`bot-pill-btn purple ${analisisEnVivo ? 'active' : ''}`}
            disabled={botDesconectado}
            onClick={handleToggleEnVivo}
          >
            <span className="dot-purple" />
            <span>En vivo</span>
          </button>
        </div>
      </div>

      {/* 2. ÁREA CENTRAL: RIEL DE DIBUJO + GRÁFICA + PANEL DERECHO */}
      <div className="bot-workspace-grid">
        {/* Riel izquierdo de herramientas de dibujo */}
        <aside className="bot-draw-rail" aria-label="Herramientas de dibujo">
          <button
            type="button"
            className={`draw-rail-btn ${herramientaDibujo === null ? 'active' : ''}`}
            onClick={() => setHerramientaDibujo(null)}
            title="Cursor / Cruz"
          >
            +
          </button>
          <button
            type="button"
            className={`draw-rail-btn ${herramientaDibujo === 'tendencia' ? 'active' : ''}`}
            onClick={() => setHerramientaDibujo((p) => (p === 'tendencia' ? null : 'tendencia'))}
            title="Línea de tendencia (2 clics)"
          >
            /
          </button>
          <button
            type="button"
            className={`draw-rail-btn ${herramientaDibujo === 'horizontal' ? 'active' : ''}`}
            onClick={() => setHerramientaDibujo((p) => (p === 'horizontal' ? null : 'horizontal'))}
            title="Línea horizontal (1 clic)"
          >
            —
          </button>
          <button
            type="button"
            className={`draw-rail-btn ${herramientaDibujo === 'zona' ? 'active' : ''}`}
            onClick={() => setHerramientaDibujo((p) => (p === 'zona' ? null : 'zona'))}
            title="Zona / Rango (2 clics)"
          >
            ▭
          </button>
          <button
            type="button"
            className={`draw-rail-btn ${herramientaDibujo === 'fib' ? 'active' : ''}`}
            onClick={() => setHerramientaDibujo((p) => (p === 'fib' ? null : 'fib'))}
            title="Retroceso de Fibonacci (2 clics)"
          >
            Fib
          </button>
          <button
            type="button"
            className="draw-rail-btn"
            onClick={() => setFitTrigger((n) => n + 1)}
            title="Ajustar escala de gráfica"
          >
            T
          </button>
          <button
            type="button"
            className="draw-rail-btn"
            onClick={borrarDibujosActivo}
            title="Borrar dibujos del usuario"
          >
            ⌫
          </button>
        </aside>

        {/* Gráfica central */}
        <div className="bot-chart-area">
          <BotCandlesChart
            velasData={velas}
            position={chartOverride && 'position' in chartOverride ? chartOverride.position : estado?.position}
            analisis={chartOverride && 'analisis' in chartOverride ? chartOverride.analisis : analisisDoc}
            mostrarDibujo={mostrarDibujoAnalisis}
            altura={520}
            herramienta={herramientaDibujo}
            dibujosUsuario={dibujosActuales}
            onAgregarDibujo={agregarDibujo}
            fitTrigger={fitTrigger}
          />
        </div>

        {/* Columna derecha (Estado del bot + Señal + Telegram en vivo) */}
        <aside className="bot-right-sidebar">
          {/* Tarjeta 1: Estado del bot */}
          <div className={`bot-side-card vm ${vmEnLinea ? 'online' : 'offline'}`}>
            <div className="bot-side-card-head">
              <span className="bot-side-title">
                <span className={vmEnLinea ? 'dot-green' : 'dot-red'} />
                <strong>
                  {vmEnLinea
                    ? origenBot
                      ? `Bot en línea · ${origenBot}`
                      : 'Bot en línea'
                    : origenBot
                      ? `Bot desconectado · ${origenBot}`
                      : 'Bot desconectado'}
                </strong>
              </span>
              <span className="bot-side-meta">
                {segundosDesdeLatido !== null ? <span className="num">hace {segundosDesdeLatido} s</span> : 'sin señal'}
              </span>
            </div>
            <div className="bot-side-sub">
              {origenBot ? `${origenBot} · ` : ''}Telegram {vmEnLinea ? 'conectado' : 'en espera'}
            </div>
          </div>

          {/* Tarjeta 2: Señal del bot */}
          <div className="bot-side-card signal">
            <div className="bot-side-card-head">
              <span className="bot-side-title">
                <span className="dot-purple" />
                <strong>Señal del bot</strong>
              </span>
              <span className="bot-side-meta">
                {estrategiaCorto} · <span className="num">{tfActual}</span>
              </span>
            </div>
            <div className="bot-signal-row">
              <span
                className={`signal-badge ${
                  senalTag === 'LONG' ? 'long' : senalTag === 'SHORT' ? 'short' : 'wait'
                }`}
              >
                {senalTag}
              </span>
              <span className="signal-desc">{patronResumen}</span>
            </div>
            <div
              className="bot-caviar-row"
              title="Freno automático de riesgo extremo: si CAViaR supera el límite, el bot se pausa solo para proteger la cuenta"
            >
              <span>
                Freno de riesgo (CAViaR){' '}
                <span className="num">
                  {fmtNum(caviarVal, 2)}% / {fmtNum(caviarUmbral, 2)}%
                </span>
              </span>
              <span className={tradingEnabled ? 'text-green' : 'text-red'}>
                <span className={tradingEnabled ? 'dot-green' : 'dot-red'} />{' '}
                {tradingEnabled ? 'habilitado' : 'pausado por riesgo'}
              </span>
            </div>
          </div>

          {/* Tarjeta 3: Telegram en vivo */}
          <div className="bot-side-card telegram">
            <div className="bot-side-card-head">
              <strong>Telegram en vivo</strong>
              <span className="bot-side-meta">espejo</span>
            </div>

            <div className="bot-tg-feed" ref={chatScrollRef}>
              {burbujasTelegram.map((b) => (
                <div key={b.id} className={`bot-tg-bubble ${b.lado}`}>
                  <div className="bot-tg-meta">
                    <span className="num">{b.hora}</span> · {b.autor}
                  </div>
                  <div className="bot-tg-line1">
                    {b.dot && <span className={`dot-${b.dot}`} />}
                    <span>{b.linea1}</span>
                  </div>
                  {b.linea2 && <div className="bot-tg-line2">{b.linea2}</div>}
                  {b.imgSrc && (
                    <button
                      type="button"
                      className="bot-tg-thumb-btn"
                      onClick={() =>
                        setImagenModal({
                          src: b.imgSrc,
                          nombre: b.adjuntoNombre || 'grafica_bot.png',
                          titulo: b.linea1 || 'Gráfico del bot',
                          hora: b.hora,
                        })
                      }
                      title="Ver imagen en grande"
                    >
                      <img src={b.imgSrc} alt={b.linea1 || 'Gráfico del bot'} className="bot-tg-thumb" />
                    </button>
                  )}
                  {b.fileUrl && (
                    <a
                      href={b.fileUrl}
                      download={b.adjuntoNombre || 'archivo_bot'}
                      className="bot-tg-file-link"
                    >
                      Descargar {b.adjuntoNombre || 'archivo'}
                    </a>
                  )}
                </div>
              ))}
            </div>

            {/* SUBMENÚ INTERACTIVO DE SELECCIÓN DE TELEGRAM */}
            {menuTgAbierto === 'tf' && (
              <div className="bot-tg-submenu">
                <div className="bot-tg-submenu-head">
                  <span>Elige la temporalidad del bot:</span>
                  <button type="button" onClick={() => setMenuTgAbierto(null)}>
                    <X size={13} />
                  </button>
                </div>
                <div className="bot-tg-submenu-grid cols-4">
                  {TFS_TODOS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`bot-tg-sub-btn num ${tfActual === t.id ? 'active' : ''}`}
                      disabled={botDesconectado || enviandoCmd}
                      onClick={() => ejecutarComandoBot('tf', t.id, `Temporalidad -> ${t.label}`)}
                    >
                      {t.id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {menuTgAbierto === 'activo' && (
              <div className="bot-tg-submenu">
                <div className="bot-tg-submenu-head">
                  <span>Elige el activo del bot:</span>
                  <button type="button" onClick={() => setMenuTgAbierto(null)}>
                    <X size={13} />
                  </button>
                </div>
                <div className="bot-tg-class-tabs">
                  {[
                    { id: 'CRYPTO', label: 'Cripto (10)' },
                    { id: 'STOCK', label: 'Acciones (10)' },
                    { id: 'ETF', label: 'ETFs (8)' },
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`bot-tg-class-tab ${claseActivoMenu === c.id ? 'active' : ''}`}
                      onClick={() => setClaseActivoMenu(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="bot-tg-submenu-grid cols-2">
                  {(CATALOGO_BOT[claseActivoMenu] || []).map(([sym, nom]) => (
                    <button
                      key={sym}
                      type="button"
                      className={`bot-tg-sub-btn ${symActual === sym ? 'active' : ''}`}
                      disabled={botDesconectado || enviandoCmd}
                      onClick={() =>
                        ejecutarComandoBot('activo', sym, `Activo -> ${sym.replace('_USDT', '')}`)
                      }
                    >
                      <strong>{sym.replace('_USDT', '')}</strong> · {nom}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {menuTgAbierto === 'estrategia' && (
              <div className="bot-tg-submenu">
                <div className="bot-tg-submenu-head">
                  <span>Elige la estrategia del bot:</span>
                  <button type="button" onClick={() => setMenuTgAbierto(null)}>
                    <X size={13} />
                  </button>
                </div>
                <div className="bot-tg-submenu-grid cols-2">
                  {ESTRATEGIAS_BOT.map((s) => {
                    const esActiva = String(estado?.strategy || 'CHARTISMO')
                      .toUpperCase()
                      .includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`bot-tg-sub-btn ${esActiva ? 'active' : ''}`}
                        disabled={botDesconectado || enviandoCmd}
                        onClick={() =>
                          ejecutarComandoBot('estrategia', s.id, `Estrategia -> ${s.corto}`)
                        }
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bot-tg-grid">
              <button
                type="button"
                className="bot-tg-btn"
                disabled={botDesconectado || enviandoCmd}
                onClick={() =>
                  ejecutarComandoBot(
                    'toggle',
                    null,
                    `Auto-Trading -> ${tradingEnabled ? 'PAUSAR' : 'ACTIVAR'}`
                  )
                }
              >
                Auto: {tradingEnabled ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                className={`bot-tg-btn ${menuTgAbierto === 'tf' ? 'active' : ''}`}
                disabled={botDesconectado}
                onClick={() => setMenuTgAbierto((m) => (m === 'tf' ? null : 'tf'))}
              >
                Temp: <span className="num">{tfActual}</span>
              </button>

              <button
                type="button"
                className={`bot-tg-btn ${menuTgAbierto === 'activo' ? 'active' : ''}`}
                disabled={botDesconectado}
                onClick={() => setMenuTgAbierto((m) => (m === 'activo' ? null : 'activo'))}
              >
                Activo: {symCorto}
              </button>

              <button
                type="button"
                className={`bot-tg-btn ${menuTgAbierto === 'estrategia' ? 'active' : ''}`}
                disabled={botDesconectado}
                onClick={() =>
                  setMenuTgAbierto((m) => (m === 'estrategia' ? null : 'estrategia'))
                }
              >
                Estrategia
              </button>

              <button
                type="button"
                className="bot-tg-btn"
                disabled={botDesconectado || enviandoCmd}
                onClick={() => {
                  enviarComandoBot(uid, 'analisis').catch(() => {});
                  ejecutarComandoBot('telegram', 'ACT:REPORT_CHART', 'Reporte técnico en vivo', {
                    esperarResultado: true,
                    categoria: 'reportes',
                    label: 'Reporte técnico + gráfico',
                  });
                }}
              >
                Reporte
              </button>

              <button
                type="button"
                className="bot-tg-btn"
                disabled={botDesconectado || enviandoCmd}
                onClick={() =>
                  ejecutarComandoBot('telegram', 'ACT:GROK_SENTIMENT', 'Sentimiento de mercado (Grok)', {
                    esperarResultado: true,
                    categoria: 'sentimiento',
                    esSentimiento: true,
                    timeoutMs: 65000,
                    label: 'Sentimiento de mercado (Grok)',
                  })
                }
              >
                Sentimiento
              </button>

              <button
                type="button"
                className="bot-tg-btn"
                disabled={botDesconectado || enviandoCmd}
                onClick={() =>
                  ejecutarComandoBot('telegram', 'ACT:WINRATE', 'Consultar Win rate', {
                    esperarResultado: true,
                    categoria: 'winrate',
                    label: 'Win rate histórico',
                  })
                }
              >
                Win rate
              </button>

              <button
                type="button"
                className="bot-tg-btn"
                disabled={botDesconectado || enviandoCmd}
                onClick={() =>
                  ejecutarComandoBot('telegram', 'ACT:DM', 'Test Diebold-Mariano', {
                    esperarResultado: true,
                    categoria: 'diebold',
                    label: 'Test Diebold-Mariano',
                  })
                }
              >
                Diebold-M.
              </button>

              <button
                type="button"
                className="bot-tg-btn bot-tg-btn-span2"
                disabled={botDesconectado || enviandoCmd}
                onClick={() =>
                  ejecutarComandoBot('telegram', 'ACT:EXCEL', 'Exportar historial Excel', {
                    esperarResultado: true,
                    categoria: 'reportes',
                    label: 'Exportación Excel',
                  })
                }
              >
                Exportar Excel
              </button>

              <button
                type="button"
                className="bot-tg-btn bot-tg-btn-span2"
                disabled={botDesconectado || !posBotAbierta}
                onClick={() => {
                  if (posBotAbierta) setPosACerrarModal(posBotAbierta);
                }}
              >
                Cerrar pos.
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* 3. PANEL INFERIOR CON CENTRO DE RESULTADOS Y TABLAS */}
      <section className="bot-bottom-panel">
        <div className="bot-bottom-tabs">
          <button
            type="button"
            className={`bot-bottom-tab ${tabInferior === 'posicion' ? 'active' : ''}`}
            onClick={() => setTabInferior('posicion')}
          >
            Posición del bot (<span className="num">{posBotAbierta ? 1 : 0}</span>)
          </button>
          <button
            type="button"
            className={`bot-bottom-tab ${tabInferior === 'resultados' ? 'active' : ''}`}
            onClick={() => setTabInferior('resultados')}
          >
            Resultados (<span className="num">{tradesEf.length}</span> ops ·{' '}
            <span className="num">{tarjetasResultados.length}</span> reportes)
            {esperaBot?.activo && <span className="bot-tab-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={`bot-bottom-tab ${tabInferior === 'operaciones' ? 'active' : ''}`}
            onClick={() => setTabInferior('operaciones')}
          >
            Operaciones del bot (<span className="num">{tradesEf.length}</span>)
          </button>
          <button
            type="button"
            className={`bot-bottom-tab ${tabInferior === 'cuenta' ? 'active' : ''}`}
            onClick={() => setTabInferior('cuenta')}
          >
            Cuenta Testnet / Bot
          </button>
          <button
            type="button"
            className={`bot-bottom-tab ${tabInferior === 'riesgo' ? 'active' : ''}`}
            onClick={() => setTabInferior('riesgo')}
          >
            Riesgo VaR/CVaR/CAViaR
          </button>
        </div>

        <div key={tabInferior} className="bot-bottom-content subtab-enter">
          {tabInferior === 'posicion' && (
            <>
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
                    <th className="num">P&amp;L (ROE S/MARGEN)</th>
                    <th className="num"></th>
                  </tr>
                </thead>
                <tbody>
                  {!posBotAbierta ? (
                    <tr>
                      <td colSpan={10} className="empty-dense-cell">
                        El bot no tiene ninguna posición abierta en este momento — monitoreando{' '}
                        <strong>{symDisplay}</strong> ({tfActual}) con estrategia{' '}
                        <strong>{estrategiaCorto}</strong>.
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td>
                        <strong>{posBotAbierta.sym.replace('_', '/')}</strong>
                      </td>
                      <td className="text-sec">
                        Bot · {estrategiaPosBot}
                        {botDesconectado ? ' · Última conocida' : ''}
                      </td>
                      <td>
                        <span
                          className={`dense-side-pill ${
                            posBotAbierta.side === 'SHORT' ? 'short' : 'long'
                          }`}
                        >
                          {posBotAbierta.side} {posBotAbierta.leverage}x
                        </span>
                      </td>
                      <td className="num">{posBotAbierta.cantidad.toFixed(4)}</td>
                      <td className="num">{fmtPrecioBot(posBotAbierta.entrada)}</td>
                      <td className="num">{fmtPrecioBot(precioPosBot)}</td>
                      <td className="num">{fmtPrecioBot(posBotAbierta.liq)}</td>
                      <td className="num">{fmtUSD.format(posBotAbierta.margen)}</td>
                      <td
                        className={`num ${
                          pnlPosBot.pnlUSD >= 0 ? 'text-green' : 'text-red'
                        }`}
                      >
                        {formatearPnlConSigno(pnlPosBot.pnlUSD)} (
                        {pnlPosBot.pnlPct >= 0 ? '+' : ''}
                        {pnlPosBot.pnlPct.toFixed(2)}% ROE s/margen)
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="dense-close-btn"
                          disabled={botDesconectado}
                          onClick={() => setPosACerrarModal(posBotAbierta)}
                        >
                          Cerrar
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {hayDesfaseEstrategiaPos && (
                <div className="bot-pos-origin-note" role="status">
                  Posición abierta por <strong>{estrategiaPosBot}</strong> (1 posición máx. a la vez): el bot mantendrá este{' '}
                  <strong>{posBotAbierta.side}</strong> hasta tocar TP/SL o cerrarse antes de tomar nuevas entradas de{' '}
                  <strong>{estrategiaCorto}</strong>.
                </div>
              )}

              {ultimoTradeBot && (
                <div className="bot-last-close-bar">
                  <span className="text-sec">Último cierre del bot:</span>
                  <span
                    className={`dense-side-pill ${
                      String(ultimoTradeBot.lado || 'LONG').toUpperCase() === 'SHORT' ? 'short' : 'long'
                    }`}
                  >
                    {ultimoTradeBot.lado || 'LONG'}
                  </span>
                  <strong>{String(ultimoTradeBot.activo || '').replace('_', '/')}</strong>
                  <span className="num text-sec">
                    {fmtPrecioBot(ultimoTradeBot.entrada)} → {fmtPrecioBot(ultimoTradeBot.salida)}
                  </span>
                  <span className="text-sec">({ultimoTradeBot.motivo || 'Cierre bot'})</span>
                  <strong className={`num ${Number(ultimoTradeBot.pnl_usdt || 0) >= 0 ? 'text-green' : 'text-red'}`}>
                    {formatearPnlConSigno(Number(ultimoTradeBot.pnl_usdt || 0))} (
                    {Number(ultimoTradeBot.roe_pct || 0) >= 0 ? '+' : ''}
                    {Number(ultimoTradeBot.roe_pct || 0).toFixed(2)}% ROE sobre margen de $100)
                  </strong>
                </div>
              )}
            </>
          )}

          {tabInferior === 'operaciones' && (
            <div className="bot-op-wrap">
              <div className="ml-plain-guide" style={{ margin: '8px 10px 0' }}>
                <span>
                  <strong>Nota sobre las versiones de la estrategia:</strong> La estrategia activa
                  hoy en el bot es <strong>Bollinger + EMA 200 (TP 2.0 / SL 0.4 ATR)</strong>. Las{' '}
                  <strong className="num">{tradesEf.length}</strong> operaciones históricas listadas
                  abajo incluyen las pruebas de la <strong>Etapa 2 (Fibonacci y SuperTrend con
                  win rate alto de 81%)</strong>. El porcentaje junto al P&amp;L es el{' '}
                  <strong>ROE sobre el margen de $100 USDT (con apalancamiento x10)</strong>, no el
                  cambio del precio del activo.
                </span>
              </div>

              <div className="bot-op-toolbar">
                <div className="bot-op-filter-groups">
                  <div className="bot-results-filters" role="group" aria-label="Filtro por versión">
                    {[
                      { id: 'todas', label: `Todas (${tradesEf.length})` },
                      {
                        id: 'BOLLINGER',
                        label: `Bollinger actual (${tradesEf.filter((t) => String(t?.estrategia || '').toUpperCase().includes('BOLLINGER')).length})`,
                      },
                      {
                        id: 'ETAPA2',
                        label: `Etapa 2 previa (${tradesEf.filter((t) => !String(t?.estrategia || '').toUpperCase().includes('BOLLINGER')).length})`,
                      },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`bot-results-pill ${filtroOpEstrategia === f.id ? 'is-active' : ''}`}
                        onClick={() => setFiltroOpEstrategia(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="bot-results-filters" role="group" aria-label="Filtro por fecha">
                    {[
                      { id: 'hoy', label: 'Hoy' },
                      { id: '7d', label: '7 días' },
                      { id: 'todo', label: 'Todo' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`bot-results-pill ${filtroOpRango === f.id ? 'is-active' : ''}`}
                        onClick={() => setFiltroOpRango(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="bot-results-filters" role="group" aria-label="Filtro por lado">
                    {[
                      { id: 'todos', label: 'Lado: Todos' },
                      { id: 'LONG', label: 'LONG' },
                      { id: 'SHORT', label: 'SHORT' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`bot-results-pill ${filtroOpLado === f.id ? 'is-active' : ''}`}
                        onClick={() => setFiltroOpLado(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="bot-results-filters" role="group" aria-label="Filtro por resultado">
                    {[
                      { id: 'todos', label: 'Resultado: Todos' },
                      { id: 'ganadas', label: 'Ganadas' },
                      { id: 'perdidas', label: 'Perdidas' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`bot-results-pill ${filtroOpResultado === f.id ? 'is-active' : ''}`}
                        onClick={() => setFiltroOpResultado(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bot-op-actions">
                  <span className="bot-results-meta num">
                    {tradesFiltrados.length} de {tradesEf.length} ops
                  </span>
                  <button
                    type="button"
                    className="bot-op-csv-btn"
                    onClick={exportarOperacionesCsv}
                    disabled={tradesFiltrados.length === 0}
                  >
                    <Download size={13} />
                    <span>Exportar CSV</span>
                  </button>
                </div>
              </div>

              <div className="bot-op-table-scroll">
                <table className="terminal-dense-table">
                  <thead>
                    <tr>
                      <th>ORDEN TESTNET</th>
                      <th>APERTURA</th>
                      <th>CIERRE</th>
                      <th>DURACIÓN</th>
                      <th>ACTIVO</th>
                      <th>LADO</th>
                      <th>ESTRATEGIA</th>
                      <th className="num">ENTRADA</th>
                      <th className="num">SALIDA</th>
                      <th>MOTIVO</th>
                      <th>EXPLICACIÓN</th>
                      <th className="num">P&amp;L USDT (ROE S/MARGEN)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradesFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="empty-dense-cell">
                          {filtroOpEstrategia === 'BOLLINGER'
                            ? 'La estrategia Bollinger + EMA 200 está activa en espera de su primera operación cerrada en vivo (ver Backtest de 229 operaciones en Estrategia Bot).'
                            : 'Ninguna operación coincide con los filtros seleccionados.'}
                        </td>
                      </tr>
                    ) : (
                      tradesFiltrados.map((tr) => {
                        const pnl = Number(tr.pnl_usdt || 0);
                        const roe = Number(tr.roe_pct ?? pnl);
                        return (
                          <tr key={tr.id}>
                            <td className="text-sec num">{tr._ordenTestnetId}</td>
                            <td className="text-sec num">
                              {fmtFechaHoraBot(tr._aperturaMs)}
                            </td>
                            <td className="text-sec num">{fmtFechaHoraBot(tr.ts)}</td>
                            <td className="text-sec num">
                              {fmtDuracionBot(tr._aperturaMs, tr.ts)}
                            </td>
                            <td>
                              <strong>{String(tr.activo || '').replace('_', '/')}</strong>
                            </td>
                            <td>
                              <span
                                className={`dense-side-pill ${
                                  tr.lado === 'SHORT' ? 'short' : 'long'
                                }`}
                              >
                                {tr.lado || 'LONG'}
                              </span>
                            </td>
                            <td className="text-sec">{tr.estrategia || 'Chartismo'}</td>
                            <td className="num">{fmtPrecioBot(tr.entrada)}</td>
                            <td className="num">{fmtPrecioBot(tr.salida)}</td>
                            <td className="text-sec">{tr.motivo || 'Cierre bot'}</td>
                            <td className="text-sec">{explicarTradeBotEs(tr)}</td>
                            <td className={`num ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                              <strong>{formatearPnlConSigno(pnl)}</strong>{' '}
                              <span className="text-sec">
                                ({roe >= 0 ? '+' : ''}
                                {roe.toFixed(2)}% ROE)
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tabInferior === 'cuenta' && (
            <div style={{ padding: '8px 10px' }}>
              {(() => {
                const pnlCerradas = tradesEf.reduce(
                  (a, t) => a + Number(t.pnl_usdt || 0),
                  0
                );
                const saldoContable = capitalInicialBot + pnlCerradas;
                const margenAbierto = posBotAbierta ? Number(posBotAbierta.margen || 100) : 0;
                const disponibleTestnet = saldoContable - margenAbierto;
                return (
                  <>
                    <div className="ml-plain-guide" style={{ marginBottom: '8px' }}>
                      <span>
                        <strong>Conciliación exacta de la cuenta del bot (Futuros USDT-M x10):</strong>{' '}
                        Capital inicial <strong className="num">$1,000.00 USDT</strong> + P&amp;L
                        realizado de las <strong className="num">{tradesEf.length}</strong>{' '}
                        operaciones registradas (
                        <strong className="num">{formatearPnlConSigno(pnlCerradas)} USDT</strong>) ={' '}
                        <strong className="num">{fmtUSD.format(saldoContable)} USDT</strong>. Cada
                        operación arriesga un margen fijo de <strong className="num">$100.00 USDT</strong>{' '}
                        con apalancamiento <strong className="num">x10</strong> (tamaño nocional
                        $1,000 USDT).
                      </span>
                    </div>
                    <table className="terminal-dense-table">
                      <thead>
                        <tr>
                          <th>CUENTA / ENTORNO</th>
                          <th>CONTRATO ACTIVO</th>
                          <th className="num">CAPITAL INICIAL</th>
                          <th className="num">OPERACIONES CERRADAS</th>
                          <th className="num">P&amp;L REALIZADO</th>
                          <th className="num">MARGEN EN USO</th>
                          <th className="num">SALDO CONTABLE ACTUAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            <strong>Gate.io Futures Testnet (Simulación x10)</strong>
                          </td>
                          <td className="text-sec">
                            {symDisplay} Perp · {estrategiaCorto} ({tfActual})
                          </td>
                          <td className="num">{fmtUSD.format(capitalInicialBot)}</td>
                          <td className="num">{tradesEf.length}</td>
                          <td
                            className={`num ${
                              pnlCerradas >= 0 ? 'text-green' : 'text-red'
                            }`}
                          >
                            <strong>{formatearPnlConSigno(pnlCerradas)}</strong> (
                            {((pnlCerradas / capitalInicialBot) * 100).toFixed(2)}%)
                          </td>
                          <td className="num">{fmtUSD.format(margenAbierto)}</td>
                          <td className="num">
                            <strong>{fmtUSD.format(disponibleTestnet)}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                );
              })()}
            </div>
          )}

          {tabInferior === 'riesgo' && (
            <div style={{ padding: '8px 10px' }}>
              <div className="ml-plain-guide" style={{ marginBottom: '8px' }}>
                <span>
                  <strong>¿Qué mide este monitor de protección?</strong>{' '}
                  <strong>VaR 95%:</strong> pérdida máxima en una vela mala normal ·{' '}
                  <strong>CVaR 95%:</strong> pérdida promedio en el peor 5% de los casos ·{' '}
                  <strong>CAViaR vs Umbral:</strong> freno automático en vivo; si CAViaR supera el
                  Umbral ({fmtNum(caviarUmbral, 2)}%), el bot pausa nuevas compras/ventas para
                  proteger el capital.
                </span>
              </div>
              <table className="terminal-dense-table">
                <thead>
                  <tr>
                    <th>ACTIVO</th>
                    <th className="num">VAR 95%</th>
                    <th className="num">CVAR 95%</th>
                    <th className="num">CAVIAR</th>
                    <th className="num">UMBRAL</th>
                    <th>ESTADO</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>{symDisplay}</strong></td>
                    <td className="num">{fmtNum(riesgoObj.var95 ?? 0.52, 2)}%</td>
                    <td className="num">{fmtNum(riesgoObj.cvar95 ?? 0.74, 2)}%</td>
                    <td className="num">{fmtNum(caviarVal, 2)}%</td>
                    <td className="num">{fmtNum(caviarUmbral, 2)}%</td>
                    <td className={tradingEnabled ? 'text-green' : 'text-red'}>
                      {tradingEnabled ? 'Habilitado (zona segura)' : 'Bloqueado por riesgo'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {tabInferior === 'resultados' && (
            <CentroResultadosBot
              mensajesTg={mensajesTg}
              trades={tradesEf}
              capitalInicialBot={capitalInicialBot}
              esperaBot={esperaBot}
              autoAbrirCardId={autoAbrirCardId}
              onAbrirImagen={(imgInfo) => setImagenModal(imgInfo)}
              onLimpiarEspera={() => setEsperaBot(null)}
            />
          )}
        </div>
      </section>

      {imagenModal && (
        <div
          className="bot-img-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={imagenModal.titulo || 'Vista previa del gráfico'}
          onClick={() => setImagenModal(null)}
        >
          <div className="bot-img-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bot-img-modal-head">
              <div>
                <h3>{imagenModal.titulo || 'Gráfico del bot'}</h3>
                {imagenModal.hora && <span className="bot-img-modal-time num">{imagenModal.hora}</span>}
              </div>
              <div className="bot-img-modal-actions">
                <a
                  href={imagenModal.src}
                  download={imagenModal.nombre || 'grafica_bot.png'}
                  className="bot-img-download-btn"
                >
                  <Download size={14} />
                  <span>Descargar PNG</span>
                </a>
                <button
                  type="button"
                  className="bot-img-close-btn"
                  onClick={() => setImagenModal(null)}
                  aria-label="Cerrar imagen"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="bot-img-modal-body">
              <img
                src={imagenModal.src}
                alt={imagenModal.titulo || 'Gráfico del bot'}
                className="bot-img-modal-img"
              />
            </div>
          </div>
        </div>
      )}

      {posACerrarModal && (
        <CerrarPosicionModal
          posicion={posACerrarModal}
          precios={precios}
          botEstado={estado}
          uid={uid}
          perfil={perfil}
          onClose={() => setPosACerrarModal(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}
