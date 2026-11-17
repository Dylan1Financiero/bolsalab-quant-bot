import React, { useState } from 'react';
import {
  iniciarConCorreo,
  registrarConCorreo,
  iniciarConGoogle,
  traducirErrorFirebase,
} from '../services/firebase';

export default function AuthScreen({ onToast }) {
  const [modo, setModo] = useState('login'); // 'login' | 'registro'
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const cambiarModo = (nuevoModo) => {
    setModo(nuevoModo);
    setErrorMsg('');
  };

  const manejarSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (modo === 'registro' && !nombre.trim()) {
      setErrorMsg('Por favor ingresa tu nombre completo o alias.');
      return;
    }
    if (!email.trim()) {
      setErrorMsg('Por favor ingresa tu correo electrónico.');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMsg('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setCargando(true);
    try {
      if (modo === 'registro') {
        await registrarConCorreo(nombre, email, password);
        if (onToast) onToast('Cuenta creada con $100,000 USD virtuales.', 'success');
      } else {
        await iniciarConCorreo(email, password);
        if (onToast) onToast('Sesión iniciada correctamente.', 'success');
      }
    } catch (err) {
      const traducido = traducirErrorFirebase(err);
      setErrorMsg(traducido);
    } finally {
      setCargando(false);
    }
  };

  const manejarGoogle = async () => {
    setErrorMsg('');
    setCargando(true);
    try {
      await iniciarConGoogle();
      if (onToast) onToast('Sesión iniciada con Google.', 'success');
    } catch (err) {
      const traducido = traducirErrorFirebase(err);
      setErrorMsg(traducido);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-brand">
            <span className="navbar-logo-badge">B</span>
            <span>BolsaLab</span>
          </div>
          <p className="auth-subtitle">
            Simulador de casa de bolsa · Chartismo · Bot Quant en vivo
          </p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            className={`auth-tab ${modo === 'login' ? 'active' : ''}`}
            onClick={() => cambiarModo('login')}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            className={`auth-tab ${modo === 'registro' ? 'active' : ''}`}
            onClick={() => cambiarModo('registro')}
          >
            Crear cuenta
          </button>
        </div>

        {errorMsg && (
          <div className="auth-error" role="alert">
            {errorMsg}
          </div>
        )}

        <form onSubmit={manejarSubmit}>
          {modo === 'registro' && (
            <div className="form-group">
              <label className="form-label" htmlFor="auth-nombre">
                Nombre
              </label>
              <input
                id="auth-nombre"
                type="text"
                className="form-input"
                placeholder="Tu nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                disabled={cargando}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="auth-email">
              Correo electrónico
            </label>
            <input
              id="auth-email"
              type="email"
              className="form-input"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={cargando}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="auth-password">
              Contraseña (mínimo 6 caracteres)
            </label>
            <input
              id="auth-password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={cargando}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '4px' }}
            disabled={cargando}
          >
            {cargando
              ? 'Procesando...'
              : modo === 'registro'
              ? 'Crear cuenta ($100,000 virtuales)'
              : 'Iniciar sesión'}
          </button>
        </form>

        <div className="auth-divider">o</div>

        <button
          type="button"
          className="btn btn-google"
          onClick={manejarGoogle}
          disabled={cargando}
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
          Continuar con Google
        </button>
      </div>
    </div>
  );
}
