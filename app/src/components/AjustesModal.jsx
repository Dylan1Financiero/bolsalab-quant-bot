import React, { useState } from 'react';
import { COMISION, fmtUSD } from '../config/tradingConfig';
import { borrarHistorialPrueba, actualizarConfigBotUsuario } from '../services/firebase';

const OPCIONES_TAMANO_COPIA = [
  { id: 'igual_bot', label: 'Igual al bot' },
  { id: '5', label: '5% de mi saldo' },
  { id: '10', label: '10% de mi saldo' },
  { id: '15', label: '15% de mi saldo' },
];

export default function AjustesModal({ uid, perfil, efectivo, onToast, onClose }) {
  const [borrando, setBorrando] = useState(false);
  const [guardandoCopia, setGuardandoCopia] = useState(false);
  const [guardandoAutoCopiar, setGuardandoAutoCopiar] = useState(false);
  const comisionPct = Number((COMISION * 100).toFixed(4));
  const tamanoCopia = String(perfil?.botTamanoCopia || 'igual_bot');
  const autoCopiarActivo = Boolean(perfil?.botAutoUser ?? perfil?.botAutoCopiar);

  const handleToggleAutoCopiar = async () => {
    if (!uid || guardandoAutoCopiar) return;
    const nuevoEstado = !autoCopiarActivo;
    setGuardandoAutoCopiar(true);
    try {
      await actualizarConfigBotUsuario(uid, {
        botAutoUser: nuevoEstado,
        botAutoCopiar: nuevoEstado,
      });
      if (onToast) {
        onToast(
          nuevoEstado
            ? 'Auto-copia activada: tu cuenta espejo replicará al bot.'
            : 'Auto-copia pausada: no se copiarán nuevas entradas del bot.',
          'ok'
        );
      }
    } catch (err) {
      if (onToast) {
        onToast(err?.message || 'No se pudo actualizar la preferencia de auto-copia.', 'error');
      }
    } finally {
      setGuardandoAutoCopiar(false);
    }
  };

  const handleCambiarTamanoCopia = async (nuevoModo) => {
    if (!uid || guardandoCopia || nuevoModo === tamanoCopia) return;
    setGuardandoCopia(true);
    try {
      await actualizarConfigBotUsuario(uid, { botTamanoCopia: nuevoModo });
      if (onToast) {
        const et = OPCIONES_TAMANO_COPIA.find((o) => o.id === nuevoModo)?.label || nuevoModo;
        onToast(`Tamaño de la copia actualizado: ${et}.`, 'ok');
      }
    } catch (err) {
      if (onToast) {
        onToast(err?.message || 'No se pudo guardar el tamaño de la copia.', 'error');
      }
    } finally {
      setGuardandoCopia(false);
    }
  };

  const handleBorrarHistorial = async () => {
    if (!uid || borrando) return;
    setBorrando(true);
    try {
      await borrarHistorialPrueba(uid);
      if (onToast) {
        onToast('Historial de prueba borrado y saldo restaurado a $10,000.00', 'ok');
      }
    } catch (err) {
      if (onToast) {
        onToast(err?.message || 'No se pudo borrar el historial.', 'error');
      }
    } finally {
      setBorrando(false);
    }
  };

  return (
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label="Ajustes de BolsaLab">
      <div className="panel onb-modal" style={{ maxWidth: '520px' }}>
        <div className="onb-top">
          <div>
            <span className="onb-badge">AJUSTES</span>
            <h2 style={{ margin: '6px 0 0 0', fontSize: '20px' }}>Configuración de la cuenta</h2>
          </div>
          <button type="button" className="btn btn-outline btn-xs" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="ajustes-section">
          <h4>Cuenta de simulación</h4>
          <div className="ajustes-row">
            <span className="text-sec">Usuario</span>
            <strong>{perfil?.nombre || perfil?.email || 'Estudiante'}</strong>
          </div>
          <div className="ajustes-row">
            <span className="text-sec">Saldo disponible</span>
            <strong className="tabular">{fmtUSD.format(Number(efectivo ?? perfil?.saldo ?? 0))}</strong>
          </div>
        </div>

        <div className="ajustes-section">
          <h4>Comisiones</h4>
          <p className="ajustes-comision-text">
            Comisión por operación: <strong>{comisionPct}%</strong>{' '}
            {COMISION === 0 ? '(versión preliminar). ' : ''}
            Más adelante se activará 0.05% por lado.
          </p>
        </div>

        <div className="ajustes-section">
          <h4>Cuenta espejo (Auto-copiar bot)</h4>
          <div className="ajustes-switch-row">
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
                Auto-copiar operaciones del bot
              </div>
              <div className="text-sec" style={{ fontSize: '12px', marginTop: '2px' }}>
                {autoCopiarActivo
                  ? 'Activo: replica automáticamente cada entrada y cierre del bot.'
                  : 'Pausado: tu cuenta simulada no copiará operaciones nuevas del bot.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoCopiarActivo}
              aria-label="Auto-copiar operaciones del bot"
              className={`ajustes-switch ${autoCopiarActivo ? 'on' : ''}`}
              disabled={guardandoAutoCopiar}
              onClick={handleToggleAutoCopiar}
            >
              <span className="ajustes-switch-knob" />
            </button>
          </div>
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border, #1E1E24)' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
              Tamaño de la copia
            </div>
            <p className="text-sec" style={{ fontSize: '12.5px', margin: '0 0 10px 0' }}>
              Elige cuánto margen usar cuando la cuenta espejo copia una operación del bot.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {OPCIONES_TAMANO_COPIA.map((op) => {
                const activo = tamanoCopia === op.id;
                return (
                  <button
                    key={op.id}
                    type="button"
                    className={`btn btn-sm ${activo ? 'btn-primary' : 'btn-outline'}`}
                    disabled={guardandoCopia}
                    onClick={() => handleCambiarTamanoCopia(op.id)}
                  >
                    {op.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="ajustes-section">
          <h4>Datos de prueba</h4>
          <p className="text-sec" style={{ fontSize: '12.5px', margin: '0 0 10px 0' }}>
            Restaura tu saldo virtual a $10,000.00 USD, limpia tus posiciones abiertas y borra las operaciones cerradas de prueba.
          </p>
          <button
            type="button"
            className="btn btn-danger-solid"
            disabled={borrando}
            onClick={handleBorrarHistorial}
          >
            {borrando ? 'Borrando...' : 'Borrar historial de prueba'}
          </button>
        </div>

        <div className="onb-footer-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
