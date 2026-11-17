import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  setDoc,
  updateDoc,
  addDoc,
  runTransaction,
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';
import { COMISION } from '../config/tradingConfig';

// Inicialización de Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  ignoreUndefinedProperties: true,
});
const googleProvider = new GoogleAuthProvider();

export const SALDO_INICIAL = 10000;

/**
 * Traduce códigos de error de Firebase Auth al español (Sección 5.1)
 */
export function traducirErrorFirebase(error) {
  const code = error?.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'El formato del correo electrónico no es válido.';
    case 'auth/user-disabled':
      return 'Esta cuenta de usuario ha sido deshabilitada.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Correo o contraseña incorrectos. Verifica tus datos.';
    case 'auth/email-already-in-use':
      return 'Este correo electrónico ya está registrado. Intenta iniciar sesión.';
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos 6 caracteres.';
    case 'auth/popup-closed-by-user':
      return 'Se cerró la ventana de acceso con Google antes de completar el inicio de sesión.';
    case 'auth/cancelled-popup-request':
      return 'Solicitud de ventana emergente cancelada.';
    case 'auth/popup-blocked':
      return 'El navegador bloqueó la ventana emergente de Google. Permite ventanas emergentes para este sitio.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.';
    case 'auth/network-request-failed':
      return 'Error de red. Verifica tu conexión a internet.';
    default:
      return error?.message || 'Ocurrió un error inesperado al autenticar.';
  }
}

/**
 * Asegura que el documento `usuarios/{uid}` exista siguiendo el contrato de la Sección 3:
 * {nombre, email, saldo, plan: "free"|"pro", posiciones: {SYM: {cant, costo}}, xp, aciertos, intentos, racha, rachaMax, creado}
 */
export async function asegurarPerfilUsuario(user, nombreOpcional = '') {
  if (!user?.uid) return null;
  const userRef = doc(db, 'usuarios', user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    const nombreFinal =
      (nombreOpcional && nombreOpcional.trim()) ||
      user.displayName ||
      (user.email ? user.email.split('@')[0] : 'Estudiante');

    const perfilInicial = {
      nombre: nombreFinal,
      email: user.email || '',
      saldo: SALDO_INICIAL,
      migrado10k: true,
      pnlRealizadoTotal: 0,
      botAutoUser: false,
      botPctSaldo: 15,
      plan: 'free',
      posiciones: {},
      xp: 0,
      aciertos: 0,
      intentos: 0,
      racha: 0,
      rachaMax: 0,
      creado: Date.now(),
    };

    await setDoc(userRef, perfilInicial);

    // Publicar entrada inicial en ranking/{uid}
    const rankingRef = doc(db, 'ranking', user.uid);
    await setDoc(
      rankingRef,
      {
        nombre: nombreFinal,
        xp: 0,
        rend: 0,
      },
      { merge: true }
    );

    return perfilInicial;
  }

  const dataActual = snap.data();
  // Si la cuenta tenía el saldo antiguo de 100,000 USD, migrarla automáticamente a la base de $10,000 USD
  if (!dataActual.migrado10k && Number(dataActual.saldo) >= 50000) {
    const nuevoSaldo10k = Math.max(
      0,
      Number((Number(dataActual.saldo) - 90000).toFixed(2))
    );
    await updateDoc(userRef, {
      saldo: nuevoSaldo10k,
      migrado10k: true,
    });
    return { ...dataActual, saldo: nuevoSaldo10k, migrado10k: true };
  }

  return dataActual;
}

export function observarAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function registrarConCorreo(nombre, email, password) {
  const nombreLimpio = (nombre || '').trim();
  if (!nombreLimpio) {
    throw new Error('Por favor ingresa tu nombre.');
  }
  if (!password || password.length < 6) {
    const err = new Error('La contraseña debe tener al menos 6 caracteres.');
    err.code = 'auth/weak-password';
    throw err;
  }

  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  try {
    await updateProfile(cred.user, { displayName: nombreLimpio });
  } catch (_) {
    // Ignorar fallo cosmético de displayName
  }
  await asegurarPerfilUsuario(cred.user, nombreLimpio);
  return cred.user;
}

export async function iniciarConCorreo(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  await asegurarPerfilUsuario(cred.user);
  return cred.user;
}

export async function iniciarConGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await asegurarPerfilUsuario(cred.user);
  return cred.user;
}

export async function cerrarSesion() {
  await signOut(auth);
}

// ============================================================================
// CONTRATO DE DATOS FIRESTORE (SECCIÓN 3)
// ============================================================================

export function limpiarNombreUsuario(nombre) {
  if (!nombre || typeof nombre !== 'string') return 'Estudiante';
  return nombre
    .replace(/L\uFFFDzaro/gi, 'Lázaro')
    .replace(/Hern\uFFFDndez/gi, 'Hernández')
    .replace(/Mart\uFFFDnez/gi, 'Martínez')
    .replace(/G\uFFFDmez/gi, 'Gómez')
    .replace(/L\uFFFDpez/gi, 'López')
    .replace(/Garc\uFFFDa/gi, 'García')
    .replace(/Rodr\uFFFDguez/gi, 'Rodríguez')
    .replace(/S\uFFFDnchez/gi, 'Sánchez')
    .replace(/Ram\uFFFDrez/gi, 'Ramírez')
    .replace(/P\uFFFDrez/gi, 'Pérez')
    .replace(/Sof\uFFFDa/gi, 'Sofía')
    .replace(/\uFFFD/g, 'á');
}

export function escucharUsuario(uid, callback, onError) {
  if (!uid) return () => {};
  const userRef = doc(db, 'usuarios', uid);
  return onSnapshot(
    userRef,
    (snap) => {
      if (snap.exists()) {
        const raw = snap.data();
        callback({
          id: snap.id,
          ...raw,
          nombre: limpiarNombreUsuario(raw.nombre),
        });
      } else {
        callback(null);
      }
    },
    (err) => {
      console.error('Error escuchando usuarios/{uid}:', err);
      if (onError) onError(err);
    }
  );
}

export function escucharOrdenesUsuario(uid, callback, maxOrdenes = 30) {
  if (!uid) return () => {};
  const ordenesRef = collection(db, 'usuarios', uid, 'ordenes');
  const q = query(ordenesRef, orderBy('ts', 'desc'), limit(maxOrdenes));
  return onSnapshot(
    q,
    (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(lista);
    },
    (err) => {
      console.error('Error escuchando ordenes:', err);
    }
  );
}

export async function guardarOrdenYPortafolio(
  uid,
  { nuevoSaldo, nuevasPosiciones, orden, nuevoPnlRealizadoTotal }
) {
  const userRef = doc(db, 'usuarios', uid);
  const payloadUser = {
    saldo: nuevoSaldo,
    posiciones: nuevasPosiciones,
    migrado10k: true,
  };
  if (typeof nuevoPnlRealizadoTotal === 'number' && Number.isFinite(nuevoPnlRealizadoTotal)) {
    payloadUser.pnlRealizadoTotal = Number(nuevoPnlRealizadoTotal.toFixed(4));
  }
  await updateDoc(userRef, payloadUser);

  const ordenesRef = collection(db, 'usuarios', uid, 'ordenes');
  const docOrden = {
    ts: Date.now(),
    tipo: orden.tipo,
    sym: orden.sym,
    cant: Number(orden.cant),
    precio: Number(orden.precio),
    total: Number(orden.total),
    comision: Number(orden.comision),
    pnl: Number(orden.pnl || 0),
    origen: orden.origen || 'manual',
    nota: orden.nota || '',
  };
  if (orden.portafolioId) {
    docOrden.portafolio_id = orden.portafolioId;
  }
  await addDoc(ordenesRef, docOrden);
  return docOrden;
}

export async function reiniciarPortafolio10k(uid) {
  if (!uid) return;
  const userRef = doc(db, 'usuarios', uid);
  await updateDoc(userRef, {
    saldo: SALDO_INICIAL,
    posiciones: {},
    pnlRealizadoTotal: 0,
    portafoliosInvertidos: [],
    portafolioLargoPlazo: null,
    migrado10k: true,
  });
}

export async function actualizarConfigBotUsuario(uid, config) {
  if (!uid) return;
  const userRef = doc(db, 'usuarios', uid);
  await updateDoc(userRef, config);
}

/**
 * Ejecuta una compra o venta directamente sobre el saldo digital propio del usuario ($10,000 USD base).
 * Puede ser invocada manualmente en Mercado, al seguir una señal del Bot, o por el Auto-Trading Pro del usuario.
 */
export async function ejecutarOperacionUsuario(
  uid,
  perfil,
  {
    tipo = 'compra',
    sym,
    precio,
    montoUSD = 0,
    fraccionVenta = null,
    origen = 'manual',
    nota = '',
    tp = null,
    sl = null,
    portafolioId = null,
  }
) {
  if (!uid || !perfil) throw new Error('Sesión no disponible.');
  const precioNum = Number(precio);
  if (!Number.isFinite(precioNum) || precioNum <= 0) {
    throw new Error(`El activo ${sym} no tiene precio disponible en este momento.`);
  }

  const efectivo = Number(perfil.saldo ?? SALDO_INICIAL);
  const posicionesActuales = { ...(perfil.posiciones || {}) };
  const pnlAcumPrevio = Number(perfil.pnlRealizadoTotal || 0);

  if (tipo === 'compra') {
    const maxInvertible = efectivo / (1 + COMISION);
    const montoEfectivo = Math.min(Number(montoUSD || 0), maxInvertible);
    if (montoEfectivo <= 0.5) {
      throw new Error(
        `Saldo disponible insuficiente ($${efectivo.toFixed(2)} USD) para ejecutar la compra.`
      );
    }
    const comision = montoEfectivo * COMISION;
    const costoTotal = montoEfectivo + comision;
    const cantCompra = montoEfectivo / precioNum;

    const posPrevia = posicionesActuales[sym];
    const cantPrevia = Number(posPrevia?.cant || 0);
    const costoPrevio = Number(posPrevia?.costo || 0);
    const margenPrevio = Number(posPrevia?.margen || cantPrevia * costoPrevio);
    const nuevaCant = cantPrevia + cantCompra;
    const nuevoCostoProm =
      (cantPrevia * costoPrevio + cantCompra * precioNum) / nuevaCant;

    const nuevaPos = {
      cant: nuevaCant,
      costo: nuevoCostoProm,
      margen: margenPrevio + montoEfectivo,
      creado_ts: posPrevia?.creado_ts || Date.now(),
    };
    if (tp && Number.isFinite(Number(tp))) nuevaPos.tp = Number(tp);
    if (sl && Number.isFinite(Number(sl))) nuevaPos.sl = Number(sl);
    if (origen) nuevaPos.origen = origen;
    if (portafolioId) nuevaPos.portafolio_id = portafolioId;

    posicionesActuales[sym] = nuevaPos;
    const nuevoSaldo = Math.max(0, efectivo - costoTotal);

    const docOrden = await guardarOrdenYPortafolio(uid, {
      nuevoSaldo,
      nuevasPosiciones: posicionesActuales,
      nuevoPnlRealizadoTotal: pnlAcumPrevio - comision,
      orden: {
        tipo: 'compra',
        sym,
        side: 'LONG',
        cant: cantCompra,
        precio: precioNum,
        entrada: precioNum,
        total: montoEfectivo,
        comision,
        pnl: -comision,
        origen,
        nota,
        portafolioId,
      },
    });

    return {
      ok: true,
      tipo: 'compra',
      sym,
      cant: cantCompra,
      precio: precioNum,
      total: montoEfectivo,
      comision,
      nuevoSaldo,
      nuevasPosiciones: posicionesActuales,
      nuevoPnlRealizadoTotal: pnlAcumPrevio - comision,
      pnl: -comision,
      orden: docOrden,
    };
  } else {
    // Venta parcial o total de la posición del usuario
    const posPrevia = posicionesActuales[sym];
    const cantTenencia = Number(posPrevia?.cant || 0);
    const costoTenencia = Number(posPrevia?.costo || 0);

    if (cantTenencia <= 1e-8) {
      throw new Error(`No tienes unidades de ${sym} en tu portafolio para vender.`);
    }

    let cantVenta =
      fraccionVenta !== null
        ? cantTenencia * Number(fraccionVenta)
        : Number(montoUSD || 0) / precioNum;

    if (fraccionVenta === 1 || Math.abs(cantVenta - cantTenencia) / cantTenencia < 0.005 || cantVenta > cantTenencia) {
      cantVenta = cantTenencia;
    }

    const montoBruto = cantVenta * precioNum;
    const comision = montoBruto * COMISION;
    const netoRecibido = Math.max(0, montoBruto - comision);
    const pnlOperacion = (precioNum - costoTenencia) * cantVenta - comision;

    const cantRestante = cantTenencia - cantVenta;
    if (cantRestante <= 1e-8 || cantRestante * precioNum < 0.01) {
      delete posicionesActuales[sym];
    } else {
      const margenPrevio = Number(posPrevia?.margen || cantTenencia * costoTenencia);
      posicionesActuales[sym] = {
        ...posPrevia,
        cant: cantRestante,
        costo: costoTenencia,
        margen: Math.max(0, margenPrevio * (cantRestante / cantTenencia)),
      };
    }

    const nuevoSaldo = efectivo + netoRecibido;
    const nuevoPnl = pnlAcumPrevio + pnlOperacion;
    const docOrden = await guardarOrdenYPortafolio(uid, {
      nuevoSaldo,
      nuevasPosiciones: posicionesActuales,
      nuevoPnlRealizadoTotal: nuevoPnl,
      orden: {
        tipo: 'venta',
        sym,
        side: 'LONG',
        cant: cantVenta,
        entrada: costoTenencia,
        salida: precioNum,
        precio: precioNum,
        total: montoBruto,
        comision,
        pnl: pnlOperacion,
        origen,
        nota,
      },
    });

    return {
      ok: true,
      tipo: 'venta',
      sym,
      cant: cantVenta,
      precio: precioNum,
      total: montoBruto,
      comision,
      nuevoSaldo,
      nuevasPosiciones: posicionesActuales,
      nuevoPnlRealizadoTotal: nuevoPnl,
      pnl: pnlOperacion,
      orden: docOrden,
    };
  }
}

export async function publicarRanking(uid, { nombre, xp, rend }) {
  if (!uid) return;
  const rankingRef = doc(db, 'ranking', uid);
  await setDoc(
    rankingRef,
    {
      nombre: nombre || 'Estudiante',
      xp: Number(xp || 0),
      rend: Number(rend || 0),
    },
    { merge: true }
  );
}

export function escucharRanking(callback, maxItems = 10) {
  const rankingRef = collection(db, 'ranking');
  const q = query(rankingRef, orderBy('xp', 'desc'), limit(maxItems));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      callback(items);
    },
    (err) => {
      console.error('Error escuchando ranking:', err);
    }
  );
}

export async function actualizarProgresoChartismo(uid, { xp, aciertos, intentos, racha, rachaMax, nombre, rend }) {
  if (!uid) return;
  const userRef = doc(db, 'usuarios', uid);
  await updateDoc(userRef, {
    xp,
    aciertos,
    intentos,
    racha,
    rachaMax,
  });
  await publicarRanking(uid, { nombre, xp, rend });
}

export async function activarPlanPro(uid) {
  if (!uid) return;
  const userRef = doc(db, 'usuarios', uid);
  await updateDoc(userRef, { plan: 'pro' });
}

export function escucharPreciosMercado(callback) {
  const ref = doc(db, 'mercado', 'precios');
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('Error escuchando mercado/precios:', err);
    }
  );
}

export function escucharBotEstado(callback) {
  const ref = doc(db, 'bot', 'estado');
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('Error escuchando bot/estado:', err);
    }
  );
}

export function escucharBotVelas(callback) {
  const ref = doc(db, 'bot', 'velas');
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('Error escuchando bot/velas:', err);
    }
  );
}

export function escucharBotAnalisis(callback) {
  const ref = doc(db, 'bot', 'analisis');
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('Error escuchando bot/analisis:', err);
    }
  );
}

export function escucharBotValidacion(callback) {
  const ref = doc(db, 'bot', 'validacion');
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('Error escuchando bot/validacion:', err);
    }
  );
}

export function escucharBotWinrate(callback) {
  const ref = doc(db, 'bot', 'winrate');
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('Error escuchando bot/winrate:', err);
    }
  );
}

export function escucharBotDM(callback) {
  const ref = doc(db, 'bot', 'dm');
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('Error escuchando bot/dm:', err);
    }
  );
}

export function escucharBotMenu(callback) {
  const ref = doc(db, 'bot', 'menu');
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('Error escuchando bot/menu:', err);
    }
  );
}

export function escucharTradesBot(callback, maxTrades = 25) {
  const ref = collection(db, 'trades_bot');
  const q = query(ref, orderBy('ts', 'desc'), limit(maxTrades));
  return onSnapshot(
    q,
    (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(lista);
    },
    (err) => {
      console.error('Error escuchando trades_bot:', err);
    }
  );
}

/**
 * Escucha los últimos 40 documentos de `telegram_espejo` ordenados por `ts`
 * y los entrega en orden cronológico ascendente para mostrarlos como chat.
 */
export function escucharTelegramEspejo(callback, maxItems = 50) {
  let cancelado = false;
  let unsubActual = () => {};
  let retryTimer = null;

  const suscribir = () => {
    if (cancelado) return;
    const ref = collection(db, 'telegram_espejo');
    const q = query(ref, orderBy('ts', 'desc'), limit(maxItems));
    unsubActual = onSnapshot(
      q,
      (snap) => {
        const lista = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
        callback(lista);
      },
      (err) => {
        if (!cancelado) {
          retryTimer = setTimeout(suscribir, 1000);
        } else {
          console.error('Error escuchando telegram_espejo:', err);
        }
      }
    );
  };

  suscribir();

  return () => {
    cancelado = true;
    if (retryTimer) clearTimeout(retryTimer);
    unsubActual();
  };
}

/**
 * Envía un comando al bot en `comandos/{id}` (solo usuarios Pro)
 * Formato: {uid, tipo, valor, estado: "pendiente", ts(ms)}
 * tipo: 'toggle' | 'tf' | 'activo' | 'estrategia' | 'validar' | 'dm' | 'long' | 'short' | 'cerrar'
 */
export function traducirErrorFirestore(err) {
  const raw = String(err?.message || err || '');
  if (
    err?.code === 'permission-denied' ||
    /Missing or insufficient permissions/i.test(raw)
  ) {
    return 'Faltan publicar las reglas de Firestore';
  }
  return raw || 'Error de conexión con Firestore.';
}

export async function enviarComandoBot(uid, tipo, valor = null) {
  if (!uid) throw new Error('Usuario no autenticado.');
  const ref = collection(db, 'comandos');
  const payload = {
    uid,
    tipo,
    valor,
    estado: 'pendiente',
    ts: Date.now(),
  };
  let docRef;
  try {
    docRef = await addDoc(ref, payload);
  } catch (err) {
    throw new Error(traducirErrorFirestore(err));
  }

  // Vigilar hasta 20 s si el comando pasa a "hecho"; si no, avisar
  if (typeof window !== 'undefined') {
    let terminado = false;
    let unsub = () => {};
    const timer = setTimeout(() => {
      if (terminado) return;
      terminado = true;
      unsub();
      window.dispatchEvent(
        new CustomEvent('bolsalab:bot-timeout', {
          detail: 'El bot no respondió. Revisa que esté corriendo',
        })
      );
    }, 20000);

    unsub = onSnapshot(
      docRef,
      (snap) => {
        if (terminado || !snap.exists()) return;
        const st = snap.data()?.estado;
        if (st && st !== 'pendiente') {
          terminado = true;
          clearTimeout(timer);
          unsub();
        }
      },
      () => {
        terminado = true;
        clearTimeout(timer);
      }
    );
  }

  return docRef.id;
}

/**
 * Crea un comando en `comandos/{id}`, escucha ese documento con `onSnapshot`
 * hasta que el bot actualice `estado` (a "hecho", "ignorado" o "expirado")
 * y devuelve `{ ok, estado, resultado }`.
 */
let comandoCerrarEnVuelo = false;

export async function enviarComandoYEsperar(uid, tipo, valor = null, timeoutMs = 20000) {
  if (!uid) throw new Error('Usuario no autenticado.');
  const ref = collection(db, 'comandos');

  if (tipo === 'cerrar') {
    if (comandoCerrarEnVuelo) {
      return {
        ok: false,
        estado: 'duplicado',
        resultado: 'Ya hay una orden de cierre pendiente en proceso.',
      };
    }
    comandoCerrarEnVuelo = true;
    try {
      const qPend = query(
        ref,
        where('uid', '==', uid),
        where('tipo', '==', 'cerrar'),
        where('estado', '==', 'pendiente'),
        limit(1)
      );
      const snapPend = await getDocs(qPend);
      if (!snapPend.empty) {
        comandoCerrarEnVuelo = false;
        return {
          ok: false,
          estado: 'duplicado',
          resultado: 'Ya hay una orden de cierre pendiente en proceso.',
        };
      }
    } catch {
      // Si falla la consulta previa, continuar con la escritura controlada
    }
  }

  let docRef;
  try {
    docRef = await addDoc(ref, {
      uid,
      tipo,
      valor,
      estado: 'pendiente',
      ts: Date.now(),
    });
  } catch (err) {
    if (tipo === 'cerrar') comandoCerrarEnVuelo = false;
    throw new Error(traducirErrorFirestore(err));
  }

  return new Promise((resolve) => {
    let terminado = false;
    let unsub = () => {};
    const liberarCerrar = () => {
      if (tipo === 'cerrar') comandoCerrarEnVuelo = false;
    };

    const timer = setTimeout(() => {
      if (terminado) return;
      terminado = true;
      liberarCerrar();
      unsub();
      resolve({
        ok: false,
        estado: 'timeout',
        resultado: 'El bot no respondió. Revisa que esté corriendo',
      });
    }, timeoutMs);

    const requiereResultado = ['long', 'short', 'cerrar', 'telegram', 'portafolio'].includes(tipo);
    let ignoradoTimer = null;

    unsub = onSnapshot(
      docRef,
      (snap) => {
        if (terminado || !snap.exists()) return;
        const data = snap.data();
        if (requiereResultado) {
          if (typeof data.resultado === 'string' && data.resultado.length > 0) {
            terminado = true;
            liberarCerrar();
            clearTimeout(timer);
            if (ignoradoTimer) clearTimeout(ignoradoTimer);
            unsub();
            resolve({
              ok: data.estado === 'hecho',
              estado: data.estado || 'hecho',
              resultado: data.resultado,
              portafolio_id: data.portafolio_id || null,
            });
            return;
          }
          // Si el bot en ejecución aún no reconoce tipo === 'telegram' y lo marca como 'ignorado',
          // damos 1.1s por si un hilo nuevo escribe `resultado`; si no, resolvemos rápido para usar respaldo.
          if (tipo === 'telegram' && data.estado === 'ignorado' && !ignoradoTimer) {
            ignoradoTimer = setTimeout(() => {
              if (terminado) return;
              terminado = true;
              liberarCerrar();
              clearTimeout(timer);
              unsub();
              resolve({
                ok: false,
                estado: 'ignorado',
                resultado: '',
              });
            }, 1100);
          }
          return;
        }
        if (data.estado && data.estado !== 'pendiente' && data.estado !== 'ignorado') {
          terminado = true;
          liberarCerrar();
          clearTimeout(timer);
          if (ignoradoTimer) clearTimeout(ignoradoTimer);
          unsub();
          resolve({
            ok: data.estado === 'hecho',
            estado: data.estado,
            resultado: data.resultado || '',
            portafolio_id: data.portafolio_id || null,
          });
        }
      },
      () => {
        if (terminado) return;
        terminado = true;
        liberarCerrar();
        clearTimeout(timer);
        unsub();
        resolve({
          ok: false,
          estado: 'error',
          resultado: 'Error escuchando la respuesta del comando en Firestore.',
        });
      }
    );
  });
}

/**
 * Si el bot responde en `consultas/{id}` con `estado: "lista"` pero devuelve un error 404
 * del modelo deprecado `gemini-2.5-flash-lite`, sintetiza un diagnóstico cuantitativo
 * en español basado en los datos reales de `bot/estado` o del portafolio enviado en `contexto`.
 */
async function sintetizarAnalisisSiFalloModelo(pregunta, contexto, estadoBotOpcional = null) {
  const preg = (pregunta || '').trim();
  const ctx = (contexto || '').trim();

  if (ctx === 'BOT') {
    let st = estadoBotOpcional;
    if (!st) {
      try {
        const snap = await getDoc(doc(db, 'bot', 'estado'));
        if (snap.exists()) st = snap.data();
      } catch (_) {}
    }

    if (!st) {
      return '• Estado del Bot: Aún no se encontraron datos publicados en `bot/estado`. Verifica que el bot esté encendido y en línea.';
    }

    const sym = st.asset || 'BTC_USDT';
    const nombre = st.asset_name || sym;
    const tf = st.timeframe || '15m';
    const strat = st.strategy_label || st.strategy || 'Chartismo+Ruptura';
    const precio = Number(st.price || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const senal = st.signal_now || 'HOLD';
    const lectura = st.signal_text || 'En formación de estructura técnica';
    const r = st.risk || {};
    const pos = st.position;

    const lineas = [
      `📊 Diagnóstico Cuantitativo en Tiempo Real — ${nombre} (${sym}) · ${tf}`,
      ``,
      `• Estructura y Estrategia Activa (${strat}):`,
      `  El precio actual se ubica en $${precio} USD con señal ${senal}. ${lectura}.`,
      `• Evaluación de Riesgo Institucional (${r.label || 'CVaR 99%'}):`,
      `  El riesgo de cola medido es de ${Number(r.val || 0).toFixed(2)}% frente a un umbral máximo de ${Number(
        r.limit || 2.0
      ).toFixed(2)}% (${
        r.blocked
          ? '⚠️ volatilidad elevada: se sugiere cautela o reducir el tamaño de posición'
          : '🟢 condición favorable dentro del umbral institucional'
      }).`,
    ];

    if (pos) {
      lineas.push(
        `• Posición y Niveles del Modelo Random Forest:`,
        `  Dirección activa ${pos.side} x${pos.leverage || 10} desde $${Number(pos.entry || 0).toLocaleString(
          'en-US',
          { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        )} USD, con objetivo Take Profit (RF) en $${Number(pos.tp || 0).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} USD y Stop Loss en $${Number(pos.sl || 0).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} USD.`
      );
    } else {
      lineas.push(
        `• Plan Operativo Sugerido:`,
        `  Esperar confirmación de ruptura al cierre de vela antes de comprometer capital. Si decides operar con tu propio saldo de $10,000 USD, arriesga entre 10% y 15% de tu liquidez disponible y respeta siempre el nivel de Stop Loss.`
      );
    }

    if (preg) {
      lineas.push(
        ``,
        `• Respuesta a tu consulta ("${preg}"):`,
        `  En ${sym} (${tf}), la prioridad es seguir la dirección de ruptura confirmada por ${strat} manteniendo el control de riesgo (${
          r.label || 'CVaR 99%'
        }: ${Number(r.val || 0).toFixed(2)}%).`
      );
    }

    return lineas.join('\n');
  }

  if (ctx.length > 0) {
    // Análisis con contexto del portafolio del usuario
    const tieneSinPosiciones = ctx.includes('Sin posiciones abiertas');
    const lineas = [
      `💼 Diagnóstico del Analista IA sobre tu Portafolio (Simulador Casa de Bolsa)`,
      ``,
      `• Resumen de tu Estado Actual:`,
      ...ctx
        .split('\n')
        .slice(0, 6)
        .map((l) => `  ${l}`),
      ``,
    ];

    if (tieneSinPosiciones) {
      lineas.push(
        `• Evaluación de Diversificación y Liquidez:`,
        `  Actualmente mantienes el 100% de tu capital en efectivo disponible ($10,000.00 USD base). No tienes exposición a riesgo de mercado, pero tampoco estás capturando rendimiento.`,
        `• Recomendación Educativa:`,
        `  1. Distribuye gradualmente entre 30% y 50% de tu efectivo en 2 o 3 clases de activos distintas (por ejemplo: un ETF índice como SPY o QQQ, una acción líder como NVDA o AAPL, y una criptomoneda principal como BTC).`,
        `  2. Conserva siempre al menos 30%–40% en efectivo disponible para aprovechar retrocesos o señales del Bot Quant.`,
        `  3. Recuerda que cada operación tiene una comisión de 0.10%; evita sobreoperar en intervalos muy cortos.`
      );
    } else {
      lineas.push(
        `• Diagnóstico de Diversificación y Riesgo:`,
        `  Tu portafolio combina posiciones activas y reserva en efectivo. Verifica que ningún activo individual concentre más del 35% de tu patrimonio total para evitar riesgo idiosincrático excesivo.`,
        `• Recomendación Educativa sobre tus Posiciones:`,
        `  1. Toma de ganancias parcial: en posiciones con P&L positivo, considera asegurar ganancias vendiendo entre el 25% y 50% si el precio se acerca a una resistencia chartista.`,
        `  2. Control de pérdidas (Stop Loss): si una posición retrocede más de 3%–5% contra tu tesis inicial y rompe soporte, recorta la pérdida para proteger tus $10,000 USD base.`,
        `  3. Apóyate en la señal del Bot Quant y en la matriz del Random Forest antes de incrementar exposición.`
      );
    }

    if (preg) {
      lineas.push(
        ``,
        `• Enfoque sobre tu pregunta ("${preg}"):`,
        `  Mantén una asignación equilibrada entre liquidez y activos, priorizando entradas con relación beneficio/riesgo mayor a 1.5:1 y validando siempre la tendencia en el gráfico.`
      );
    }

    return lineas.join('\n');
  }

  // Pregunta libre
  const qLower = preg.toLowerCase();
  if (qLower.includes('riesgo') || qLower.includes('var') || qLower.includes('cvar') || qLower.includes('caviar')) {
    return [
      `🛡️ Guía de Gestión de Riesgo Institucional (VaR, CVaR y CAViaR al 99%)`,
      ``,
      `• VaR 99% (Value at Risk — usado en ETFs): estima la pérdida máxima esperada en una vela con un 99% de confianza estadística.`,
      `• CVaR 99% (Expected Shortfall — usado en Acciones): mide el promedio de las pérdidas en el 1% de los peores escenarios extremos (colas pesadas).`,
      `• CAViaR 99% (Conditional Autoregressive VaR — usado en Cripto): adapta dinámicamente el umbral de riesgo cuando la volatilidad se dispara.`,
      `• Regla práctica en tu cuenta de $10,000 USD: no arriesgues más del 1% al 2% de tu patrimonio total en una sola idea y utiliza siempre niveles claros de Stop Loss.`,
    ].join('\n');
  }

  if (qLower.includes('chartismo') || qLower.includes('figura') || qLower.includes('ruptura') || qLower.includes('hombro') || qLower.includes('doble')) {
    return [
      `📐 Principios Clave para Operar Figuras de Chartismo`,
      ``,
      `• Espera siempre la ruptura confirmada: una figura en formación (Doble Suelo, Hombro-Cabeza-Hombro, Triángulo o Bandera) solo activa señal cuando el cierre de la vela supera el cuello o directriz.`,
      `• Cálculo del objetivo técnico: proyecta la altura máxima de la figura desde el punto de ruptura para estimar tu Take Profit.`,
      `• Gestión con Stop Loss: coloca el stop del otro lado del nivel roto (soporte o resistencia) por si ocurre una falsa ruptura (bull/bear trap).`,
    ].join('\n');
  }

  return [
    `🧠 Respuesta del Analista Financiero IA`,
    ``,
    `• Sobre tu consulta ("${preg || 'Análisis general de mercado'}"):`,
    `  En el simulador BolsaLab cuentas con $10,000.00 USD virtuales para construir y gestionar tu portafolio en 28 activos (criptomonedas, acciones y ETFs).`,
    `• Tres pilares recomendados para operar:`,
    `  1. Análisis de estructura: identifica primero si el activo está en tendencia alcista, bajista o consolidación lateral antes de abrir una orden.`,
    `  2. Tamaño de posición: invierte entre el 10% y el 25% de tu efectivo disponible por operación para mantener liquidez y diversificación.`,
    `  3. Disciplina cuantitativa: combina la lectura de figuras chartistas con las métricas del modelo Random Forest (RMSE, F1 y test Diebold-Mariano) y los filtros de riesgo VaR/CVaR/CAViaR.`,
  ].join('\n');
}

/**
 * Crea una consulta para Gemini en `consultas/{id}` y escucha con `onSnapshot`
 * hasta que `estado == "lista"` (tiempo máximo 90 s).
 */
export async function consultarGemini({
  uid,
  pregunta = '',
  contexto = '',
  estadoBot = null,
}) {
  if (!uid) throw new Error('Usuario no autenticado.');
  const ref = collection(db, 'consultas');
  const docRef = await addDoc(ref, {
    uid,
    pregunta,
    contexto,
    estado: 'pendiente',
    ts: Date.now(),
  });

  return new Promise((resolve) => {
    let finalizado = false;
    let unsub = () => {};

    const timer = setTimeout(() => {
      if (finalizado) return;
      finalizado = true;
      unsub();
      resolve({
        ok: false,
        timeout: true,
        consultaId: docRef.id,
        respuesta: 'El bot no respondió. Revisa que el bot esté encendido y en línea.',
      });
    }, 90000);

    unsub = onSnapshot(
      docRef,
      async (snap) => {
        if (finalizado || !snap.exists()) return;
        const data = snap.data();
        if (data.estado === 'lista') {
          finalizado = true;
          clearTimeout(timer);
          unsub();
          let textoResp = String(data.respuesta || '').trim();
          if (
            !textoResp ||
            textoResp.startsWith('No se pudo conectar con Gemini') ||
            textoResp.startsWith('Error al consultar Gemini')
          ) {
            textoResp = await sintetizarAnalisisSiFalloModelo(
              pregunta,
              contexto,
              estadoBot
            );
          }
          resolve({
            ok: true,
            timeout: false,
            consultaId: docRef.id,
            respuesta: textoResp,
          });
        }
      },
      () => {
        if (finalizado) return;
        finalizado = true;
        clearTimeout(timer);
        unsub();
        resolve({
          ok: false,
          timeout: false,
          consultaId: docRef.id,
          respuesta: 'El bot no respondió. Revisa que el bot esté encendido y en línea.',
        });
      }
    );
  });
}

/**
 * Guarda los datos del asistente de bienvenida (Sección 5.1 bis) en `usuarios/{uid}`:
 * {objetivo, experiencia, perfil_riesgo, puntaje_riesgo, onboarding_ok: true}
 */
export async function guardarOnboardingUsuario(
  uid,
  { objetivo, experiencia, perfil_riesgo, puntaje_riesgo }
) {
  if (!uid) throw new Error('Usuario no autenticado.');
  const userRef = doc(db, 'usuarios', uid);
  await updateDoc(userRef, {
    objetivo,
    experiencia,
    perfil_riesgo,
    puntaje_riesgo: Number(puntaje_riesgo || 0),
    onboarding_ok: true,
  });
}

/**
 * Envía el comando `portafolio` al bot en `comandos/{id}` y espera a que el bot
 * escriba el documento resultante en `portafolios/{id}`.
 */
export async function solicitarPortafolioML(uid, config, timeoutMs = 90000) {
  const res = await enviarComandoYEsperar(uid, 'portafolio', config, timeoutMs);
  if (!res.ok) {
    throw new Error(
      res.resultado || 'El bot no pudo calcular el portafolio. Revisa que el bot esté encendido y en línea.'
    );
  }
  const portafolioId = res.portafolio_id;
  if (!portafolioId) {
    throw new Error('El bot respondió sin portafolio_id.');
  }
  const docSnap = await getDoc(doc(db, 'portafolios', portafolioId));
  if (!docSnap.exists()) {
    throw new Error('No se encontró el resultado en portafolios/' + portafolioId);
  }
  return {
    id: docSnap.id,
    resumenComando: res.resultado,
    ...docSnap.data(),
  };
}

/**
 * Lee un documento puntual de `portafolios/{id}`.
 */
export async function obtenerPortafolioML(portafolioId) {
  if (!portafolioId) return null;
  const snap = await getDoc(doc(db, 'portafolios', portafolioId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Guarda en `usuarios/{uid}.portafolioLargoPlazo` el seguimiento de la cartera invertida.
 */
export async function guardarPortafolioInvertidoUsuario(uid, datosPortafolio) {
  if (!uid) return;
  const userRef = doc(db, 'usuarios', uid);
  await updateDoc(userRef, {
    portafolioLargoPlazo: datosPortafolio,
  });
}

/**
 * Invierte de forma atómica todos los activos de un portafolio ML (Portafolio 1, Portafolio 2, ...),
 * acumulando correctamente todas las posiciones Spot sin sobrescribirse entre sí y guardando el contexto.
 */
export async function invertirCarteraPortafolioUsuario(
  uid,
  { items = [], capitalObjetivo = 0, portafolioMeta = {} } = {}
) {
  if (!uid) throw new Error('Sesión no disponible.');
  const userRef = doc(db, 'usuarios', uid);
  const tsAhora = Date.now();

  const resultadoTx = await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) throw new Error('No se encontró tu perfil de usuario.');
    const data = snap.data() || {};

    const efectivo = Number(data.saldo ?? SALDO_INICIAL);
    const maxInvertible = efectivo / (1 + COMISION);
    const capSolicitado = Math.max(0, Number(capitalObjetivo || 0));
    const capEfectivo = Math.min(capSolicitado, maxInvertible);

    if (capEfectivo < 2) {
      throw new Error(
        `Saldo disponible insuficiente ($${efectivo.toFixed(2)} USD) para invertir esta cartera.`
      );
    }

    const itemsValidos = (items || []).filter(
      (it) => it && it.sym && Number(it.precio) > 0 && Number(it.peso) > 0
    );
    const sumaPesos = itemsValidos.reduce((acc, it) => acc + Number(it.peso || 0), 0);
    if (itemsValidos.length === 0 || sumaPesos <= 0) {
      throw new Error('No hay activos con precio disponible para invertir.');
    }

    const posicionesActuales = { ...(data.posiciones || {}) };
    let pnlAcum = Number(data.pnlRealizadoTotal || 0);
    let totalGastado = 0;
    let totalComision = 0;
    const itemsEjecutados = [];
    const ordenesPendientes = [];

    for (const item of itemsValidos) {
      const px = Number(item.precio);
      const pesoNorm = Number(item.peso) / sumaPesos;
      const montoUSD = capEfectivo * pesoNorm;
      if (montoUSD < 0.5) continue;

      const comision = montoUSD * COMISION;
      const costoTotal = montoUSD + comision;
      const cantCompra = montoUSD / px;

      const posPrevia = posicionesActuales[item.sym];
      const cantPrevia = Number(posPrevia?.cant || 0);
      const costoPrevio = Number(posPrevia?.costo || 0);
      const margenPrevio = Number(posPrevia?.margen || cantPrevia * costoPrevio);
      const nuevaCant = cantPrevia + cantCompra;
      const nuevoCostoProm =
        (cantPrevia * costoPrevio + cantCompra * px) / nuevaCant;

      const nuevaPos = {
        cant: nuevaCant,
        costo: nuevoCostoProm,
        margen: margenPrevio + montoUSD,
        creado_ts: posPrevia?.creado_ts || tsAhora,
        origen: 'portafolio',
      };
      if (portafolioMeta.portafolioId) {
        nuevaPos.portafolio_id = portafolioMeta.portafolioId;
      }
      posicionesActuales[item.sym] = nuevaPos;

      totalGastado += montoUSD;
      totalComision += comision;
      pnlAcum -= comision;

      itemsEjecutados.push({
        sym: item.sym,
        nombre: item.nombre || item.sym,
        clase: item.clase || 'STOCK',
        peso: pesoNorm,
        montoUSD: Number(montoUSD.toFixed(4)),
        precioCompra: px,
        cantComprada: cantCompra,
      });

      ordenesPendientes.push({
        sym: item.sym,
        cantCompra,
        px,
        montoUSD,
        comision,
      });
    }

    if (itemsEjecutados.length === 0) {
      throw new Error('Verifica que tengas efectivo disponible y precios activos.');
    }

    // Reconstruir lista previa conservando portafolioLargoPlazo legado si aplica
    let listaPrev = Array.isArray(data.portafoliosInvertidos)
      ? data.portafoliosInvertidos.filter(
          (p) => p && Array.isArray(p.objetivoPesos) && p.objetivoPesos.length > 0
        )
      : [];
    if (
      listaPrev.length === 0 &&
      data.portafolioLargoPlazo &&
      Array.isArray(data.portafolioLargoPlazo.objetivoPesos) &&
      data.portafolioLargoPlazo.objetivoPesos.length > 0
    ) {
      const lp = data.portafolioLargoPlazo;
      listaPrev = [
        {
          ...lp,
          id: lp.id || lp.portafolioId || 'portafolio-1',
          numero: Number(lp.numero || 1),
          alias: lp.alias || 'Portafolio 1',
          contexto: String(lp.contexto || '').trim(),
        },
      ];
    }

    const numero =
      listaPrev.reduce((mx, p) => Math.max(mx, Number(p.numero || 0)), 0) + 1;
    const alias = `Portafolio ${numero}`;
    const contextoLimpio = String(portafolioMeta.contexto || '').trim();
    const nuevoPortafolio = {
      id: `pf_${tsAhora}_${numero}`,
      numero,
      alias,
      portafolioId: portafolioMeta.portafolioId || null,
      perfil: portafolioMeta.perfil || 'conservador',
      nombreCartera: portafolioMeta.nombreCartera || 'Cartera ML',
      contexto: contextoLimpio,
      capitalInicial: Number(totalGastado.toFixed(2)),
      capitalSolicitado: capSolicitado,
      spyPrecioInicial: portafolioMeta.spyPrecioInicial || null,
      tsCompra: tsAhora,
      objetivoPesos: itemsEjecutados,
    };

    const listaActualizada = [...listaPrev, nuevoPortafolio];
    const nuevoSaldo = Math.max(0, efectivo - (totalGastado + totalComision));

    tx.update(userRef, {
      saldo: nuevoSaldo,
      posiciones: posicionesActuales,
      pnlRealizadoTotal: Number(pnlAcum.toFixed(4)),
      migrado10k: true,
      portafoliosInvertidos: listaActualizada,
      portafolioLargoPlazo: nuevoPortafolio,
    });

    return {
      nuevoSaldo,
      nuevasPosiciones: posicionesActuales,
      nuevoPortafolio,
      portafoliosInvertidos: listaActualizada,
      ordenesPendientes,
    };
  });

  // Registrar cada orden en usuarios/{uid}/ordenes
  const ordenesRef = collection(db, 'usuarios', uid, 'ordenes');
  const { nuevoPortafolio, ordenesPendientes } = resultadoTx;
  const notaOrden = nuevoPortafolio.contexto
    ? `${nuevoPortafolio.alias} · ${nuevoPortafolio.nombreCartera} — ${nuevoPortafolio.contexto}`
    : `${nuevoPortafolio.alias} · ${nuevoPortafolio.nombreCartera}`;

  await Promise.all(
    ordenesPendientes.map((op) => {
      const docOrden = {
        ts: tsAhora,
        tipo: 'compra',
        sym: op.sym,
        cant: Number(op.cantCompra),
        precio: Number(op.px),
        total: Number(op.montoUSD),
        comision: Number(op.comision),
        pnl: -Number(op.comision),
        origen: 'portafolio',
        nota: notaOrden,
      };
      if (nuevoPortafolio.portafolioId) {
        docOrden.portafolio_id = nuevoPortafolio.portafolioId;
      }
      return addDoc(ordenesRef, docOrden);
    })
  );

  return {
    ok: true,
    comprados: ordenesPendientes.length,
    nuevoSaldo: resultadoTx.nuevoSaldo,
    nuevasPosiciones: resultadoTx.nuevasPosiciones,
    portafolioGuardado: nuevoPortafolio,
    portafoliosInvertidos: resultadoTx.portafoliosInvertidos,
  };
}

/**
 * Actualiza el texto de contexto/nota de un portafolio guardado (Portafolio 1, Portafolio 2, ...).
 */
export async function actualizarContextoPortafolioUsuario(
  uid,
  portafolioEntryId,
  nuevoContexto = ''
) {
  if (!uid || !portafolioEntryId) return [];
  const userRef = doc(db, 'usuarios', uid);
  const texto = String(nuevoContexto || '').trim();

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) return [];
    const data = snap.data() || {};

    let lista = Array.isArray(data.portafoliosInvertidos)
      ? [...data.portafoliosInvertidos]
      : [];
    if (
      lista.length === 0 &&
      data.portafolioLargoPlazo &&
      Array.isArray(data.portafolioLargoPlazo.objetivoPesos)
    ) {
      const lp = data.portafolioLargoPlazo;
      lista = [
        {
          ...lp,
          id: lp.id || lp.portafolioId || 'portafolio-1',
          numero: Number(lp.numero || 1),
          alias: lp.alias || 'Portafolio 1',
        },
      ];
    }

    const listaActualizada = lista.map((p) => {
      const match =
        String(p.id || p.portafolioId || '') === String(portafolioEntryId);
      return match ? { ...p, contexto: texto } : p;
    });

    const lpActual = data.portafolioLargoPlazo;
    const lpMatch =
      lpActual &&
      String(lpActual.id || lpActual.portafolioId || 'portafolio-1') ===
        String(portafolioEntryId);

    const payload = { portafoliosInvertidos: listaActualizada };
    if (lpMatch) {
      payload.portafolioLargoPlazo = { ...lpActual, contexto: texto };
    }
    tx.update(userRef, payload);
    return listaActualizada;
  });
}

/**
 * Cuenta Espejo: copia exactamente UNA VEZ la posición abierta del bot en Firestore
 * usando runTransaction + entry_utc como llave única para no duplicar entre pestañas.
 */
export async function copiarAperturaBotEspejo(uid, botPos, tamanoCopia = 'igual_bot') {
  if (!uid || !botPos || !botPos.asset || !botPos.entry) return null;
  const entryUtc = String(botPos.entry_utc || botPos.entry_candle || '');
  if (!entryUtc) return null;

  const userRef = doc(db, 'usuarios', uid);
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    if (!(data.botAutoUser ?? data.botAutoCopiar)) return null;
    if (data.copiaUltimaEntryUtc === entryUtc) return null;

    const posFut = { ...(data.posicionesFuturos || {}) };
    const sym = botPos.asset;
    if (posFut[sym]?.entry_utc === entryUtc) return null;

    const efectivo = Number(data.saldo ?? SALDO_INICIAL);
    if (efectivo < 1) return null;

    const modo = String(tamanoCopia ?? data.botTamanoCopia ?? 'igual_bot');
    const margenBot = Number(botPos.margin_usdt || 0);
    let margen;
    if (modo === 'igual_bot' && margenBot > 0) {
      margen = Math.min(efectivo, margenBot);
    } else {
      const pct = Math.max(1, Math.min(100, Number(modo === 'igual_bot' ? data.botPctSaldo || 15 : modo)));
      margen = Math.min(efectivo, Math.max(25, (efectivo * pct) / 100));
    }
    const entry = Number(botPos.entry);
    const leverage = Number(botPos.leverage || 10);
    const qty = (margen * leverage) / entry;

    posFut[sym] = {
      asset: sym,
      side: String(botPos.side || 'LONG').toUpperCase(),
      entry,
      qty,
      margin_usdt: margen,
      leverage,
      sl: botPos.sl ? Number(botPos.sl) : null,
      tp: botPos.tp ? Number(botPos.tp) : null,
      liq: botPos.liq ? Number(botPos.liq) : null,
      entry_utc: entryUtc,
      origen: 'copia',
    };

    const nuevoSaldo = Math.max(0, efectivo - margen);
    tx.update(userRef, {
      saldo: nuevoSaldo,
      posicionesFuturos: posFut,
      copiaUltimaEntryUtc: entryUtc,
    });

    return { sym, side: posFut[sym].side, margen, entry, qty, leverage, entryUtc };
  });

  if (res) {
    const ordenesCol = collection(db, 'usuarios', uid, 'ordenes');
    await addDoc(ordenesCol, {
      tipo: 'compra',
      sym: res.sym,
      side: res.side,
      cant: res.qty,
      precio: res.entry,
      entrada: res.entry,
      total: res.margen,
      comision: 0,
      pnl: 0,
      origen: 'copia',
      nota: `Copia bot ${res.side} x${res.leverage}`,
      entry_utc: res.entryUtc,
      ts: Date.now(),
    });
  }
  return res;
}

/**
 * Cierra la posición en Cuenta Espejo (`posicionesFuturos[sym]`) con runTransaction
 * para evitar cierres duplicados entre pestañas. Calcula P&L exacto sin comisiones.
 */
export async function cerrarCopiaBotEspejo(
  uid,
  sym,
  exitPrice,
  motivo = 'Cierre copia bot',
  origenOrden = null
) {
  const px = Number(exitPrice);
  if (!uid || !sym || !Number.isFinite(px) || px <= 0) return null;

  const userRef = doc(db, 'usuarios', uid);
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    const posFut = { ...(data.posicionesFuturos || {}) };
    const pos = posFut[sym];
    if (!pos) return null;

    const entry = Number(pos.entry || 0);
    const qty = Number(pos.qty || 0);
    const margen = Number(pos.margin_usdt || 0);
    const side = String(pos.side || 'LONG').toUpperCase();
    const pnl = side === 'SHORT' ? (entry - px) * qty : (px - entry) * qty;
    const origFinal = origenOrden || pos.origen || 'copia';

    delete posFut[sym];
    const efectivo = Number(data.saldo ?? SALDO_INICIAL);
    const nuevoSaldo = Math.max(0, efectivo + margen + pnl);
    const pnlPrev = Number(data.pnlRealizadoTotal || 0);

    tx.update(userRef, {
      saldo: nuevoSaldo,
      posicionesFuturos: posFut,
      pnlRealizadoTotal: pnlPrev + pnl,
    });

    return {
      sym,
      side,
      entry,
      salida: px,
      qty,
      margen,
      pnl,
      nuevoSaldo,
      entryUtc: pos.entry_utc || '',
      origen: origFinal,
    };
  });

  if (res) {
    const ordenesCol = collection(db, 'usuarios', uid, 'ordenes');
    await addDoc(ordenesCol, {
      tipo: 'venta',
      sym: res.sym,
      side: res.side,
      cant: res.qty,
      precio: res.salida,
      entrada: res.entry,
      salida: res.salida,
      total: res.margen + res.pnl,
      comision: 0,
      pnl: res.pnl,
      origen: res.origen,
      nota: motivo,
      entry_utc: res.entryUtc,
      ts: Date.now(),
    });
  }
  return res;
}

/**
 * Abre manualmente una posición apalancada (LONG o SHORT, ej. 5x o 10x) con margen del usuario (origen: 'manual').
 */
export async function abrirPosicionApalancadaManual(
  uid,
  perfil,
  { sym, side = 'LONG', precio, montoUSD = 500, leverage = 10, tp = null, sl = null }
) {
  const px = Number(precio);
  const margen = Number(montoUSD);
  const dir = String(side || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const lev = Math.max(1, Number(leverage || 10));
  if (!uid || !sym || !Number.isFinite(px) || px <= 0) {
    throw new Error(`Precio o activo inválido para abrir ${dir}.`);
  }
  if (!Number.isFinite(margen) || margen <= 0.5) {
    throw new Error('Ingresa un monto válido para el margen.');
  }

  const userRef = doc(db, 'usuarios', uid);
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) throw new Error('Perfil de usuario no encontrado.');
    const data = snap.data() || {};
    const efectivo = Number(data.saldo ?? perfil?.saldo ?? SALDO_INICIAL);
    if (margen > efectivo) {
      throw new Error(`Saldo insuficiente ($${efectivo.toFixed(2)} USD).`);
    }
    const posFut = { ...(data.posicionesFuturos || {}) };
    if (posFut[sym]) {
      throw new Error(`Ya tienes una posición abierta en ${sym}. Ciérrala antes de abrir otra.`);
    }
    const qty = (margen * lev) / px;
    const nuevoSaldo = Math.max(0, efectivo - margen);
    const liq = dir === 'SHORT' ? px * (1 + 0.9 / lev) : px * Math.max(0.05, 1 - 0.9 / lev);

    posFut[sym] = {
      asset: sym,
      side: dir,
      entry: px,
      qty,
      margin_usdt: margen,
      leverage: lev,
      tp: tp ? Number(tp) : null,
      sl: sl ? Number(sl) : null,
      liq,
      entry_utc: new Date().toISOString(),
      origen: 'manual',
    };

    tx.update(userRef, {
      saldo: nuevoSaldo,
      posicionesFuturos: posFut,
    });

    return { sym, side: dir, entry: px, qty, margen, leverage: lev, nuevoSaldo };
  });

  const ordenesCol = collection(db, 'usuarios', uid, 'ordenes');
  await addDoc(ordenesCol, {
    tipo: 'compra',
    sym: res.sym,
    side: res.side,
    cant: res.qty,
    precio: res.entry,
    entrada: res.entry,
    total: res.margen,
    comision: 0,
    pnl: 0,
    origen: 'manual',
    nota: `${res.side} manual x${res.leverage}`,
    ts: Date.now(),
  });

  return res;
}

export async function abrirShortManualX10(
  uid,
  perfil,
  { sym, precio, montoUSD = 500, leverage = 10, tp = null, sl = null }
) {
  return abrirPosicionApalancadaManual(uid, perfil, {
    sym,
    side: 'SHORT',
    precio,
    montoUSD,
    leverage,
    tp,
    sl,
  });
}

/**
 * Borra el historial de operaciones cerradas de prueba del usuario y restaura saldo a $10,000.
 */
export async function borrarHistorialPrueba(uid) {
  if (!uid) return;
  const ordenesCol = collection(db, 'usuarios', uid, 'ordenes');
  const snap = await getDocs(ordenesCol);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));

  const userRef = doc(db, 'usuarios', uid);
  await updateDoc(userRef, {
    saldo: SALDO_INICIAL,
    pnlRealizadoTotal: 0,
    posiciones: {},
    posicionesFuturos: {},
    copiaUltimaEntryUtc: '',
    historialBorradoTs: Date.now(),
  });
}
