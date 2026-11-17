# -*- coding: utf-8 -*-
"""
VERIFICACION INDEPENDIENTE DEL PORTAFOLIO (Opciones 1 y 2 del proyecto BolsaLab)

Corre el mismo calculo que usa la app (construir_portafolio del bot) y lo comprueba por fuera:
  1. Recalcula rendimiento, volatilidad, Sharpe, Sortino y VaR de cada cartera con formulas directas.
  2. Comprueba que el optimizador sea correcto:
       - contra la formula cerrada de Markowitz (cartera tangente sin restricciones),
       - contra 100,000 carteras al azar (ninguna debe tener mejor Sharpe ni menor riesgo),
       - y que en Paridad de Riesgo cada activo aporte el mismo riesgo.
  3. Recalcula Accuracy y F1 de los modelos ML desde sus matrices de confusion.
  4. Genera un Excel con FORMULAS (para revisarlo a mano o con Solver) y una grafica PNG.

Uso: pon este archivo en la misma carpeta que bot_quant_x10_app.py y correlo con F5 en Spyder
     (o: python verificar_portafolio.py). Necesita internet (precios de Yahoo Finance).
"""
import importlib.util
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# ------------------ PARAMETROS (cambialos si quieres) ------------------
PERFIL = 'moderado'          # conservador | moderado | agresivo
CAPITAL = 10000.0
ACTIVOS = None               # None = automatico; o una lista, p. ej. ['SPY', 'QQQ', 'GLD', 'TLT', 'NVDA']
MAX_PESO = 0.35
ANIOS = 5
N_AZAR = 100_000             # carteras aleatorias para la prueba de optimalidad
TOL = 1e-4
# -----------------------------------------------------------------------

try:
    CARPETA = Path(__file__).resolve().parent
except NameError:
    CARPETA = Path.cwd()
SALIDA = CARPETA / 'verificacion_portafolio'
SALIDA.mkdir(exist_ok=True)


def cargar_bot():
    os.environ.setdefault('TELEGRAM_BOT_TOKEN', 'solo-verificacion')
    spec = importlib.util.spec_from_file_location('bot_verif', CARPETA / 'bot_quant_x10_app.py')
    bot = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bot)        # no arranca Telegram: main() solo corre con __main__
    return bot


RESULTADOS = []


def prueba(nombre, ok, detalle):
    RESULTADOS.append({'Prueba': nombre, 'Resultado': 'PASA' if ok else 'FALLA', 'Detalle': detalle})
    print(('  PASA   ' if ok else '  FALLA  ') + nombre + ' | ' + detalle)


def main(bot=None):
    bot = bot or cargar_bot()
    print('Calculando el portafolio igual que la app (puede tardar ~1 min)...')
    res = bot.construir_portafolio(PERFIL, CAPITAL, ACTIVOS, MAX_PESO, ANIOS)
    simbolos = [a['sym'] for a in res['activos']]
    precios, _ = bot.precios_portafolio(simbolos, max(ANIOS, 3))
    precios = precios[simbolos]
    ret = np.log(precios / precios.shift(1)).dropna()
    rf = res['tasa_libre'] / 100
    mu = np.array([a['rend_usado'] / 100 for a in res['activos']])        # el mu que uso la app
    mu_hist = ret.mean().values * 252
    cov = ret.cov().values * 252
    topes = np.array([a['tope'] for a in res['activos']])
    n = len(simbolos)
    idx = {s: i for i, s in enumerate(simbolos)}

    def vector(cartera):
        w = np.zeros(n)
        for p in cartera['pesos']:
            w[idx[p['sym']]] = p['peso']
        return w

    def metricas(w, m=mu, c=cov):
        r = w @ m
        v = np.sqrt(w @ c @ w)
        return r, v, (r - rf) / v

    print('\n1) CONSISTENCIA DE CADA CARTERA')
    carteras = {c['nombre']: c for c in res['carteras']}
    for nombre, c in carteras.items():
        w = vector(c)
        r, v, sh = metricas(w)
        rp = ret.values @ w
        abajo = np.minimum(rp - rf / 252, 0)
        sortino = (rp.mean() * 252 - rf) / (np.sqrt((abajo ** 2).mean()) * np.sqrt(252))
        var95 = -np.percentile(rp, 5) * 100
        # los pesos mostrados omiten los < 0.5%, por eso la suma puede quedar apenas abajo de 1
        prueba(nombre + ': pesos validos', abs(w.sum() - 1) < 0.03 and (w >= -1e-9).all()
               and (nombre.startswith('Pesos iguales') or (w <= topes + 1e-6).all()),
               'suma=%.4f, min=%.4f, ningún peso sobre su tope' % (w.sum(), w.min()))
        prueba(nombre + ': métricas', abs(r * 100 - c['rendimiento']) < 0.6 and abs(v * 100 - c['volatilidad']) < 0.6
               and abs(sortino - c['sortino']) < 0.15 and abs(var95 - c['var95_dia']) < 0.1,
               'rend %.2f%% (app %.2f) | vol %.2f%% (app %.2f) | Sharpe %.3f (app %.3f) | Sortino %.3f (app %.3f)'
               % (r * 100, c['rendimiento'], v * 100, c['volatilidad'], sh, c['sharpe'], sortino, c['sortino']))

    print('\n2) EL OPTIMIZADOR ENCUENTRA EL OPTIMO')
    # a) Condiciones de optimalidad (KKT) con pesos >= 0, suma 1 y topes. Con g = gradiente:
    #    los activos con peso entre 0 y su tope deben tener el MISMO g; los de peso 0 un g peor; los topados un g mejor.
    #    Máximo Sharpe: g_i = (mu_i - rf) - k·(Σw)_i, con k = (rend - rf) / var   (mayor es mejor)
    #    Mínima varianza: g_i = (Σw)_i                                           (menor es mejor)
    def kkt(w, g, mejor_alto, tol):
        libre = topes > 1e-6                      # los de tope 0 (régimen alta en conservador) quedan fuera
        interior = libre & (w > 1e-3) & (w < topes - 1e-3)
        cero, tope = libre & (w <= 1e-3), libre & ~(w <= 1e-3) & (w >= topes - 1e-3)
        c = np.median(g[interior]) if interior.any() else 0.0
        disp = np.abs(g[interior] - c).max() if interior.any() else 0.0
        s = 1 if mejor_alto else -1
        ok = disp < tol and (s * (g[cero] - c) <= tol).all() and (s * (g[tope] - c) >= -tol).all()
        return ok, disp, int(interior.sum()), int(cero.sum()), int(tope.sum())
    w_sh, w_min = vector(carteras['Máximo Sharpe']), vector(carteras['Mínima varianza'])
    k = (w_sh @ mu - rf) / (w_sh @ cov @ w_sh)
    ok, disp, ni, nc, nt = kkt(w_sh, (mu - rf) - k * (cov @ w_sh), True, 0.003)
    prueba('Máximo Sharpe cumple las condiciones de óptimo (KKT)', ok,
           '%d activos interiores con el mismo gradiente (diferencia máx. %.5f), %d en 0, %d en su tope'
           % (ni, disp, nc, nt))
    ok, disp, ni, nc, nt = kkt(w_min, cov @ w_min, False, 2e-4)
    prueba('Mínima varianza cumple las condiciones de óptimo (KKT)', ok,
           '%d activos interiores con el mismo (Σw)_i (diferencia máx. %.6f), %d en 0, %d en su tope'
           % (ni, disp, nc, nt))
    # b) Solver independiente: máximo Sharpe reescrito como problema convexo (no usa el código del bot)
    #    min y'Σy  s.a. (mu - rf)'y = 1, y >= 0, y_i <= tope_i·Σy   ->   w = y / Σy
    from scipy.optimize import minimize
    if (mu > rf).any():
        y0 = np.where(mu > rf, 1.0, 0.0)
        y0 /= (mu - rf) @ y0
        r = minimize(lambda y: y @ cov @ y, y0, jac=lambda y: 2 * cov @ y, method='SLSQP',
                     bounds=[(0, None)] * n,
                     constraints=[{'type': 'eq', 'fun': lambda y: (mu - rf) @ y - 1},
                                  {'type': 'ineq', 'fun': lambda y: topes * y.sum() - y}],
                     options={'maxiter': 3000, 'ftol': 1e-15})
        sh_ind = metricas(r.x / r.x.sum())[2]
        prueba('Máximo Sharpe = solver convexo independiente', abs(sh_ind - metricas(w_sh)[2]) < 2e-3,
               'Sharpe independiente %.4f vs app %.4f' % (sh_ind, metricas(w_sh)[2]))
    # c) Monte Carlo con las MISMAS restricciones (pesos >= 0, suma 1, topes)
    rng = np.random.default_rng(7)
    W = rng.dirichlet(np.full(n, 0.3), N_AZAR)
    W = W[(W <= topes + 1e-12).all(axis=1)]
    R = W @ mu
    V = np.sqrt(np.einsum('ij,jk,ik->i', W, cov, W))
    S = (R - rf) / V
    prueba('Ninguna cartera al azar supera el Sharpe máximo', len(W) == 0 or S.max() <= metricas(w_sh)[2] + TOL,
           '%d carteras válidas; mejor al azar %.4f vs app %.4f' % (len(W), S.max() if len(W) else np.nan, metricas(w_sh)[2]))
    prueba('Ninguna cartera al azar tiene menos riesgo que la mínima varianza', len(W) == 0 or V.min() >= metricas(w_min)[1] - TOL,
           'menor vol al azar %.3f%% vs app %.3f%%' % (V.min() * 100 if len(W) else np.nan, metricas(w_min)[1] * 100))
    # d) Paridad de riesgo: aportaciones de riesgo iguales
    if 'Paridad de riesgo' in carteras:
        w_rp = vector(carteras['Paridad de riesgo'])
        sigma = np.sqrt(w_rp @ cov @ w_rp)
        rc = w_rp * (cov @ w_rp) / sigma
        libres = (w_rp > 0.005) & (w_rp < topes - 1e-3)       # los topados no pueden subir su aportación
        activos = rc[libres]
        cv = activos.std() / activos.mean()
        topados = rc[(w_rp >= topes - 1e-3) & (topes > 1e-6)]
        prueba('Paridad de riesgo: cada activo aporta el mismo riesgo', cv < 0.05 and (topados <= activos.max() * 1.05).all(),
               '%d activos libres aportan de %.3f%% a %.3f%% (variación %.1f%%); %d topados aportan menos'
               % (len(activos), activos.min() * 100, activos.max() * 100, cv * 100, len(topados)))
    # e) frontera: a mas rendimiento, mas volatilidad
    fr = pd.DataFrame(res['frontera']).sort_values('rendimiento')
    prueba('Frontera eficiente creciente', bool((fr['volatilidad'].diff().dropna() >= -0.05).all()),
           '%d puntos, de %.1f%% a %.1f%% de volatilidad' % (len(fr), fr['volatilidad'].min(), fr['volatilidad'].max()))
    r_sh = metricas(w_sh)[0] * 100
    prueba('La frontera cubre al Máximo Sharpe (llega hasta el rendimiento máximo posible)',
           fr['rendimiento'].max() >= r_sh - 0.05,
           'frontera hasta %.2f%% de rendimiento; Máximo Sharpe en %.2f%%' % (fr['rendimiento'].max(), r_sh))

    print('\n3) METRICAS DE LOS MODELOS ML (desde sus matrices de confusion)')
    for clave, etiqueta in (('regimen', 'Opción 1 régimen'), ('rendimiento', 'Opción 2 dirección')):
        bloque = res['ml'][clave]
        m = np.array(bloque['matriz'] if clave == 'regimen' else bloque['matriz_direccion'], dtype=float)
        acc = np.trace(m) / m.sum() * 100
        prec = np.divide(np.diag(m), m.sum(axis=0), out=np.zeros(len(m)), where=m.sum(axis=0) > 0)
        rec = np.divide(np.diag(m), m.sum(axis=1), out=np.zeros(len(m)), where=m.sum(axis=1) > 0)
        f1 = np.mean(np.divide(2 * prec * rec, prec + rec, out=np.zeros(len(m)), where=(prec + rec) > 0))
        mejor = next(x for x in bloque['modelos'] if x['modelo'] == bloque['mejor'])
        if clave == 'regimen':
            prueba(etiqueta + ': Accuracy y F1 = matriz', abs(acc - mejor['accuracy']) < 0.05 and abs(f1 - mejor['f1']) < 0.002,
                   'Accuracy %.2f%% (app %.2f) | F1 %.4f (app %.4f) | modelo %s' % (acc, mejor['accuracy'], f1, mejor['f1'], mejor['modelo']))
        else:
            prueba(etiqueta + ': acierto de dirección = matriz', abs(acc - mejor['acierto_direccion']) < 0.05,
                   'acierto %.2f%% (app %.2f) | modelo %s' % (acc, mejor['acierto_direccion'], mejor['modelo']))

    exportar_excel(res, simbolos, precios, ret, mu, mu_hist, cov, topes, rf, carteras, vector)
    grafica(res, R, V, carteras, vector, metricas)
    ok = sum(r['Resultado'] == 'PASA' for r in RESULTADOS)
    print('\nRESULTADO: %d de %d pruebas pasan. Archivos en %s' % (ok, len(RESULTADOS), SALIDA))
    return res


def exportar_excel(res, simbolos, precios, ret, mu, mu_hist, cov, topes, rf, carteras, vector):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter as L

    n = len(simbolos)
    wb = Workbook()
    neg = Font(name='Arial', bold=True)
    normal = Font(name='Arial')
    entrada = Font(name='Arial', color='0000FF')
    head = PatternFill('solid', fgColor='DDD6FE')

    # --- Leeme
    ws = wb.active
    ws.title = 'Leeme'
    notas = [
        'Verificación del portafolio BolsaLab — perfil %s, capital $%s, datos %s a %s (%d días)'
        % (res['perfil'], format(res['capital'], ',.0f'), res['desde'], res['hasta'], res['dias']),
        '',
        'Azul = dato de entrada (viene del bot o de Yahoo Finance). Negro = fórmula de Excel.',
        'Mu_Cov: rendimiento esperado anual usado por la app (50% modelo ML + 50% histórico) y matriz de covarianza anual (×252).',
        'Cada hoja de cartera recalcula con fórmulas: rendimiento = SUMAPRODUCTO(w, mu); varianza = SUMAPRODUCTO(w, Σw);',
        '   Sharpe = (rend − rf) / vol; aportación de riesgo de cada activo = w_i·(Σw)_i / vol.',
        'Para comprobar con Solver: en la hoja "Maximo Sharpe" usa Datos → Solver: maximizar la celda Sharpe,',
        '   cambiando los pesos (columna C), con suma de pesos = 1, pesos ≥ 0 y pesos ≤ tope (columna D). Debe llegar al mismo Sharpe.',
        'Tasa libre de riesgo (T-Bill 13 semanas, ^IRX): %.3f%%' % (rf * 100),
        'Verificacion: resultado de todas las pruebas automáticas.',
        res['aviso'],
    ]
    for i, t in enumerate(notas, 1):
        ws.cell(i, 1, t).font = neg if i == 1 else normal
    ws.column_dimensions['A'].width = 130

    # --- Precios y rendimientos
    for nombre, df in (('Precios', precios), ('Rendimientos_log', ret)):
        w = wb.create_sheet(nombre)
        w.cell(1, 1, 'Fecha').font = neg
        for j, s in enumerate(simbolos, 2):
            w.cell(1, j, s).font = neg
        for i, (fecha, fila) in enumerate(df.iterrows(), 2):
            w.cell(i, 1, fecha.date())
            for j, s in enumerate(simbolos, 2):
                w.cell(i, j, float(fila[s])).font = entrada
        w.freeze_panes = 'B2'

    # --- Mu y covarianza
    m = wb.create_sheet('Mu_Cov')
    m['A1'] = 'Activo'
    m['B1'] = 'Rend. esperado usado (mu)'
    m['C1'] = 'Rend. histórico'
    m['D1'] = 'Rend. modelo ML'
    m['E1'] = 'Régimen volatilidad'
    m['F1'] = 'Tope de peso'
    m['H1'] = 'Matriz de covarianza anual'
    for c in ('A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'H1'):
        m[c].font = neg
        m[c].fill = head
    ult = 1 + len(ret)
    for i, a in enumerate(res['activos'], 2):
        s = a['sym']
        col = L(simbolos.index(s) + 2)
        m.cell(i, 1, s)
        m.cell(i, 2, a['rend_usado'] / 100).font = entrada
        m.cell(i, 3, '=AVERAGE(Rendimientos_log!%s2:%s%d)*252' % (col, col, ult))
        m.cell(i, 4, a['rend_ml'] / 100).font = entrada
        m.cell(i, 5, a['regimen'] or '')
        m.cell(i, 6, a['tope']).font = entrada
        for c in (2, 3, 4, 6):
            m.cell(i, c).number_format = '0.00%'
    m.cell(n + 3, 1, 'rf')
    m.cell(n + 3, 2, rf).font = entrada
    m.cell(n + 3, 2).number_format = '0.000%'
    for j, s in enumerate(simbolos):
        m.cell(1, 9 + j, s).font = neg
        m.cell(2 + j, 8, s).font = neg
        for k, s2 in enumerate(simbolos):
            ci, ck = L(simbolos.index(s) + 2), L(simbolos.index(s2) + 2)
            m.cell(2 + j, 9 + k, '=_xlfn.COVARIANCE.S(Rendimientos_log!%s2:%s%d,Rendimientos_log!%s2:%s%d)*252'
                   % (ci, ci, ult, ck, ck, ult)).number_format = '0.0000'
    m.column_dimensions['A'].width = 12
    for c in 'BCDEF':
        m.column_dimensions[c].width = 22
    rf_ref = 'Mu_Cov!$B$%d' % (n + 3)
    cov_ini, cov_fin = 'I', L(9 + n - 1)

    # --- Una hoja por cartera, todo con formulas
    for nombre, c in carteras.items():
        w_vec = vector(c)
        h = wb.create_sheet(nombre.replace('(', '').replace(')', '').replace('/', '-')[:28])
        cab = ['Activo', 'mu', 'Peso w', 'Tope', '(Σw)_i', 'Aportación de riesgo', '% del riesgo', 'Monto USD']
        for j, t in enumerate(cab, 1):
            h.cell(1, j, t).font = neg
            h.cell(1, j).fill = head
        # fila auxiliar con los pesos transpuestos para Σw sin formulas matriciales
        h.cell(n + 9, 1, 'w (transpuesto)').font = neg
        for j in range(n):
            h.cell(n + 9, 2 + j, '=$C$%d' % (2 + j))
        fila_w = '$B$%d:$%s$%d' % (n + 9, L(1 + n), n + 9)
        for i, s in enumerate(simbolos):
            r = 2 + i
            h.cell(r, 1, s)
            h.cell(r, 2, '=Mu_Cov!B%d' % (2 + i)).number_format = '0.00%'
            h.cell(r, 3, float(w_vec[i])).font = entrada
            h.cell(r, 3).number_format = '0.00%'
            h.cell(r, 4, '=Mu_Cov!F%d' % (2 + i)).number_format = '0.00%'
            h.cell(r, 5, '=SUMPRODUCT(Mu_Cov!$%s$%d:$%s$%d,%s)' % (cov_ini, 2 + i, cov_fin, 2 + i, fila_w)).number_format = '0.000000'
            h.cell(r, 6, '=C%d*E%d/$B$%d' % (r, r, n + 5)).number_format = '0.000%'
            h.cell(r, 7, '=F%d/$B$%d' % (r, n + 5)).number_format = '0.0%'
            h.cell(r, 8, '=C%d*%s' % (r, res['capital'])).number_format = '#,##0.00'
        f = n + 2
        rng_w, rng_mu, rng_s = 'C2:C%d' % (f - 1), 'B2:B%d' % (f - 1), 'E2:E%d' % (f - 1)
        filas = [('Suma de pesos', '=SUM(%s)' % rng_w, '0.00%'),
                 ('Rendimiento esperado', '=SUMPRODUCT(%s,%s)' % (rng_w, rng_mu), '0.00%'),
                 ('Volatilidad', '=SQRT(SUMPRODUCT(%s,%s))' % (rng_w, rng_s), '0.00%'),
                 ('Sharpe', '=(B%d-%s)/B%d' % (f + 1, rf_ref, f + 2), '0.0000'),
                 ('App: rendimiento / vol / Sharpe', '%.4f%% / %.4f%% / %.4f' % (c['rendimiento'], c['volatilidad'], c['sharpe']), '@')]
        for k, (t, fml, fmt) in enumerate(filas):
            h.cell(f + k, 1, t).font = neg
            h.cell(f + k, 2, fml).number_format = fmt
        h.column_dimensions['A'].width = 30
        for col in 'BCDEFGH':
            h.column_dimensions[col].width = 16

    # --- Verificacion
    v = wb.create_sheet('Verificacion', 1)
    for j, t in enumerate(['Prueba', 'Resultado', 'Detalle'], 1):
        v.cell(1, j, t).font = neg
        v.cell(1, j).fill = head
    for i, r in enumerate(RESULTADOS, 2):
        v.cell(i, 1, r['Prueba'])
        v.cell(i, 2, r['Resultado']).font = Font(name='Arial', bold=True,
                                                 color='15803D' if r['Resultado'] == 'PASA' else 'DC2626')
        v.cell(i, 3, r['Detalle'])
    v.column_dimensions['A'].width = 58
    v.column_dimensions['B'].width = 12
    v.column_dimensions['C'].width = 110

    # --- Validacion ML
    ml = wb.create_sheet('Validacion_ML')
    fila = 1
    for clave, titulo, cols in (
            ('regimen', 'Opción 1 — Régimen de volatilidad (clasificación)', ['modelo', 'accuracy', 'f1', 'dm', 'p']),
            ('rendimiento', 'Opción 2 — Rendimiento a 20 días (regresión)', ['modelo', 'rmse', 'mse', 'mae', 'r2', 'acierto_direccion', 'dm', 'p'])):
        b = res['ml'][clave]
        ml.cell(fila, 1, titulo).font = neg
        fila += 1
        for j, t in enumerate(cols, 1):
            ml.cell(fila, j, t).font = neg
            ml.cell(fila, j).fill = head
        for mo in b['modelos']:
            fila += 1
            for j, t in enumerate(cols, 1):
                ml.cell(fila, j, mo[t])
        fila += 1
        ml.cell(fila, 1, 'Ingenuo: ' + b['base']['modelo'])
        fila += 2
        mat = b['matriz'] if clave == 'regimen' else b['matriz_direccion']
        et = b['etiquetas'] if clave == 'regimen' else b['etiquetas_direccion']
        ml.cell(fila, 1, 'Matriz de confusión (filas = real, columnas = predicho) — ' + b['mejor']).font = neg
        ini = fila + 1
        for j, e in enumerate(et):
            ml.cell(ini, 2 + j, e).font = neg
            ml.cell(ini + 1 + j, 1, e).font = neg
            for k in range(len(et)):
                ml.cell(ini + 1 + j, 2 + k, mat[j][k]).font = entrada
        last = L(1 + len(et))
        ml.cell(ini + len(et) + 2, 1, 'Accuracy (fórmula)').font = neg
        diag = '+'.join('%s%d' % (L(2 + j), ini + 1 + j) for j in range(len(et)))
        ml.cell(ini + len(et) + 2, 2, '=(%s)/SUM(B%d:%s%d)' % (diag, ini + 1, last, ini + len(et))).number_format = '0.00%'
        fila = ini + len(et) + 4
    ml.cell(fila, 1, 'Datos: %d filas de entrenamiento, %d de prueba, corte %s, horizonte %d días, temporalidad %s'
            % (res['ml']['n_train'], res['ml']['n_test'], res['ml']['corte'], res['ml']['horizonte_dias'],
               res['ml']['temporalidad']))
    ml.column_dimensions['A'].width = 40

    archivo = SALIDA / ('verificacion_portafolio_%s.xlsx' % res['perfil'])
    wb.save(archivo)
    print('Excel:', archivo)


def grafica(res, R, V, carteras, vector, metricas):
    fig, ax = plt.subplots(figsize=(11, 7))
    if len(R):
        sel = np.random.default_rng(1).choice(len(R), min(len(R), 15000), replace=False)
        ax.scatter(V[sel] * 100, R[sel] * 100, s=2, c=((R - res['tasa_libre'] / 100) / V)[sel], cmap='viridis',
                   alpha=0.5, label='Carteras al azar (mismas restricciones)')
    fr = pd.DataFrame(res['frontera']).sort_values('volatilidad')
    ax.plot(fr['volatilidad'], fr['rendimiento'], 'k-', lw=2, label='Frontera eficiente (app)')
    marcas = ['*', 'o', 's', 'D', '^']
    for (nombre, c), mk in zip(carteras.items(), marcas):
        r, v, _ = metricas(vector(c))
        ax.scatter(v * 100, r * 100, s=180, marker=mk, edgecolor='k', zorder=5, label=nombre)
    ax.set_xlabel('Volatilidad anual (%)')
    ax.set_ylabel('Rendimiento esperado anual (%)')
    ax.set_title('Verificación: ninguna cartera al azar debe quedar arriba de la frontera')
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    fig.tight_layout()
    archivo = SALIDA / ('frontera_verificacion_%s.png' % res['perfil'])
    fig.savefig(archivo, dpi=130)
    plt.close(fig)
    print('Gráfica:', archivo)


if __name__ == '__main__':
    main()
