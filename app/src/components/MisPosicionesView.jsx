import React, { useEffect, useMemo, useState } from 'react';
import { MAPA_ACTIVOS } from '../data/catalogo';
import {
  escucharOrdenesUsuario,
} from '../services/firebase';
import {
  fmtUSD,
  calcularPnlPosicion,
  formatearPnlConSigno,
  formatearPctConSigno,
} from '../config/tradingConfig';
import { obtenerMapaEtiquetasPortafolioPorSym } from '../utils/portafoliosGuardados';
import CerrarPosicionModal, { obtenerPrecioVivoPosicion } from './CerrarPosicionModal';

function formatearTiempoAbierta(tsMs) {
  if (!tsMs) return 'Reciente';
  const diffMin = Math.max(0, Math.floor((Date.now() - tsMs) / 60000));
  if (diffMin < 1) return 'Hace <1 min';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const hrs = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hrs < 24) return `Hace ${hrs}h ${mins}m`;
  const dias = Math.floor(hrs / 24);
  return `Hace ${dias}d ${hrs % 24}h`;
}

export function normalizarPosicionesAbiertas(perfil, botEstado) {
  const lista = [];
  const mapaEtiquetasPort = obtenerMapaEtiquetasPortafolioPorSym(perfil);

  // 1. Manual spot y Portafolio ML (usuarios/{uid}.posiciones)
  const posObj = perfil?.posiciones || {};
  Object.entries(posObj).forEach(([sym, p]) => {
    const cant = Number(p?.cant || 0);
    const costo = Number(p?.costo || 0);
    if (cant <= 1e-8 || costo <= 0) return;
    const info = MAPA_ACTIVOS[sym];
    const margen = Number(p?.margen || cant * costo);
    const esPort = p?.origen === 'portafolio' || Boolean(mapaEtiquetasPort[sym]);
    lista.push({
      id: `manual-${sym}`,
      origen: esPort ? 'portafolio' : 'manual',
      origenLabel: mapaEtiquetasPort[sym] || (esPort ? 'Portafolio' : 'Manual'),
      sym,
      nombre: info?.nombre || sym.replace('_USDT', ''),
      mercado: 'Spot',
      side: 'LONG',
      leverage: 1,
      entrada: costo,
      cantidad: cant,
      margen,
      sl: p?.sl ? Number(p.sl) : null,
      tp: p?.tp ? Number(p.tp) : null,
      liq: null,
      ts: p?.creado_ts || null,
    });
  });

  // 2. Copia bot (Cuenta espejo de futuros si existe)
  const posFuturos = perfil?.posicionesFuturos || {};
  Object.entries(posFuturos).forEach(([sym, p]) => {
    const cant = Number(p?.qty || p?.cant || 0);
    const entry = Number(p?.entry || p?.costo || 0);
    if (cant <= 1e-8 || entry <= 0) return;
    const info = MAPA_ACTIVOS[sym];
    const lev = Number(p?.leverage || 10);
    const margen = Number(p?.margin_usdt || p?.margen || (cant * entry) / lev);
    const esManual = p?.origen === 'manual';
    lista.push({
      id: `${esManual ? 'manualfut' : 'copia'}-${sym}`,
      origen: esManual ? 'manual' : 'copia',
      origenLabel: esManual ? 'Manual' : 'Copia bot',
      sym,
      nombre: info?.nombre || sym.replace('_USDT', ''),
      mercado: `Futuros x${lev}`,
      side: String(p?.side || 'LONG').toUpperCase(),
      leverage: lev,
      entrada: entry,
      cantidad: cant,
      margen,
      sl: p?.sl ? Number(p.sl) : null,
      tp: p?.tp ? Number(p.tp) : null,
      liq: p?.liq ? Number(p.liq) : null,
      ts: p?.entry_utc ? Date.parse(p.entry_utc) : null,
    });
  });

  return lista;
}

export default function MisPosicionesView({
  uid,
  perfil,
  precios,
  botEstado,
  onGoToMercado,
  onGoToPortafolio,
  onToast,
}) {
  const [ordenesUser, setOrdenesUser] = useState([]);
  const [posACerrar, setPosACerrar] = useState(null);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub1 = escucharOrdenesUsuario(uid, setOrdenesUser, 60);
    return () => {
      unsub1();
    };
  }, [uid]);

  const posiciones = useMemo(
    () => normalizarPosicionesAbiertas(perfil, botEstado),
    [perfil, botEstado]
  );

  const posicionesConPnl = useMemo(() => {
    return posiciones.map((pos) => {
      const actual = obtenerPrecioVivoPosicion(pos, precios, botEstado);
      const { pnlUSD, pnlPct } = calcularPnlPosicion({
        side: pos.side,
        entrada: pos.entrada,
        actual,
        cantidad: pos.cantidad,
        margen: pos.margen,
      });
      return { ...pos, actual, pnlUSD, pnlPct };
    });
  }, [posiciones, precios, botEstado]);

  const totalPnlAbierto = useMemo(
    () => posicionesConPnl.reduce((acc, p) => acc + p.pnlUSD, 0),
    [posicionesConPnl]
  );

  const cerradasHoy = useMemo(() => {
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);
    const inicioMs = inicioDia.getTime();
    const borradoTs = Number(perfil?.historialBorradoTs || 0);
    const corteMs = Math.max(inicioMs, borradoTs);

    const etiquetaOrigen = (orig) => {
      if (orig === 'copia' || orig === 'bot_auto') return 'Copia bot';
      if (orig === 'portafolio') return 'Portafolio';
      return 'Manual';
    };

    return (ordenesUser || [])
      .filter((o) => o.tipo === 'venta' && o.origen !== 'bot' && Number(o.ts || 0) >= corteMs)
      .map((o) => {
        const cant = Number(o.cant || 0);
        const ent = Number(o.entrada || 0);
        const sal = Number(o.salida || o.precio || 0);
        const side = String(o.side || 'LONG').toUpperCase();
        const pnlExacto =
          ent > 0 && sal > 0 && cant > 0
            ? side === 'SHORT'
              ? (ent - sal) * cant
              : (sal - ent) * cant
            : Number(o.pnl || 0);
        return {
          id: `u-${o.id}`,
          origenLabel: etiquetaOrigen(o.origen),
          sym: o.sym,
          side,
          pnl: pnlExacto,
          precio: sal,
          total: Number(o.total || 0),
          ts: Number(o.ts || 0),
          motivo: o.nota || 'Venta / Cierre',
        };
      })
      .sort((a, b) => b.ts - a.ts);
  }, [ordenesUser, perfil?.historialBorradoTs]);

  const totalCerradoHoy = useMemo(
    () => cerradasHoy.reduce((acc, c) => acc + c.pnl, 0),
    [cerradasHoy]
  );

  return (
    <div className="pos-view-layout">
      {/* Encabezado resumen */}
      <div className="pos-top-actions-bar">
        <button type="button" className="paso-secondary-btn compact" onClick={onGoToMercado}>
          ← Ir a Mercado
        </button>
        {onGoToPortafolio && (
          <button type="button" className="paso-secondary-btn compact" onClick={onGoToPortafolio}>
            Ver Portafolios ML →
          </button>
        )}
      </div>

      <div className="pos-summary-grid">
        <div className="panel kpi-card">
          <span className="kpi-label">Total P&amp;L abierto</span>
          <span
            className={`kpi-value tabular ${
              totalPnlAbierto >= 0 ? 'text-green' : 'text-red'
            }`}
          >
            {formatearPnlConSigno(totalPnlAbierto)}
          </span>
          <span className="kpi-sub">Actualización en vivo · Sin comisiones</span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Posiciones abiertas</span>
          <span className="kpi-value tabular">{posicionesConPnl.length}</span>
          <span className="kpi-sub">Manual + Copia bot + Portafolio</span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Ganado / perdido hoy (cerradas)</span>
          <span
            className={`kpi-value tabular ${
              totalCerradoHoy >= 0 ? 'text-green' : 'text-red'
            }`}
          >
            {formatearPnlConSigno(totalCerradoHoy)}
          </span>
          <span className="kpi-sub">{cerradasHoy.length} cerradas hoy</span>
        </div>
      </div>

      {/* Tarjetas grandes por posición abierta */}
      {posicionesConPnl.length === 0 ? (
        <div className="panel pos-empty-state">
          <h3>No tienes posiciones abiertas</h3>
          <p className="text-sec">
            Abre una operación en Mercado o activa una posición con el Bot de trading para monitorear tu P&amp;L en vivo aquí.
          </p>
          <button type="button" className="btn btn-primary" onClick={onGoToMercado}>
            Ir a Mercado
          </button>
        </div>
      ) : (
        <div className="pos-cards-grid">
          {posicionesConPnl.map((pos) => {
            const esGanancia = pos.pnlUSD >= 0;
            const symCorto = pos.sym.replace('_USDT', '');
            const tsBot = Number(botEstado?.ts || 0);
            const botDesconectado =
              pos.origen === 'bot' &&
              (tsBot <= 0 || Math.round(Date.now() / 1000 - tsBot) > 60);
            return (
              <article key={pos.id} className="panel pos-big-card">
                <div className="pos-card-top">
                  <div>
                    <div className="pos-card-title-row">
                      <h3>
                        {symCorto} <span className="text-sec">{pos.nombre}</span>
                      </h3>
                      <span className={`pos-origin-chip ${pos.origen}`}>{pos.origenLabel}</span>
                      <span
                        className={`pos-side-chip ${
                          pos.side === 'SHORT' ? 'short' : 'long'
                        }`}
                      >
                        {pos.side}
                      </span>
                      <span className="pos-market-chip">{pos.mercado}</span>
                      {botDesconectado && (
                        <span className="status-pill offline" style={{ fontSize: '11px' }}>
                          Bot desconectado
                        </span>
                      )}
                    </div>
                    <span className="text-sec" style={{ fontSize: '12px' }}>
                      {botDesconectado ? 'Última posición conocida · ' : ''}⏱️ {formatearTiempoAbierta(pos.ts)}
                    </span>
                  </div>

                  <div className={`pos-pnl-big tabular ${esGanancia ? 'text-green' : 'text-red'}`}>
                    <div className="pos-pnl-usd">{formatearPnlConSigno(pos.pnlUSD)}</div>
                    <div className="pos-pnl-pct">({formatearPctConSigno(pos.pnlPct)})</div>
                  </div>
                </div>

                <div className="pos-metrics-row tabular">
                  <div>
                    <span className="text-sec">Entrada → Actual</span>
                    <strong>
                      {fmtUSD.format(pos.entrada)} → {fmtUSD.format(pos.actual)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-sec">Cantidad</span>
                    <strong>{pos.cantidad.toFixed(6)}</strong>
                  </div>
                  <div>
                    <span className="text-sec">Monto invertido (margen)</span>
                    <strong>{fmtUSD.format(pos.margen)}</strong>
                  </div>
                </div>

                {(pos.sl || pos.tp || pos.liq) && (
                  <div className="pos-levels-row tabular">
                    {pos.tp && (
                      <span className="text-green">🎯 TP: {fmtUSD.format(pos.tp)}</span>
                    )}
                    {pos.sl && (
                      <span className="text-red">🛡️ SL: {fmtUSD.format(pos.sl)}</span>
                    )}
                    {pos.liq && (
                      <span className="text-amber">💀 Liq: {fmtUSD.format(pos.liq)}</span>
                    )}
                  </div>
                )}

                <div className="pos-card-actions">
                  <button
                    type="button"
                    className={`btn ${esGanancia ? 'btn-primary' : 'btn-danger-solid'}`}
                    disabled={botDesconectado}
                    onClick={() => setPosACerrar(pos)}
                  >
                    {botDesconectado ? 'Bot desconectado' : 'Cerrar esta posición'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Cerradas hoy */}
      <section className="panel">
        <div className="section-header-row">
          <div>
            <h3>Cerradas hoy</h3>
            <p className="text-sec">Historial del día con resultado exacto sin comisiones</p>
          </div>
          <span className={`tabular ${totalCerradoHoy >= 0 ? 'text-green' : 'text-red'}`}>
            <strong>Total hoy: {formatearPnlConSigno(totalCerradoHoy)}</strong>
          </span>
        </div>

        {cerradasHoy.length === 0 ? (
          <p className="text-sec" style={{ marginTop: '8px' }}>
            Aún no has cerrado posiciones con tu dinero el día de hoy.
          </p>
        ) : (
          <div className="table-responsive" style={{ marginTop: '10px' }}>
            <table className="fin-table tabular">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Origen</th>
                  <th>Activo</th>
                  <th>Lado</th>
                  <th className="num">Precio salida</th>
                  <th className="num">P&amp;L</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {cerradasHoy.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.ts
                        ? new Date(c.ts).toLocaleTimeString('es-MX', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td>{c.origenLabel}</td>
                    <td><strong>{String(c.sym || '').replace('_USDT', '')}</strong></td>
                    <td>{c.side}</td>
                    <td className="num">{fmtUSD.format(c.precio)}</td>
                    <td className={`num ${c.pnl >= 0 ? 'text-green' : 'text-red'}`}>
                      <strong>{formatearPnlConSigno(c.pnl)}</strong>
                    </td>
                    <td className="text-sec">{c.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
