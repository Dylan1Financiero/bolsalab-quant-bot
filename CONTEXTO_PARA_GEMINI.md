# Contexto completo del proyecto BolsaLab (para Gemini / Antigravity)

Lee este archivo completo antes de hacer cualquier cosa. Resume qué estamos construyendo, qué ya está
hecho, qué falta y las reglas que no se pueden romper. El detalle técnico exacto está en
`ESPECIFICACION.md`; si algo de aquí y de allá no coincide, manda `ESPECIFICACION.md`.

## 1. Qué es
Proyecto integrador final de la materia Finanzas Computacionales (UDEM). Une cuatro opciones de la rúbrica
(1, 2, 3 y 6). La 1 (régimen de volatilidad) y la 2 (portafolios con regresión, Markowitz y Paridad de Riesgo)
son el motor de la pestaña Portafolio. Las otras dos:
- **Opción 3 — Bot de trading automático** en una máquina virtual de Google Cloud, con Telegram.
- **Opción 6 — Aplicación financiera interactiva con IA**, publicada con link público.

El producto se llama **BolsaLab**: un simulador de casa de bolsa con enfoque chartista, que además enseña a
leer gráficos jugando y muestra en vivo un bot de trading cuantitativo.

**Fechas:** entrega 17 de noviembre de 2026; defensa en vivo 19 de noviembre de 2026.
**Idioma:** toda la interfaz y todos los textos en español.

## 2. Qué pide la rúbrica (todo es obligatorio)
1. App desarrollada en Antigravity (o AI Studio).
2. Autenticación con **Firebase Authentication**.
3. Núcleo cuantitativo: **panel conectado en tiempo real al bot** que corre en la VM.
4. Como el bot usa Machine Learning, la app muestra en pantalla: RMSE, MSE, MAE, MAPE, SMAPE, Variance
   Score, Matriz de Confusión, F1-Score y test Diebold-Mariano.
5. Motor de IA: análisis con **Gemini**.
6. **URL pública** activa (Firebase Hosting).
7. Del lado del bot: señales Buy/Hold/Sell, gestión de riesgo, alertas por Telegram, estado de la VM, llaves
   en `.env`, archivo `trading_bot.log`, ejecución 24/7.

## 3. Arquitectura
```
Bot en Python (VM de Google Cloud)  ──escribe──►  Firestore  ◄──lee en tiempo real──  App web (React)
        ▲                                             │
        └──────── lee comandos y preguntas ◄──────────┘ (la app los escribe)
        │
        └── Telegram (alertas y menú)      └── Gemini (el bot responde las preguntas de la app)
```
- La app **nunca** habla directo con el bot ni con Gemini: todo pasa por Firestore.
- La llave de Gemini vive solo en la VM. **Ninguna llave secreta va en el frontend.**
- Proyecto de Firebase: `bolsalab-udem`.

## 4. El bot (YA ESTÁ TERMINADO — no modificar nada dentro de `bot/`)
Archivo: `bot/bot_quant_x10_app.py`.
- Opera 28 activos: 10 criptomonedas (Gate.io), 10 acciones y 8 ETFs (Yahoo Finance).
- 6 estrategias: RSI, EMA 50/200, Bollinger, Fibonacci + abanicos, SuperTrend, Chartismo + ruptura.
- Apalancamiento x10, operación simulada (paper trading), SL/TP calculados con Random Forest.
- Usa **CatBoost** además de Random Forest (requisito del profesor: debe correr en la VM). La validación
  compara ambos modelos y los enfrenta con Diebold-Mariano.
- Filtro de riesgo según la clase de activo; si pasa el límite, bloquea la entrada (semáforo rojo):
  - Criptomonedas → CAViaR 99% (límite 1.5%)
  - Acciones → CVaR 99% (límite 2.2%)
  - ETFs → VaR 99% (límite 1.5%)
- Menú de Telegram con: Auto-Trading, temporalidad → activo, Long / Cerrar, reporte + gráfico, saldo,
  trades, Excel, estrategias, filtros de riesgo, Gemini, **Reporte Winrate** y **Test Diebold-Mariano**.
- Publica en Firestore su estado, velas, precios de los 28 activos, trades, validación del Random Forest,
  reporte de winrate, reporte Diebold-Mariano y una **copia en vivo del chat de Telegram** (espejo).
- Atiende comandos de la app (encender/pausar, cambiar activo, temporalidad y estrategia, validar, y
- **Control remoto:** publica su menú de Telegram en `bot/menu` y ejecuta cualquier botón que la app le mande
  con el comando `telegram`. La app debe ofrecer TODAS las opciones del bot de Telegram.
  **órdenes Long / Short / Cerrar**) y responde con Gemini las preguntas que la app deja en Firestore.

## 5. La app (lo que se construye en Antigravity)
Carpeta `app/`, Vite + React, Firebase JS SDK, lightweight-charts y el widget de TradingView.

| Sección | Qué hace | Estado |
|---|---|---|
| Acceso | Registro e inicio de sesión (correo y Google). Cuenta nueva = $100,000 USD virtuales, plan Free | ✅ Hecho (Prompt 1) |
| Mercado | Simulador de casa de bolsa: 28 activos con precio en vivo, gráfico de TradingView, compra/venta a mercado con comisión 0.10%, portafolio, historial, ranking | ✅ Hecho (Prompt 2) |
| Juega y aprende | Juego para aprender chartismo con 38 figuras y lecturas generadas con código, 3 modos, experiencia, niveles, racha y ranking | ⏳ Sigue (Prompt 3) |
| Bot de trading (plan Pro) | Panel en vivo del bot, **operar desde la app**, **espejo de Telegram**, **Reporte Winrate**, **Test Diebold-Mariano** | ⏳ Prompt 4 |
| Modelo ML | Tabla de validación del Random Forest y matriz de confusión | ⏳ Prompt 4 |
| Bienvenida y perfil | Asistente al crear cuenta: objetivo, experiencia y perfil de riesgo; recomienda la sección | ⏳ Nuevo |
| Portafolio | Opciones 1 y 2: régimen de volatilidad (RF, KNN, red neuronal) + rendimiento esperado (regresión) → Markowitz y Paridad de Riesgo según el perfil; lo calcula el bot | ⏳ Nuevo |
| Analista IA | Chat con Gemini sobre el portafolio o el estado del bot | ⏳ Prompt 5 |
| Videos | `espera.mp4` de fondo en el login (en bucle) e `intro.mp4` una vez después de entrar | ⏳ Después del Prompt 5 |
| Publicación | Revisión contra los criterios y `firebase deploy` | ⏳ Prompt 6 |

Modelo de negocio: plan **Free** (simulador, juego, modelo ML, analista IA) y plan **Pro** (bot). El pago es
**simulado**: el botón solo cambia `plan` a `"pro"` en el perfil del usuario. No integrar pasarelas de pago.

## 6. Archivos de esta carpeta
| Archivo | Para qué sirve |
|---|---|
| `ESPECIFICACION.md` | Especificación exacta: contrato de datos de Firestore, catálogo, pantallas, diseño y criterios de aceptación. **Es la fuente de verdad.** |
| `PROMPTS.md` | Los 6 prompts en orden, con la prueba de cada uno |
| `datos/figuras_chartismo.json` | Las 38 figuras del juego (coordenadas, trazos, explicación) |
| `referencias/*.png` | 40 imágenes de cómo debe verse cada figura ya revelada (solo referencia visual) |
| `firestore.rules` | Reglas de seguridad. Se copian a `app/` y se despliegan tal cual |
| `bot/` | El bot terminado, su `.env.example` y `requirements.txt` |
| `app/` | La aplicación que se está construyendo |

## 7. Reglas que no se pueden romper
1. **No modificar nada dentro de `bot/` ni de `datos/`.**
2. **No cambiar nombres de colecciones, documentos ni campos de Firestore**: el bot ya escribe con esos
   nombres (sección 3 de `ESPECIFICACION.md`). Si se cambian, la app deja de entenderse con el bot.
3. **No poner llaves secretas en el frontend** (ni Gemini, ni Telegram, ni Gate, ni el JSON de credenciales).
   El `firebaseConfig` sí es público y va en `app/src/firebaseConfig.js`.
4. **No llamar a Gemini desde la app**: se crea un documento en `consultas` y se espera la respuesta del bot.
5. **No usar imágenes en el juego**: las velas se generan con código a partir del JSON. Usar las 38 figuras
   tal cual, sin inventar ni quitar.
6. **No modificar `firestore.rules`**; solo copiarlo a `app/` y desplegarlo.
7. Si un documento de Firestore todavía no existe (bot apagado), mostrar "El bot aún no publica datos" sin
   romper la pantalla.
8. Diseño: tema oscuro (fondo `#0b0e14`, acento `#7c5cff`, verde `#22c58b`, rojo `#f0506e`), responsivo, sin
   scroll horizontal en celular.
9. Trabajar por pasos: hacer solo lo que pide el prompt actual, probarlo en el navegador y reportar.

## 8. Dónde vamos y qué sigue
- Hechos: Prompt 1 (base, Firebase, acceso) y Prompt 2 (Mercado). Reglas de Firestore ya desplegadas en
  `bolsalab-udem`. Servidor de desarrollo en `http://localhost:5173`.
- Sigue: **Prompt 3 (Juega y aprende)**, luego Prompt 4, Prompt 5, los videos y Prompt 6, en ese orden.
- Las secciones 3 y 5.4 de `ESPECIFICACION.md` y `firestore.rules` se actualizaron después del Prompt 2
  (órdenes desde la app, espejo de Telegram, winrate y Diebold-Mariano): **volver a leerlas antes del
  Prompt 4** y volver a desplegar las reglas.

## 9. Cómo responderle al usuario
- En español, corto y directo.
- Antes de programar, mostrar el plan. Después de programar, probar en el navegador y decir qué se probó.
- Si algo de la especificación no se puede cumplir, decirlo antes de cambiarlo por otra cosa.

## 10. Narrativa del producto
**BolsaLab: de aprender a invertir.** Al entrar, el usuario dice qué busca y la app lo lleva por su camino:
aprender a leer gráficos (juego de chartismo), operar día a día por su cuenta en el simulador (con el bot cuantitativo
como opción Pro), o invertir a largo plazo con un portafolio construido con machine learning: un clasificador de
régimen de volatilidad decide qué activos acepta su perfil, un modelo de regresión estima su rendimiento, y Markowitz
o Paridad de Riesgo arman la cartera. Todo con validación estadística visible e IA que explica cada resultado.
