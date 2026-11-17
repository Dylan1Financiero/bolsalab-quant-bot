import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import AuthScreen from './components/AuthScreen';
import Navbar from './components/Navbar';
import TickerTape from './components/TickerTape';
import MercadoView from './components/MercadoView';
import JuegoView from './components/JuegoView';
import BotView from './components/BotView';
import ModeloMLView from './components/ModeloMLView';
import AnalistaIAView from './components/AnalistaIAView';
import PortafolioMLView from './components/PortafolioMLView';
import MisPosicionesView from './components/MisPosicionesView';
import OnboardingModal from './components/OnboardingModal';
import AjustesModal from './components/AjustesModal';
import { tieneAccesoPro } from './config/planConfig';
import { usePreciosVivo } from './hooks/usePreciosVivo';
import {
  observarAuth,
  asegurarPerfilUsuario,
  escucharUsuario,
  escucharBotEstado,
  escucharTradesBot,
  copiarAperturaBotEspejo,
  cerrarCopiaBotEspejo,
  cerrarSesion,
  SALDO_INICIAL,
} from './services/firebase';

export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined = cargando
  const [perfil, setPerfil] = useState(null);
  const [botEstado, setBotEstado] = useState(null);
  const [tradesBot, setTradesBot] = useState([]);
  const [tradesBotCargado, setTradesBotCargado] = useState(false);
  const [seccionActiva, setSeccionActiva] = useState('mercado');
  const [mostrarOnboardingManual, setMostrarOnboardingManual] = useState(false);
  const [mostrarAjustes, setMostrarAjustes] = useState(false);
  const [avisoDosBots, setAvisoDosBots] = useState(false);
  const [toasts, setToasts] = useState([]);

  const { precios } = usePreciosVivo(Boolean(authUser));
  const autoTradeLockRef = useRef(false);
  const ultimaSenalAutoRef = useRef('');
  const instanciasHistorialRef = useRef([]);
  const botPosTrackerRef = useRef({ init: false, key: '' });
  const tradesBotTrackerRef = useRef({ init: false, ids: new Set() });
  const [botNotifyOverride, setBotNotifyOverride] = useState(null);

  useEffect(() => {
    const onOverride = (ev) => {
      setBotNotifyOverride(ev?.detail ?? null);
    };
    window.addEventListener('bolsalab:chart-test-override', onOverride);
    return () => window.removeEventListener('bolsalab:chart-test-override', onOverride);
  }, []);

  const agregarToast = useCallback((mensaje, tipo = 'info', duracionMs = 5500) => {
    const raw = String(mensaje || '');
    const msgFinal = /Missing or insufficient permissions|permission-denied/i.test(raw)
      ? 'Faltan publicar las reglas de Firestore'
      : raw;
    if (!msgFinal) return;
    const id = Date.now() + Math.random();
    setToasts((prev) => {
      if (prev.some((t) => t.mensaje === msgFinal)) return prev;
      return [...prev, { id, mensaje: msgFinal, tipo }];
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duracionMs);
  }, []);

  useEffect(() => {
    const onTimeout = (ev) => {
      agregarToast(
        ev?.detail || 'El bot no respondió. Revisa que esté corriendo',
        'error'
      );
    };
    window.addEventListener('bolsalab:bot-timeout', onTimeout);
    return () => window.removeEventListener('bolsalab:bot-timeout', onTimeout);
  }, [agregarToast]);

  const eliminarToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Suscripción a Firebase Auth
  useEffect(() => {
    const unsub = observarAuth(async (user) => {
      if (user) {
        try {
          await asegurarPerfilUsuario(user);
        } catch (err) {
          console.error('Error asegurando perfil:', err);
        }
        setAuthUser(user);
      } else {
        setAuthUser(null);
        setPerfil(null);
      }
    });
    return () => unsub();
  }, []);

  // Suscripción en tiempo real a usuarios/{uid}
  useEffect(() => {
    if (!authUser?.uid) return undefined;
    const unsubUser = escucharUsuario(authUser.uid, (datos) => {
      setPerfil(datos);
    });
    const unsubBot = escucharBotEstado((datosBot) => {
      setBotEstado(datosBot);
    });
    const unsubTrades = escucharTradesBot((lista) => {
      setTradesBot(lista);
      setTradesBotCargado(true);
    }, 10);
    return () => {
      unsubUser();
      unsubBot();
      unsubTrades();
    };
  }, [authUser?.uid]);

  // Detectar si hay dos instancias del bot alternando en bot/estado.instancia (< 2 min)
  useEffect(() => {
    const inst = botEstado?.instancia;
    if (!inst) return;
    const ahora = Date.now();
    const ventana = instanciasHistorialRef.current.filter((x) => ahora - x.ts < 120000);
    const ultimo = ventana[ventana.length - 1];
    if (!ultimo || ultimo.inst !== inst) {
      const yaExistiaAntes = ventana.some((x) => x.inst === inst);
      ventana.push({ inst, ts: ahora });
      instanciasHistorialRef.current = ventana;
      if (yaExistiaAntes && ultimo && ultimo.inst !== inst) {
        setAvisoDosBots(true);
      }
    }
  }, [botEstado?.instancia]);

  // Notificación en vivo cuando el bot abre una nueva posición (LONG o SHORT)
  useEffect(() => {
    if (!authUser?.uid) return;
    if (!botEstado && !(botNotifyOverride && 'position' in botNotifyOverride)) return;

    const posActual =
      botNotifyOverride && 'position' in botNotifyOverride
        ? botNotifyOverride.position
        : botEstado?.position || null;

    const posKey =
      posActual && Number(posActual.entry || 0) > 0
        ? `${String(posActual.side || 'LONG').toUpperCase()}:${posActual.asset || ''}:${posActual.entry_utc || posActual.entry_candle || posActual.entry}`
        : '';

    if (!botPosTrackerRef.current.init) {
      botPosTrackerRef.current = { init: true, key: posKey };
      return;
    }

    if (posKey && posKey !== botPosTrackerRef.current.key) {
      const side = String(posActual.side || 'LONG').toUpperCase();
      const lev = Number(posActual.leverage || botEstado?.leverage || 10);
      const sym = String(posActual.asset || botEstado?.asset || 'BTC_USDT').replace('_', '/');
      const entry = Number(posActual.entry || 0);
      const tp = Number(posActual.tp || 0);
      const sl = Number(posActual.sl || 0);
      const strat = String(posActual.strategy || botEstado?.strategy || '').trim();
      const fmtP = (v) =>
        v.toLocaleString('en-US', {
          minimumFractionDigits: v < 1 ? 4 : 2,
          maximumFractionDigits: v < 1 ? 4 : 2,
        });
      agregarToast(
        `${side} x${lev} abierto por el bot en ${sym} @ $${fmtP(entry)} · TP $${fmtP(tp)} · SL $${fmtP(sl)}${strat ? ` (${strat})` : ''}`,
        side === 'SHORT' ? 'warn' : 'success',
        7000
      );
    }
    botPosTrackerRef.current.key = posKey;
  }, [authUser?.uid, botEstado, botNotifyOverride, agregarToast]);

  // Notificación en vivo cuando el bot cierra una operación (trades_bot) con P&L realizado
  useEffect(() => {
    if (!authUser?.uid) return;
    const hayTestTrade = Boolean(botNotifyOverride?.newTrade);
    if (!tradesBotCargado && !hayTestTrade) return;

    if (!tradesBotTrackerRef.current.init) {
      tradesBotTrackerRef.current = {
        init: true,
        ids: new Set((tradesBot || []).map((t) => t.id || String(t.ts || ''))),
      };
      if (!hayTestTrade) return;
    }

    const listaTrades = hayTestTrade
      ? [botNotifyOverride.newTrade, ...(tradesBot || [])]
      : tradesBot || [];

    for (const tr of listaTrades.slice(0, 3)) {
      const tid = tr.id || String(tr.ts || '');
      if (!tid || tradesBotTrackerRef.current.ids.has(tid)) continue;
      tradesBotTrackerRef.current.ids.add(tid);

      const lado = String(tr.lado || tr.side || 'LONG').toUpperCase();
      const sym = String(tr.activo || tr.asset || 'BTC_USDT').replace('_', '/');
      const motivo = String(tr.motivo || 'Cierre bot');
      const pnl = Number(tr.pnl_usdt ?? 0);
      const roe = Number(tr.roe_pct ?? (pnl / 100) * 100);
      const pnlTxt = `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`;
      const roeTxt = `${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%`;

      agregarToast(
        `Bot cerró ${lado} ${sym} (${motivo}) · P&L ${pnlTxt} USD (${roeTxt})`,
        pnl >= 0 ? 'success' : 'error',
        7000
      );
    }
  }, [authUser?.uid, tradesBot, tradesBotCargado, botNotifyOverride, agregarToast]);

  // Cuenta Espejo: únicamente copia lo que el bot de Python abre y cierra en bot/estado.position
  // Usa runTransaction + entry_utc para no duplicar entre pestañas y se apaga si trading_enabled === false
  useEffect(() => {
    if (
      !authUser?.uid ||
      !perfil ||
      !tieneAccesoPro(perfil) ||
      !(perfil.botAutoUser ?? perfil.botAutoCopiar) ||
      !botEstado ||
      !botEstado.trading_enabled ||
      autoTradeLockRef.current
    ) {
      return;
    }

    const botPos = botEstado.position || null;
    const botEntryUtc = botPos ? String(botPos.entry_utc || botPos.entry_candle || '') : '';
    const posFuturos = perfil.posicionesFuturos || {};

    // 1. Si el bot tiene posición abierta y aún no ha sido copiada (por entry_utc), copiarla UNA vez
    if (botPos && botEntryUtc && perfil.copiaUltimaEntryUtc !== botEntryUtc && !posFuturos[botPos.asset]) {
      autoTradeLockRef.current = true;
      copiarAperturaBotEspejo(authUser.uid, botPos, perfil.botTamanoCopia || 'igual_bot')
        .then((res) => {
          if (res) {
            agregarToast(
              `🤖 Copia bot: Abrió ${res.side} ${res.sym} x${res.leverage} ($${res.margen.toFixed(2)} USD).`,
              'success'
            );
          }
        })
        .catch((err) => console.error('Error copiarAperturaBotEspejo:', err))
        .finally(() => {
          autoTradeLockRef.current = false;
        });
      return;
    }

    // 2. Si existe una posición en Cuenta Espejo cuyo entry_utc ya no está activo en el bot, cerrarla UNA vez
    const abiertasCopia = Object.entries(posFuturos);
    for (const [sym, posCopia] of abiertasCopia) {
      const mismaOperacionBot =
        botPos &&
        botPos.asset === sym &&
        String(botPos.entry_utc || botPos.entry_candle || '') === String(posCopia.entry_utc || '');
      if (mismaOperacionBot) continue;

      const tradeBotCerrado = (tradesBot || []).find(
        (t) => posCopia.entry_utc && String(t.entry_utc || '') === String(posCopia.entry_utc)
      );
      const cambioLado =
        botPos &&
        botPos.asset === sym &&
        String(botPos.side || '').toUpperCase() !== String(posCopia.side || '').toUpperCase();
      const motivoCierre =
        tradeBotCerrado?.motivo ||
        (cambioLado
          ? `El bot cambió a ${String(botPos.side || '').toUpperCase()}`
          : 'El bot cerró su posición');
      const precioSalida =
        Number(tradeBotCerrado?.salida || 0) ||
        Number(precios?.[sym]?.p || 0) ||
        (botEstado.asset === sym ? Number(botEstado.price || 0) : 0) ||
        Number(posCopia.entry || 0);

      if (precioSalida > 0) {
        autoTradeLockRef.current = true;
        cerrarCopiaBotEspejo(
          authUser.uid,
          sym,
          precioSalida,
          motivoCierre
        )
          .then((res) => {
            if (res) {
              agregarToast(
                `🤖 Copia bot cerró ${res.sym} (P&L: ${res.pnl >= 0 ? '+' : '−'}$${Math.abs(res.pnl).toFixed(2)} USD).`,
                'info'
              );
            }
          })
          .catch((err) => console.error('Error copiarAperturaBotEspejo:', err))
          .finally(() => {
            autoTradeLockRef.current = false;
          });
        break;
      }
    }
  }, [authUser?.uid, perfil, botEstado, tradesBot, precios, agregarToast]);

  // Cálculo unificado de Efectivo, Valor de posiciones, Patrimonio y Rendimiento total (% sobre $10,000)
  const resumenFinanciero = useMemo(() => {
    const efectivo = Number(perfil?.saldo ?? SALDO_INICIAL);
    const posiciones = perfil?.posiciones || {};
    let valorPosiciones = 0;

    for (const [sym, pos] of Object.entries(posiciones)) {
      const cant = Number(pos?.cant || 0);
      if (cant <= 1e-8) continue;
      const cot = precios?.[sym];
      const precioRef =
        cot?.disponible && Number(cot.p) > 0
          ? Number(cot.p)
          : Number(pos?.costo || 0);
      valorPosiciones += cant * precioRef;
    }

    const posFuturos = perfil?.posicionesFuturos || {};
    for (const [sym, p] of Object.entries(posFuturos)) {
      const qty = Number(p?.qty || 0);
      const entry = Number(p?.entry || 0);
      const margen = Number(p?.margin_usdt || 0);
      if (qty <= 1e-8 || entry <= 0) continue;
      const cot = precios?.[sym];
      const precioRef =
        (cot?.disponible && Number(cot.p) > 0 ? Number(cot.p) : null) ||
        (botEstado?.asset === sym && Number(botEstado?.price || 0) > 0 ? Number(botEstado.price) : entry);
      const pnl = String(p?.side || 'LONG').toUpperCase() === 'SHORT'
        ? (entry - precioRef) * qty
        : (precioRef - entry) * qty;
      valorPosiciones += Math.max(0, margen + pnl);
    }

    const patrimonio = efectivo + valorPosiciones;
    const rendimientoPct = ((patrimonio - SALDO_INICIAL) / SALDO_INICIAL) * 100;

    return {
      efectivo,
      valorPosiciones,
      patrimonio,
      rendimientoPct,
    };
  }, [perfil, precios, botEstado]);

  const abrirBuscadorActivo = useCallback(() => {
    setSeccionActiva('mercado');
    setTimeout(() => {
      const inp = document.querySelector('.mercado-search, input[placeholder*="Buscar"]');
      if (inp) inp.focus();
    }, 80);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        abrirBuscadorActivo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abrirBuscadorActivo]);

  const manejarSalir = async () => {
    try {
      await cerrarSesion();
      agregarToast('Has cerrado sesión.', 'info');
    } catch (_) {
      agregarToast('No se pudo cerrar la sesión.', 'error');
    }
  };

  if (authUser === undefined) {
    return (
      <div className="auth-wrapper">
        <div className="panel tabular" style={{ padding: '24px 32px' }}>
          Cargando BolsaLab...
        </div>
      </div>
    );
  }

  return (
    <>
      {!authUser ? (
        <AuthScreen onToast={agregarToast} />
      ) : (
        <>
          <Navbar
            seccionActiva={seccionActiva}
            onSelectSeccion={setSeccionActiva}
            patrimonio={resumenFinanciero.patrimonio}
            botEstado={botEstado}
            perfil={perfil}
            onCambiarObjetivo={() => setMostrarOnboardingManual(true)}
            onAbrirAjustes={() => setMostrarAjustes(true)}
            onBuscarActivo={abrirBuscadorActivo}
            onSalir={manejarSalir}
          />

          {avisoDosBots && (
            <div className="dual-bot-banner" role="alert">
              <span>
                ⚠️ Hay dos bots publicando a la vez; deja solo una instancia activa.
              </span>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setAvisoDosBots(false)}
              >
                Ocultar
              </button>
            </div>
          )}

          <main
            className={`main-container ${
              ['mercado', 'bot', 'portafolio', 'ml'].includes(seccionActiva)
                ? 'main-flush'
                : ''
            }`}
          >
            <div key={seccionActiva} className="view-fade-enter">
              {seccionActiva === 'mercado' && (
              <MercadoView
                uid={authUser.uid}
                perfil={perfil}
                precios={precios}
                resumenFinanciero={resumenFinanciero}
                botEstado={botEstado}
                onGoToBot={() => setSeccionActiva('bot')}
                onSelectSeccion={setSeccionActiva}
                onCambiarObjetivo={() => setMostrarOnboardingManual(true)}
                onToast={agregarToast}
              />
            )}

            {seccionActiva === 'posiciones' && (
              <MisPosicionesView
                uid={authUser.uid}
                perfil={perfil}
                precios={precios}
                botEstado={botEstado}
                onGoToMercado={() => setSeccionActiva('mercado')}
                onGoToPortafolio={() => setSeccionActiva('portafolio')}
                onToast={agregarToast}
              />
            )}

            {seccionActiva === 'portafolio' && (
              <PortafolioMLView
                uid={authUser.uid}
                perfil={perfil}
                precios={precios}
                resumenFinanciero={resumenFinanciero}
                onSelectSeccion={setSeccionActiva}
                onToast={agregarToast}
              />
            )}

            {seccionActiva === 'juego' && (
              <JuegoView
                uid={authUser.uid}
                perfil={perfil}
                rendimientoPct={resumenFinanciero.rendimientoPct}
                onToast={agregarToast}
              />
            )}

            {seccionActiva === 'bot' && (
              <BotView
                uid={authUser.uid}
                perfil={perfil}
                precios={precios}
                resumenFinanciero={resumenFinanciero}
                onToast={agregarToast}
              />
            )}

            {seccionActiva === 'ml' && (
              <ModeloMLView
                uid={authUser.uid}
                perfil={perfil}
                onToast={agregarToast}
              />
            )}

            {seccionActiva === 'ia' && (
              <AnalistaIAView
                uid={authUser.uid}
                perfil={perfil}
                precios={precios}
                resumenFinanciero={resumenFinanciero}
                botEstado={botEstado}
                onToast={agregarToast}
              />
            )}
            </div>
          </main>

          {((perfil && !perfil.onboarding_ok) || mostrarOnboardingManual) && (
            <OnboardingModal
              uid={authUser.uid}
              perfil={perfil}
              onCompletar={(sec) => {
                setMostrarOnboardingManual(false);
                if (sec) setSeccionActiva(sec);
              }}
              onCerrarOpcional={() => setMostrarOnboardingManual(false)}
              onToast={agregarToast}
            />
          )}

          {mostrarAjustes && (
            <AjustesModal
              uid={authUser.uid}
              perfil={perfil}
              efectivo={resumenFinanciero.efectivo}
              onToast={agregarToast}
              onClose={() => setMostrarAjustes(false)}
            />
          )}
        </>
      )}

      {toasts.length > 0 && (
        <div className="toast-container" role="region" aria-label="Notificaciones">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tipo}`}>
              <span>{t.mensaje}</span>
              <button
                type="button"
                className="toast-close"
                onClick={() => eliminarToast(t.id)}
                aria-label="Cerrar aviso"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
