# Informe Técnico Final — Proyecto Integrador BolsaLab & Bot Quant x10

**Materia:** Finanzas Computacionales, Algoritmos Cuantitativos e Inteligencia Artificial  
**Institución:** Universidad de Monterrey (UDEM)  
**Fecha de entrega documental:** 17 de noviembre de 2026  
**Fecha de defensa en vivo:** 19 de noviembre de 2026  
**Opciones implementadas:** Opciones **1, 2, 3 y 6** (con elementos espaciales de KNN de Opción 5)

---

## Enlaces de Entrega y Despliegue Público

- **Aplicación Web Publicada (URL activa):** https://bolsalab-udem.web.app
- **Repositorio Público en GitHub:** https://github.com/Dylan1Financiero/bolsalab-quant-bot
- **Infraestructura Cloud:** Máquina Virtual en Google Cloud Compute Engine (`systemd` activo 24/7) + Cloud Firestore + Firebase Hosting + Firebase Authentication + Telegram Bot API + Gate.io Futures Testnet

---

## 1. Objetivo General y Alcance

El proyecto **BolsaLab** integra en un ecosistema completo conectado en tiempo real:
1. **Opción 1 (Clasificación de Riesgo de Inversión y Volatilidad):** Predicción diaria (`h = 20` días hábiles) del régimen de volatilidad (`baja`, `media`, `alta` respecto a terciles históricos de cada activo + lectura absoluta anual) comparando **Random Forest Classifier**, **KNN (Distancia Euclidiana)** y **Red Neuronal MLP** frente a un modelo ingenuo de persistencia.
2. **Opción 2 (Optimización de Portafolios de Inversión):** Predicción de rendimientos a 20 días mediante regresión (**Random Forest**, **KNN**, **MLP**), construcción de la **Matriz de Correlación de Pearson** y optimización de la **Frontera Eficiente de Markowitz** generando 5 carteras (*Recomendada*, *Máximo Sharpe*, *Mínima varianza*, *Paridad de riesgo* y *Pesos iguales 1/N*) con *backtest* fuera de muestra frente al S&P 500 (`SPY`).
3. **Opción 3 (Bot de Trading Automático en VM de Google Cloud + Telegram + Testnet):** Ejecución continua 24/7 en Compute Engine leyendo velas reales de **Gate.io** y **Yahoo Finance**, evaluando 6 estrategias técnicas con predominio de **Bandas de Bollinger (20, 2σ) + EMA 200**, dimensionando salidas con **ATR(14)** (`TP 2.0 ATR / SL 0.4 ATR`, relación 5:1), aplicando freno automático de riesgo dinámico (**CAViaR 99%**, **CVaR 99%**, **VaR 99%**), optimizando apalancamiento dinámico en XRP con **Random Forest** (`x10` / `x15`), replicando órdenes en **Gate.io Futures Testnet** y enviando alertas/comandos bidireccionales por **Telegram**.
4. **Opción 6 (Aplicación Financiera Interactiva con IA):** Terminal web publicada en Firebase Hosting con autenticación (**Firebase Auth**), consola de terminal del bot en vivo (velas `lightweight-charts`, espejo de Telegram y métricas en tiempo real), asistente por pasos de portafolios, simulador educativo (38 figuras chartistas) y **Analista Financiero IA** con **Google Gemini** y análisis de sentimiento en X con **xAI (Grok)**.

---

## 2. Arquitectura del Sistema Cloud y Seguridad

```text
[Gate.io Producción API + Yahoo Finance]
               │ (velas OHLCV reales)
               ▼
[Google Cloud Compute Engine VM - Python 24/7 (systemd)]
   ├── Motor Estrategias (Bollinger+EMA200, Chartismo v3.2, Fib, RSI, EMA50/200, ST)
   ├── Motor Riesgo (CAViaR 99% Cripto | CVaR 99% Acciones | VaR 99% ETFs)
   ├── Motor ML & Validación (Random Forest vs CatBoost, KNN, MLP, Diebold-Mariano)
   ├── Ejecución Testnet (Gate.io Futures Testnet x10/x15)
   ├── ChatOps Telegram Bot API <──► Usuario Telegram + Espejo en Firestore
   └── Puente Firebase Admin SDK <──► Cloud Firestore
                                            │
                                            ▼
                     [App Web React publicada en Firebase Hosting]
                        https://bolsalab-udem.web.app
```

- **Seguridad y variables de entorno:** Ninguna clave privada (`TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GATE_TESTNET_*`, `firebase-credenciales.json`) está incluida en el repositorio; la VM y el entorno local cargan las credenciales mediante `.env` a partir de la plantilla `bot/.env.example`.

---

## 3. Arquitectura y Módulos del Frontend (Aplicación Web React)

La interfaz web (**BolsaLab**) está construida como una *Single Page Application* (SPA) publicada en **Firebase Hosting** (`https://bolsalab-udem.web.app`), diseñada para operar en tiempo real sin recargas mediante suscripciones reactivas (`onSnapshot`) a **Cloud Firestore**.

### 3.1. Stack Tecnológico del Frontend
- **Framework y Build:** `React 18.3.1` + `Vite 5.4.11` (`ES Modules`, compilación optimizada para producción en `dist/`).
- **Backend-as-a-Service (BaaS):** `Firebase SDK 11.0.2` (**Firebase Authentication** con correo/contraseña y Google OAuth + **Cloud Firestore** para estado del bot, órdenes, portafolios y reportes en vivo).
- **Visualización Financiera:** `lightweight-charts 4.2.1` (gráficos de velas OHLCV con primitiva personalizada `PositionRangePrimitive.js` para trazar Entrada, Take Profit y Stop Loss) + `TradingViewWidget.jsx` + `ChartismoCanvas.jsx` (`HTML5 Canvas`).
- **Iconografía y UI:** `lucide-react 1.73.0` + hoja de estilos modular responsiva (`index.css`) adaptable a escritorio y móvil.

### 3.2. Flujo de Acceso, Onboarding y Navegación
1. **Autenticación (`AuthScreen.jsx`):** Pantalla de inicio de sesión y registro con fondo de video institucional en silencio (`/video_interfaz.mp4`), validación de credenciales y asignación automática de saldo virtual inicial para simulación.
2. **Onboarding (`OnboardingModal.jsx`):** Asistente de 3 pasos al primer ingreso para configurar el perfil del usuario (aprendizaje chartista, *day trading*, portafolios ML o exploración completa).
3. **Barra de Estado Global (`Navbar.jsx` y `AjustesModal.jsx`):** Muestra en todo momento el estado de conexión del bot en la VM (latido `ts <= 60s`), patrimonio total, P&L diario y ajustes de cuenta.

### 3.3. Módulos y Vistas Principales de la Terminal Web

| Sección (`Navbar`) | Componentes Clave | Funcionalidad Implementada |
|---|---|---|
| **1. Mercado** | `MercadoView.jsx`, `TradingViewWidget.jsx`, `MisPosicionesView.jsx`, `CerrarPosicionModal.jsx` | Simulador multi-activo (Cripto, Acciones y ETFs) con boleta de orden Spot y apalancada, **apalancamiento libre editable** (`1x` en adelante), **Stop Loss y Take Profit porcentuales personalizables**, cálculo dinámico de comisión/riesgo, gestión de posiciones abiertas y recomendación del bot / Analista IA. |
| **2. Trading (bot)** | `BotView.jsx`, `BotCandlesChart.jsx`, `PositionRangePrimitive.js`, `TelegramMenuPanel.jsx`, `CentroResultadosBot.jsx` | Consola en vivo conectada al bot 24/7 en Compute Engine: velas en tiempo real, niveles visuales de Entrada/TP/SL, semáforo de riesgo (`CAViaR`/`CVaR`/`VaR 99%`), espejo bidireccional de Telegram, envío de comandos remotos y centro de reportes (`Winrate`, `Diebold-Mariano`, `Sentimiento`, `Órdenes`). |
| **3. Portafolio** | `PortafolioMLView.jsx`, `PortfolioDashboard.jsx`, `MisPortafoliosInvertidos.jsx` | Asistente cuantitativo por pasos (Opciones 1, 2 y 5): clasificación de régimen de volatilidad (`baja`/`media`/`alta`), regresión de retornos (`RF`, `KNN` Euclidiana, `MLP`), **Matriz de Correlación de Pearson**, **Frontera Eficiente de Markowitz** (5 carteras), comparación fuera de muestra vs. `S&P 500` y seguimiento de carteras invertidas. |
| **4. Aprender** | `JuegoView.jsx`, `ChartismoCanvas.jsx` | Módulo interactivo de entrenamiento visual sobre **38 figuras chartistas** en canvas con sistema de puntuación (XP) y ranking. |
| **5. Modelo ML** | `ModeloMLView.jsx` | Tablero de validación estadística fuera de muestra: KPIs de acierto vs. modelo ingenuo, `F1` macro, estadístico **Diebold-Mariano** (vs. caminata aleatoria y vs. CatBoost), tabla comparativa de hiperparámetros (`Random Forest` y `CatBoost`) y comparativa de impacto del filtro ML en XRP. |
| **6. Analista IA** | `AnalistaIAView.jsx` | Analista financiero conversacional impulsado por **Google Gemini** y módulo de sentimiento en X con **xAI (Grok)** bajo ponderación híbrida `50/35/15`, integrando contexto técnico y métricas de riesgo. |

---

## 4. Especificación Matemática de Modelos y Métricas

### 4.1. Test Transversal de Validación Diebold-Mariano (con corrección de Harvey et al., 1997)
Dados los errores de pronóstico $e_{1,t} = y_t - \hat{y}_{1,t}$ (modelo candidato) y $e_{2,t} = y_t - \hat{y}_{2,t}$ (referencia ingenua o segundo modelo), el diferencial de pérdida cuadrática es:

$$d_t = e_{1,t}^2 - e_{2,t}^2, \qquad \bar{d} = \frac{1}{n}\sum_{t=1}^{n} d_t$$

Estimando la varianza de largo plazo mediante autocovarianzas muestrales hasta el horizonte $h$:

$$\hat{\gamma}_k = \frac{1}{n}\sum_{t=k+1}^{n}(d_t - \bar{d})(d_{t-k} - \bar{d}), \qquad \widehat{V}(\bar{d}) = \frac{\hat{\gamma}_0 + 2\sum_{k=1}^{h-1}\hat{\gamma}_k}{n}$$

El estadístico de Diebold-Mariano ajustado por muestra finita (Harvey, Leybourne y Newbold, 1997) es:

$$DM = \frac{\bar{d}}{\sqrt{\widehat{V}(\bar{d})}} \cdot \sqrt{\frac{n + 1 - 2h + \frac{h(h-1)}{n}}{n}} \sim t_{n-1}$$

- **Regla de decisión:** Si $DM < 0$ y $p < 0.05$, el modelo candidato tiene menor error de forma estadísticamente significativa; si $DM > 0$ y $p < 0.05$, es significativamente peor que la referencia.

### 4.2. Métricas de Error de Predicción y Clasificación en Machine Learning
- **Regresión:**

$$MAE = \frac{1}{n}\sum_{t=1}^{n}|e_t|, \qquad MSE = \frac{1}{n}\sum_{t=1}^{n}e_t^2, \qquad RMSE = \sqrt{MSE}$$

$$MAPE = \frac{100}{n}\sum_{t=1}^{n}\left|\frac{e_t}{y_t}\right|, \qquad SMAPE = \frac{100}{n}\sum_{t=1}^{n}\frac{2|e_t|}{|y_t|+|\hat{y}_t|}, \qquad \text{Variance Score} = 1 - \frac{\mathrm{Var}(y-\hat{y})}{\mathrm{Var}(y)}$$

- **Clasificación:**

$$\text{Precision}_c = \frac{TP_c}{TP_c + FP_c}, \qquad \text{Recall}_c = \frac{TP_c}{TP_c + FN_c}, \qquad F_{1,c} = \frac{2\cdot\text{Precision}_c\cdot\text{Recall}_c}{\text{Precision}_c+\text{Recall}_c}, \qquad F_{1,\text{macro}} = \frac{1}{K}\sum_{c=1}^{K}F_{1,c}$$

- **K-Nearest Neighbors (KNN) con Distancia Euclidiana:** sobre las variables estandarizadas con `StandardScaler`:

$$d(x, x_i) = \sqrt{\sum_{j=1}^{p} (x_j - x_{ij})^2}, \qquad w_i = \frac{1}{d(x, x_i)}$$

### 4.3. Estrategia Técnica, Salidas ATR y Riesgo Operativo del Bot
1. **Bandas de Bollinger (20, 2σ) y Tendencia EMA 200:**

$$MA_{20,t} = \frac{1}{20}\sum_{i=0}^{19} C_{t-i}, \qquad \sigma_{20,t} = \sqrt{\frac{1}{20}\sum_{i=0}^{19}(C_{t-i}-MA_{20,t})^2}, \qquad BB_{\pm} = MA_{20,t} \pm 2\sigma_{20,t}$$

$$EMA_{200,t} = \alpha C_t + (1-\alpha)EMA_{200,t-1}, \quad \alpha = \frac{2}{201}$$

- **Entrada LONG:** $C_{t-1} < BB_{-,t-1}$ y $C_t \ge BB_{-,t}$ con $C_t > EMA_{200,t}$.
- **Entrada SHORT:** $C_{t-1} > BB_{+,t-1}$ y $C_t \le BB_{+,t}$ con $C_t \le EMA_{200,t}$.

2. **Average True Range (ATR) y Relación 5:1 de Salidas:**

$$TR_t = \max\!\big(H_t - L_t,\ |H_t - C_{t-1}|,\ |L_t - C_{t-1}|\big), \qquad ATR_{14,t} = \frac{1}{14}\sum_{i=0}^{13} TR_{t-i}$$

$$\text{Take Profit} = \text{Entrada} \pm 2.0\cdot ATR_{14}, \qquad \text{Stop Loss} = \text{Entrada} \mp 0.4\cdot ATR_{14}$$

$$WR^* = \frac{SL}{TP + SL} = \frac{0.4}{2.0 + 0.4} = 16.7\%, \qquad PF = \frac{\sum \text{Ganancias}}{\left|\sum \text{Pérdidas}\right|}$$

3. **Semáforo de Riesgo Bloqueante al 99%:**
   - **Criptomonedas (CAViaR 99%, límite 1.50%):** $q_t = 0.04 + 0.86\,q_{t-1} + 0.38\,|r_{t-1}|$
   - **Acciones (CVaR 99%, límite 2.20%):** $CVaR_{99\%} = -\mathbb{E}[r \mid r \le q_{0.01}(r)]$
   - **ETFs (VaR 99%, límite 1.50%):** $VaR_{99\%} = -q_{0.01}(r)$

### 4.4. Optimización Cuantitativa de Portafolios (Markowitz y Pearson)
- **Correlación de Pearson y Covarianza:**

$$\rho_{ij} = \frac{\mathrm{Cov}(r_i, r_j)}{\sigma_i \sigma_j}, \qquad \Sigma_{ij} = \rho_{ij}\sigma_i\sigma_j$$

- **Rendimiento esperado regularizado (50% ML / 50% histórico) y Ratios de Desempeño:**

$$\mu = 0.5\,\mu_{ML} + 0.5\,\mu_{\text{hist}}, \qquad \text{Sharpe} = \frac{w^\top \mu - R_f}{\sqrt{w^\top \Sigma w}}, \qquad \text{Sortino} = \frac{w^\top \mu - R_f}{\sqrt{\mathbb{E}[\min(r_p - R_f/252,\,0)^2]\cdot 252}}$$

---

## 5. Resultados Empíricos, Monte Carlo y Validación Estadística

### 5.1. Evolución del Bot y Simulaciones Monte Carlo (15,000 combinaciones)
El análisis de 15,000 combinaciones de estrategia, TP, SL y temporalidad sobre 9 criptomonedas (>1,400 millones de operaciones simuladas) demostró que buscar un porcentaje de aciertos alto llevaba a pérdidas:

| Etapa / Configuración | Aciertos (Win Rate) | Profit Factor | Resultado |
|---|---:|---:|---|
| 1. Código original | 46.0% | 0.95 | Pérdida gradual |
| 2. Versión "Win rate alto" (Fibonacci/SuperTrend, 21 ops en vivo) | 81.0%–89.5% | 0.46–0.87 | Ganancias diminutas (+$0.54) borradas por pérdidas (−$4.92) |
| 3. RSI con tendencia | 47.0% | 1.10 | Primera versión positiva |
| 4. Bollinger con tendencia (TP 1.5 / SL 0.5 ATR) | 33.0% | 1.54 | Fuerte mejora |
| 5. Bollinger + EMA 200 con filtro estricto RF (4 criptos, 229 ops) | 26.2% | 2.00 | Rentable pero pasaba hasta 15 h sin operar (9 ops/día en XRP) |
| **6. Versión final en vivo: Bollinger + EMA 200 sin bloqueo RF (XRP 1m, 133 ops)** | **24.8%** | **2.25** | **IC 95%: 1.36–3.38 · 22 ops/día · +70 USDT neto (9–15 nov)** |

Comparativa en XRP (1m, mismas salidas TP 2.0 / SL 0.4 ATR): **Bollinger con tendencia (1.67)** > Cruce de medias 50/200 (1.44) > Bollinger sin tendencia (1.17) > RSI (1.13) > Chartismo (0.99) > Fibonacci (0.98) > SuperTrend (0.75). En vivo tras activar la versión final de Bollinger, las primeras operaciones reales ya confirmaron la asimetría 5:1 (`−$0.23` y `−$0.22` en Stop Loss vs. `+$1.28` y `+$1.59` en Take Profit, **`PF > 6`**, **`+$2.42 USDT`**).

### 5.2. Validación ML Fuera de Muestra y Simulación de Hiperparámetros (Opción 3)
Prueba fuera de muestra en **BTC 1h (`h = 6`, 393 entrenamiento, 171 prueba, purga de `h` velas)**:

| Modelo | Árboles | Prof. | MAE ($) | MSE | RMSE ($) | DM vs. Caminata | p-valor |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Random Forest** | **50** | **4** | **645.91** | **770,094** | **877.55** | **+1.11** | **0.267** |
| Random Forest | 100 | 8 | 666.93 | 820,941 | 906.06 | +2.45 | 0.015 |
| Random Forest | 200 | 12 | 669.04 | 819,711 | 905.38 | +2.55 | 0.012 |
| CatBoost | 200 | 4 | 814.31 | 1,117,769 | 1,057.25 | +3.33 | 0.001 |

- **Random Forest vs. CatBoost:** `DM = −3.11 (p = 0.002)` — Random Forest supera significativamente a CatBoost.
- **Comparativa ATR vs. Random Forest para fijar TP/SL (4 criptos, 961 train / 962 test, 12 velas):**
  - Movimiento a favor: `ATR × 1.71` logra MAE `0.169%` vs. RF `0.196%` (`DM = +5.10, p < 0.001`).
  - Movimiento en contra: `ATR × 2.02` logra MAE `0.222%` vs. RF `0.235%` (`DM = +3.52, p < 0.001`).
  - **Conclusión de diseño:** Por evidencia estadística de Diebold-Mariano, las salidas se fijan con **ATR** y no con regresión RF; asimismo se eliminó el bloqueo de entradas RF (`PF 2.25`, `22 ops/día`, `+70 USDT`) conservando RF únicamente para escalar el apalancamiento a **x15 en XRP** ante alta convicción (`prob >= 50%` y `valor esperado >= 0.15%`).

### 5.3. Portafolio de Inversión (Opciones 1 y 2)
- Evaluado sobre series diarias (`~5` años, corte `2025-07-25`, 11,280 obs. train / 4,976 obs. test, purga de `20` días).
- Se muestran en la app todas las métricas exigidas: `Accuracy`, `F1` macro y `F1` por clase (`baja`, `media`, `alta`), matriz de confusión 3×3 y 2×2, `RMSE`, `MSE`, `MAE`, `MAPE`, `SMAPE`, `Variance Score`, `Sharpe`, `Sortino`, `VaR/CVaR 95%`, **Matriz de Correlación de Pearson** y comparación fuera de muestra frente al `S&P 500`.

---

## 6. Limitaciones y Líneas Futuras

1. El backtest intensivo en velas de 1 minuto abarca 1 semana (9–15 de noviembre de 2026) y **no incluye comisiones del exchange ni deslizamiento (*slippage*)**, lo cual se reporta explícitamente como limitación del estudio. Se recomienda extender la validación a múltiples meses e incorporar comisiones en simulaciones futuras.
2. En el dominio de velas de 1m–1h se verifica empíricamente la hipótesis de mercados eficientes en forma débil (ningún modelo ML supera de forma significativa a la caminata aleatoria en dirección pura), reforzando que la rentabilidad proviene de la gestión asimétrica de riesgo (`5:1` ATR), filtro de tendencia (`EMA 200`) y freno de cola (`CAViaR 99%`).

---

## 7. Referencias (APA 7)

- Bollinger, J. (2001). *Bollinger on Bollinger Bands*. McGraw-Hill.
- Breiman, L. (2001). Random forests. *Machine Learning, 45*(1), 5–32. https://doi.org/10.1023/A:1010933404324
- Diebold, F. X., & Mariano, R. S. (1995). Comparing predictive accuracy. *Journal of Business & Economic Statistics, 13*(3), 253–263. https://doi.org/10.1080/07350015.1995.10524599
- Engle, R. F., & Manganelli, S. (2004). CAViaR: Conditional autoregressive value at risk by regression quantiles. *Journal of Business & Economic Statistics, 22*(4), 367–381. https://doi.org/10.1198/073500104000000370
- Glasserman, P. (2003). *Monte Carlo methods in financial engineering*. Springer.
- Harvey, D., Leybourne, S., & Newbold, P. (1997). Testing the equality of prediction mean squared errors. *International Journal of Forecasting, 13*(2), 281–291. https://doi.org/10.1016/S0169-2070(96)00719-4
- Jorion, P. (2007). *Value at risk: The new benchmark for managing financial risk* (3a ed.). McGraw-Hill.
- López de Prado, M. (2018). *Advances in financial machine learning*. Wiley.
- Markowitz, H. (1952). Portfolio selection. *The Journal of Finance, 7*(1), 77–91.
- Murphy, J. J. (1999). *Technical analysis of the financial markets*. New York Institute of Finance.
- Tharp, V. K. (2008). *Van Tharp's definitive guide to position sizing*. International Institute of Trading Mastery.
- Wilder, J. W. (1978). *New concepts in technical trading systems*. Trend Research.
