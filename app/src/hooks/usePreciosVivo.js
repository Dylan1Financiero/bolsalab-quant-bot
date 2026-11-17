import { useEffect, useState, useMemo } from 'react';
import {
  CATALOGO_ACTIVOS,
  MAPA_BINANCE_PAR_A_SYM,
  BINANCE_WS_URL,
} from '../data/catalogo';
import { escucharPreciosMercado } from '../services/firebase';

/**
 * Hook de precios en vivo según Sección 4:
 * - Cripto: WebSocket público de Binance (<par>@miniTicker, c = precio, o = apertura 24h)
 *   con respaldo de `mercado/precios` en Firestore.
 * - Acciones y ETFs: exclusivamente desde `mercado/precios` en Firestore.
 */
export function usePreciosVivo(habilitado = true) {
  const [preciosFirestore, setPreciosFirestore] = useState({});
  const [preciosBinance, setPreciosBinance] = useState({});
  const [wsConectado, setWsConectado] = useState(false);

  // 1. Suscripción a Firestore `mercado/precios`
  useEffect(() => {
    if (!habilitado) return undefined;
    const unsub = escucharPreciosMercado((datos) => {
      if (datos) {
        setPreciosFirestore(datos);
      }
    });
    return () => unsub();
  }, [habilitado]);

  // 2. Suscripción al WebSocket público de Binance para las 10 criptomonedas
  useEffect(() => {
    if (!habilitado) return undefined;
    let ws = null;
    let reconectarTimer = null;
    let cancelado = false;

    const conectar = () => {
      if (cancelado) return;
      try {
        ws = new WebSocket(BINANCE_WS_URL);

        ws.onopen = () => {
          if (!cancelado) setWsConectado(true);
        };

        ws.onmessage = (event) => {
          if (cancelado) return;
          try {
            const msg = JSON.parse(event.data);
            const payload = msg?.data || msg;
            const par = payload?.s; // ej. "BTCUSDT"
            const sym = MAPA_BINANCE_PAR_A_SYM[par];
            if (!sym) return;

            const c = parseFloat(payload.c);
            const o = parseFloat(payload.o);
            if (!Number.isFinite(c) || c <= 0) return;

            const chg = Number.isFinite(o) && o > 0 ? ((c / o) - 1) * 100 : 0;

            setPreciosBinance((prev) => {
              const anterior = prev[sym];
              if (anterior && anterior.p === c && Math.abs(anterior.chg - chg) < 0.001) {
                return prev;
              }
              return {
                ...prev,
                [sym]: {
                  p: c,
                  chg,
                  ts: Date.now(),
                },
              };
            });
          } catch (_) {
            // Ignorar trama malformada
          }
        };

        ws.onerror = () => {
          if (!cancelado) setWsConectado(false);
        };

        ws.onclose = () => {
          if (cancelado) return;
          setWsConectado(false);
          reconectarTimer = setTimeout(conectar, 3500);
        };
      } catch (_) {
        if (!cancelado) {
          setWsConectado(false);
          reconectarTimer = setTimeout(conectar, 5000);
        }
      }
    };

    conectar();

    return () => {
      cancelado = true;
      if (reconectarTimer) clearTimeout(reconectarTimer);
      if (ws) {
        try {
          ws.close();
        } catch (_) {
          // Ignorar error al cerrar WS
        }
      }
    };
  }, [habilitado]);

  // 3. Combinar precios según las reglas de la Sección 4
  const precios = useMemo(() => {
    const mapa = {};
    for (const activo of CATALOGO_ACTIVOS) {
      const { sym, clase } = activo;
      if (clase === 'CRYPTO') {
        const tickWs = preciosBinance[sym];
        const tickFs = preciosFirestore?.[sym];
        if (tickWs && Number.isFinite(tickWs.p) && tickWs.p > 0) {
          mapa[sym] = {
            p: Number(tickWs.p),
            chg: Number(tickWs.chg || 0),
            abierto: true,
            periodo: '24h',
            fuente: 'Binance WebSocket',
            disponible: true,
          };
        } else if (tickFs && Number.isFinite(Number(tickFs.p)) && Number(tickFs.p) > 0) {
          mapa[sym] = {
            p: Number(tickFs.p),
            chg: Number(tickFs.chg || 0),
            abierto: true,
            periodo: '24h',
            fuente: 'Respaldo (mercado/precios)',
            disponible: true,
          };
        } else {
          mapa[sym] = {
            p: null,
            chg: null,
            abierto: true,
            periodo: '24h',
            fuente: 'Sin precio',
            disponible: false,
          };
        }
      } else {
        // Acciones y ETFs: precio SOLO de mercado/precios
        const tickFs = preciosFirestore?.[sym];
        const abiertoFlag =
          typeof tickFs?.abierto === 'boolean' ? tickFs.abierto : false;
        if (tickFs && Number.isFinite(Number(tickFs.p)) && Number(tickFs.p) > 0) {
          mapa[sym] = {
            p: Number(tickFs.p),
            chg: Number(tickFs.chg || 0),
            abierto: abiertoFlag,
            periodo: 'hoy',
            fuente: 'mercado/precios (bot)',
            disponible: true,
          };
        } else {
          mapa[sym] = {
            p: null,
            chg: null,
            abierto: abiertoFlag,
            periodo: 'hoy',
            fuente: 'Sin precio',
            disponible: false,
          };
        }
      }
    }
    return mapa;
  }, [preciosBinance, preciosFirestore]);

  return {
    precios,
    wsConectado,
    tsFirestore: preciosFirestore?.ts || null,
  };
}
