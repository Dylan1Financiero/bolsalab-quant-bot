import React, { useState } from 'react';
import {
  ejecutarOperacionUsuario,
  enviarComandoYEsperar,
  cerrarCopiaBotEspejo,
} from '../services/firebase';
import {
  fmtUSD,
  calcularPnlPosicion,
  formatearPctConSigno,
} from '../config/tradingConfig';

export function obtenerPrecioVivoPosicion(posicion, precios, botEstado) {
  if (!posicion) return 0;
  const pVivo = Number(precios?.[posicion.sym]?.p || 0);
  if (pVivo > 0) return pVivo;
  return Number(posicion.entrada || 0);
}

export default function CerrarPosicionModal({
  posicion,
  precios,
  botEstado,
  uid,
  perfil,
  onClose,
  onCerrada,
  onToast,
}) {
  const [cerrando, setCerrando] = useState(false);

  if (!posicion) return null;

  const precioActual = obtenerPrecioVivoPosicion(posicion, precios, botEstado);
  const { pnlUSD, pnlPct } = calcularPnlPosicion({
    side: posicion.side,
    entrada: posicion.entrada,
    actual: precioActual,
    cantidad: posicion.cantidad,
    margen: posicion.margen,
  });

  const esGanancia = pnlUSD >= 0;
  const montoAbs = fmtUSD.format(Math.abs(pnlUSD));
  const pctTexto = formatearPctConSigno(pnlPct);
  const symCorto = String(posicion.sym || '').replace('_USDT', '');

  const handleConfirmar = async () => {
    if (cerrando) return;
    setCerrando(true);
    try {
      if (posicion.origen === 'bot') {
        const res = await enviarComandoYEsperar(uid, 'cerrar', null, 20000);
        if (!res?.ok) {
          throw new Error(res?.resultado || 'El bot no respondió. Revisa que esté corriendo');
        }
        const texto = res?.resultado || 'Posición del bot cerrada.';
        if (onToast) onToast(texto, 'ok');
        if (onCerrada) onCerrada(texto, { ...posicion, pnlUSD, precioSalida: precioActual });
      } else if (posicion.origen === 'copia' || (posicion.origen === 'manual' && posicion.leverage > 1)) {
        const res = await cerrarCopiaBotEspejo(
          uid,
          posicion.sym,
          precioActual,
          posicion.origen === 'manual'
            ? `Cierre manual ${posicion.side} x${posicion.leverage} ${symCorto}`
            : `Cierre manual copia bot ${posicion.side} ${symCorto}`,
          posicion.origen
        );
        const pnlReal = Number(res?.pnl ?? pnlUSD);
        const msg =
          pnlReal >= 0
            ? `Posición cerrada: ganaste ${fmtUSD.format(Math.abs(pnlReal))}`
            : `Posición cerrada: perdiste ${fmtUSD.format(Math.abs(pnlReal))}`;
        if (onToast) onToast(msg, pnlReal >= 0 ? 'ok' : 'info');
        if (onCerrada) onCerrada(msg, { ...posicion, pnlUSD: pnlReal, precioSalida: precioActual });
      } else {
        const res = await ejecutarOperacionUsuario(uid, perfil, {
          tipo: 'venta',
          sym: posicion.sym,
          precio: precioActual,
          fraccionVenta: 1,
          origen: posicion.origen || 'manual',
          nota: `Cierre de posición ${posicion.side} ${symCorto}`,
        });
        const pnlReal = Number(res?.pnl ?? pnlUSD);
        const msg =
          pnlReal >= 0
            ? `Posición cerrada: ganaste ${fmtUSD.format(Math.abs(pnlReal))}`
            : `Posición cerrada: perdiste ${fmtUSD.format(Math.abs(pnlReal))}`;
        if (onToast) onToast(msg, pnlReal >= 0 ? 'ok' : 'info');
        if (onCerrada) onCerrada(msg, { ...posicion, pnlUSD: pnlReal, precioSalida: precioActual });
      }
      if (onClose) onClose();
    } catch (err) {
      if (onToast) {
        onToast(err?.message || 'No se pudo cerrar la posición.', 'error');
      }
    } finally {
      setCerrando(false);
    }
  };

  return (
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label="Confirmar cierre de posición">
      <div className="panel onb-modal close-pos-modal" style={{ maxWidth: '480px' }}>
        <div className="onb-top">
          <div>
            <span className="onb-badge">CONFIRMAR CIERRE</span>
            <h3 style={{ margin: '6px 0 0 0', fontSize: '18px' }}>
              {posicion.side} {symCorto} {posicion.leverage > 1 ? `x${posicion.leverage}` : 'Spot'}
            </h3>
          </div>
          <span className={`pos-origin-chip ${posicion.origen}`}>{posicion.origenLabel}</span>
        </div>

        <div className={`close-pos-preview ${esGanancia ? 'gain' : 'loss'}`}>
          <p className="close-pos-sentence">
            Si cierras esta posición ahora vas a tener una{' '}
            <strong>
              {esGanancia ? 'ganancia' : 'pérdida'} de {montoAbs} ({pctTexto})
            </strong>
          </p>
        </div>

        {posicion.origen === 'bot' && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              color: '#fbbf24',
              fontSize: '12.5px',
            }}
          >
            Esta posición es de la cuenta simulada del bot, no de tu saldo.
          </div>
        )}

        <div className="close-pos-details tabular">
          <div>
            <span className="text-sec">Precio entrada</span>
            <strong>{fmtUSD.format(Number(posicion.entrada || 0))}</strong>
          </div>
          <div>
            <span className="text-sec">Precio actual (en vivo)</span>
            <strong>{fmtUSD.format(precioActual)}</strong>
          </div>
          <div>
            <span className="text-sec">Cantidad</span>
            <strong>{Number(posicion.cantidad || 0).toFixed(6)}</strong>
          </div>
          <div>
            <span className="text-sec">Monto invertido / margen</span>
            <strong>{fmtUSD.format(Number(posicion.margen || 0))}</strong>
          </div>
        </div>

        <p className="text-sec" style={{ fontSize: '12px', margin: '8px 0 0 0' }}>
          Simulación sin comisiones (0% por operación). El monto se recalcula en vivo mientras esta ventana está abierta.
        </p>

        <div className="onb-footer-actions" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-outline"
            disabled={cerrando}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={`btn ${esGanancia ? 'btn-primary' : 'btn-danger-solid'}`}
            disabled={cerrando}
            onClick={handleConfirmar}
          >
            {cerrando ? 'Cerrando...' : 'Cerrar posición'}
          </button>
        </div>
      </div>
    </div>
  );
}
