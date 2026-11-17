import React, { useState } from 'react';
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Layers,
  Pencil,
  PlusCircle,
  RefreshCw,
} from 'lucide-react';
import { actualizarContextoPortafolioUsuario } from '../services/firebase';

function fmtNum(val, dec = 2) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtSignedPct(val, dec = 2) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00%';
  return `${n > 0 ? '+' : ''}${fmtNum(n, dec)}%`;
}

function fmtFechaCorta(tsMs) {
  if (!tsMs) return 'Reciente';
  try {
    return new Date(tsMs).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Reciente';
  }
}

export default function MisPortafoliosInvertidos({
  uid,
  panelRef = null,
  seguimiento,
  expandido,
  onToggleExpandido,
  justoInvirtioId = null,
  rebalanceandoId = null,
  onRebalancear,
  onPrepararNuevoPortafolio,
  onSelectSeccion,
  onToast,
}) {
  const [editandoCtxId, setEditandoCtxId] = useState(null);
  const [draftCtx, setDraftCtx] = useState('');
  const [guardandoCtx, setGuardandoCtx] = useState(false);

  const portafolios = seguimiento?.portafolios || [];
  const combinado = seguimiento?.combinado || null;

  if (portafolios.length === 0 || !combinado) return null;

  const siguienteNumero =
    portafolios.reduce((mx, p) => Math.max(mx, Number(p.numero || 0)), 0) + 1;

  const iniciarEdicionCtx = (p) => {
    setEditandoCtxId(p.id);
    setDraftCtx(p.contexto || '');
  };

  const guardarCtx = async (p) => {
    if (!uid || guardandoCtx) return;
    setGuardandoCtx(true);
    try {
      await actualizarContextoPortafolioUsuario(uid, p.id, draftCtx);
      setEditandoCtxId(null);
      onToast?.(`Contexto actualizado para ${p.alias}.`, 'success');
    } catch (err) {
      onToast?.(err?.message || 'No se pudo guardar el contexto.', 'error');
    } finally {
      setGuardandoCtx(false);
    }
  };

  const pnlComPos = combinado.totalPnlCombinadoUSD >= 0;

  return (
    <section
      ref={panelRef}
      id="mis-portafolios-invertidos"
      className="portafolio-panel-card mis-portafolios-shell"
    >
      {/* Barra superior siempre visible con resumen + accesos rápidos */}
      <div className="mis-portafolios-header">
        <div className="mis-portafolios-head-left">
          <span className="mis-pf-badge">
            <Briefcase size={13} />
            <span>
              Mis portafolios invertidos ({portafolios.length})
            </span>
          </span>
          <div className="mis-pf-kpis">
            <span className="mis-pf-kpi">
              Invertido:{' '}
              <strong className="num">
                ${fmtNum(combinado.totalCapitalCombinado, 2)}
              </strong>
            </span>
            <span className="mis-pf-kpi">
              Valor vivo:{' '}
              <strong className="num">
                ${fmtNum(combinado.totalValorActualCombinado, 2)}
              </strong>{' '}
              <span className={`num ${pnlComPos ? 'text-green' : 'text-red'}`}>
                ({fmtSignedPct(combinado.totalPnlCombinadoPct, 2)})
              </span>
            </span>
            <span className="mis-pf-kpi text-sec">
              {combinado.activosCombinados.length} activos Spot
            </span>
          </div>
        </div>

        <div className="mis-portafolios-head-actions">
          {onSelectSeccion && (
            <>
              <button
                type="button"
                className="paso-secondary-btn compact"
                onClick={() => onSelectSeccion('posiciones')}
              >
                <ExternalLink size={13} />
                <span>Ver Mis posiciones</span>
              </button>
              <button
                type="button"
                className="paso-secondary-btn compact"
                onClick={() => onSelectSeccion('mercado')}
              >
                <span>Ver en Mercado</span>
              </button>
            </>
          )}
          <button
            type="button"
            className="mercado-ia-btn primary"
            onClick={onPrepararNuevoPortafolio}
          >
            <PlusCircle size={13} />
            <span>Nuevo (Portafolio {siguienteNumero})</span>
          </button>
          <button
            type="button"
            className="paso-detail-btn"
            onClick={onToggleExpandido}
            aria-expanded={expandido}
          >
            {expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{expandido ? 'Ocultar' : 'Ver posiciones y pesos'}</span>
          </button>
        </div>
      </div>

      {expandido && (
        <div className="mis-portafolios-body paso-enter">
          {/* Tarjetas individuales por cada Portafolio guardado (Portafolio 1, Portafolio 2, ...) */}
          <div
            className={`mis-pf-cards-grid ${
              portafolios.length === 1 ? 'single' : 'multi'
            }`}
          >
            {portafolios.map((p) => {
              const pnlPos = p.pnlUSD >= 0;
              const editandoEste = editandoCtxId === p.id;
              const rebalEste = rebalanceandoId === p.id;
              return (
                <article
                  key={p.id}
                  className={`mis-pf-card ${
                    justoInvirtioId === p.id ? 'just-invested-flash' : ''
                  }`}
                >
                  <div className="mis-pf-card-head">
                    <div className="mis-pf-card-title-group">
                      <span className="mis-pf-num-pill num">{p.alias}</span>
                      <strong className="mis-pf-strategy-name">
                        {p.nombreCartera}
                      </strong>
                      <span className="mis-pf-meta-chip">
                        Perfil {String(p.perfil || 'conservador')} ·{' '}
                        {fmtFechaCorta(p.tsCompra)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="paso-secondary-btn compact"
                      disabled={Boolean(rebalanceandoId)}
                      onClick={() => onRebalancear?.(p)}
                      title="Ajustar posiciones para volver a los pesos objetivo de este portafolio"
                    >
                      <RefreshCw size={12} />
                      <span>
                        {rebalEste ? 'Rebalanceando...' : 'Rebalancear'}
                      </span>
                    </button>
                  </div>

                  {/* Contexto del portafolio (editable en línea) */}
                  <div className="mis-pf-context-box">
                    {!editandoEste ? (
                      <div className="mis-pf-context-view">
                        <p className="mis-pf-context-text">
                          <span className="mis-pf-context-label">Contexto:</span>{' '}
                          {p.contexto ? (
                            <span>{p.contexto}</span>
                          ) : (
                            <span className="text-sec">
                              Sin nota aún (agrega por qué invertiste este {p.alias.toLowerCase()}).
                            </span>
                          )}
                        </p>
                        <button
                          type="button"
                          className="mis-pf-edit-ctx-btn"
                          onClick={() => iniciarEdicionCtx(p)}
                          title="Editar nota de contexto"
                        >
                          <Pencil size={12} />
                          <span>Editar</span>
                        </button>
                      </div>
                    ) : (
                      <div className="mis-pf-context-edit">
                        <input
                          type="text"
                          className="mis-pf-context-input"
                          value={draftCtx}
                          onChange={(e) => setDraftCtx(e.target.value)}
                          placeholder={`Nota o estrategia de ${p.alias}...`}
                          maxLength={220}
                        />
                        <div className="mis-pf-context-edit-btns">
                          <button
                            type="button"
                            className="mercado-ia-btn primary"
                            disabled={guardandoCtx}
                            onClick={() => guardarCtx(p)}
                          >
                            {guardandoCtx ? 'Guardando...' : 'Guardar'}
                          </button>
                          <button
                            type="button"
                            className="dense-close-btn"
                            disabled={guardandoCtx}
                            onClick={() => setEditandoCtxId(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* KPIs del portafolio */}
                  <div className="mis-pf-stats-strip">
                    <div>
                      <span className="text-sec">Invertido</span>
                      <strong className="num">${fmtNum(p.capitalBase, 2)}</strong>
                    </div>
                    <div>
                      <span className="text-sec">Valor vivo</span>
                      <strong className="num">${fmtNum(p.valorActual, 2)}</strong>
                    </div>
                    <div>
                      <span className="text-sec">P&amp;L</span>
                      <strong className={`num ${pnlPos ? 'text-green' : 'text-red'}`}>
                        {p.pnlUSD >= 0 ? '+' : '-'}${fmtNum(Math.abs(p.pnlUSD), 2)} (
                        {fmtSignedPct(p.pnlPct, 2)})
                      </strong>
                    </div>
                    <div>
                      <span className="text-sec">Posiciones</span>
                      <strong className="num">
                        {p.activosAbiertos}/{p.activosTotal} abiertas
                      </strong>
                    </div>
                  </div>

                  {/* Tabla de posiciones individuales de este portafolio */}
                  <div className="ml-dense-table-wrap">
                    <table className="terminal-dense-table">
                      <thead>
                        <tr>
                          <th>ACTIVO</th>
                          <th className="num">PESO OBJ.</th>
                          <th className="num">PESO VIVO</th>
                          <th className="num">CANTIDAD</th>
                          <th className="num">INVERTIDO</th>
                          <th className="num">VALOR VIVO</th>
                          <th className="num">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.filas.map((f) => {
                          const fPos = f.pnlUSD >= 0;
                          return (
                            <tr key={`${p.id}_${f.sym}`}>
                              <td>
                                <strong>{f.symCorto}</strong>{' '}
                                <span className="text-sec">{f.nombre}</span>
                                {f.cerradaManual && (
                                  <span className="mis-pf-closed-chip">Cerrada</span>
                                )}
                              </td>
                              <td className="num">{fmtNum(f.pesoObjetivoPct, 1)}%</td>
                              <td className="num">{fmtNum(f.pesoActualPct, 1)}%</td>
                              <td className="num">{fmtNum(f.cantActiva, 4)}</td>
                              <td className="num">${fmtNum(f.montoUSD, 2)}</td>
                              <td className="num">${fmtNum(f.valorActual, 2)}</td>
                              <td
                                className={`num ${
                                  f.cerradaManual
                                    ? 'text-sec'
                                    : fPos
                                      ? 'text-green'
                                      : 'text-red'
                                }`}
                              >
                                {f.cerradaManual
                                  ? 'Cerrada'
                                  : `${f.pnlUSD >= 0 ? '+' : '-'}$${fmtNum(
                                      Math.abs(f.pnlUSD),
                                      2
                                    )} (${fmtSignedPct(f.pnlPct, 2)})`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="mis-pf-total-row">
                          <td>
                            <strong>TOTAL {p.alias.toUpperCase()}</strong>
                          </td>
                          <td className="num">
                            <strong>{fmtNum(p.sumaPesosObjetivoPct, 1)}%</strong>
                          </td>
                          <td className="num">
                            <strong>{p.valorActual > 0 ? '100.0%' : '0.0%'}</strong>
                          </td>
                          <td className="num text-sec">—</td>
                          <td className="num">
                            <strong>${fmtNum(p.capitalBase, 2)}</strong>
                          </td>
                          <td className="num">
                            <strong>${fmtNum(p.valorActual, 2)}</strong>
                          </td>
                          <td className={`num ${pnlPos ? 'text-green' : 'text-red'}`}>
                            <strong>
                              {p.pnlUSD >= 0 ? '+' : '-'}$
                              {fmtNum(Math.abs(p.pnlUSD), 2)} (
                              {fmtSignedPct(p.pnlPct, 2)})
                            </strong>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Guía rápida si solo hay 1 portafolio, o Tabla combinada completa si hay 2 o más */}
          {portafolios.length === 1 ? (
            <div className="mis-pf-combo-hint">
              <div className="mis-pf-combo-hint-text">
                <Layers size={15} className="text-accent-soft" />
                <span>
                  Tu cartera se guardó como <strong>Portafolio 1</strong> y sus{' '}
                  <strong className="num">{portafolios[0].activosAbiertos}</strong> posiciones Spot
                  ya están activas en <strong>Mercado</strong> y <strong>Mis posiciones</strong>.
                  Cuando inviertas un <strong>Portafolio 2</strong> más adelante, aquí verás la{' '}
                  <strong>suma total combinada de los pesos</strong> de ambos portafolios.
                </span>
              </div>
              <button
                type="button"
                className="paso-secondary-btn compact"
                onClick={onPrepararNuevoPortafolio}
              >
                <PlusCircle size={13} />
                <span>Preparar Portafolio 2</span>
              </button>
            </div>
          ) : (
            <div className="mis-pf-combinado-card">
              <div className="p-panel-head" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>
                    Suma total de pesos combinados (
                    {portafolios.map((p) => p.alias).join(' + ')})
                  </strong>
                  <span className="p-panel-sub">
                    {' '}
                    · Ponderado por capital invertido en todos tus portafolios
                  </span>
                </div>
                <span className="mis-pf-total-badge num">
                  Suma de pesos: {fmtNum(combinado.sumaPesosCombinadosPct, 1)}%
                </span>
              </div>

              {/* Barra apilada horizontal con los pesos combinados sumando 100% */}
              <div className="mis-pf-stacked-wrap">
                <div
                  className="mis-pf-stacked-bar"
                  role="img"
                  aria-label="Distribución combinada de pesos de todos los portafolios"
                >
                  {combinado.activosCombinados.map((a) => (
                    <div
                      key={`stack_${a.sym}`}
                      className="mis-pf-stacked-seg"
                      style={{
                        width: `${Math.max(0.5, a.pesoCombinadoPct).toFixed(2)}%`,
                        backgroundColor: a.color,
                      }}
                      title={`${a.symCorto}: ${fmtNum(a.pesoCombinadoPct, 1)}% ($${fmtNum(
                        a.montoTotalUSD,
                        2
                      )})`}
                    />
                  ))}
                </div>
                <div className="mis-pf-stacked-legend">
                  {combinado.activosCombinados.map((a) => (
                    <span key={`leg_${a.sym}`} className="mis-pf-legend-chip">
                      <span
                        className="dona-color-dot"
                        style={{ backgroundColor: a.color }}
                      />
                      <strong>{a.symCorto}</strong>{' '}
                      <span className="num">{fmtNum(a.pesoCombinadoPct, 1)}%</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Tabla detallada combinada */}
              <div className="ml-dense-table-wrap">
                <table className="terminal-dense-table">
                  <thead>
                    <tr>
                      <th>ACTIVO</th>
                      <th>APORTE POR PORTAFOLIO</th>
                      <th className="num">INVERTIDO TOTAL</th>
                      <th className="num">VALOR VIVO TOTAL</th>
                      <th className="num">PESO COMBINADO (OBJ.)</th>
                      <th className="num">PESO EN VIVO</th>
                      <th className="num">P&amp;L COMBINADO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinado.activosCombinados.map((a) => {
                      const aPos = a.pnlUSD >= 0;
                      return (
                        <tr key={`comb_${a.sym}`}>
                          <td>
                            <span
                              className="dona-color-dot"
                              style={{ backgroundColor: a.color, marginRight: '6px' }}
                            />
                            <strong>{a.symCorto}</strong>{' '}
                            <span className="text-sec">{a.nombre}</span>
                            {a.cerradaManual && (
                              <span className="mis-pf-closed-chip">Cerrada</span>
                            )}
                          </td>
                          <td>
                            <div className="mis-pf-contrib-chips">
                              {a.desglosePortafolios.map((d) => (
                                <span
                                  key={`${a.sym}_${d.id}`}
                                  className="mis-pf-contrib-chip num"
                                  title={`${d.alias}: ${fmtNum(
                                    d.pesoEnPortafolioPct,
                                    1
                                  )}% de su cartera · Aporta ${fmtNum(
                                    d.aportePesoGlobalPct,
                                    1
                                  )}% al total combinado`}
                                >
                                  <strong>P{d.numero}:</strong>{' '}
                                  {fmtNum(d.pesoEnPortafolioPct, 1)}% ($
                                  {fmtNum(d.montoUSD, 0)})
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="num">${fmtNum(a.montoTotalUSD, 2)}</td>
                          <td className="num">${fmtNum(a.valorActualTotal, 2)}</td>
                          <td className="num">
                            <div className="peso-table-cell">
                              <strong>{fmtNum(a.pesoCombinadoPct, 1)}%</strong>
                              <span className="peso-bar-track mini" aria-hidden="true">
                                <span
                                  className="peso-bar-fill"
                                  style={{
                                    width: `${Math.min(100, a.pesoCombinadoPct).toFixed(1)}%`,
                                    backgroundColor: a.color,
                                  }}
                                />
                              </span>
                            </div>
                          </td>
                          <td className="num">{fmtNum(a.pesoActualCombinadoPct, 1)}%</td>
                          <td
                            className={`num ${
                              a.cerradaManual
                                ? 'text-sec'
                                : aPos
                                  ? 'text-green'
                                  : 'text-red'
                            }`}
                          >
                            {a.cerradaManual
                              ? 'Cerrada'
                              : `${a.pnlUSD >= 0 ? '+' : '-'}$${fmtNum(
                                  Math.abs(a.pnlUSD),
                                  2
                                )} (${fmtSignedPct(a.pnlPct, 2)})`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="mis-pf-total-row">
                      <td>
                        <strong>
                          SUMA TOTAL ({combinado.activosCombinados.length} activos)
                        </strong>
                      </td>
                      <td className="text-sec">
                        {portafolios.map((p) => p.alias).join(' + ')}
                      </td>
                      <td className="num">
                        <strong>${fmtNum(combinado.totalCapitalCombinado, 2)}</strong>
                      </td>
                      <td className="num">
                        <strong>
                          ${fmtNum(combinado.totalValorActualCombinado, 2)}
                        </strong>
                      </td>
                      <td className="num">
                        <strong>{fmtNum(combinado.sumaPesosCombinadosPct, 1)}%</strong>
                      </td>
                      <td className="num">
                        <strong>{fmtNum(combinado.sumaPesosActualesPct, 1)}%</strong>
                      </td>
                      <td className={`num ${pnlComPos ? 'text-green' : 'text-red'}`}>
                        <strong>
                          {combinado.totalPnlCombinadoUSD >= 0 ? '+' : '-'}$
                          {fmtNum(Math.abs(combinado.totalPnlCombinadoUSD), 2)} (
                          {fmtSignedPct(combinado.totalPnlCombinadoPct, 2)})
                        </strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
