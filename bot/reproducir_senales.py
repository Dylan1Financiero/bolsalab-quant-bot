# -*- coding: utf-8 -*-
"""
REPRODUCE LAS SEÑALES DEL BOT EN LAS ÚLTIMAS HORAS (sin operar, sin modificar el bot)

Descarga velas reales de Gate.io, recorre vela por vela con la MISMA función del bot
(evaluate_strategy_signal y rf_levels para SL/TP) y simula cada operación como la haría el bot:
margen fijo, x10, cierre por SL o TP (si una vela toca ambos, se asume el SL primero).

Además compara 3 filtros opcionales para ver si habrían evitado entradas malas
(NO se aplican al bot; solo sirven para decidir):
  A) Original (lo que hace hoy el bot)
  B) Exigir volumen de confirmación (vela de ruptura >= 1.2x su media de 20)
  C) No entrar si el precio ya se movió más de 1.2% en las últimas 10 velas (entrada tardía)

Uso en Spyder: pon el archivo junto a bot_quant_x10_app.py, ajusta ACTIVO/TF/ESTRATEGIA/HORAS y F5.
"""
import importlib.util
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd

ACTIVO = 'BTC_USDT'
TF = '1m'
ESTRATEGIA = 'CHARTISMO'
HORAS = 24
MARGEN = 100.0          # USD por operación (como el bot)
APALANCAMIENTO = 10

try:
    CARPETA = Path(__file__).resolve().parent
except NameError:
    CARPETA = Path.cwd()


def cargar_bot():
    os.environ.setdefault('TELEGRAM_BOT_TOKEN', 'solo-reproduccion')
    spec = importlib.util.spec_from_file_location('bot_rep', CARPETA / 'bot_quant_x10_app.py')
    bot = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bot)
    return bot


def velas_historicas(bot, activo, tf, horas):
    """Descarga varias ventanas de Gate y calcula los indicadores igual que get_candles."""
    import gate_api
    sec = bot.TIMEFRAMES[tf]['sec']
    api = gate_api.FuturesApi(gate_api.ApiClient(gate_api.Configuration(host=bot.GATE_HOSTS[0])))
    fin = int(time.time())
    ini = fin - horas * 3600 - 300 * sec            # 300 velas extra para EMA200 y el canal
    filas, t = [], ini
    while t < fin:
        t2 = min(fin, t + 1500 * sec)
        bars = api.list_futures_candlesticks(settle='usdt', contract=bot.ASSETS[activo]['ticker'],
                                             interval=tf, _from=t, to=t2)
        filas += [{'t': int(b.t), 'open': float(b.o), 'high': float(b.h), 'low': float(b.l),
                   'close': float(b.c), 'volume': float(getattr(b, 'v', 0) or 0)} for b in bars]
        t = t2
    crudo = pd.DataFrame(filas).drop_duplicates('t').sort_values('t').reset_index(drop=True)
    crudo = crudo[crudo['t'] + sec <= fin].reset_index(drop=True)
    original = bot.fetch_gate_candles
    bot.fetch_gate_candles = lambda *a, **k: crudo.copy()
    try:
        return bot.get_candles(activo, tf)            # mismos indicadores que el bot
    finally:
        bot.fetch_gate_candles = original


def simular(bot, df, inicio, filtro):
    ops, i, n = [], inicio, len(df)
    while i < n - 1:
        ventana = df.iloc[:i + 1]
        try:
            sig, txt = bot.evaluate_strategy_signal(ventana, ESTRATEGIA)
        except Exception:
            sig = None
        if sig and filtro(ventana, sig):
            spot = float(ventana['close'].iloc[-1])
            sl, tp, _ = bot.rf_levels(ventana, sig, spot)
            j, salida, motivo = i + 1, None, None
            while j < n:
                h, l = float(df['high'].iloc[j]), float(df['low'].iloc[j])
                if sig == 'LONG':
                    if l <= sl: salida, motivo = sl, 'SL'
                    elif h >= tp: salida, motivo = tp, 'TP'
                else:
                    if h >= sl: salida, motivo = sl, 'SL'
                    elif l <= tp: salida, motivo = tp, 'TP'
                if salida is not None:
                    break
                j += 1
            if salida is None:
                salida, motivo, j = float(df['close'].iloc[-1]), 'ABIERTA', n - 1
            ret = (salida / spot - 1) * (1 if sig == 'LONG' else -1)
            ops.append({'entrada_utc': pd.to_datetime(int(df['t'].iloc[i]), unit='s'),
                        'lado': sig, 'entrada': spot, 'sl': sl, 'tp': tp, 'salida': salida,
                        'motivo': motivo, 'velas': j - i,
                        'pnl_usd': MARGEN * APALANCAMIENTO * ret, 'roe_pct': ret * APALANCAMIENTO * 100,
                        'senal': txt})
            i = j + 1
        else:
            i += 1
    return pd.DataFrame(ops)


def main():
    bot = cargar_bot()
    print('Descargando velas reales de Gate.io...')
    df = velas_historicas(bot, ACTIVO, TF, HORAS)
    inicio = max(250, len(df) - int(HORAS * 3600 / bot.TIMEFRAMES[TF]['sec']))
    print('%d velas, simulando desde %s' % (len(df), pd.to_datetime(int(df['t'].iloc[inicio]), unit='s')))

    def vol_ok(v, sig):
        vol = v['volume'].to_numpy(float)
        return len(vol) > 21 and vol[-1] >= 1.2 * vol[-21:-1].mean()

    def no_tarde(v, sig):
        c = v['close'].to_numpy(float)
        mov = c[-1] / c[-11] - 1
        return not ((sig == 'SHORT' and mov < -0.012) or (sig == 'LONG' and mov > 0.012))

    filtros = {'A) Original': lambda v, s: True, 'B) Con volumen': vol_ok, 'C) Sin entrada tardía': no_tarde}
    resumen = []
    with pd.ExcelWriter(CARPETA / ('reproduccion_%s_%s_%s.xlsx' % (ACTIVO, TF, ESTRATEGIA))) as xw:
        for nombre, f in filtros.items():
            ops = simular(bot, df, inicio, f)
            if len(ops):
                ops.to_excel(xw, sheet_name=nombre[:3].replace(')', ''), index=False)
                cerr = ops[ops['motivo'] != 'ABIERTA']
                resumen.append({'Variante': nombre, 'Operaciones': len(ops),
                                'Ganadoras %': round((cerr['pnl_usd'] > 0).mean() * 100, 1) if len(cerr) else None,
                                'P&L total USD': round(ops['pnl_usd'].sum(), 2),
                                'Peor operación USD': round(ops['pnl_usd'].min(), 2)})
            else:
                resumen.append({'Variante': nombre, 'Operaciones': 0})
        r = pd.DataFrame(resumen)
        r.to_excel(xw, sheet_name='Resumen', index=False)
    print('\n' + r.to_string(index=False))
    print('\nDetalle por operación en reproduccion_%s_%s_%s.xlsx' % (ACTIVO, TF, ESTRATEGIA))


if __name__ == '__main__':
    main()
