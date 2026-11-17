import React from 'react';
import { Settings, LogOut } from 'lucide-react';

export const SECCIONES = [
  { id: 'mercado', label: 'Mercado' },
  { id: 'bot', label: 'Trading (bot)' },
  { id: 'portafolio', label: 'Portafolio' },
  { id: 'juego', label: 'Aprender' },
  { id: 'ml', label: 'Modelo ML' },
  { id: 'ia', label: 'Analista IA' },
];

const SALDO_INICIAL = 10000;

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function abreviarNombre(nombre = '') {
  const limpio = String(nombre || 'Estudiante').trim();
  const partes = limpio.split(/\s+/);
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[1][0]}.`;
}

export default function Navbar({
  seccionActiva,
  onSelectSeccion,
  patrimonio,
  botEstado,
  perfil,
  onAbrirAjustes,
  onSalir,
}) {
  const nombreCorto = abreviarNombre(perfil?.nombre || 'Estudiante');
  const patNum = Number.isFinite(patrimonio) ? patrimonio : SALDO_INICIAL;
  const pnlHoy = patNum - SALDO_INICIAL;
  const pnlPos = pnlHoy >= 0;

  const tsBot = Number(botEstado?.ts || 0);
  const botEnLinea = tsBot > 0 && Math.round(Date.now() / 1000 - tsBot) <= 60;

  return (
    <header className="navbar">
      <div className="navbar-left">
        <div
          className="navbar-brand"
          onClick={() => onSelectSeccion('mercado')}
          style={{ cursor: 'pointer' }}
        >
          <span className="navbar-logo-cube" aria-hidden="true" />
          <span className="navbar-brand-text">BolsaLab</span>
        </div>

        <nav className="navbar-nav" aria-label="Navegación principal">
          {SECCIONES.map((sec) => (
            <button
              key={sec.id}
              type="button"
              className={`nav-tab ${seccionActiva === sec.id ? 'active' : ''}`}
              onClick={() => onSelectSeccion(sec.id)}
            >
              <span>{sec.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="navbar-right">
        <div className="navbar-metrics-group">
          <div
            className={`bot-status-pill ${botEnLinea ? 'online' : 'offline'}`}
            title={botEnLinea ? 'Bot conectado en tiempo real' : 'Bot desconectado (> 60s)'}
          >
            <span className="bot-status-dot" />
            <span>{botEnLinea ? 'Bot en línea' : 'Bot desconectado'}</span>
          </div>

          <div className="navbar-metric">
            <span className="navbar-metric-label">PATRIMONIO</span>
            <span className="navbar-metric-val num">{fmtUSD.format(patNum)}</span>
          </div>

          <div className="navbar-metric">
            <span className="navbar-metric-label">P&amp;L HOY</span>
            <span className={`navbar-metric-val num ${pnlPos ? 'text-green' : 'text-red'}`}>
              {pnlPos ? '+' : '-'}
              {fmtUSD.format(Math.abs(pnlHoy))}
            </span>
          </div>
        </div>

        <div className="navbar-user-group">
          <span className="user-nombre-top" title={perfil?.nombre || 'Estudiante'}>
            {nombreCorto}
          </span>

          {onAbrirAjustes && (
            <button
              type="button"
              className="btn-icon-top"
              onClick={onAbrirAjustes}
              title="Ajustes y comisiones"
              aria-label="Ajustes"
            >
              <Settings size={14} />
            </button>
          )}

          <button
            type="button"
            className="btn-icon-top"
            onClick={onSalir}
            title="Cerrar sesión"
            aria-label="Salir"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
