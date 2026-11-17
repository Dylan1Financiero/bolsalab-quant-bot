# Guía Completa de Estudio, Funcionamiento Interno y Defensa Individual — BolsaLab & Bot Quant x10

> **Objetivo de este documento:** Que cualquier integrante del equipo pueda explicar de memoria, con seguridad y rigor matemático, **exactamente cómo funciona el bot por dentro, qué calcula cada indicador, cómo opera cada métrica de riesgo y Machine Learning, y responder sin titubear cualquier pregunta del profesor durante la defensa del 19 de noviembre de 2026.**

---

## 1. Arquitectura General y Flujo en Tiempo Real (¿Qué pasa cada minuto?)

El sistema completo consta de **4 piezas conectadas sin abrir puertos en el servidor**:

1. **Máquina Virtual en Google Cloud (Compute Engine · Ubuntu LTS):**
   - Ejecuta `vm/bot_trading.py` (`bot/bot_quant_x10_app.py`) las 24 horas en segundo plano en la VM (instalado con `vm/instalar_vm.sh`) y guarda los registros en `trading_bot.log`.
   - Corre **3 hilos simultáneos + un ciclo asíncrono de Telegram**:
     - `background_monitor`: revisa periódicamente si hubo cierres por TP/SL o si cerró una nueva vela para evaluar señal con `step_auto_trading()`.
     - `_fb_bucle_estado`: descarga velas de producción de Gate.io (cripto) o Yahoo Finance (acciones/ETFs) y publica en Firestore `bot/estado` (precio, señal, semáforo CAViaR, posición abierta, CPU/RAM de la VM, uptime) y `bot/velas` (últimas 300 velas).
     - `_fb_bucle_precios`: actualiza `mercado/precios` con los 28 activos del catálogo.
     - Listeners `on_snapshot`: escuchan en tiempo real `comandos/` (acciones enviadas desde la web: cambiar activo, temporalidad, estrategia, pausar/reanudar, abrir/cerrar posición o calcular Portafolio ML) y `consultas/` (preguntas al Analista IA Gemini).
2. **Gate.io Producción vs. Gate.io Futures Testnet:**
   - **Las velas para analizar SIEMPRE se descargan de Gate.io Producción (`api.gateio.ws`)**: el código explica explícitamente que el Testnet de Gate.io genera mechas falsas artificiales ("barcodes") que distorsionarían Bollinger, Chartismo y RSI.
   - **Las órdenes reales de prueba se ejecutan en Gate.io Futures Testnet (`api-testnet.gateapi.io`)** con apalancamiento `x10` (o `x15` en XRP alta convicción) usando margen base de **\$100 USDT** (\$1,000 nocional) y se registran con su ID de orden.
3. **Telegram (`python-telegram-bot`) + Espejo en Vivo:**
   - Todo lo que el bot responde o lo que el usuario pulsa en Telegram se intercepta con un hook (`instalar_espejo_telegram`) y se guarda en `telegram_espejo` para mostrarse **en vivo en la esquina derecha de la App Web**.
4. **Aplicación Web (`https://bolsalab-udem.web.app`):**
   - React + Vite + TradingView `lightweight-charts` + Firebase Auth + Firestore en tiempo real.

---

## 2. Los 6 Indicadores y Estrategias del Bot (Uno por Uno)

En el bot (`evaluate_strategy_signal`), puedes elegir entre **6 motores técnicos**. Al cambiar de vela cerrada (`df.iloc[-1]`), la estrategia evalúa `spot = float(last['close'])` contra la vela anterior (`prev = df.iloc[-2]`):

### 2.1. Bandas de Bollinger (20, 2σ) + Filtro de Tendencia EMA 200 *(Estrategia Activa Final)*
- **¿Qué son las Bandas de Bollinger (John Bollinger, 2001)?**
  Son un canal estadístico alrededor del precio basado en una media móvil simple de 20 períodos y dos desviaciones estándar:
  - Media central: $MA_{20} = \frac{1}{20}\sum_{i=0}^{19} C_{t-i}$
  - Banda Superior: $BB_{\text{sup}} = MA_{20} + 2\sigma_{20}$
  - Banda Inferior: $BB_{\text{inf}} = MA_{20} - 2\sigma_{20}$
  - Si los retornos fuesen aproximadamente normales, $\pm 2\sigma$ contiene ~95% de los precios recientes; cuando el precio sale de la banda y **regresa adentro**, detecta una sobre-extensión temporal (**reversión a la media**).
- **¿Qué es el filtro EMA 200?**
  Una Media Móvil Exponencial de 200 velas ($\alpha = \frac{2}{200+1}$) que representa la tendencia estructural mayor:
  - $EMA_t = \alpha C_t + (1 - \alpha) EMA_{t-1}$
  - Si $\text{Precio} > EMA_{200}$ el mercado está en tendencia alcista; si $\text{Precio} \le EMA_{200}$ está en tendencia bajista.
- **Regla exacta en código (`evaluate_strategy_signal`, modo `BOLLINGER`):**
  - **LONG:** `prev['close'] < prev['bb_dn']` AND `last['close'] >= last['bb_dn']` (reingreso desde abajo) **Y además** `spot > ema_200` (solo compra retrocesos en tendencia alcista).
  - **SHORT:** `prev['close'] > prev['bb_up']` AND `last['close'] <= last['bb_up']` (reingreso desde arriba) **Y además** `spot <= ema_200` (solo vende rebotes en tendencia bajista).
- **¿Por qué ganó esta estrategia frente a las demás?**
  En el backtest en las 4 criptos (1m):
  - **Bollinger a favor de EMA 200:** `PF 1.67` (XRP), `1.31` (ETH), `1.24` (SOL), `1.11` (BTC).
  - **Bollinger sin filtro EMA 200:** `PF 1.02` (XRP), `0.87` (ETH), `0.88` (BTC) — sin tendencia perdía dinero al atrapar "cuchillos cayendo".
  - **Versión final en XRP (sin filtro bloqueante del RF):** **`133` ops (22/día) · Win Rate `24.8%` · Profit Factor `2.25` · `+70 USDT`** (IC bootstrap 95%: `1.36 – 3.38`).

### 2.2. Fibonacci + Abanicos + Líneas de Velocidad + Gann
- **¿Qué es?** Usa la sucesión de Fibonacci ($0\%, 23.6\%, 38.2\%, 50.0\%, 61.8\%, 78.6\%, 100\%$) entre el mínimo (`lo`) y el máximo (`hi`) estructurales de las últimas 120 velas (`analyze_fibonacci`):
  - En impulso alcista (`ilo < ihi`): $\text{Nivel}(r) = \text{Max} - (\text{Max} - \text{Min}) \cdot r$
  - Además traza **Líneas de Velocidad** ($1/3$ y $2/3$ del rango desde el origen del impulso), **Abanico Clásico de 3 directrices** sobre pivotes crecientes/decrecientes y **Ángulos de Gann** (`1×1`, `1×2` al 50%, `1×4` al 75%).
- **Cómo genera señal en el código:**
  - `LONG` / `SHORT` cuando el precio cruza/rebota sobre la zona áurea **38.2%** o **61.8%**, o cuando rompe la **línea de velocidad 1/3** o la **3ª directriz del abanico**.
- **Resultado en validación:** En 1m dio `PF = 0.98` (y fue parte de las 21 ops de la Etapa 2 en vivo donde aciertos pequeños de `+$0.54` eran borrados por pérdidas de `−$4.92`). Por eso se sustituyó por Bollinger.

### 2.3. Chartismo Estructural v3.2 + Filtro Anti-Mechas + Filtro Anti-Clímax
- **Cómo limpia el ruido (`_structural_series`):** Antes de buscar figuras, calcula la mediana robusta de los cuerpos de vela para recortar mechas anómalas aisladas (> `2.0 × ATR`).
- **Cómo detecta patrones (`analyze_chartismo`):** Construye pivotes ZigZag causales (`_pivots`, excluyendo la vela abierta actual) y busca por orden de prioridad:
  1. **Hombro-Cabeza-Hombro (HCH) / HCH Invertido** (5 pivotes `HLHLH` o `LHLHL`, prioridad 95).
  2. **Doble Techo (M) / Doble Suelo (W)** (separación 10–65 velas, altura $\ge 2.0\text{ ATR}$, prioridad 90).
  3. **Canal de Tendencia R²** (ajuste por mínimos cuadrados con $R^2 \ge 0.78$ en $\le 24$ velas, prioridad 92).
  4. **Bandera Alcista / Bajista** (mástil previo $\ge 3.4\text{ ATR}$ en cierres, prioridad 86).
  5. **Cuña Ascendente / Descendente** (compresión al 22%–76% del vértice, prioridad 85).
  6. **Triángulos (Ascendente, Descendente, Simétrico)** (prioridades 78–82) y **Rectángulo Institucional** (prioridad 75).
- **Confirmación triple de ruptura (calibrada tras Monte Carlo):**
  Para no caer en rupturas falsas, exige: (1) dirección a favor de `EMA 200`, (2) vela de ruptura con cuerpo $\ge 0.6\text{ ATR}$, (3) volumen $\ge 1.2\times$ media(20), y **filtro anti-clímax RSI** (bloquea LONG si `RSI > 74` y SHORT si `RSI < 26`). Aun así, en 1m dio `PF 0.99`.

### 2.4. RSI (14) — Índice de Fuerza Relativa (Wilder, 1978)
- **Fórmula:** $RSI = 100 \cdot \frac{\text{Media Ganancias}(14)}{\text{Media Ganancias}(14) + \text{Media Pérdidas}(14)}$
- **Interpretación:** Mide el momentum reciente en escala `0–100`. $>70$ es sobrecompra; $<30$ es sobreventa.
- **Regla en el código:** Compra (`LONG`) solo al recuperar $30$ hacia arriba **y** estar sobre `EMA 200`; vende (`SHORT`) al perder $70$ hacia abajo **y** estar bajo `EMA 200`. Dio `PF 1.13` en XRP.

### 2.5. Cruce de Medias Exponenciales (EMA 50 / EMA 200)
- **Regla en el código:** **Golden Cross** (`EMA50` cruza arriba de `EMA200` → `LONG`) y **Death Cross** (`EMA50` cruza abajo de `EMA200` → `SHORT`).
- **Resultado:** `PF 1.44` en XRP, rentable pero genera muy pocas operaciones en comparación con Bollinger.

### 2.6. SuperTrend (10, 3.0) y el Papel Clave del ATR (14)
- **Average True Range (ATR):**
  $$TR_t = \max\big(H_t - L_t,\ |H_t - C_{t-1}|,\ |L_t - C_{t-1}|\big), \qquad ATR_{14} = \frac{1}{14}\sum TR$$
  Mide en dólares cuánto se mueve normalmente una vela incluyendo gaps.
- **SuperTrend:** Traza bandas a distancia $3.0 \times ATR_{10}$ del punto medio $(H+L)/2$. Cuando el cierre cruza la banda, cambia de dirección (`1` verde a `-1` rojo). Como estrategia de entrada dio el peor PF (`0.75`), pero **ATR(14) se convirtió en el motor matemático de salidas del bot**:
  $$\text{Take Profit} = \text{Entrada} \pm 2.0 \cdot ATR_{14}, \qquad \text{Stop Loss} = \text{Entrada} \mp 0.4 \cdot ATR_{14}$$

---

## 3. Gestión de Riesgo Cuantitativa: VaR, CVaR y CAViaR

El bot selecciona **automáticamente** el modelo de riesgo institucional según el tipo de activo (`evaluate_all_risks`, ventana de 150 velas):

1. **Criptomonedas $\rightarrow$ CAViaR 99% (Límite: `1.50%`) — Engle y Manganelli (2004):**
   $$q_t = 0.04 + 0.86\,q_{t-1} + 0.38\,|r_{t-1}|$$
   donde $q_t$ es el riesgo estimado en `%` y $|r_{t-1}|$ es la magnitud del último retorno porcentual.
   - **Por qué es superior para Cripto:** El VaR histórico tradicional da el mismo peso a hace 149 velas que a hace 1 vela; si Bitcoin/XRP sufre una sacudida brusca ahora mismo, `0.38 × |r_{t-1}|` dispara el `CAViaR` en segundos y el **semáforo rojo bloquea nuevas entradas** antes de que el bot opere en pánico.
2. **Acciones EE.UU. $\rightarrow$ CVaR 99% / Expected Shortfall (Límite: `2.20%`):**
   $$CVaR_{99\%} = -\mathbb{E}[\,r \mid r \le q_{0.01}(r)\,]$$
   Promedia **todas** las pérdidas en el peor 1% de la distribución histórica (cola izquierda). A diferencia del VaR, captura la severidad del cisne negro.
3. **ETFs (y cartera en Portafolio al 95%) $\rightarrow$ VaR Histórico (Límite: `1.50%` al 99%):**
   $$VaR_{99\%} = -\text{Percentil}_{1\%}(r)$$
   Marca el umbral de pérdida que solo es superado en el 1% de las velas (o 5% de los días en Portafolio: *"en 1 de cada 20 días malos podrías perder \$X"*).

### Relación Matemática Profit Factor, Win Rate de Equilibrio y Geometría 5:1
- **Margen y Apalancamiento:** \$100 USDT por orden a `x10` (\$1,000 nocional). Liquidación teórica al ±9% (`0.9 / lev`), mientras el Stop Loss está topado en `6.5%` (siempre se ejecuta el SL antes que la liquidación).
- **Apalancamiento Dinámico en XRP (`LEV_DINAMICO = True`):** Si `Asset == XRP_USDT` y el clasificador Random Forest marca probabilidad a favor $\ge 50\%$ y Valor Esperado $(p_{\text{fav}}\cdot\text{rec}_{\text{fav}} - p_{\text{adv}}\cdot\text{rec}_{\text{adv}}) \ge 0.15\%$, el bot sube automáticamente de `x10` a **`x15`** (\$1,500 nocional).
- **Win Rate de equilibrio ($WR^*$):**
  $$WR^* = \frac{SL}{TP + SL} = \frac{0.4}{2.0 + 0.4} = \frac{0.4}{2.4} = 16.7\%$$
  Si aciertas más del 16.7% (y el bot en XRP acierta **24.8%**, y en vivo **50%** hasta ahora), la esperanza matemática es positiva porque **1 acierto cubre 5 pérdidas**.
- **Profit Factor ($PF$):**
  $$PF = \frac{\sum \text{Ganancias}}{\left|\sum \text{Pérdidas}\right|}$$
  En `BotView` / `CentroResultadosBot` el ROI de cada trade es **ROE sobre margen de \$100 USDT** (por eso `+$1.59` equivale a `+1.59% ROE`).

---

## 4. Machine Learning, Validación Estadística y Portafolios

### 4.1. Por qué quitamos el filtro del Random Forest pero conservamos el modelo en el bot
1. **Validación de precios (`BTC 1h, h=6`, 393 train / 171 test):**
   - `Random Forest (50 árboles, prof 4)`: MAE `$645.91`, RMSE `$877.55`, DM `+1.11` (`p = 0.267`).
   - Más complejidad (`100/8`, `200/12`, `CatBoost 200/4`) empeoró el error (`RMSE $906` / `$1,057`, sobreajuste).
   - **RF vs. CatBoost:** `DM = −3.11` (`p = 0.002`) $\rightarrow$ Random Forest es estadísticamente superior a CatBoost.
   - **RF vs. Caminata Aleatoria:** `DM = +1.11` (`p = 0.267`) $\rightarrow$ No hay evidencia estadística de que el ML venza al precio ingenuo ("mañana igual que hoy").
2. **Validación de recorrido TP/SL (4 criptos, 961 train / 962 test, 12 velas):**
   - Contra `ATR × 1.71` (a favor) y `ATR × 2.02` (en contra), el RF tuvo mayor MAE con significancia `DM = +5.10 (p < 0.001)` y `DM = +3.52 (p < 0.001)`. Por eso **el ATR fija el TP/SL**.
3. **Comparativa del Filtro RF en XRP (1m, TP 2.0 / SL 0.4 ATR):**
   - Filtro estricto (`CONFIRMA`): `58` ops (9/día), WR `32.8%`, PF `3.53`, Neto `+$59` (pasaba hasta 15h sin operar).
   - Filtro Veto: `97` ops (16/día), WR `28.9%`, PF `2.63`, Neto `+$64`.
   - **Sin filtro (versión final activa):** `133` ops (22/día), WR `24.8%`, PF `2.25`, Neto **`+$70`** (casi el doble de operaciones y mayor ganancia neta; en las 4 criptos: `491` ops, `PF 1.64`), y el RF sigue midiendo probabilidad/valor esperado para escalar a **x15 en XRP**.

### 4.2. Fórmulas de Evaluación ML y Diebold-Mariano
- $MAE = \frac{1}{n}\sum |e_t|$, $\quad MSE = \frac{1}{n}\sum e_t^2$, $\quad RMSE = \sqrt{MSE}$
- $MAPE = \frac{100}{n}\sum \left|\frac{e_t}{y_t}\right|$, $\quad SMAPE = \frac{100}{n}\sum \frac{2|e_t|}{|y_t| + |\hat{y}_t|}$
- $\text{Variance Score} = 1 - \frac{\text{Var}(y - \hat{y})}{\text{Var}(y)}$
- $\text{Precision} = \frac{TP}{TP+FP}$, $\quad \text{Recall} = \frac{TP}{TP+FN}$, $\quad F_1 = \frac{2 \cdot P \cdot R}{P + R}$
- **Prueba de Diebold-Mariano (con corrección de Harvey et al., 1997):**
  $$d_t = e_{\text{modelo},t}^2 - e_{\text{ingenuo},t}^2, \qquad DM = \frac{\bar{d}}{\sqrt{\widehat{V}(\bar{d})}}$$
  - **$DM < 0$ y $p < 0.05$:** El modelo tiene error cuadrático significativamente **menor** (mejor que el ingenuo).
  - **$DM > 0$ y $p < 0.05$:** El modelo es significativamente **peor** que el ingenuo.
  - **$p \ge 0.05$:** Empate estadístico (no se rechaza $H_0$ de igual precisión).

### 4.3. Portafolio de Inversión (Opciones 1, 2, 5 y 6.2)
- **Panel Diario (17 variables técnicas):** retornos a `1, 5, 20, 60, 120` días, volatilidades `5, 20, 60`, `vol_ratio`, `RSI 14`, distancia a `SMA 50/200`, `drawdown 60`, retorno/volatilidad de mercado (`SPY`), `beta 60` y dummy `es_cripto`.
- **KNN con Distancia Euclidiana:** Escala variables con `StandardScaler` y calcula $d(x, x_i) = \sqrt{\sum_{j=1}^{17}(x_j - x_{ij})^2}$ ponderando vecinos por `1 / d` (`weights='distance'`).
- **Optimización de Markowitz y Matriz de Correlación de Pearson ($\rho_{ij}$):**
  - El rendimiento esperado mezcla **50% predicción ML + 50% promedio histórico** ($\mu_{\text{usado}} = 0.5\,\mu_{ML} + 0.5\,\mu_{\text{hist}}$) para reducir sensibilidad extrema a errores de pronóstico.
  - La covarianza entre activos es $\Sigma_{ij} = \rho_{ij}\sigma_i\sigma_j$, donde $\rho_{ij} \in [-1, 1]$ es el coeficiente de correlación de Pearson: al incluir activos con baja o negativa correlación (ej. bonos `TLT`, oro `GLD`) frente a acciones tech o cripto, se reduce la volatilidad total del portafolio ($\sigma_p = \sqrt{w^\top \Sigma w}$).
  - Calcula las 5 carteras (**Recomendada**, **Máximo Sharpe**, **Mínima varianza**, **Paridad de riesgo**, **Pesos iguales 1/N**) usando **Sharpe Ratio** $= \frac{R_p - R_f}{\sigma_p}$ (con tasa libre de riesgo del T-Bill `^IRX` a 13 semanas) y **Sortino Ratio** $= \frac{R_p - R_f}{\sigma_{\text{down}}}$.

---

## 5. Checklist Antes de Entrar al Salón (Para Asegurar Cero Penalizaciones)

Ejecuta esta verificación **30 minutos antes de exponer** (`−15 pts` si falla VM/Telegram en vivo, `−10 pts` si falla una API Key):
1. Conéctate a la VM y verifica que el proceso/servicio está activo y prueba credenciales con `--verificar`:
   ```bash
   python3 bot_trading.py --verificar
   ```
   Confirma `OK` en: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `XAI_API_KEY`, `Testnet Gate`, `Firebase / Firestore`.
2. Abre `https://bolsalab-udem.web.app` e inicia sesión con una cuenta lista:
   - Revisa que en el header diga **`● Bot en línea`** (verde).
   - Abre **`Trading (bot)`**: verifica gráfica de velas de `XRP/USDT (1m)`, bandas de Bollinger activas, espejo de Telegram con los mensajes recientes y las operaciones reales de Bollinger en `Resultados`.
   - Abre **`Portafolio`**: ten ya calculado un portafolio para mostrar los 3 pasos sin esperar cálculo, o muestra el botón **`Ver todo`**.
   - Abre **`Analista IA`**: haz 1 pregunta de prueba para verificar que la cuota de Gemini responde en ~3 segundos.
3. Ten abierto **Telegram** en el celular o computadora para enviar `/vm` o pulsar **`📊 Reporte Pro + Gráfico Dark`** en vivo ante el profesor y ver cómo aparece al instante tanto en Telegram como en el espejo de la app web.

---

## 6. Banco de 20 Preguntas Probables del Profesor (con Respuesta Directa)

1. **¿Qué hace exactamente tu bot en la VM y dónde corre?**  
   Corre 24/7 como servicio `systemd` en Google Cloud Compute Engine (`bot_trading.py`), descarga velas reales de Gate.io Producción y Yahoo Finance, evalúa Bandas de Bollinger + EMA 200 al cierre de cada vela, verifica riesgo CAViaR/CVaR/VaR 99%, ejecuta órdenes en Gate.io Futures Testnet y sincroniza en tiempo real con Telegram y Firebase Firestore.
2. **¿Por qué usan Gate.io Producción para analizar velas y Testnet solo para ejecutar órdenes?**  
   Porque las velas del Testnet tienen poca liquidez y generan mechas artificiales ("barcodes") que dispararían señales falsas; por eso leemos precios reales de producción y mandamos las órdenes al Testnet para probar ejecución sin arriesgar capital real.
3. **Explícame qué son las Bandas de Bollinger y cómo entra tu bot.**  
   Son $\text{Media}(20) \pm 2\sigma_{20}$. Si la vela anterior cierra fuera de la banda y la vela actual reingresa dentro, hay señal de reversión a la media, pero **solo** operamos si el precio está a favor de la `EMA 200` (arriba para LONG, abajo para SHORT).
4. **¿Por qué filtran con EMA 200?**  
   En nuestro backtest sobre 4 criptos, Bollinger con filtro EMA 200 dio Profit Factor `1.67` en XRP, `1.31` en ETH y `1.24` en SOL; sin el filtro bajaba a `1.02`, `0.87` y `0.88` respectivamente porque compraba rebotes en plena caída libre.
5. **¿Cómo gana dinero el bot si su Win Rate es 24.8% (falla 3 de cada 4 trades)?**  
   Por la geometría 5:1 (`TP = 2.0 ATR`, `SL = 0.4 ATR`). El equilibrio es $WR^* = 0.4 / 2.4 = 16.7\%$. Cada acierto paga 5 veces una pérdida, generando `PF = 2.25` en XRP (IC 95% bootstrap: `1.36 a 3.38`).
6. **¿Por qué tenían 21 operaciones viejas con 81% Win Rate y aun así perdían (-$10.57)?**  
   Eran de nuestra Etapa 2 (Fibonacci/SuperTrend con TP corto ~0.05%). Ganaban +$0.54 promedio pero cuando tocaban Stop Loss perdían -$4.92 (`PF = 0.46`). Eso motivó nuestras 15,000 simulaciones Monte Carlo y el cambio a Bollinger + EMA 200. En vivo con Bollinger ya llevamos operaciones ganando más por acierto que por error (`+$1.28` / `+$1.59` vs `−$0.22` / `−$0.23`).
7. **¿Por qué quitaron el filtro del Random Forest para entrar, y entonces para qué sirve el ML en el bot?**  
   Primero, porque Diebold-Mariano mostró que RF supera a CatBoost (`DM −3.11, p=0.002`) pero no a la caminata aleatoria (`DM +1.11, p=0.27`), y el filtro bloqueante dejaba al bot operando solo ~9 veces/día (hasta 15 h en espera). Sin bloqueo opera 22 veces/día en XRP con `PF 2.25` y `+70 USDT`. Segundo, el RF **sí sigue activo** para decidir cuándo subir el apalancamiento a `x15` en XRP si la probabilidad es $\ge 50\%$ y el valor esperado $\ge 0.15\%$.
8. **¿Cómo se calcula el CAViaR y por qué lo usan solo en cripto?**  
   $q_t = 0.04 + 0.86 q_{t-1} + 0.38 |r_{t-1}|$. Es autorregresivo: reacciona al instante ante un choque reciente $|r_{t-1}|$ en cripto (que cotiza 24/7 y sufre colapsos súbitos), bloqueando entradas si supera `1.50%`. En acciones usamos CVaR 99% (lím. `2.20%`) y en ETFs VaR 99% (lím. `1.50%`).
9. **¿Qué diferencia hay entre VaR y CVaR?**  
   VaR es el umbral de pérdida en el peor 1% (o 5%) de los días; no dice qué tan grave es la pérdida si se rebasa ese umbral. CVaR (Expected Shortfall) promedia **todas** las pérdidas peores que ese umbral.
10. **¿Qué significa que un modelo tenga DM negativo y p < 0.05?**  
    Que la diferencia cuadrática de errores ($e_{\text{modelo}}^2 - e_{\text{ingenuo}}^2$) es negativa en promedio y estadísticamente significativa al 95%: el modelo sí pronostica mejor que el modelo ingenuo. Si DM es positivo y $p < 0.05$, es significativamente peor.
11. **En Portafolio Opción 1, ¿por qué BTC con 51% de volatilidad puede salir como régimen BAJO y el Oro con 19% como ALTO?**  
    Porque el clasificador evalúa el régimen **relativo a los propios terciles históricos de cada activo** (comparando BTC hoy contra la historia de BTC, y Oro hoy contra la historia del Oro). Además mostramos la volatilidad absoluta anual en la columna contigua y aplicamos topes duros a cripto (5%–30%).
12. **¿Cómo usan KNN en Portafolios?**  
    Estandarizando las 17 variables con `StandardScaler` y midiendo cercanía con **Distancia Euclidiana** $d(x, x_i) = \sqrt{\sum (x_j - x_{ij})^2}$ ponderada por distancia inversa (`weights='distance'`) en clasificación (50 vecinos) y regresión (100 vecinos).
13. **¿Por qué mezclan 50% predicción ML + 50% rendimiento histórico en Markowitz?**  
    Porque los optimizadores de Markowitz puros son hipersensibles a variaciones pequeñas en los rendimientos esperados ($\mu$). Combinar 50% ML + 50% histórico actúa como regularización tipo Black-Litterman/shrinkage evitando pesos extremos irreales.
14. **¿Para qué sirve la Matriz de Correlación de Pearson en Portafolios?**  
    Mide qué tan sincronizados se mueven dos activos ($\rho_{ij} \in [-1, +1]$). Markowitz usa $\Sigma_{ij} = \rho_{ij}\sigma_i\sigma_j$ para combinar activos descorrelacionados o con correlación negativa (como bonos `TLT` frente a acciones/cripto) y reducir el riesgo total sin sacrificar retorno.
15. **¿Cuál es la diferencia entre Sharpe y Sortino?**  
    Sharpe divide el rendimiento excedente sobre la tasa libre de riesgo (`^IRX`) entre toda la volatilidad ($\sigma$ subida y bajada). Sortino solo penaliza la desviación negativa (volatilidad a la baja $\sigma_{\text{down}}$), premiando portafolios que tienen saltos positivos grandes y caídas acotadas.
16. **¿Qué es la purga temporal (`cut - h`) al entrenar el ML?**  
    Como nuestro horizonte de predicción es $h=6$ velas en el bot (o $h=20$ días en Portafolio), dejamos un espacio de $h$ observaciones entre el fin del set de entrenamiento y el inicio del test para que las etiquetas futuras del train no se traslapen con el test (**sin data leakage**).
17. **¿Por qué usan temporalidad diaria en Portafolio (Opciones 1 y 2) pero 1 minuto en el Bot (Opción 3)?**  
    En horizontes de 5–15 min el precio sigue casi una caminata aleatoria dominada por ruido microestructural (ideal solo para estrategias técnicas rápidas como reversión a Bollinger con ATR). En cambio, para predecir regímenes de volatilidad a 20 días y optimizar asignación de activos de mediano/largo plazo, la serie diaria captura ciclos macroeconómicos, betas y correlaciones sin ruido de alta frecuencia.
18. **¿Qué pasa si una vela toca tanto el Take Profit como el Stop Loss al mismo tiempo?**  
    En `step_auto_trading` aplicamos el criterio conservador/pesimista tanto en backtest como en monitoreo: evaluamos primero `liq`, luego `sl` y por último `tp`, de modo que ante ambigüedad dentro de la misma vela se asume la pérdida.
19. **¿Cómo se implementa Fibonacci y qué son las líneas de velocidad y Gann en tu bot?**  
    Calcula los retrocesos clásicos (23.6% a 78.6%) desde los extremos estructurales de 120 velas y traza rectas desde el punto de origen hasta los puntos 1/3 y 2/3 de corrección (líneas de velocidad), 3 directrices sucesivas (abanico 1-2-3) y pendientes de Gann (`1×1`, `1×2`, `1×4`).
20. **¿Cómo funciona la integración con Gemini y Grok?**  
    En el **Analista IA**, React crea un documento en `consultas/{id}` con el contexto real de la cuenta del usuario o del estado del bot; la VM lo lee vía `on_snapshot`, llama a la API oficial `google-genai` (`gemini-3.5-flash` con fallback a `2.5-flash`) y escribe la respuesta en tiempo real. Por separado, en Telegram el módulo de sentimiento consulta a **Grok (xAI)** ponderando `50%` comunidad en X, `35%` medios financieros y `15%` fuentes oficiales para generar una tarjeta visual con velocímetro.
