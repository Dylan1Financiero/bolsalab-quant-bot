import React, { useMemo } from 'react';
import { MAPA_ACTIVOS } from '../data/catalogo';

function fmtTickerPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

export default function TickerTape({ precios = {}, onSelectActivo }) {
  const items = useMemo(() => {
    const lista = Object.values(MAPA_ACTIVOS || {});
    return lista.slice(0, 14).map((a) => {
      const cot = precios?.[a.sym];
      const p = Number(cot?.p || 0);
      const chg = Number(cot?.chg ?? cot?.cambio ?? 0);
      return {
        sym: a.sym,
        corto: a.sym.replace('_USDT', ''),
        precio: p,
        chg: Number.isFinite(chg) ? chg : 0,
      };
    });
  }, [precios]);

  if (items.length === 0) return null;

  const renderGrupo = (prefix) =>
    items.map((it) => {
      const sube = it.chg >= 0;
      return (
        <button
          key={`${prefix}_${it.sym}`}
          type="button"
          className="ticker-item"
          onClick={() => onSelectActivo?.(it.sym)}
          title={`Ver ${it.corto} en Mercado`}
        >
          <span className="ticker-sym">{it.corto}</span>
          <span className="ticker-price num">{fmtTickerPrice(it.precio)}</span>
          <span className={`ticker-chg num ${sube ? 'text-green' : 'text-red'}`}>
            {sube ? '+' : ''}
            {it.chg.toFixed(2)}%
          </span>
        </button>
      );
    });

  return (
    <div className="ticker-tape" aria-label="Cinta de precios en vivo">
      <div className="ticker-track">
        <div className="ticker-group">{renderGrupo('a')}</div>
        <div className="ticker-group" aria-hidden="true">{renderGrupo('b')}</div>
      </div>
    </div>
  );
}
