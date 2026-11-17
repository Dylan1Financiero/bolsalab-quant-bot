# -*- coding: utf-8 -*-
# =====================================================================================
#  VERSION PARA SPYDER (Mac) - mismo bot que desplegar_bot_gcloud.sh, sin la parte de Bash
#  1) Una sola vez, en la consola de Spyder:
#     %pip install numpy pandas matplotlib scikit-learn scipy gate-api google-genai "python-telegram-bot>=21" python-dotenv openpyxl psutil firebase-admin catboost
#     (reinicia el kernel: Consolas > Reiniciar kernel)
#  2) Guarda este archivo en la misma carpeta que .env y firebase-credenciales.json
#  3) Correr el bot: F5 (Run file). Envia /start en Telegram.
#  4) Detenerlo: Ctrl+C en la consola (o el boton de interrumpir kernel).
#     Si vuelves a darle F5, la instancia anterior se apaga sola.
#  5) Verificacion previa de llaves y datos: en la consola escribe  %run bot_trading.py --verificar
#  IMPORTANTE: apaga el bot de la VM antes de correrlo aqui (dos bots con el mismo token chocan).
# =====================================================================================
"""Bot Quant Multi-Activo x10 | Chartismo + Fibonacci + EMA 50/200 + RF
Administracion de riesgo adaptada automaticamente a la clase de activo:
- Criptomonedas (incluye Bitcoin) -> CAViaR 99% (Lim 1.50%)
- Acciones   -> CVaR 99% (Lim 2.20%)
- ETFs    -> VaR 99% (Lim 1.50%)
Si la metrica activa supera su limite: semaforo ROJO y entrada bloqueada.
Datos: Gate.io Produccion (cripto) y Yahoo Finance (acciones y ETFs).
Compatible con Spyder / Jupyter / Terminal en Python 3.14 y VM de Google Cloud.
"""
import asyncio
import base64
import io
import json
import logging
import os
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.ensemble import RandomForestRegressor
try:
    import catboost as cb
    from catboost import CatBoostRegressor, CatBoostClassifier, Pool
    CATBOOST_OK = True
except ImportError:
    cb = None
    CatBoostRegressor = None
    CatBoostClassifier = None
    Pool = None
    CATBOOST_OK = False
import gate_api
from google import genai
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters,
)
from telegram.error import BadRequest
from telegram.request import HTTPXRequest

# Constantes de indice para evitar que el portapapeles del chat altere corchetes numericos
I0, I1, I2 = 0, 1, 2

# =====================================================================
# 1. CREDENCIALES Y CATALOGO MULTI-ACTIVO CON ADAPTACION AUTOMATICA
# =====================================================================
try:
    BASE_DIR = Path(__file__).resolve().parent
except NameError:
    BASE_DIR = Path.cwd()
try:
    from dotenv import load_dotenv
    for _env in (BASE_DIR / '.env', Path(os.path.expanduser('~/datos_ema_bot/.env'))):
        if _env.exists():
            load_dotenv(_env)
except ImportError:
    pass

GATE_API_KEY = os.getenv('GATE_API_KEY', '')
GATE_API_SECRET = os.getenv('GATE_API_SECRET', '')
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = None

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-3.5-flash')

# API de Grok / xAI (Sentimiento de Mercado en X)
XAI_API_KEY = os.getenv('XAI_API_KEY', '').strip()
XAI_MODEL = os.getenv('XAI_MODEL', 'grok-4.7').strip()

FIREBASE_CRED = os.getenv('FIREBASE_CREDENTIALS', str(BASE_DIR / 'firebase-credenciales.json'))

# Testnet de futuros de Gate.io (dinero ficticio). Si estas dos llaves existen, cada apertura y cierre
# del bot se envia tambien como orden real al testnet. Son llaves de "red de prueba", NO las de la cuenta real.
GATE_TESTNET_KEY = os.getenv('GATE_TESTNET_KEY', '').strip()
GATE_TESTNET_SECRET = os.getenv('GATE_TESTNET_SECRET', '').strip()
GATE_TESTNET_HOST = os.getenv('GATE_TESTNET_HOST', 'https://api-testnet.gateapi.io/api/v4').strip()

LEVERAGE = 10
MARGIN_USDT = 100.0  # Margen base por operacion ($100 x 10 = $1,000 nocional)

DATA_DIR = Path(os.path.expanduser('~/datos_ema_bot'))
DATA_DIR.mkdir(parents=True, exist_ok=True)
CATBOOST_DIR = DATA_DIR / 'catboost_info'
CATBOOST_DIR.mkdir(parents=True, exist_ok=True)
# Parametros base de CatBoost optimizados para correr en VM Linux de Google Cloud (CPU headless)
CATBOOST_VM_PARAMS = {
    'task_type': 'CPU',
    'thread_count': -1,
    'allow_writing_files': False,
    'train_dir': str(CATBOOST_DIR),
    'verbose': 0,
    'random_seed': 42,
}
STATE_FILE = DATA_DIR / 'estado_quant_x10.json'
TRADES_FILE = DATA_DIR / 'trades_x10.csv'
PAIR_FILE = DATA_DIR / 'telegram_chat.json'

ASSET_CLASSES = {
    'CRYPTO': {
        'label': 'Criptomonedas', 'singular': 'Cripto', 'icon': '🪙',
        'source': 'gate', 'risk': 'CAVIAR99', 'strat': 'CHARTISMO',
    },
    'STOCK': {
        'label': 'Acciones', 'singular': 'Acción', 'icon': '🏢',
        'source': 'yahoo', 'risk': 'CVAR99', 'strat': 'CHARTISMO',
    },
    'ETF': {
        'label': 'ETFs', 'singular': 'ETF', 'icon': '🧺',
        'source': 'yahoo', 'risk': 'VAR99', 'strat': 'EMA50_200',
    },
}

CATALOG = {
    'CRYPTO': [
        ('BTC_USDT', 'Bitcoin'), ('ETH_USDT', 'Ethereum'), ('SOL_USDT', 'Solana'),
        ('XRP_USDT', 'XRP'), ('BNB_USDT', 'BNB'), ('DOGE_USDT', 'Dogecoin'),
        ('ADA_USDT', 'Cardano'), ('AVAX_USDT', 'Avalanche'), ('LINK_USDT', 'Chainlink'),
        ('LTC_USDT', 'Litecoin'),
    ],
    'STOCK': [
        ('NVDA', 'NVIDIA'), ('AAPL', 'Apple'), ('TSLA', 'Tesla'), ('MSFT', 'Microsoft'),
        ('AMZN', 'Amazon'), ('GOOGL', 'Alphabet'), ('META', 'Meta'), ('AMD', 'AMD'),
        ('NFLX', 'Netflix'), ('JPM', 'JPMorgan'),
    ],
    'ETF': [
        ('SPY', 'S&P 500'), ('QQQ', 'Nasdaq 100'), ('IWM', 'Russell 2000'),
        ('DIA', 'Dow Jones'), ('GLD', 'Oro'), ('TLT', 'Bonos Tesoro 20+'),
        ('XLK', 'Tecnología'), ('EEM', 'Emergentes'),
    ],
}

ASSETS = dict()
for _cls, _items in CATALOG.items():
    _cfg = ASSET_CLASSES[_cls]
    for _sym, _name in _items:
        ASSETS[_sym] = {
            'type': _cls, 'source': _cfg['source'], 'ticker': _sym, 'name': _name,
            'default_risk': _cfg['risk'], 'default_strat': _cfg['strat'],
            'desc': _name + ' (' + _cfg['singular'] + ' x' + str(LEVERAGE) + ')',
        }

TIMEFRAMES = {
    '1m': {'sec': 60, 'label': '1 min', 'yf_int': '1m', 'yf_rng': '7d'},
    '5m': {'sec': 300, 'label': '5 min', 'yf_int': '5m', 'yf_rng': '60d'},
    '15m': {'sec': 900, 'label': '15 min', 'yf_int': '15m', 'yf_rng': '60d'},
    '30m': {'sec': 1800, 'label': '30 min', 'yf_int': '30m', 'yf_rng': '60d'},
    '1h': {'sec': 3600, 'label': '1 hour', 'yf_int': '60m', 'yf_rng': '730d'},
    '4h': {'sec': 14400, 'label': '4 hours', 'yf_int': '60m', 'yf_rng': '730d'},
    '1d': {'sec': 86400, 'label': '1 day', 'yf_int': '1d', 'yf_rng': '5y'},
}

RISK_MODELS = {
    'VAR99': {'label': 'VaR 99%', 'limit': 1.50, 'is_pct': True, 'target': 'ETFs'},
    'CVAR99': {'label': 'CVaR 99%', 'limit': 2.20, 'is_pct': True, 'target': 'Acciones'},
    'CAVIAR99': {'label': 'CAViaR 99%', 'limit': 1.50, 'is_pct': True, 'target': 'Criptomonedas'},
}

STRATEGIES = {
    'RSI': '1° RSI Spot/Fut',
    'EMA50_200': '2° EMA 50/200',
    'BOLLINGER': '3° Bollinger',
    'FIBONACCI': '4° Fibonacci+Abanicos',
    'SUPERTREND': '5° SuperTrend',
    'CHARTISMO': '6° Chartismo+Ruptura',
}

if os.getenv('TELEGRAM_CHAT_ID'):
    try:
        TELEGRAM_CHAT_ID = int(os.getenv('TELEGRAM_CHAT_ID'))
    except ValueError:
        pass
elif PAIR_FILE.exists():
    try:
        TELEGRAM_CHAT_ID = int(json.loads(PAIR_FILE.read_text(encoding='utf-8'))['chat_id'])
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s',
    handlers=[
        logging.StreamHandler(),
        RotatingFileHandler(
            BASE_DIR / 'trading_bot.log', maxBytes=2_000_000, backupCount=3, encoding='utf-8'
        ),
    ],
)
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)
LAST_RISK = dict()
LOCK = threading.RLock()


# Formateadores numericos y visuales seguros
def fc2(val):
    v = float(val)
    if 0 < abs(v) < 1.0:
        return format(v, ',.4f')
    return format(v, ',.2f')


def fc1(val):
    return format(float(val), ',.1f')


def fc0(val):
    return format(float(val), ',.0f')


def fd2(val):
    return format(float(val), '.2f')


def fd1(val):
    return format(float(val), '.1f')


def fd4(val):
    return format(float(val), '.4f')


def fs2(val):
    return format(float(val), '+.2f')


def fs1(val):
    return format(float(val), '+.1f')


def bar_meter(ratio, width=10):
    r = max(0.0, min(1.0, float(ratio)))
    filled = int(round(r * width))
    return '▰' * filled + '▱' * (width - filled)


def range_slider(pct, width=11):
    p = max(0.0, min(100.0, float(pct)))
    idx = min(width - 1, max(0, int(round(p / 100.0 * (width - 1)))))
    chars = ['─'] * width
    chars[idx] = '●'
    return '[' + ''.join(chars) + ']'


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def load_state():
    default = {
        'trading_enabled': False,
        'timeframe': '1h',
        'asset': 'BTC_USDT',
        'strategy': 'CHARTISMO',
        'risk_metric': 'CAVIAR99',
        'balance_usdt': 1000.0,
        'realized_pnl_usdt': 0.0,
        'position': None,
        'last_candle': None,
        'last_signal': 'Sin señales previas',
    }
    if STATE_FILE.exists():
        try:
            loaded = json.loads(STATE_FILE.read_text(encoding='utf-8'))
            for k in list(default.keys()):
                if k in loaded:
                    default[k] = loaded[k]
        except Exception:
            logging.exception('Estado previo invalido, reiniciando valores por defecto')
    if default['asset'] not in ASSETS:
        default['asset'] = 'BTC_USDT'
    if default['timeframe'] not in TIMEFRAMES:
        default['timeframe'] = '1h'
    if default['strategy'] not in STRATEGIES:
        default['strategy'] = ASSETS[default['asset']]['default_strat']
    if default['risk_metric'] not in RISK_MODELS:
        default['risk_metric'] = ASSETS[default['asset']]['default_risk']
    return default


STATE = load_state()


def save_state():
    tmp = STATE_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(STATE, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(STATE_FILE)


def write_trade_csv(record):
    pd.DataFrame([record]).to_csv(
        TRADES_FILE, mode='a', index=False,
        header=not TRADES_FILE.exists(), encoding='utf-8-sig'
    )
    try:
        fb_push_trade(record)
    except Exception:
        logging.exception('No se pudo enviar el trade a la app')


# =====================================================================
# 2. DESCARGA MULTI-ACTIVO (GATE.IO REAL PRIMERO + YAHOO FINANCE)
# =====================================================================
# IMPORTANTE: Produccion va PRIMERO. El testnet de Gate.io genera mechas falsas
# artificiales (barcodes) que distorsionan cualquier analisis tecnico en 1m y 5m.
GATE_HOSTS = (
    'https://api.gateio.ws/api/v4',
    'https://api-testnet.gateapi.io/api/v4',
)


def fetch_gate_candles(contract, tf):
    """Descarga velas reales del mercado de futuros USDT de Gate.io (endpoint publico)."""
    last_err = None
    for host in GATE_HOSTS:
        cfg = gate_api.Configuration(host=host)
        cli = gate_api.ApiClient(cfg)
        api = gate_api.FuturesApi(cli)
        try:
            bars = api.list_futures_candlesticks(
                settle='usdt', contract=contract, interval=tf, limit=600
            )
            df = pd.DataFrame([{
                't': int(b.t), 'open': float(b.o),
                'high': float(b.h), 'low': float(b.l), 'close': float(b.c),
                'volume': float(getattr(b, 'v', 0) or 0)
            } for b in bars])
            if len(df) >= 80:
                return df
            last_err = RuntimeError('solo ' + str(len(df)) + ' velas en ' + host)
        except Exception as exc:
            last_err = exc
        finally:
            try:
                cli.close()
            except Exception:
                pass
    raise RuntimeError('Gate.io no devolvio velas de ' + str(contract) + ': ' + str(last_err))


def fetch_yahoo_candles(ticker, tf):
    tf_cfg = TIMEFRAMES[tf]
    url = (
        'https://query1.finance.yahoo.com/v8/finance/chart/' + str(ticker)
        + '?interval=' + str(tf_cfg['yf_int'])
        + '&range=' + str(tf_cfg['yf_rng'])
    )
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode('utf-8'))

    res = payload['chart']['result'][I0]
    ts = res['timestamp']
    q = res['indicators']['quote'][I0]
    df = pd.DataFrame({
        't': ts,
        'open': q['open'],
        'high': q['high'],
        'low': q['low'],
        'close': q['close'],
        'volume': [float(v or 0) for v in q.get('volume', [0.0] * len(ts))],
    }).dropna().reset_index(drop=True)
    df['t'] = df['t'].astype(int)

    if tf == '4h' and not df.empty:
        df['dt'] = pd.to_datetime(df['t'], unit='s', utc=True)
        df = df.set_index('dt').resample('4h').agg({
            't': 'first', 'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last',
            'volume': 'sum'
        }).dropna().reset_index(drop=True)
        df['t'] = df['t'].astype(int)
    return df


def get_candles(asset=None, timeframe=None):
    sym = asset or STATE['asset']
    tf = timeframe or STATE['timeframe']
    info = ASSETS[sym]
    sec = TIMEFRAMES[tf]['sec']

    if info['source'] == 'gate':
        df = fetch_gate_candles(info['ticker'], tf)
        closed = df[df['t'] + sec <= int(time.time())].reset_index(drop=True)
        if len(closed) >= 150:
            df = closed
    else:
        df = fetch_yahoo_candles(info['ticker'], tf)

    df = df.sort_values('t').drop_duplicates('t').reset_index(drop=True)
    if len(df) < 80:
        raise RuntimeError(
            'Historial insuficiente para ' + str(sym) + ' en ' + str(tf)
            + ' (' + str(len(df)) + ' velas).'
        )

    df['ema_50'] = df['close'].ewm(span=50, adjust=False).mean()
    df['ema_200'] = df['close'].ewm(span=200, adjust=False).mean()

    delta = df['close'].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    df['rsi'] = (100.0 * gain / (gain + loss)).where((gain + loss) > 0, 50.0)

    df['bb_mid'] = df['close'].rolling(20).mean()
    bb_std = df['close'].rolling(20).std()
    df['bb_up'] = df['bb_mid'] + 2.0 * bb_std
    df['bb_dn'] = df['bb_mid'] - 2.0 * bb_std

    prev_c = df['close'].shift(1)
    tr = pd.concat([
        df['high'] - df['low'],
        (df['high'] - prev_c).abs(),
        (df['low'] - prev_c).abs()
    ], axis=1).max(axis=1)
    df['atr'] = tr.rolling(14).mean()
    hl2 = (df['high'] + df['low']) / 2.0
    st_atr = tr.rolling(10).mean()
    basic_ub = hl2 + 3.0 * st_atr
    basic_lb = hl2 - 3.0 * st_atr
    st_dir = np.ones(len(df))
    st_line = np.zeros(len(df))
    c_arr = np.array(df['close'], dtype=float)
    ub_arr = np.array(basic_ub.bfill(), dtype=float)
    lb_arr = np.array(basic_lb.bfill(), dtype=float)
    st_line[I0] = lb_arr[I0]
    for i in range(1, len(df)):
        if c_arr[i] > ub_arr[i - 1]:
            st_dir[i] = 1
        elif c_arr[i] < lb_arr[i - 1]:
            st_dir[i] = -1
        else:
            st_dir[i] = st_dir[i - 1]
            if st_dir[i] == 1 and lb_arr[i] < lb_arr[i - 1]:
                lb_arr[i] = lb_arr[i - 1]
            if st_dir[i] == -1 and ub_arr[i] > ub_arr[i - 1]:
                ub_arr[i] = ub_arr[i - 1]
        st_line[i] = lb_arr[i] if st_dir[i] == 1 else ub_arr[i]
    df['supertrend'] = st_line
    df['st_dir'] = st_dir
    return df


# =====================================================================
# 3. MOTOR DE 3 METRICAS DE RIESGO + SEMAFORO ROJO BLOQUEANTE
# =====================================================================
def compute_caviar_series(returns_arr):
    abs_r = np.abs(returns_arr) * 100.0
    q = np.zeros(len(abs_r))
    init_slice = returns_arr[:min(40, len(returns_arr))]
    q[I0] = max(0.3, float(-np.percentile(init_slice, 1) * 100.0))
    b0, b1, b2 = 0.04, 0.86, 0.38
    for t in range(1, len(abs_r)):
        q[t] = b0 + b1 * q[t - 1] + b2 * abs_r[t - 1]
    return q


def evaluate_all_risks(df, active_metric=None, asset=None):
    sym = asset or STATE['asset']
    act = active_metric or STATE['risk_metric']
    if act not in RISK_MODELS:
        act = ASSETS[sym]['default_risk']

    ret_series = df['close'].pct_change().dropna()
    ret = ret_series.tail(150).to_numpy()
    if len(ret) < 30:
        raise RuntimeError('Datos insuficientes para metricas de riesgo.')

    q01 = np.percentile(ret, 1)
    var99 = max(0.01, float(-q01 * 100.0))

    tail_99 = ret[ret <= q01]
    cvar99 = max(var99, float(-tail_99.mean() * 100.0)) if len(tail_99) > 0 else var99 * 1.25

    caviar_ser = compute_caviar_series(ret_series.to_numpy())
    caviar99 = float(caviar_ser[-1])

    raw_vals = {
        'VAR99': round(var99, 2),
        'CVAR99': round(cvar99, 2),
        'CAVIAR99': round(caviar99, 2),
    }

    details = dict()
    for k, cfg in RISK_MODELS.items():
        val = raw_vals[k]
        lim = cfg['limit']
        blocked = val > lim
        details[k] = {
            'key': k,
            'label': cfg['label'],
            'val': val,
            'limit': lim,
            'is_pct': cfg['is_pct'],
            'blocked': blocked,
            'icon': '🔴' if blocked else '🟢',
            'target': cfg['target'],
        }

    active_info = details[act]
    if asset is None and active_metric is None:
        LAST_RISK.clear()
        LAST_RISK.update({
            'asset': sym, 'timeframe': STATE['timeframe'], 'key': act,
            'blocked': active_info['blocked'], 'val': active_info['val'],
            'limit': active_info['limit'], 'label': active_info['label'],
        })
    return {
        'active_key': act,
        'active': active_info,
        'blocked': active_info['blocked'],
        'all': details,
    }


def rolling_active_risk(df, metric_key):
    r = df['close'].pct_change().fillna(0.0)
    if metric_key == 'VAR99':
        return (-r.rolling(50).quantile(0.01) * 100.0).clip(lower=0.0)
    if metric_key == 'CVAR99':
        def _cv99(arr):
            q = np.percentile(arr, 1)
            t = arr[arr <= q]
            return max(0.0, float(-t.mean() * 100.0) if len(t) > 0 else float(-q * 100.0))
        return r.rolling(50).apply(_cv99, raw=True)
    vals = compute_caviar_series(r.to_numpy())
    return pd.Series(vals, index=df.index)


# =====================================================================
# 4. MOTOR CHARTISTA v3.2 (ESTRUCTURAL, TRIANGULOS, CUNAS Y VIGENCIA VIVA)
# =====================================================================
CHART_LOOKBACK = 120


def _structural_series(op, hi, lo, cl):
    """Filtra mechas anomalas aisladas (bad-ticks / flash wicks) usando mediana robusta
    y devuelve techos/pisos estructurales confirmados por el cuerpo de las velas."""
    body_hi = np.maximum(op, cl)
    body_lo = np.minimum(op, cl)
    prev_c = np.roll(cl, 1)
    prev_c[I0] = cl[I0]
    body_tr = np.maximum(body_hi - body_lo, np.abs(cl - prev_c))
    med_step = float(np.nanmedian(body_tr[-50:]))
    if not np.isfinite(med_step) or med_step <= 0:
        med_step = max(float(np.nanmedian(hi - lo)), float(cl[-1]) * 0.002, 1e-6)

    raw_tr = np.maximum(hi - lo, np.maximum(np.abs(hi - prev_c), np.abs(lo - prev_c)))
    atr = float(np.nanmedian(raw_tr[-35:]) * 1.35)
    atr = min(atr, med_step * 3.2)
    atr = max(atr, med_step * 1.1, float(cl[-1]) * 0.0008, 1e-6)

    s_hi = np.copy(hi)
    s_lo = np.copy(lo)
    n = len(cl)
    for i in range(n):
        nb_hi = float(np.max(body_hi[max(0, i - 2):min(n, i + 3)]))
        nb_lo = float(np.min(body_lo[max(0, i - 2):min(n, i + 3)]))
        if s_hi[i] - nb_hi > 2.0 * atr:
            s_hi[i] = body_hi[i] + 0.65 * atr
        if nb_lo - s_lo[i] > 2.0 * atr:
            s_lo[i] = body_lo[i] - 0.65 * atr
    return s_hi, s_lo, body_hi, body_lo, atr


def _pivots(hi, lo, w=4, min_swing=0.0):
    """ZigZag causal sobre precios estructurales (excluye la vela actual n - 1)."""
    n = len(hi)
    end_i = max(w + 1, n - 1)
    raw = []
    for i in range(w, end_i - 1):
        left = max(0, i - w)
        right = min(end_i, i + w + 1)
        if right - i < 2:
            continue
        is_h = hi[i] >= np.max(hi[left:right])
        is_l = lo[i] <= np.min(lo[left:right])
        if is_h and is_l:
            prev_t = raw[-1][I2] if raw else 'L'
            raw.append((i, float(hi[i] if prev_t == 'L' else lo[i]), 'H' if prev_t == 'L' else 'L'))
        elif is_h:
            raw.append((i, float(hi[i]), 'H'))
        elif is_l:
            raw.append((i, float(lo[i]), 'L'))

    piv = []
    for p in raw:
        if not piv:
            piv.append(p)
            continue
        last = piv[-1]
        if p[I2] == last[I2]:
            better = (p[I1] >= last[I1]) if p[I2] == 'H' else (p[I1] <= last[I1])
            if better:
                piv[-1] = p
        else:
            if abs(p[I1] - last[I1]) >= min_swing and (p[I0] - last[I0]) >= 2:
                piv.append(p)
    return piv


def _fit(points):
    xs = np.array([p[I0] for p in points], dtype=float)
    ys = np.array([p[I1] for p in points], dtype=float)
    if len(points) >= 2 and float(np.ptp(xs)) > 0:
        m, b = np.polyfit(xs, ys, 1)
        return float(m), float(b)
    return 0.0, float(ys[-1])


def _pattern_alive(cl, x_check, m_u, b_u, m_l, b_l, atr, max_broken_bars=3):
    """Verifica que el patron NO haya sido roto ni invalidado hace varias velas."""
    n = len(cl)
    start = max(0, min(int(x_check), n - 2))
    xs = np.arange(start, n, dtype=float)
    u = m_u * xs + b_u
    l = m_l * xs + b_l
    if np.any(u - l <= 0.35 * atr):
        return False, 99

    c_seg = cl[start:n]
    tol_in = 0.30 * atr
    broken_tail = 0
    for k in range(len(c_seg) - 1, -1, -1):
        if c_seg[k] > u[k] + tol_in or c_seg[k] < l[k] - tol_in:
            broken_tail += 1
        else:
            break
    if broken_tail > max_broken_bars:
        return False, broken_tail

    core_len = max(0, len(c_seg) - max_broken_bars)
    if core_len >= 6:
        inside = (c_seg[:core_len] <= u[:core_len] + tol_in) & (c_seg[:core_len] >= l[:core_len] - tol_in)
        if float(np.mean(inside)) < 0.85:
            return False, broken_tail
    return True, broken_tail


def _detect_active_channel(s_hi, s_lo, body_hi, body_lo, cl, atr):
    """Encuentra el canal de tendencia REALMENTE ACTIVO en el borde derecho usando R^2."""
    n = len(cl)
    best = None
    for w_len in (16, 22, 30, 42, 58, 80):
        if n < w_len + 2:
            continue
        x0 = n - w_len
        xs = np.arange(x0, n - 1, dtype=float)
        ys = cl[x0:n - 1]
        m, b = np.polyfit(xs, ys, 1)
        pred = m * xs + b
        ss_tot = float(np.sum((ys - np.mean(ys)) ** 2))
        ss_res = float(np.sum((ys - pred) ** 2))
        r2 = (1.0 - ss_res / ss_tot) if ss_tot > 1e-12 else 0.0

        res_hi = s_hi[x0:n - 1] - pred
        res_lo = pred - s_lo[x0:n - 1]
        off_u = max(float(np.percentile(res_hi, 92)), float(np.max(body_hi[x0:n - 1] - pred)), 0.55 * atr)
        off_l = max(float(np.percentile(res_lo, 92)), float(np.max(pred - body_lo[x0:n - 1])), 0.55 * atr)
        b_u = b + off_u
        b_l = b - off_l
        width = off_u + off_l

        u_now = m * (n - 1) + b_u
        l_now = m * (n - 1) + b_l
        if cl[-1] > u_now + 1.8 * atr or cl[-1] < l_now - 1.8 * atr:
            continue

        move_atr = abs(m) * w_len / atr
        recency_bonus = 0.14 if (w_len <= 24 and r2 >= 0.72 and move_atr >= 2.2) else 0.0
        score = r2 * 1.1 + min(move_atr / 5.0, 0.5) - (width / atr) * 0.06 + recency_bonus
        cand = {
            'score': score, 'r2': r2, 'm': float(m), 'b_u': float(b_u), 'b_l': float(b_l),
            'x0': int(x0), 'w_len': w_len, 'width': float(width), 'move_atr': float(move_atr),
        }
        if best is None or cand['score'] > best['score']:
            best = cand

    return best


def analyze_chartismo(df, lookback=CHART_LOOKBACK):
    """Motor Chartista v3.2: HCH, Doble Techo/Suelo, Banderas, Triangulos (Asc/Desc/Sim),
    Cunas (Ascendente/Descendente), Rectangulo y Canal R^2 con filtro anti-climax."""
    sub = df.tail(lookback).reset_index(drop=True)
    op = sub['open'].to_numpy(dtype=float)
    hi = sub['high'].to_numpy(dtype=float)
    lo = sub['low'].to_numpy(dtype=float)
    cl = sub['close'].to_numpy(dtype=float)
    rsi_now = float(sub['rsi'].iloc[-1]) if 'rsi' in sub.columns else 50.0
    n = len(sub)
    spot, prev_spot = float(cl[-1]), float(cl[-2])

    s_hi, s_lo, body_hi, body_lo, atr = _structural_series(op, hi, lo, cl)
    piv = _pivots(s_hi, s_lo, w=4, min_swing=1.0 * atr)
    if len(piv) < 4:
        piv = _pivots(s_hi, s_lo, w=3, min_swing=0.65 * atr)
    highs = [p for p in piv if p[I2] == 'H']
    lows = [p for p in piv if p[I2] == 'L']

    def body_confirms_high(idx, level):
        s = max(0, int(idx) - 1)
        e = min(n - 1, int(idx) + 2)
        return float(np.max(body_hi[s:e])) >= level - 0.85 * atr

    def body_confirms_low(idx, level):
        s = max(0, int(idx) - 1)
        e = min(n - 1, int(idx) + 2)
        return float(np.min(body_lo[s:e])) <= level + 0.85 * atr

    def prior_slope_dir(idx):
        idx_i = max(2, min(n - 2, int(idx)))
        s = max(0, idx_i - 25)
        if idx_i - s < 8:
            return 'FLAT'
        xs_p = np.arange(s, idx_i + 1, dtype=float)
        m_p, _ = np.polyfit(xs_p, cl[s:idx_i + 1], 1)
        disp = m_p * (idx_i - s)
        if disp >= 1.5 * atr:
            return 'UP'
        if disp <= -1.5 * atr:
            return 'DOWN'
        return 'FLAT'

    candidates = []
    wedge_slope_dir = None  # Guarda si hay una Cuna activa ('UP' o 'DOWN') para blindarla ante el Canal R^2

    # =================================================================
    # PATRON 1: HOMBRO-CABEZA-HOMBRO (HCH) Y HCH INVERTIDO
    # =================================================================
    cand5 = []
    if len(piv) >= 5:
        cand5.append(piv[-5:])
    if len(piv) >= 6:
        cand5.append(piv[-6:-1])

    for grp in cand5:
        sq = ''.join(p[I2] for p in grp)
        if sq == 'HLHLH':
            h1, l1, h2, l2, h3 = grp
            span_bars = h3[I0] - h1[I0]
            m_nk, b_nk = _fit([l1, l2])
            nk_h2 = m_nk * h2[I0] + b_nk
            head_prom = h2[I1] - max(h1[I1], h3[I1])
            sh_diff = abs(h1[I1] - h3[I1])
            if (span_bars >= 16 and (h2[I0] - h1[I0]) >= 5 and (h3[I0] - h2[I0]) >= 5
                    and prior_slope_dir(h1[I0]) == 'UP'
                    and head_prom >= 0.75 * atr and sh_diff <= 0.90 * atr
                    and (h2[I1] - nk_h2) >= 2.0 * atr and abs(m_nk) <= 0.07 * atr
                    and body_confirms_high(h2[I0], h2[I1]) and body_confirms_high(h3[I0], h3[I1])):
                alive, _ = _pattern_alive(cl, h3[I0], 0.0, float(h2[I1]), m_nk, b_nk, atr, max_broken_bars=3)
                if alive and spot < h2[I1]:
                    candidates.append({
                        'prio': 95, 'pattern': 'Hombro-Cabeza-Hombro (HCH)', 'kind': 'Reversión bajista',
                        'bias': 'DOWN', 'm_u': 0.0, 'b_u': float(h2[I1]), 'm_l': m_nk, 'b_l': b_nk,
                        'height': float(h2[I1] - nk_h2), 'x0': h1[I0],
                        'up_name': 'Cabeza (invalidación)', 'lo_name': 'Línea clavicular (cuello)',
                        'labels': [(h1, 'HI'), (h2, 'Cabeza'), (h3, 'HD')], 'notes': [],
                    })
        elif sq == 'LHLHL':
            l1, h1, l2, h2, l3 = grp
            span_bars = l3[I0] - l1[I0]
            m_nk, b_nk = _fit([h1, h2])
            nk_l2 = m_nk * l2[I0] + b_nk
            head_prom = min(l1[I1], l3[I1]) - l2[I1]
            sh_diff = abs(l1[I1] - l3[I1])
            if (span_bars >= 16 and (l2[I0] - l1[I0]) >= 5 and (l3[I0] - l2[I0]) >= 5
                    and prior_slope_dir(l1[I0]) == 'DOWN'
                    and head_prom >= 0.75 * atr and sh_diff <= 0.90 * atr
                    and (nk_l2 - l2[I1]) >= 2.0 * atr and abs(m_nk) <= 0.07 * atr
                    and body_confirms_low(l2[I0], l2[I1]) and body_confirms_low(l3[I0], l3[I1])):
                alive, _ = _pattern_alive(cl, l3[I0], m_nk, b_nk, 0.0, float(l2[I1]), atr, max_broken_bars=3)
                if alive and spot > l2[I1]:
                    candidates.append({
                        'prio': 95, 'pattern': 'HCH Invertido (Suelo)', 'kind': 'Reversión alcista',
                        'bias': 'UP', 'm_u': m_nk, 'b_u': b_nk, 'm_l': 0.0, 'b_l': float(l2[I1]),
                        'height': float(nk_l2 - l2[I1]), 'x0': l1[I0],
                        'up_name': 'Línea clavicular (cuello)', 'lo_name': 'Cabeza (invalidación)',
                        'labels': [(l1, 'HI'), (l2, 'Cabeza'), (l3, 'HD')], 'notes': [],
                    })

    # =================================================================
    # PATRON 2: DOBLE TECHO (M) Y DOBLE SUELO (W) (separacion >= 10 velas)
    # =================================================================
    cand3 = []
    if len(piv) >= 3:
        cand3.append(piv[-3:])
    if len(piv) >= 4:
        cand3.append(piv[-4:-1])

    for grp in cand3:
        sq = ''.join(p[I2] for p in grp)
        if sq == 'HLH':
            h1, l1, h2 = grp
            sep = h2[I0] - h1[I0]
            top_v = max(h1[I1], h2[I1])
            amp = min(h1[I1], h2[I1]) - l1[I1]
            if (10 <= sep <= 65 and prior_slope_dir(h1[I0]) == 'UP'
                    and abs(h1[I1] - h2[I1]) <= 0.65 * atr and amp >= 2.0 * atr
                    and top_v >= float(np.max(s_hi[max(0, h1[I0] - 20):n - 1])) - 0.3 * atr
                    and body_confirms_high(h1[I0], h1[I1]) and body_confirms_high(h2[I0], h2[I1])):
                alive, _ = _pattern_alive(cl, h2[I0], 0.0, float(top_v), 0.0, float(l1[I1]), atr, max_broken_bars=3)
                if alive and spot <= top_v + 0.25 * atr:
                    candidates.append({
                        'prio': 90, 'pattern': 'Doble Techo (M)', 'kind': 'Reversión bajista',
                        'bias': 'DOWN', 'm_u': 0.0, 'b_u': float(top_v), 'm_l': 0.0, 'b_l': float(l1[I1]),
                        'height': float(top_v - l1[I1]), 'x0': h1[I0],
                        'up_name': 'Doble Techo (resistencia)', 'lo_name': 'Cuello (confirmación M)',
                        'labels': [(h1, 'Techo 1'), (h2, 'Techo 2')], 'notes': [],
                    })
        elif sq == 'LHL':
            l1, h1, l2 = grp
            sep = l2[I0] - l1[I0]
            bot_v = min(l1[I1], l2[I1])
            amp = h1[I1] - max(l1[I1], l2[I1])
            if (10 <= sep <= 65 and prior_slope_dir(l1[I0]) == 'DOWN'
                    and abs(l1[I1] - l2[I1]) <= 0.65 * atr and amp >= 2.0 * atr
                    and bot_v <= float(np.min(s_lo[max(0, l1[I0] - 20):n - 1])) + 0.3 * atr
                    and body_confirms_low(l1[I0], l1[I1]) and body_confirms_low(l2[I0], l2[I1])):
                alive, _ = _pattern_alive(cl, l2[I0], 0.0, float(h1[I1]), 0.0, float(bot_v), atr, max_broken_bars=3)
                if alive and spot >= bot_v - 0.25 * atr:
                    candidates.append({
                        'prio': 90, 'pattern': 'Doble Suelo (W)', 'kind': 'Reversión alcista',
                        'bias': 'UP', 'm_u': 0.0, 'b_u': float(h1[I1]), 'm_l': 0.0, 'b_l': float(bot_v),
                        'height': float(h1[I1] - bot_v), 'x0': l1[I0],
                        'up_name': 'Cuello (confirmación W)', 'lo_name': 'Doble Suelo (soporte)',
                        'labels': [(l1, 'Suelo 1'), (l2, 'Suelo 2')], 'notes': [],
                    })

    # =================================================================
    # PATRON 3: BANDERA ALCISTA / BAJISTA (impulso limpio en cuerpos)
    # =================================================================
    if n >= 32:
        for f_len in (9, 13, 17):
            f_start = n - 1 - f_len
            p_start = f_start - 10
            if p_start < 2:
                continue
            pole_disp = float(cl[f_start]) - float(cl[p_start])
            fx = np.arange(f_start, n - 1, dtype=float)
            fm, fb = np.polyfit(fx, cl[f_start:n - 1], 1)
            f_pred = fm * fx + fb
            off_u = max(float(np.max(body_hi[f_start:n - 1] - f_pred)), 0.45 * atr)
            off_l = max(float(np.max(f_pred - body_lo[f_start:n - 1])), 0.45 * atr)
            fb_u, fb_l = fb + off_u, fb - off_l
            f_rng = float(np.max(body_hi[f_start:n - 1]) - np.min(body_lo[f_start:n - 1]))

            if pole_disp >= 3.4 * atr and f_rng <= 0.48 * pole_disp and -0.18 * atr <= fm <= 0.01 * atr:
                alive, _ = _pattern_alive(cl, f_start, fm, fb_u, fm, fb_l, atr, max_broken_bars=2)
                if alive:
                    candidates.append({
                        'prio': 86, 'pattern': 'Bandera Alcista', 'kind': 'Continuación alcista',
                        'bias': 'UP', 'm_u': float(fm), 'b_u': float(fb_u), 'm_l': float(fm), 'b_l': float(fb_l),
                        'height': float(pole_disp), 'x0': int(f_start),
                        'up_name': 'Techo de bandera (gatillo)', 'lo_name': 'Soporte de bandera',
                        'labels': [], 'notes': ['Mástil alcista previo de +' + fc2(pole_disp) + ' confirmado en cierres'],
                    })
                    break
            if pole_disp <= -3.4 * atr and f_rng <= 0.48 * abs(pole_disp) and -0.01 * atr <= fm <= 0.18 * atr:
                alive, _ = _pattern_alive(cl, f_start, fm, fb_u, fm, fb_l, atr, max_broken_bars=2)
                if alive:
                    candidates.append({
                        'prio': 86, 'pattern': 'Bandera Bajista', 'kind': 'Continuación bajista',
                        'bias': 'DOWN', 'm_u': float(fm), 'b_u': float(fb_u), 'm_l': float(fm), 'b_l': float(fb_l),
                        'height': float(abs(pole_disp)), 'x0': int(f_start),
                        'up_name': 'Resistencia de bandera', 'lo_name': 'Base de bandera (gatillo)',
                        'labels': [], 'notes': ['Mástil bajista previo de ' + fc2(pole_disp) + ' confirmado en cierres'],
                    })
                    break

    # =================================================================
    # PATRON 4 Y 5: TRIANGULOS (ASC/DESC/SIM), CUNAS (ASC/DESC) Y RECTANGULO
    # =================================================================
    if len(highs) >= 2 and len(lows) >= 2:
        pts_h = highs[-2:]
        pts_l = lows[-2:]
        x0_t = int(min(pts_h[I0][I0], pts_l[I0][I0]))
        last_piv_x = int(max(pts_h[-1][I0], pts_l[-1][I0]))
        span_t = (n - 1) - x0_t
        if (15 <= span_t <= 85 and (n - 1 - last_piv_x) <= 14
                and (pts_h[-1][I0] - pts_h[I0][I0]) >= 5
                and (pts_l[-1][I0] - pts_l[I0][I0]) >= 5):
            m_u, b_u = _fit(pts_h)
            m_l, b_l = _fit(pts_l)
            w0 = (m_u * x0_t + b_u) - (m_l * x0_t + b_l)
            w1 = (m_u * (n - 1) + b_u) - (m_l * (n - 1) + b_l)
            alive, _ = _pattern_alive(cl, x0_t, m_u, b_u, m_l, b_l, atr, max_broken_bars=3)
            if alive and w0 >= 1.8 * atr and w1 >= 0.45 * atr:
                su, sl = m_u / atr, m_l / atr
                conv_ratio = w1 / w0
                t_notes = []
                if 0.22 <= conv_ratio <= 0.76:
                    x_apex = (b_l - b_u) / (m_u - m_l) if abs(m_u - m_l) > 1e-9 else (n + 20)
                    pct_ap = np.clip((n - 1 - x0_t) / max(x_apex - x0_t, 1.0) * 100.0, 10.0, 95.0)
                    t_notes.append('Compresión al ' + fd1(pct_ap) + '% del vértice (zona ideal: 50%–75%)')
                    if abs(su) <= 0.028 and sl >= 0.032:
                        candidates.append({
                            'prio': 82, 'pattern': 'Triángulo Ascendente', 'kind': 'Compresión alcista',
                            'bias': 'UP', 'm_u': m_u, 'b_u': b_u, 'm_l': m_l, 'b_l': b_l,
                            'height': float(w0), 'x0': x0_t,
                            'up_name': 'Techo horizontal (ruptura)', 'lo_name': 'Directriz alcista',
                            'labels': [], 'notes': t_notes,
                        })
                    elif su <= -0.032 and abs(sl) <= 0.028:
                        candidates.append({
                            'prio': 82, 'pattern': 'Triángulo Descendente', 'kind': 'Compresión bajista',
                            'bias': 'DOWN', 'm_u': m_u, 'b_u': b_u, 'm_l': m_l, 'b_l': b_l,
                            'height': float(w0), 'x0': x0_t,
                            'up_name': 'Directriz bajista', 'lo_name': 'Soporte horizontal (ruptura)',
                            'labels': [], 'notes': t_notes,
                        })
                    elif su <= -0.028 and sl >= 0.028:
                        tr_dir = prior_slope_dir(x0_t)
                        b_sim = tr_dir if tr_dir != 'FLAT' else ('UP' if cl[-1] >= cl[x0_t] else 'DOWN')
                        candidates.append({
                            'prio': 78, 'pattern': 'Triángulo Simétrico', 'kind': 'Compresión / Continuidad',
                            'bias': b_sim, 'm_u': m_u, 'b_u': b_u, 'm_l': m_l, 'b_l': b_l,
                            'height': float(w0), 'x0': x0_t,
                            'up_name': 'Directriz superior', 'lo_name': 'Directriz inferior',
                            'labels': [], 'notes': t_notes,
                        })
                    elif su >= 0.020 and sl >= 0.035 and sl >= su * 1.30:
                        wedge_slope_dir = 'UP'
                        h_wedge = max(float((m_l * (n - 1) + b_l) - pts_l[I0][I1]), float(w0))
                        candidates.append({
                            'prio': 85, 'pattern': 'Cuña Ascendente', 'kind': 'Agotamiento / Reversión bajista',
                            'bias': 'DOWN', 'm_u': m_u, 'b_u': b_u, 'm_l': m_l, 'b_l': b_l,
                            'height': h_wedge, 'x0': x0_t,
                            'up_name': 'Techo convergente', 'lo_name': 'Directriz de cuña (ruptura ↓)',
                            'labels': [], 'notes': t_notes + ['Objetivo proyectado hacia la base de origen de la cuña'],
                        })
                    elif su <= -0.035 and sl <= -0.020 and abs(su) >= abs(sl) * 1.30:
                        wedge_slope_dir = 'DOWN'
                        h_wedge = max(float(pts_h[I0][I1] - (m_u * (n - 1) + b_u)), float(w0))
                        candidates.append({
                            'prio': 85, 'pattern': 'Cuña Descendente', 'kind': 'Agotamiento / Reversión alcista',
                            'bias': 'UP', 'm_u': m_u, 'b_u': b_u, 'm_l': m_l, 'b_l': b_l,
                            'height': h_wedge, 'x0': x0_t,
                            'up_name': 'Directriz de cuña (ruptura ↑)', 'lo_name': 'Base convergente',
                            'labels': [], 'notes': t_notes + ['Objetivo proyectado hacia el tope de origen de la cuña'],
                        })
                elif abs(su) <= 0.022 and abs(sl) <= 0.022 and 0.80 <= conv_ratio <= 1.20:
                    r_top = float(np.mean([pts_h[I0][I1], pts_h[I1][I1]]))
                    r_bot = float(np.mean([pts_l[I0][I1], pts_l[I1][I1]]))
                    if r_top - r_bot >= 1.5 * atr:
                        candidates.append({
                            'prio': 75, 'pattern': 'Rectángulo Institucional', 'kind': 'Rango de consolidación',
                            'bias': prior_slope_dir(x0_t), 'm_u': 0.0, 'b_u': r_top, 'm_l': 0.0, 'b_l': r_bot,
                            'height': float(r_top - r_bot), 'x0': x0_t,
                            'up_name': 'Resistencia del rectángulo', 'lo_name': 'Soporte del rectángulo',
                            'labels': [], 'notes': [],
                        })

    # =================================================================
    # PATRON 6: CANAL DE TENDENCIA ACTIVO (REGRESION R^2 EN TIEMPO REAL)
    # =================================================================
    ch_act = _detect_active_channel(s_hi, s_lo, body_hi, body_lo, cl, atr)
    if ch_act is not None:
        slope_atr = ch_act['m'] / atr
        if ch_act['r2'] >= 0.48 and ch_act['move_atr'] >= 1.8 and abs(slope_atr) >= 0.03:
            is_up = ch_act['m'] > 0
            ch_dir = 'UP' if is_up else 'DOWN'
            same_as_wedge = (wedge_slope_dir == ch_dir)
            if (not same_as_wedge) and ch_act['w_len'] <= 24 and ch_act['r2'] >= 0.78 and ch_act['move_atr'] >= 2.6:
                ch_prio = 92
            else:
                ch_prio = 70
            candidates.append({
                'prio': ch_prio,
                'pattern': 'Canal Alcista' if is_up else 'Canal Bajista',
                'kind': 'Tendencia alcista activa' if is_up else 'Tendencia bajista activa',
                'bias': ch_dir,
                'm_u': ch_act['m'], 'b_u': ch_act['b_u'], 'm_l': ch_act['m'], 'b_l': ch_act['b_l'],
                'height': ch_act['width'], 'x0': ch_act['x0'],
                'up_name': 'Techo del canal', 'lo_name': 'Base del canal',
                'labels': [],
                'notes': ['Ajuste estadístico de tendencia R² = ' + fd2(ch_act['r2']) + ' (' + str(ch_act['w_len']) + ' velas)'],
            })

    if candidates:
        candidates.sort(key=lambda d: d['prio'], reverse=True)
        win = candidates[I0]
        pattern, kind, bias = win['pattern'], win['kind'], win['bias']
        m_u, b_u, m_l, b_l = win['m_u'], win['b_u'], win['m_l'], win['b_l']
        height, x0 = win['height'], win['x0']
        up_name, lo_name = win['up_name'], win['lo_name']
        labels, notes = list(win['labels']), list(win['notes'])
    else:
        w_box = min(35, n - 2)
        x0 = n - 1 - w_box
        top_box = float(np.percentile(s_hi[x0:n - 1], 95))
        bot_box = float(np.percentile(s_lo[x0:n - 1], 5))
        if top_box - bot_box < 1.0 * atr:
            mid_b = (top_box + bot_box) / 2.0
            top_box, bot_box = mid_b + 0.6 * atr, mid_b - 0.6 * atr
        pattern, kind, bias = 'Rango Lateral', 'Sin tendencia direccional', 'FLAT'
        m_u, b_u, m_l, b_l = 0.0, top_box, 0.0, bot_box
        height = top_box - bot_box
        up_name, lo_name = 'Resistencia del rango', 'Soporte del rango'
        labels, notes = [], ['Mercado lateralizado: operar únicamente ruptura confirmada de extremos']

    # ---------------- Huecos de precio reales (Gaps) ----------------
    gaps = []
    for i in range(max(1, n - 35), n):
        if s_lo[i] > s_hi[i - 1] and (s_lo[i] - s_hi[i - 1]) >= 0.35 * atr:
            g_lo, g_hi, g_dir = float(s_hi[i - 1]), float(s_lo[i]), 'UP'
        elif s_hi[i] < s_lo[i - 1] and (s_lo[i - 1] - s_hi[i]) >= 0.35 * atr:
            g_lo, g_hi, g_dir = float(s_hi[i]), float(s_lo[i - 1]), 'DOWN'
        else:
            continue
        after_lo = float(np.min(s_lo[i:]))
        after_hi = float(np.max(s_hi[i:]))
        filled = (after_lo <= g_lo) if g_dir == 'UP' else (after_hi >= g_hi)
        gaps.append({'x': i, 'lo': g_lo, 'hi': g_hi, 'dir': g_dir, 'filled': filled})
    open_gaps = [g for g in gaps if not g['filled']]
    if open_gaps:
        g = open_gaps[-1]
        notes.append(('Gap alcista abierto ' if g['dir'] == 'UP' else 'Gap bajista abierto ')
                     + fc2(g['lo']) + ' – ' + fc2(g['hi']))

    xs = np.arange(n, dtype=float)
    res_line = m_u * xs + b_u
    sup_line = m_l * xs + b_l
    res_now = float(res_line[-1])
    sup_now = float(sup_line[-1])
    if res_now <= sup_now:
        mid = (res_now + sup_now) / 2.0
        res_now, sup_now = mid + 0.5 * atr, max(1e-6, mid - 0.5 * atr)

    filt = 0.15 * atr
    span = max(res_now - sup_now, 1e-9)
    pos_pct = float(np.clip((spot - sup_now) / span * 100.0, 0.0, 100.0))

    vol_ok, vol_txt = None, 'Volumen no reportado'
    if 'volume' in sub.columns:
        v = sub['volume'].to_numpy(dtype=float)
        v_avg = float(np.mean(v[-21:-1])) if n > 21 else 0.0
        if v_avg > 0 and v[-1] > 0:
            vol_ratio = float(v[-1]) / v_avg
            vol_ok = vol_ratio >= 1.2
            vol_txt = ('Volumen ' + fd2(vol_ratio) + 'x media(20) '
                       + ('— fuerte confirmación ✅' if vol_ok else '— moderado ⚠️'))

    if 'Canal' in pattern:
        tgt_up = float(res_now) if spot <= res_now + filt else float(res_now + height)
        tgt_dn = float(sup_now) if spot >= sup_now - filt else float(max(spot * 0.05, sup_now - height))
    else:
        tgt_up = float(res_now + height)
        tgt_dn = float(max(spot * 0.05, sup_now - height))

    # ---------------- Confirmacion de Ruptura (calibrada con backtest + Monte Carlo) ----------------
    # En ~250,000 velas reales las rupturas "a secas" fallaron mas que el azar. Solo se opera la ruptura
    # que cumple las 3 reglas clasicas del chartismo: (1) va A FAVOR de la tendencia mayor (EMA 200),
    # (2) la vela de ruptura tiene cuerpo decidido (>= 0.6 ATR) y (3) el volumen supera 1.2x su media(20).
    atr_ref = atr
    if 'atr' in sub.columns:
        atr_df = float(sub['atr'].iloc[-1])
        if np.isfinite(atr_df) and atr_df > 0:
            atr_ref = atr_df
    ema200_now = float(sub['ema_200'].iloc[-1]) if 'ema_200' in sub.columns else spot
    body_atr = (spot - float(op[-1])) / atr_ref
    faltas_long, faltas_short = [], []
    if spot <= ema200_now:
        faltas_long.append('va contra la tendencia mayor: precio bajo EMA 200')
    else:
        faltas_short.append('va contra la tendencia mayor: precio sobre EMA 200')
    if body_atr < 0.6:
        faltas_long.append('vela de ruptura sin fuerza')
    if body_atr > -0.6:
        faltas_short.append('vela de ruptura sin fuerza')
    if vol_ok is False:
        faltas_long.append('volumen bajo')
        faltas_short.append('volumen bajo')

    # ---------------- Evaluacion de Rupturas con Filtro Anti-Climax ----------------
    signal, target = None, None
    if spot > res_now + filt:
        if pattern == 'Canal Alcista':
            breakout = ('🟡 Sobre-extensión sobre techo de Canal Alcista ($' + fc2(res_now)
                        + '): agotamiento comprador, se bloquea LONG en techo')
        elif rsi_now > 74.0:
            breakout = ('🟡 Ruptura sobre $' + fc2(res_now) + ' bloqueada por sobrecompra extrema (RSI '
                        + fd1(rsi_now) + '): riesgo de retroceso')
        elif prev_spot <= res_line[-2] + filt and faltas_long:
            breakout = ('🟡 Ruptura sobre $' + fc2(res_now) + ' SIN confirmar ('
                        + ', '.join(faltas_long) + '): se descarta el LONG')
        elif prev_spot <= res_line[-2] + filt:
            signal = 'LONG'
            tgt_up = float(res_now + height)
            target = tgt_up
            if bias == 'DOWN' and 'Canal' in pattern:
                pattern = 'Ruptura de Canal Bajista'
                kind, bias = 'Cambio a tendencia alcista', 'UP'
            breakout = '🟢 RUPTURA ALCISTA CONFIRMADA al cierre sobre $' + fc2(res_now)
        else:
            if bias == 'DOWN':
                bias = 'UP'
                kind = 'Ruptura alcista en curso'
            tgt_up = float(res_now + height)
            adv = (spot / res_now - 1.0) * 100.0
            breakout = '🟢 Ruptura alcista activa (+' + fd2(adv) + '% sobre $' + fc2(res_now) + '). Objetivo $' + fc2(tgt_up)
    elif spot < sup_now - filt:
        if pattern == 'Canal Bajista':
            breakout = ('🟡 Clímax vendedor bajo la base del Canal Bajista ($' + fc2(sup_now)
                        + '): agotamiento de caída, se bloquea SHORT en piso por alto riesgo de rebote')
        elif rsi_now < 26.0:
            breakout = ('🟡 Ruptura bajo $' + fc2(sup_now) + ' bloqueada por sobreventa extrema (RSI '
                        + fd1(rsi_now) + '): esperar rebote antes de vender')
        elif prev_spot >= sup_line[-2] - filt and faltas_short:
            breakout = ('🟡 Ruptura bajo $' + fc2(sup_now) + ' SIN confirmar ('
                        + ', '.join(faltas_short) + '): se descarta el SHORT')
        elif prev_spot >= sup_line[-2] - filt:
            signal = 'SHORT'
            tgt_dn = float(max(spot * 0.05, sup_now - height))
            target = tgt_dn
            if bias == 'UP' and 'Canal' in pattern:
                pattern = 'Ruptura de Canal Alcista'
                kind, bias = 'Cambio a tendencia bajista', 'DOWN'
            breakout = '🔴 RUPTURA BAJISTA CONFIRMADA al cierre bajo $' + fc2(sup_now)
        else:
            if bias == 'UP':
                bias = 'DOWN'
                kind = 'Ruptura bajista en curso'
            tgt_dn = float(max(spot * 0.05, sup_now - height))
            adv = (1.0 - spot / sup_now) * 100.0
            breakout = '🔴 Ruptura bajista activa (-' + fd2(adv) + '% bajo $' + fc2(sup_now) + '). Objetivo $' + fc2(tgt_dn)
    elif spot >= res_now:
        breakout = ('🟡 Probando ' + up_name + ' ($' + fc2(res_now)
                    + '): requiere cierre > $' + fc2(res_now + filt) + ' para LONG')
    elif spot <= sup_now:
        breakout = ('🟡 Probando ' + lo_name + ' ($' + fc2(sup_now)
                    + '): requiere cierre < $' + fc2(max(0.0, sup_now - filt)) + ' para SHORT')
    else:
        dist_res = max(0.0, (res_now - spot) / spot * 100.0)
        dist_sup = max(0.0, (spot - sup_now) / spot * 100.0)
        breakout = ('⚪ Dentro de la estructura: a +' + fd2(dist_res) + '% de ' + up_name
                    + ' y -' + fd2(dist_sup) + '% de ' + lo_name)

    bias_txt = {'UP': 'Alcista 🟢', 'DOWN': 'Bajista 🔴', 'FLAT': 'Neutral ⚪'}[bias]
    return {
        'pattern': pattern,
        'kind': kind,
        'bias': bias,
        'bias_txt': bias_txt,
        'spot': spot,
        'res_now': res_now,
        'sup_now': sup_now,
        'res_filt': float(res_now + filt),
        'sup_filt': float(max(0.0, sup_now - filt)),
        'pos_pct': pos_pct,
        'res_line': res_line,
        'sup_line': sup_line,
        'up_name': up_name,
        'lo_name': lo_name,
        'x0': int(x0),
        'height': float(height),
        'target': target,
        'target_up': tgt_up,
        'target_dn': tgt_dn,
        'vol_ok': vol_ok,
        'vol_txt': vol_txt,
        'notes': notes,
        'gaps': open_gaps,
        'reversal': None,
        'labels': labels,
        'pivots': [p for p in piv if p[I0] >= x0 - 2],
        's_hi': s_hi,
        's_lo': s_lo,
        'breakout_text': breakout,
        'signal': signal,
        'lookback': n,
    }


FAN_DEFS = (
    ('Velocidad 2/3', 1.0 / 3.0, 'speed'),
    ('Velocidad 1/3', 2.0 / 3.0, 'speed'),
    ('Abanico Fib 38.2%', 0.382, 'fib'),
    ('Abanico Fib 61.8%', 0.618, 'fib'),
    ('Gann 1x2 (50%)', 0.500, 'gann'),
    ('Gann 1x4 (75%)', 0.750, 'gann'),
)


def analyze_fibonacci(df, lookback=CHART_LOOKBACK):
    sub = df.tail(lookback).reset_index(drop=True)
    op = sub['open'].to_numpy(dtype=float)
    hi_r = sub['high'].to_numpy(dtype=float)
    lo_r = sub['low'].to_numpy(dtype=float)
    cl = sub['close'].to_numpy(dtype=float)
    hi_a, lo_a, _, _, _ = _structural_series(op, hi_r, lo_r, cl)
    n = len(sub)
    ihi, ilo = int(np.argmax(hi_a)), int(np.argmin(lo_a))
    hi, lo = float(hi_a[ihi]), float(lo_a[ilo])
    spot, prev = float(cl[-1]), float(cl[-2])
    diff = max(hi - lo, 1e-12)
    up = ilo < ihi
    ratios = [0.0, 0.236, 0.382, 0.500, 0.618, 0.786, 1.0]

    levels = dict()
    for r in ratios:
        levels[fd1(r * 100.0) + '%'] = (hi - diff * r) if up else (lo + diff * r)
    classic = dict()
    for nm, r in (('33%', 1.0 / 3.0), ('50%', 0.5), ('66%', 2.0 / 3.0)):
        classic[nm] = (hi - diff * r) if up else (lo + diff * r)
    retr_pct = ((hi - spot) / diff * 100.0) if up else ((spot - lo) / diff * 100.0)
    trend = 'Impulso Alcista' if up else 'Impulso Bajista'

    fib_618, fib_382 = levels['61.8%'], levels['38.2%']
    sig, sig_txt = None, None
    if up and ((prev <= fib_618 and spot > fib_618) or (prev <= fib_382 and spot > fib_382)):
        sig, sig_txt = 'LONG', 'Rebote alcista sobre retroceso áureo de Fibonacci'
    elif (not up) and ((prev >= fib_618 and spot < fib_618) or (prev >= fib_382 and spot < fib_382)):
        sig, sig_txt = 'SHORT', 'Rechazo bajista en retroceso áureo de Fibonacci'

    if up:
        xo, yo, xe, ye = ilo, lo, ihi, hi
    else:
        xo, yo, xe, ye = ihi, hi, ilo, lo
    run = max(1, xe - xo)
    fans = []
    for name, r, grp in FAN_DEFS:
        ya = (hi - diff * r) if up else (lo + diff * r)
        m = (ya - yo) / run
        fans.append({
            'name': name, 'r': r, 'group': grp, 'm': m,
            'now': yo + m * (n - 1 - xo), 'prev': yo + m * (n - 2 - xo),
        })
    m11 = (ye - yo) / run
    gann11 = {'name': 'Gann 1x1 (impulso)', 'r': 0.0, 'group': 'gann', 'm': m11,
              'now': yo + m11 * (n - 1 - xo), 'prev': yo + m11 * (n - 2 - xo)}

    notes = []
    after_end = (n - 1) > xe
    sp23 = fans[I0]
    sp13 = fans[I1]
    if after_end:
        if up:
            if prev >= sp13['prev'] and spot < sp13['now']:
                sig, sig_txt = 'SHORT', 'Pierde la línea de velocidad 1/3: cambio de tendencia'
            elif spot < sp13['now']:
                notes.append('Bajo velocidad 1/3: impulso alcista invalidado')
            elif spot < sp23['now']:
                notes.append('Corrección hacia línea de velocidad 1/3 (' + fc2(sp13['now']) + ')')
            else:
                notes.append('Sobre velocidad 2/3: impulso alcista sano')
        else:
            if prev <= sp13['prev'] and spot > sp13['now']:
                sig, sig_txt = 'LONG', 'Supera la línea de velocidad 1/3: cambio de tendencia'
            elif spot > sp13['now']:
                notes.append('Sobre velocidad 1/3: impulso bajista invalidado')
            elif spot > sp23['now']:
                notes.append('Rebote hacia línea de velocidad 1/3 (' + fc2(sp13['now']) + ')')
            else:
                notes.append('Bajo velocidad 2/3: tendencia bajista intacta')

    piv = _pivots(hi_a, lo_a)
    fan3, cur = [], None
    for p in piv:
        if p[I0] <= xo or p[I2] != ('L' if up else 'H'):
            continue
        m = (p[I1] - yo) / (p[I0] - xo)
        if (up and m <= 0) or ((not up) and m >= 0):
            continue
        flatter = (cur is None) or (m < cur * 0.92 if up else m > cur * 0.92)
        if flatter:
            fan3.append({'m': m, 'pivot': p})
            cur = m
        if len(fan3) == 3:
            break
    broken = 0
    for k, fl in enumerate(fan3):
        fl['name'] = 'Abanico ' + str(k + 1)
        fl['now'] = yo + fl['m'] * (n - 1 - xo)
        fl['prev'] = yo + fl['m'] * (n - 2 - xo)
        if (up and spot < fl['now']) or ((not up) and spot > fl['now']):
            broken += 1
    if len(fan3) == 3:
        f3 = fan3[I2]
        if up and prev >= f3['prev'] and spot < f3['now']:
            sig, sig_txt = 'SHORT', 'Principio del abanico: ruptura de la 3ª directriz'
        elif (not up) and prev <= f3['prev'] and spot > f3['now']:
            sig, sig_txt = 'LONG', 'Principio del abanico: ruptura de la 3ª directriz'
    fan_txt = ('Abanico clásico: ' + str(len(fan3)) + '/3 directrices activas (' + str(broken) + ' rotas)')
    if len(fan3) == 3 and broken == 3:
        fan_txt += ' ➔ giro confirmado'

    pool = sorted([v for v in (list(levels.values()) + [f['now'] for f in fans]) if v > 0])
    sups = [v for v in pool if v <= spot]
    ress = [v for v in pool if v > spot]
    return {
        'trend': trend, 'up': up, 'spot': spot, 'high': hi, 'low': lo,
        'levels': levels, 'classic': classic, 'retr_pct': float(retr_pct),
        'support': sups[-1] if sups else lo,
        'resistance': ress[I0] if ress else hi,
        'origin': (int(xo), float(yo)), 'end': (int(xe), float(ye)),
        'fans': fans, 'gann11': gann11, 'fan3': fan3, 'fan_txt': fan_txt,
        'notes': notes, 'signal': sig, 'signal_txt': sig_txt, 'lookback': n,
    }


def evaluate_strategy_signal(df, strat_key=None):
    sk = strat_key or STATE['strategy']
    last, prev = df.iloc[-1], df.iloc[-2]
    spot = float(last['close'])

    if sk == 'CHARTISMO':
        ch = analyze_chartismo(df)
        return ch['signal'], 'Chartismo: ' + ch['pattern'] + ' | ' + ch['breakout_text']

    if sk == 'FIBONACCI':
        fb = analyze_fibonacci(df)
        return fb['signal'], (
            'Fibonacci (' + fb['trend'] + '): Sop ' + fc2(fb['support'])
            + ' | Res ' + fc2(fb['resistance'])
            + ((' | ' + fb['signal_txt']) if fb['signal_txt'] else '')
        )

    if sk == 'EMA50_200':
        e50, e200 = float(last['ema_50']), float(last['ema_200'])
        p50, p200 = float(prev['ema_50']), float(prev['ema_200'])
        sig = None
        if p50 <= p200 and e50 > e200:
            sig = 'LONG'
        elif p50 >= p200 and e50 < e200:
            sig = 'SHORT'
        estado = 'Golden Cross (EMA50 > EMA200)' if e50 >= e200 else 'Death Cross (EMA50 < EMA200)'
        return sig, estado + ' | EMA50=' + fc2(e50) + ' vs EMA200=' + fc2(e200)

    if sk == 'RSI':
        r_now, r_prev = float(last['rsi']), float(prev['rsi'])
        sig = 'LONG' if (r_prev < 30 <= r_now) else ('SHORT' if (r_prev > 70 >= r_now) else None)
        # Filtro de tendencia mayor (validado en backtest): el RSI solo opera retrocesos A FAVOR de la EMA 200.
        nota = ''
        e200 = float(last['ema_200'])
        if (sig == 'LONG' and spot <= e200) or (sig == 'SHORT' and spot > e200):
            nota = ' | ' + sig + ' descartado: va contra la tendencia mayor (EMA 200)'
            sig = None
        return sig, 'RSI(14) actual: ' + fd1(r_now) + nota

    if sk == 'BOLLINGER':
        sig = None
        if float(prev['close']) < float(prev['bb_dn']) and spot >= float(last['bb_dn']):
            sig = 'LONG'
        elif float(prev['close']) > float(prev['bb_up']) and spot <= float(last['bb_up']):
            sig = 'SHORT'
        return sig, 'Bandas Bollinger: [' + fc2(last['bb_dn']) + ' - ' + fc2(last['bb_up']) + ']'

    d_now, d_prev = int(last['st_dir']), int(prev['st_dir'])
    sig = 'LONG' if (d_prev == -1 and d_now == 1) else ('SHORT' if (d_prev == 1 and d_now == -1) else None)
    est = 'Alcista 🟢' if d_now == 1 else 'Bajista 🔴'
    return sig, 'SuperTrend: ' + est + ' (Nivel ' + fc2(last['supertrend']) + ')'


# Geometria de salida calibrada con backtest + Monte Carlo sobre velas reales (ver informe):
# la direccion del precio NO es predecible (AUC ~0.50, Diebold-Mariano), la volatilidad SI. Por eso el
# Random Forest se usa para medir el recorrido esperado y el win rate se controla con la relacion TP/SL.
TP_FRAC_RF = 0.28   # TP = 28% del recorrido FAVORABLE que el RF espera en 12 velas (objetivo de alta probabilidad)
SL_MULT_RF = 2.40   # SL = 2.4x el recorrido ADVERSO esperado (queda fuera del ruido normal del mercado)
TP_ATR_BAND = (0.40, 0.60)   # limites del TP en multiplos de ATR(14)
SL_ATR_BAND = (4.50, 5.60)   # limites del SL en multiplos de ATR(14)
SL_MAX_PCT = 0.065           # el SL nunca pasa de 6.5% del precio (la liquidacion x10 esta al 9%)


def rf_levels(df, side, spot):
    """SL/TP dinamicos por volatilidad. El Random Forest estima cuanto se movera el precio a favor y en
    contra en las proximas 12 velas y el ATR(14) acota ese pronostico a la temporalidad activa.
    TP corto (alta probabilidad de tocarse) y SL fuera del ruido, siempre antes de la liquidacion."""
    hi_pct, lo_pct = None, None
    try:
        c = df['close']
        cols = dict()
        for k in (1, 3, 6, 12, 24):
            cols['r_' + str(k)] = c.pct_change(k)
        X = pd.DataFrame(cols, index=df.index)
        X['vol'] = c.pct_change().rolling(20).std()
        X = X.replace([np.inf, -np.inf], np.nan)
        h = 12
        fhi = pd.concat([df['high'].shift(-k) for k in range(1, h + 1)], axis=1).max(axis=1)
        flo = pd.concat([df['low'].shift(-k) for k in range(1, h + 1)], axis=1).min(axis=1)
        fhi.iloc[-h:], flo.iloc[-h:] = np.nan, np.nan
        yhi, ylo = np.log(fhi / c), np.log(flo / c)
        ok = X.notna().all(axis=1) & yhi.notna() & ylo.notna()
        if ok.sum() >= 60:
            m_hi = RandomForestRegressor(n_estimators=80, max_depth=6, random_state=42).fit(X.loc[ok], yhi.loc[ok])
            m_lo = RandomForestRegressor(n_estimators=80, max_depth=6, random_state=42).fit(X.loc[ok], ylo.loc[ok])
            lat = X.iloc[[-1]].bfill().ffill()
            hi_pct = float(np.exp(m_hi.predict(lat)[I0]) - 1.0)   # recorrido esperado hacia arriba
            lo_pct = float(1.0 - np.exp(m_lo.predict(lat)[I0]))   # recorrido esperado hacia abajo
    except Exception:
        hi_pct, lo_pct = None, None

    # Volatilidad real de la temporalidad activa: ATR(14) como % del precio
    atr_pct = None
    try:
        atr_val = float(df['atr'].iloc[-1])
        if np.isfinite(atr_val) and atr_val > 0:
            atr_pct = atr_val / float(spot)
    except Exception:
        atr_pct = None
    if atr_pct is None:
        atr_pct = float(((df['high'] - df['low']) / df['close']).tail(14).mean())
    atr_pct = float(np.clip(atr_pct, 0.0002, 0.05))

    # Recorrido a favor / en contra segun el lado (LONG gana hacia arriba, SHORT hacia abajo)
    fav = hi_pct if side == 'LONG' else lo_pct
    adv = lo_pct if side == 'LONG' else hi_pct
    if fav is None or adv is None or not np.isfinite(fav) or not np.isfinite(adv):
        fav, adv = 2.0 * atr_pct, 2.0 * atr_pct
    tp_pct = float(np.clip(TP_FRAC_RF * fav, TP_ATR_BAND[I0] * atr_pct, TP_ATR_BAND[I1] * atr_pct))
    sl_pct = float(np.clip(SL_MULT_RF * adv, SL_ATR_BAND[I0] * atr_pct, SL_ATR_BAND[I1] * atr_pct))
    if sl_pct > SL_MAX_PCT:
        tp_pct = tp_pct * SL_MAX_PCT / sl_pct
        sl_pct = SL_MAX_PCT

    dec = 2 if spot >= 1000.0 else (4 if spot >= 1.0 else 6)
    if side == 'LONG':
        tp = round(spot * (1.0 + tp_pct), dec)
        sl = round(spot * (1.0 - sl_pct), dec)
        liq = round(spot * (1.0 - 0.09), dec)
    else:
        tp = round(spot * (1.0 - tp_pct), dec)
        sl = round(spot * (1.0 + sl_pct), dec)
        liq = round(spot * (1.0 + 0.09), dec)
    return sl, tp, liq


# =====================================================================
# 5. EJECUCION APALANCADA x10 (MANUAL Y AUTO-TRADING)
# =====================================================================
TESTNET_FILE = DATA_DIR / 'testnet_ordenes.csv'


def testnet_orden(pos, accion):
    """Replica la operacion del bot en el testnet de futuros de Gate.io (orden a mercado, x10).
    Nunca interrumpe al bot: sin llaves no hace nada y, si la API falla, devuelve el motivo en texto.
    Cada orden queda registrada en testnet_ordenes.csv como evidencia."""
    if not (GATE_TESTNET_KEY and GATE_TESTNET_SECRET):
        return ''
    contract = str(pos['asset'])
    if accion == 'CERRAR' and not pos.get('testnet_size'):
        return ''
    if ASSETS.get(contract, dict()).get('source') != 'gate':
        return '🧪 Testnet Gate: ' + contract + ' no cotiza en futuros de Gate (queda solo en simulación)'
    cli = None
    try:
        cfg = gate_api.Configuration(host=GATE_TESTNET_HOST, key=GATE_TESTNET_KEY, secret=GATE_TESTNET_SECRET)
        cli = gate_api.ApiClient(cfg)
        api = gate_api.FuturesApi(cli)
        if accion == 'ABRIR':
            info = api.get_futures_contract('usdt', contract, _request_timeout=8)
            mult = float(info.quanto_multiplier or 1.0)
            px = float(info.mark_price or info.last_price)
            size = max(int(info.order_size_min or 1), int(round(float(pos['notional_usdt']) / (px * mult))))
            if pos['side'] == 'SHORT':
                size = -size
            try:
                api.update_position_leverage('usdt', contract, str(LEVERAGE), _request_timeout=8)
            except Exception as exc_lev:
                logging.warning('Testnet: no se pudo fijar apalancamiento x%s: %s', LEVERAGE, exc_lev)
            orden = gate_api.FuturesOrder(contract=contract, size=size, price='0', tif='ioc', text='t-botquant')
            res = api.create_futures_order('usdt', orden, _request_timeout=8)
            pos['testnet_size'] = size
        else:
            size = -int(pos['testnet_size'])
            try:
                orden = gate_api.FuturesOrder(contract=contract, size=0, close=True, price='0', tif='ioc',
                                              text='t-botquant')
                res = api.create_futures_order('usdt', orden, _request_timeout=8)
            except Exception:
                orden = gate_api.FuturesOrder(contract=contract, size=size, reduce_only=True, price='0',
                                              tif='ioc', text='t-botquant')
                res = api.create_futures_order('usdt', orden, _request_timeout=8)
        fill = float(getattr(res, 'fill_price', 0) or 0)
        estado = str(getattr(res, 'finish_as', '') or getattr(res, 'status', ''))
        ord_id = str(getattr(res, 'id', '') or '')
        if accion == 'ABRIR' and ord_id:
            pos['testnet_order_id'] = ord_id
        pd.DataFrame([{
            'utc': now_iso(), 'accion': accion, 'contrato': contract, 'lado': pos['side'],
            'contratos': size, 'orden_id': ord_id, 'precio_ejecucion': fill,
            'estado': estado, 'apalancamiento': 'x' + str(LEVERAGE),
        }]).to_csv(TESTNET_FILE, mode='a', index=False, header=not TESTNET_FILE.exists(), encoding='utf-8-sig')
        logging.info('Testnet Gate %s %s: orden %s, %s contratos a %s (%s)', accion, contract,
                     getattr(res, 'id', ''), size, fill, estado)
        return ('🧪 Testnet Gate: orden #' + str(getattr(res, 'id', '')) + ' ' + estado + ' | '
                + str(abs(size)) + ' contratos a $' + fc2(fill))
    except Exception as exc:
        motivo = str(getattr(exc, 'label', '') or type(exc).__name__)
        detalle = str(getattr(exc, 'message', '') or exc)[:120]
        logging.error('Testnet Gate %s %s fallo: %s %s', accion, contract, motivo, detalle)
        return '🧪 Testnet Gate: orden NO enviada (' + motivo + ': ' + detalle + ')'
    finally:
        try:
            if cli is not None:
                cli.close()
        except Exception:
            pass


def execute_open_x10(df, side, origin='AUTO'):
    with LOCK:
        if STATE['position'] is not None:
            return '⚠️ Ya existe una posición abierta en ' + str(STATE['position']['asset']) + '.'

        risk_pack = evaluate_all_risks(df)
        act = risk_pack['active']
        if risk_pack['blocked']:
            unit = '%' if act['is_pct'] else ''
            fmt_v = (fd2(act['val']) + '%') if act['is_pct'] else fd4(act['val'])
            msg = (
                '━━━ 🛑 OPERACIÓN RECHAZADA ━━━\n'
                + 'Activo: ' + str(STATE['asset']) + ' (' + TIMEFRAMES[STATE['timeframe']]['label'] + ')\n'
                + 'Motivo: ' + act['label'] + ' en ' + fmt_v + ' supera límite de ' + fd2(act['limit']) + unit
            )
            STATE['last_signal'] = msg
            save_state()
            return msg

        spot = float(df['close'].iloc[-1])
        notional = MARGIN_USDT * LEVERAGE
        qty = notional / spot
        sl, tp, liq = rf_levels(df, side, spot)

        STATE['position'] = {
            'asset': STATE['asset'],
            'timeframe': STATE['timeframe'],
            'strategy': STATE['strategy'],
            'risk_metric': act['label'],
            'side': side,
            'entry': round(spot, 6 if spot < 1.0 else 4),
            'margin_usdt': MARGIN_USDT,
            'leverage': LEVERAGE,
            'notional_usdt': notional,
            'qty': round(qty, 6),
            'sl': sl,
            'tp': tp,
            'liq': liq,
            'entry_utc': now_iso(),
            'entry_candle': int(df['t'].iloc[-1]),
        }
        side_em = '🟢 LONG' if side == 'LONG' else '🔴 SHORT'
        msg = (
            '━━━ ⚡ ORDEN EJECUTADA (' + str(origin) + ') ━━━\n'
            + side_em + ' x' + str(LEVERAGE) + ' | ' + str(STATE['asset']) + '\n'
            + '├─ Precio Entrada: $' + fc2(spot) + '\n'
            + '├─ Exposición: $' + fc0(notional) + ' (Margen $' + fc0(MARGIN_USDT) + ')\n'
            + '├─ 🎯 Take Profit (RF): $' + fc2(tp) + '\n'
            + '├─ 🛡️ Stop Loss (RF): $' + fc2(sl) + '\n'
            + '├─ 💀 Liquidación x10: $' + fc2(liq) + '\n'
            + '└─ Motor: ' + STRATEGIES[STATE['strategy']] + ' | ' + act['label'] + ' 🟢'
        )
        tn = testnet_orden(STATE['position'], 'ABRIR')
        if tn:
            msg = msg + '\n' + tn
        STATE['last_signal'] = msg
        save_state()
        return msg


def execute_close_x10(exit_price, reason='Manual'):
    with LOCK:
        pos = STATE['position']
        if not pos:
            return '⚠️ No hay posición abierta para cerrar.'
        entry = float(pos['entry'])
        direction = 1.0 if pos['side'] == 'LONG' else -1.0
        raw_ret = ((exit_price - entry) / entry) * direction
        pnl_usdt = pos['margin_usdt'] * pos['leverage'] * raw_ret
        roe_pct = raw_ret * pos['leverage'] * 100.0

        STATE['balance_usdt'] = round(STATE['balance_usdt'] + pnl_usdt, 2)
        STATE['realized_pnl_usdt'] = round(STATE['realized_pnl_usdt'] + pnl_usdt, 2)
        tn = testnet_orden(pos, 'CERRAR')
        write_trade_csv({
            'entrada_utc': pos['entry_utc'],
            'salida_utc': now_iso(),
            'activo': pos['asset'],
            'temporalidad': pos['timeframe'],
            'estrategia': pos['strategy'],
            'lado': pos['side'],
            'apalancamiento': 'x' + str(pos['leverage']),
            'entrada': entry,
            'salida': round(exit_price, 4),
            'motivo': reason,
            'roe_pct': round(roe_pct, 2),
            'pnl_usdt': round(pnl_usdt, 2),
            'orden_id': pos.get('testnet_order_id') or None,
        })
        try:
            registrar_prediccion_rf(pos, exit_price, reason)
        except Exception:
            logging.exception('No se pudo guardar la prediccion del RF')
        STATE['position'] = None
        res_icon = '✅ GANANCIA' if pnl_usdt >= 0 else '🔻 PÉRDIDA'
        msg = (
            '━━━ 🏁 POSICIÓN CERRADA ━━━\n'
            + str(pos['asset']) + ' ' + str(pos['side']) + ' x' + str(pos['leverage']) + ' | ' + res_icon + '\n'
            + '├─ Motivo: ' + str(reason) + '\n'
            + '├─ Entrada: $' + fc2(entry) + ' ➔ Salida: $' + fc2(exit_price) + '\n'
            + '├─ Resultado: ' + fs2(pnl_usdt) + ' USDT (' + fs2(roe_pct) + '% ROE)\n'
            + '└─ Saldo Actual: $' + fc2(STATE['balance_usdt']) + ' USDT'
        )
        if tn:
            msg = msg + '\n' + tn
        STATE['last_signal'] = msg
        save_state()
        return msg


def rf_decision(df, h=6):
    """Clasificador Random Forest Buy / Hold / Sell sobre indicadores tecnicos. Usa las MISMAS variables
    y etiquetas que la validacion (matriz de confusion y F1), asi que lo que se valida es lo que decide.
    Devuelve (decision, probabilidad %) para la ultima vela; (None, 0) si no hay datos para entrenar."""
    try:
        from sklearn.ensemble import RandomForestClassifier
        c = df['close']
        X = pd.DataFrame(index=df.index)
        for k in (1, 3, 6, 12, 24):
            X['r_' + str(k)] = np.log(c / c.shift(k))
        X['vol'] = c.pct_change().rolling(20).std()
        X['rango'] = ((df['high'] - df['low']) / c).rolling(14).mean()
        X['rsi'] = df['rsi'] / 100.0
        X['ema50'] = df['ema_50'] / c - 1.0
        X['ema200'] = df['ema_200'] / c - 1.0
        X = X.replace([np.inf, -np.inf], np.nan)
        fwd = np.log(c.shift(-h) / c)
        tau = 0.5 * np.log(c / c.shift(1)).ewm(span=100).std() * np.sqrt(h)
        y = pd.Series(np.where(fwd > tau, 1, np.where(fwd < -tau, -1, 0)), index=df.index)
        ok = X.notna().all(axis=1) & fwd.notna() & tau.notna()
        ultima = X.iloc[[-1]]
        if int(ok.sum()) < 150 or bool(ultima.isna().any(axis=1).iloc[I0]) or y[ok].nunique() < 2:
            return None, 0.0
        clf = RandomForestClassifier(n_estimators=100, max_depth=6, min_samples_leaf=10,
                                     class_weight='balanced_subsample', max_features='sqrt', random_state=42)
        clf.fit(X[ok], y[ok])
        proba = clf.predict_proba(ultima)[I0]
        k_max = int(np.argmax(proba))
        nombres = {1: 'BUY', 0: 'HOLD', -1: 'SELL'}
        return nombres[int(clf.classes_[k_max])], float(proba[k_max] * 100.0)
    except Exception:
        logging.exception('No se pudo calcular la decision del Random Forest')
        return None, 0.0


def step_auto_trading(df, pos_df=None):
    with LOCK:
        msgs = []
        pos = STATE['position']

        # Revisa TODAS las velas posteriores a la entrada, en orden: asi el SL siempre se ejecuta antes que
        # la liquidacion y no se pierde una salida si el bot estuvo detenido o salto alguna vela.
        if pos is not None:
            src_df = pos_df if pos_df is not None else df
            bars = src_df[src_df['t'] > int(pos.get('entry_candle', 0))]
            for b_open, hi, lo in zip(bars['open'].astype(float), bars['high'].astype(float), bars['low'].astype(float)):
                if pos['side'] == 'LONG':
                    if b_open <= pos['liq']:
                        msgs.append(execute_close_x10(pos['liq'], 'LIQUIDACIÓN x10'))
                    elif lo <= pos['sl']:
                        msgs.append(execute_close_x10(pos['sl'], 'STOP LOSS'))
                    elif hi >= pos['tp']:
                        msgs.append(execute_close_x10(pos['tp'], 'TAKE PROFIT'))
                else:
                    if b_open >= pos['liq']:
                        msgs.append(execute_close_x10(pos['liq'], 'LIQUIDACIÓN x10'))
                    elif hi >= pos['sl']:
                        msgs.append(execute_close_x10(pos['sl'], 'STOP LOSS'))
                    elif lo <= pos['tp']:
                        msgs.append(execute_close_x10(pos['tp'], 'TAKE PROFIT'))
                if STATE['position'] is None:
                    break

        candle = int(df['t'].iloc[-1])
        if STATE['last_candle'] == candle:
            return msgs
        STATE['last_candle'] = candle
        save_state()

        if not STATE['trading_enabled'] or STATE['position'] is not None:
            return msgs

        sig, _ = evaluate_strategy_signal(df)
        if sig in ('LONG', 'SHORT'):
            # La estrategia PROPONE y el modelo DECIDE: el Random Forest debe confirmar (Buy para LONG,
            # Sell para SHORT). Si dice Hold o lo contrario, la señal se descarta. Las ordenes manuales no pasan por aqui.
            dec, prob = rf_decision(df)
            esperado = 'BUY' if sig == 'LONG' else 'SELL'
            if dec is not None and dec != esperado:
                msg = (
                    '━━━ 🤖 SEÑAL DESCARTADA POR EL MODELO ━━━\n'
                    + str(STATE['asset']) + ' (' + TIMEFRAMES[STATE['timeframe']]['label'] + ')\n'
                    + '├─ ' + STRATEGIES[STATE['strategy']] + ' propuso: ' + sig + '\n'
                    + '└─ Random Forest decide: ' + dec + ' (' + fd0_pct(prob) + ') ➔ no se opera'
                )
                STATE['last_signal'] = msg
                save_state()
                msgs.append(msg)
            else:
                msg = execute_open_x10(df, sig, origin='AUTO')
                if dec is not None and 'ORDEN EJECUTADA' in msg:
                    msg = msg + '\n🤖 Random Forest confirma: ' + dec + ' (' + fd0_pct(prob) + ')'
                msgs.append(msg)
        return msgs


# =====================================================================
# 6. INTERFAZ DE REPORTES Y GRAFICO DARK QUANT PRO
# =====================================================================
def fd0_pct(val):
    return format(float(val), '.0f') + '%'


def format_full_report(df):
    sym = STATE['asset']
    tf = STATE['timeframe']
    strat = STATE['strategy']
    info = ASSETS[sym]
    cls_cfg = ASSET_CLASSES[info['type']]
    spot = float(df['close'].iloc[-1])
    prev = float(df['close'].iloc[-2])
    chg_candle = ((spot / prev) - 1.0) * 100.0 if prev else 0.0

    risk_pack = evaluate_all_risks(df)
    all_r = risk_pack['all']
    act_k = risk_pack['active_key']
    act = risk_pack['active']

    ratio_r = act['val'] / act['limit'] if act['limit'] > 0 else 0.0
    r_bar = bar_meter(ratio_r, 10)
    sem_header = (
        '🔴 BLOQUEADO (Riesgo alto)' if act['blocked']
        else '🟢 APTO PARA OPERAR'
    )

    lines_r = []
    for k in ('CAVIAR99', 'CVAR99', 'VAR99'):
        it = all_r[k]
        mark = ' ◀ ACTIVO' if k == act_k else ''
        lines_r.append(
            ' ' + it['icon'] + ' ' + it['label'] + ' (' + it['target'] + '): '
            + fd2(it['val']) + '% / ' + fd2(it['limit']) + '%' + mark
        )

    sig, _ = evaluate_strategy_signal(df, strat)
    auto_badge = '🟢 ON' if STATE['trading_enabled'] else '⏸️ PAUSA'

    if sig == 'LONG':
        sl, tp, _ = rf_levels(df, 'LONG', spot)
        verdict_box = (
            '🟢 ACCIÓN: SEÑAL DE COMPRA (LONG x' + str(LEVERAGE) + ')\n'
            + ' ├─ Entrada ref: $' + fc2(spot) + '\n'
            + ' └─ TP sugerido (RF): $' + fc2(tp) + ' | SL: $' + fc2(sl)
        )
    elif sig == 'SHORT':
        sl, tp, _ = rf_levels(df, 'SHORT', spot)
        verdict_box = (
            '🔴 ACCIÓN: SEÑAL DE VENTA (SHORT x' + str(LEVERAGE) + ')\n'
            + ' ├─ Entrada ref: $' + fc2(spot) + '\n'
            + ' └─ TP sugerido (RF): $' + fc2(tp) + ' | SL: $' + fc2(sl)
        )
    else:
        verdict_box = '⚪ ACCIÓN: EN ESPERA (sin gatillo confirmado en esta vela)'
    dec_rf, prob_rf = rf_decision(df)
    if dec_rf is not None:
        verdict_box = verdict_box + '\n🤖 Modelo Random Forest: ' + dec_rf + ' (' + fd0_pct(prob_rf) + ')'
        if sig in ('LONG', 'SHORT') and dec_rf != ('BUY' if sig == 'LONG' else 'SELL'):
            verdict_box = verdict_box + ' ➔ el modelo NO confirma: en automático no se opera'

    return (
        '━━━ 📊 REPORTE QUANT x' + str(LEVERAGE) + ' ━━━\n'
        + cls_cfg['icon'] + ' ' + info['name'] + ' (' + sym + ') | ⏱️ ' + TIMEFRAMES[tf]['label'] + '\n'
        + '💵 Precio: $' + fc2(spot) + ' (' + fs2(chg_candle) + '% vela) | 🤖 Auto: ' + auto_badge + '\n\n'
        + '🛡️ SEMÁFORO DE RIESGO: ' + sem_header + '\n'
        + ' Uso límite: [' + r_bar + '] ' + fd0_pct(ratio_r * 100.0) + '\n'
        + '\n'.join(lines_r) + '\n\n'
        + '📐 DIAGNÓSTICO TÉCNICO — ' + STRATEGIES[strat] + '\n'
        + '\n'.join(strategy_report_lines(df, strat)) + '\n\n'
        + '🎯 CONCLUSIÓN OPERATIVA\n'
        + verdict_box
    )


def strategy_report_lines(df, strat):
    last = df.iloc[-1]
    spot = float(last['close'])

    if strat == 'CHARTISMO':
        ch = analyze_chartismo(df)
        slider = range_slider(ch['pos_pct'], 11)
        lines = [
            ' 📌 Patrón: ' + ch['pattern'],
            ' 🧭 Estructura: ' + ch['kind'] + ' | Sesgo: ' + ch['bias_txt'],
            ' 📏 Ubicación en figura (' + fd1(ch['pos_pct']) + '%): Sop ' + slider + ' Res',
            ' 🔼 ' + ch['up_name'] + ': $' + fc2(ch['res_now']) + ' (ruptura > $' + fc2(ch['res_filt']) + ')',
            ' 🔽 ' + ch['lo_name'] + ': $' + fc2(ch['sup_now']) + ' (ruptura < $' + fc2(ch['sup_filt']) + ')',
        ]
        if ch['bias'] == 'UP':
            lines.append(' 🎯 Objetivo técnico alcista: $' + fc2(ch['target_up']))
        elif ch['bias'] == 'DOWN':
            lines.append(' 🎯 Objetivo técnico bajista: $' + fc2(ch['target_dn']))
        else:
            lines.append(' 🎯 Objetivos por ruptura: ↑ $' + fc2(ch['target_up']) + ' | ↓ $' + fc2(ch['target_dn']))
        lines.append(' 📊 ' + ch['vol_txt'])
        for nt in ch['notes']:
            lines.append(' 💡 ' + nt)
        lines.append(' 🔎 Lectura: ' + ch['breakout_text'])
        return lines

    if strat == 'FIBONACCI':
        fb = analyze_fibonacci(df)
        lv = fb['levels']
        by = {f['name']: f['now'] for f in fb['fans']}
        span = max(fb['resistance'] - fb['support'], 1e-9)
        pct_s = np.clip((spot - fb['support']) / span * 100.0, 0.0, 100.0)
        lines = [
            ' 📌 Estructura: ' + fb['trend'] + ' (retroceso ' + fd1(fb['retr_pct']) + '%)',
            ' 📏 Rango extremo: $' + fc2(fb['low']) + ' ➔ $' + fc2(fb['high']),
            ' 🎯 Zona Áurea: 38.2% ($' + fc2(lv['38.2%']) + ') | 50% ($' + fc2(lv['50.0%']) + ') | 61.8% ($' + fc2(lv['61.8%']) + ')',
            ' ⚡ Velocidad hoy: 2/3 ($' + fc2(by['Velocidad 2/3']) + ') | 1/3 ($' + fc2(by['Velocidad 1/3']) + ')',
            ' 📐 Gann hoy: 1x1 ($' + fc2(fb['gann11']['now']) + ') | 1x2 ($' + fc2(by['Gann 1x2 (50%)']) + ')',
            ' 🧭 ' + fb['fan_txt'],
            ' 📍 Nivel inmediato: Sop $' + fc2(fb['support']) + ' ' + range_slider(pct_s, 9) + ' Res $' + fc2(fb['resistance']),
        ]
        for nt in fb['notes']:
            lines.append(' 💡 ' + nt)
        if fb['signal_txt']:
            lines.append(' 🔎 Gatillo: ' + fb['signal_txt'])
        return lines

    if strat == 'EMA50_200':
        e50, e200 = float(last['ema_50']), float(last['ema_200'])
        estado = 'Golden Cross Alcista 🟢' if e50 >= e200 else 'Death Cross Bajista 🔴'
        return [
            ' 📌 Régimen: ' + estado,
            ' 📈 EMA 50 (rápida): $' + fc2(e50),
            ' 📉 EMA 200 (lenta): $' + fc2(e200) + ' (spread ' + fs2((e50 / e200 - 1.0) * 100.0) + '%)',
            ' 📏 Distancia precio vs EMA 200: ' + fs2((spot / e200 - 1.0) * 100.0) + '%',
        ]

    if strat == 'RSI':
        r = float(last['rsi'])
        zona = 'Sobrecompra (>70) 🔴' if r > 70 else ('Sobreventa (<30) 🟢' if r < 30 else 'Neutral (30–70) ⚪')
        return [
            ' 📌 Oscilador RSI(14): ' + fd1(r) + ' | ' + zona,
            ' 📏 Nivel: [' + bar_meter(r / 100.0, 10) + '] ' + fd1(r) + '/100',
            ' 🔎 Regla: Compra al recuperar 30 | Venta al perder 70 (solo a favor de la EMA 200)',
        ]

    if strat == 'BOLLINGER':
        up, dn, mid = float(last['bb_up']), float(last['bb_dn']), float(last['bb_mid'])
        pct_b = np.clip((spot - dn) / max(up - dn, 1e-9) * 100.0, 0.0, 100.0)
        return [
            ' 🔼 Banda Superior: $' + fc2(up),
            ' ➖ Media Base (20): $' + fc2(mid),
            ' 🔽 Banda Inferior: $' + fc2(dn),
            ' 📏 Posición %B: Inf ' + range_slider(pct_b, 9) + ' Sup (' + fd1(pct_b) + '%)',
            ' 📊 Volatilidad (ancho): ' + fd2((up - dn) / mid * 100.0) + '%',
        ]

    d_now = int(last['st_dir'])
    st_val = float(last['supertrend'])
    dist = abs(spot - st_val) / spot * 100.0
    return [
        ' 📌 Tendencia SuperTrend (10, 3.0): ' + ('Alcista 🟢' if d_now == 1 else 'Bajista 🔴'),
        ' 🛡️ Stop dinámico actual: $' + fc2(st_val) + ' (a ' + fd2(dist) + '% del precio)',
    ]


def _draw_right_pills(ax, x_pos, items, y_span):
    """Dibuja etiquetas de precio a la derecha separandolas si estan muy juntas."""
    min_gap = max(y_span * 0.055, 1e-6)
    ordered = sorted(items, key=lambda t: t[I0])
    adj_y = [float(t[I0]) for t in ordered]
    for i in range(1, len(adj_y)):
        if adj_y[i] - adj_y[i - 1] < min_gap:
            adj_y[i] = adj_y[i - 1] + min_gap
    for (_, txt, bg_col), y_draw in zip(ordered, adj_y):
        ax.annotate(
            ' ' + txt + ' ',
            xy=(x_pos, y_draw), xytext=(4, 0), textcoords='offset points',
            va='center', ha='left', fontsize=8, fontweight='bold', color='#ffffff',
            bbox=dict(boxstyle='round,pad=0.22', facecolor=bg_col, edgecolor='none', alpha=0.93),
            clip_on=False,
        )


def build_report_chart(df):
    """Grafico Dark Quant Pro con zoom dinamico adaptado al patron o tramo activo."""
    sym = STATE['asset']
    tf = STATE['timeframe']
    strat = STATE['strategy']
    risk_pack = evaluate_all_risks(df)
    act = risk_pack['active']
    act_k = risk_pack['active_key']

    df_plot = df.copy()
    df_plot['r_curve'] = rolling_active_risk(df_plot, act_k)
    rec = df_plot.tail(CHART_LOOKBACK).reset_index(drop=True)
    n = len(rec)
    x = np.arange(n)
    dates = pd.to_datetime(rec['t'], unit='s', utc=True)
    spot = float(rec['close'].iloc[-1])

    bg_fig = '#0b1120'
    bg_ax = '#0f172a'
    grid_c = '#1e293b'
    txt_c = '#e2e8f0'
    muted_c = '#94a3b8'
    up_c = '#10b981'
    dn_c = '#ef4444'

    with_rsi = (strat == 'RSI')
    if with_rsi:
        fig, (ax1, axm, ax2) = plt.subplots(
            3, 1, figsize=(10.8, 8.4), sharex=True,
            gridspec_kw={'height_ratios': [2.6, 0.85, 0.95]})
        axes = (ax1, axm, ax2)
    else:
        fig, (ax1, ax2) = plt.subplots(
            2, 1, figsize=(10.8, 7.2), sharex=True,
            gridspec_kw={'height_ratios': [2.8, 0.95]})
        axes = (ax1, ax2)

    fig.patch.set_facecolor(bg_fig)
    for a in axes:
        a.set_facecolor(bg_ax)
        a.tick_params(colors=muted_c, labelsize=8.5)
        for sp in a.spines.values():
            sp.set_color('#334155')
        a.grid(color=grid_c, linestyle='-', linewidth=0.7, alpha=0.8)

    s_hi, s_lo, _, _, _ = _structural_series(
        rec['open'].to_numpy(float), rec['high'].to_numpy(float),
        rec['low'].to_numpy(float), rec['close'].to_numpy(float)
    )
    up = rec['close'] >= rec['open']
    body = (rec['close'] - rec['open']).abs()
    min_b = max(float(np.median(s_hi - s_lo)) * 0.04, 1e-6)
    body_draw = np.maximum(body, min_b)
    bottoms = np.minimum(rec['open'], rec['close'])
    for mask, col in ((up, up_c), (~up, dn_c)):
        ax1.vlines(x[mask], s_lo[mask], s_hi[mask], color=col, lw=1.05, alpha=0.9)
        ax1.bar(x[mask], body_draw[mask], bottom=bottoms[mask], width=0.66,
                color=col, edgecolor=col, lw=0.4, zorder=3)

    ax1.axhline(spot, color='#38bdf8', ls=':', lw=0.9, alpha=0.7)
    pills = [(spot, 'Spot ' + fc2(spot), '#0284c7')]
    subtitle = ''

    # Recorte visual dinamico (zoom sobre lo ultimo / figura activa)
    view_start = max(0, n - 45)
    extra_y_vals = [spot]

    if strat == 'CHARTISMO':
        ch = analyze_chartismo(df_plot)
        pad_left = 10 if 'Bandera' in ch['pattern'] else 7
        view_start = max(0, min(int(ch['x0']) - pad_left, n - 22))

        xi = np.arange(max(0, ch['x0']), n)
        fill_col = '#10b981' if ch['bias'] == 'UP' else ('#ef4444' if ch['bias'] == 'DOWN' else '#38bdf8')
        ax1.fill_between(xi, ch['sup_line'][xi], ch['res_line'][xi],
                         color=fill_col, alpha=0.08, zorder=1)
        ax1.plot(xi, ch['res_line'][xi], color='#fb7185', lw=2.1, zorder=4,
                 label=ch['up_name'] + ' (' + fc2(ch['res_now']) + ')')
        ax1.plot(xi, ch['sup_line'][xi], color='#38bdf8', lw=2.1, zorder=4,
                 label=ch['lo_name'] + ' (' + fc2(ch['sup_now']) + ')')
        pills.append((ch['res_now'], 'Res ' + fc2(ch['res_now']), '#be123c'))
        pills.append((ch['sup_now'], 'Sop ' + fc2(ch['sup_now']), '#1d4ed8'))
        extra_y_vals.extend([
            float(np.max(ch['res_line'][xi])),
            float(np.min(ch['sup_line'][xi])),
        ])

        for p in ch['pivots']:
            if p[I0] >= view_start:
                ax1.scatter(p[I0], p[I1], s=48, zorder=5,
                            marker='v' if p[I2] == 'H' else '^',
                            color='#fda4af' if p[I2] == 'H' else '#93c5fd',
                            edgecolors='#0f172a', linewidths=0.6)
        for p, txt in ch['labels']:
            if p[I0] >= view_start:
                off = 11 if p[I2] == 'H' else -16
                ax1.annotate(
                    txt, (p[I0], p[I1]), textcoords='offset points', xytext=(0, off),
                    ha='center', fontsize=8.5, fontweight='bold', color='#fef08a',
                    bbox=dict(boxstyle='round,pad=0.18', facecolor='#1e293b', edgecolor='#eab308', lw=0.8),
                    zorder=6,
                )

        if ch['bias'] == 'UP' and abs(ch['target_up'] - ch['res_now']) > 1e-6:
            ax1.axhline(ch['target_up'], color='#34d399', ls='--', lw=1.3, alpha=0.85,
                        label='Objetivo ↑ (' + fc2(ch['target_up']) + ')')
            if ch['target_up'] <= spot * 1.06:
                extra_y_vals.append(ch['target_up'])
        elif ch['bias'] == 'DOWN' and abs(ch['target_dn'] - ch['sup_now']) > 1e-6:
            ax1.axhline(ch['target_dn'], color='#f87171', ls='--', lw=1.3, alpha=0.85,
                        label='Objetivo ↓ (' + fc2(ch['target_dn']) + ')')
            if ch['target_dn'] >= spot * 0.94:
                extra_y_vals.append(ch['target_dn'])

        for g in ch['gaps']:
            if g['x'] >= view_start:
                ax1.fill_between([g['x'] - 1, n - 1], g['lo'], g['hi'], color='#f59e0b', alpha=0.18)
                ax1.text(g['x'], g['hi'], ' Gap', fontsize=7.5, color='#fbbf24', va='bottom')

        if ch['signal']:
            ax1.scatter(n - 1, ch['spot'], marker='*', s=260, zorder=7,
                        color='#22c55e' if ch['signal'] == 'LONG' else '#ef4444',
                        edgecolors='#ffffff', linewidths=0.9,
                        label='RUPTURA ' + ch['signal'])
        subtitle = ch['pattern'] + ' • ' + ch['kind'] + ' • Sesgo ' + ch['bias_txt'][:-2]

    elif strat == 'FIBONACCI':
        fb = analyze_fibonacci(df_plot)
        xo, yo = fb['origin']
        xe, ye = fb['end']
        view_start = max(0, min(xo, xe) - 5)
        view_start = min(view_start, max(0, n - 25))

        for lbl in ('23.6%', '38.2%', '50.0%', '61.8%', '78.6%'):
            val = fb['levels'][lbl]
            strong = lbl in ('38.2%', '50.0%', '61.8%')
            col_f = '#fbbf24' if strong else '#64748b'
            ax1.axhline(val, color=col_f, ls='--' if strong else ':', lw=1.2 if strong else 0.8, alpha=0.8)
            ax1.text(view_start + 0.4, val, ' Fib ' + lbl + ' (' + fc2(val) + ')',
                     fontsize=7.5, color=col_f, va='bottom')
        ax1.plot([xo, xe], [yo, ye], color='#f8fafc', lw=1.2, ls='--', alpha=0.75)
        ax1.scatter([xo, xe], [yo, ye], s=45, color='#fbbf24', zorder=5)
        xf = np.arange(xo, n + 2)
        styles = {'speed': ('#fb923c', '--', 1.4), 'fib': ('#38bdf8', '-', 1.2), 'gann': ('#c084fc', '-.', 1.2)}
        seen = set()
        for f in fb['fans'] + [fb['gann11']]:
            col, ls, lw = styles[f['group']]
            grp_lbl = {'speed': 'Velocidad 1/3 y 2/3', 'fib': 'Abanico Fib 38.2 / 61.8',
                       'gann': 'Abanico Gann 1x1 / 1x2 / 1x4'}[f['group']]
            yf = yo + f['m'] * (xf - xo)
            ax1.plot(xf, yf, color=col, ls=ls, lw=lw, alpha=0.85,
                     label=None if f['group'] in seen else grp_lbl)
            seen.add(f['group'])
        for k, fl in enumerate(fb['fan3']):
            yf = yo + fl['m'] * (xf - xo)
            ax1.plot(xf, yf, color='#fde047', lw=1.6,
                     label='Principio Abanico (1-2-3)' if k == 0 else None)
        extra_y_vals.extend([fb['low'], fb['high']])
        subtitle = fb['trend'] + ' • Retroceso ' + fd1(fb['retr_pct']) + '%'

    elif strat == 'EMA50_200':
        d = np.sign((rec['ema_50'] - rec['ema_200']).to_numpy())
        crosses = [i for i in range(1, n) if d[i] != d[i - 1] and d[i] != 0]
        if crosses and (n - crosses[-1]) <= 65:
            view_start = max(0, crosses[-1] - 8)
        else:
            view_start = max(0, n - 50)
        ax1.plot(x, rec['ema_50'], color='#facc15', lw=2.0, label='EMA 50 (' + fc2(rec['ema_50'].iloc[-1]) + ')')
        ax1.plot(x, rec['ema_200'], color='#c084fc', lw=2.0, label='EMA 200 (' + fc2(rec['ema_200'].iloc[-1]) + ')')
        for i in crosses:
            if i >= view_start:
                ax1.scatter(i, rec['ema_50'][i], marker='^' if d[i] > 0 else 'v', s=130, zorder=6,
                            color='#22c55e' if d[i] > 0 else '#ef4444', edgecolors='#ffffff')
        extra_y_vals.extend(rec['ema_50'].iloc[view_start:].tolist())
        extra_y_vals.extend(rec['ema_200'].iloc[view_start:].tolist())
        subtitle = 'Golden Cross Alcista' if d[-1] > 0 else 'Death Cross Bajista'

    elif strat == 'BOLLINGER':
        view_start = max(0, n - 45)
        ax1.plot(x, rec['bb_up'], color='#22d3ee', lw=1.4, label='Banda Sup (' + fc2(rec['bb_up'].iloc[-1]) + ')')
        ax1.plot(x, rec['bb_mid'], color='#94a3b8', ls='--', lw=1.1, label='Media 20')
        ax1.plot(x, rec['bb_dn'], color='#22d3ee', lw=1.4, label='Banda Inf (' + fc2(rec['bb_dn'].iloc[-1]) + ')')
        ax1.fill_between(x, rec['bb_dn'], rec['bb_up'], color='#22d3ee', alpha=0.09)
        extra_y_vals.extend(rec['bb_up'].iloc[view_start:].dropna().tolist())
        extra_y_vals.extend(rec['bb_dn'].iloc[view_start:].dropna().tolist())
        subtitle = 'Bandas de Bollinger (20, 2)'

    elif strat == 'SUPERTREND':
        d_st = rec['st_dir'].to_numpy()
        flips = [i for i in range(1, n) if d_st[i] != d_st[i - 1]]
        if flips and (n - flips[-1]) <= 55:
            view_start = max(0, flips[-1] - 8)
        else:
            view_start = max(0, n - 45)
        st_up = rec['supertrend'].where(rec['st_dir'] == 1)
        st_dn = rec['supertrend'].where(rec['st_dir'] == -1)
        ax1.plot(x, st_up, color='#10b981', lw=2.2, label='SuperTrend Alcista')
        ax1.plot(x, st_dn, color='#ef4444', lw=2.2, label='SuperTrend Bajista')
        extra_y_vals.extend(rec['supertrend'].iloc[view_start:].dropna().tolist())
        subtitle = 'SuperTrend (10, 3.0)'

    else:
        view_start = max(0, n - 45)
        axm.plot(x, rec['rsi'], color='#a78bfa', lw=1.7, label='RSI(14)')
        axm.axhline(70, color='#f87171', ls='--', lw=1.0)
        axm.axhline(30, color='#34d399', ls='--', lw=1.0)
        axm.axhspan(30, 70, color='#38bdf8', alpha=0.06)
        axm.set_ylim(0, 100)
        axm.set_ylabel('RSI', color=txt_c)
        axm.legend(loc='upper left', fontsize=8, facecolor='#1e293b', edgecolor='#334155', labelcolor=txt_c)
        subtitle = 'RSI(14) = ' + fd1(rec['rsi'].iloc[-1])

    vis_lo = min(float(np.min(s_lo[view_start:])), min(extra_y_vals))
    vis_hi = max(float(np.max(s_hi[view_start:])), max(extra_y_vals))
    y_span = max(vis_hi - vis_lo, spot * 0.004, 1e-6)
    y_pad = y_span * 0.10
    ax1.set_ylim(vis_lo - y_pad, vis_hi + y_pad)

    visible_bars = max(10, n - view_start)
    right_margin = max(3.8, round(visible_bars * 0.16, 2))
    _draw_right_pills(ax1, (n - 1) + max(0.35, visible_bars * 0.012), pills, y_span + 2.0 * y_pad)

    ax1.set_title(
        sym + ' • ' + TIMEFRAMES[tf]['label'] + ' • Apalancamiento x' + str(LEVERAGE)
        + ' | ' + STRATEGIES[strat] + '\n' + subtitle,
        fontsize=11.0, fontweight='bold', color=txt_c, pad=10
    )
    ax1.set_ylabel('Precio (USD)', color=txt_c)
    leg1 = ax1.legend(loc='upper left', fontsize=8, ncol=2, facecolor='#1e293b',
                      edgecolor='#334155', labelcolor=txt_c)
    leg1.get_frame().set_alpha(0.88)

    lim = act['limit']
    lim_fmt = fd2(lim) + '%'
    v_fmt = fd2(act['val']) + '%'
    r_vis = rec['r_curve'].iloc[view_start:].dropna()
    rmax = float(r_vis.max()) if not r_vis.empty else lim
    y_top = max(rmax * 1.22, lim * 1.55)

    ax2.axhspan(0, lim, color='#10b981', alpha=0.10, label='Zona Segura (Habilitada)')
    ax2.axhspan(lim, y_top, color='#ef4444', alpha=0.13, label='Zona Bloqueo (Riesgo Excesivo)')
    ax2.plot(x, rec['r_curve'], color='#38bdf8', lw=1.8, label=act['label'])
    ax2.fill_between(x, 0, rec['r_curve'], color='#38bdf8', alpha=0.10)
    ax2.axhline(lim, color='#f87171', ls='--', lw=1.6, label='Límite (' + lim_fmt + ')')

    col_t = '#f87171' if act['blocked'] else '#34d399'
    est_t = 'BLOQUEADO (ROJO)' if act['blocked'] else 'HABILITADO (VERDE)'
    ax2.set_ylim(0, y_top)
    ax2.set_ylabel(act['label'] + ' %', color=txt_c)
    ax2.set_title(
        'Monitor de Riesgo (' + act['target'] + ') • ' + act['label'] + ': ' + v_fmt
        + ' / Límite ' + lim_fmt + ' ➔ ' + est_t,
        color=col_t, fontsize=9.8, fontweight='bold', pad=6
    )
    leg2 = ax2.legend(loc='upper left', fontsize=8, ncol=2, facecolor='#1e293b',
                      edgecolor='#334155', labelcolor=txt_c)
    leg2.get_frame().set_alpha(0.88)

    ticks = np.unique(np.linspace(view_start, n - 1, min(7, visible_bars)).astype(int))
    fmt = '%d-%b' if tf == '1d' else '%d-%b %H:%M'
    ax2.set_xticks(ticks)
    ax2.set_xticklabels([dates.iloc[i].strftime(fmt) for i in ticks], rotation=20, ha='right',
                        fontsize=8, color=muted_c)
    ax2.set_xlim(view_start - 0.8, (n - 1) + right_margin)

    fig.tight_layout(rect=[0.0, 0.0, 1.0, 0.985])
    stream = io.BytesIO()
    fig.savefig(stream, format='png', dpi=130, facecolor=bg_fig)
    plt.close(fig)
    stream.seek(0)
    return stream


# =====================================================================
# 7. INTERFAZ INLINE DE TELEGRAM
# =====================================================================
def build_dashboard_kb():
    st = STATE
    sym = st['asset']
    tf_lbl = TIMEFRAMES[st['timeframe']]['label']
    strat = st['strategy']
    rk = st['risk_metric']

    auto_txt = (
        '🤖 Auto-Trading: 🟢 ACTIVO (Toca para pausar)'
        if st['trading_enabled'] else
        '🤖 Auto-Trading: ⏸️ PAUSADO (Toca para activar)'
    )

    def sm(key, txt):
        return (txt + ' ✅') if strat == key else txt

    def rm(key, txt):
        return (txt + ' ✅') if rk == key else txt

    lr = LAST_RISK
    known = (
        lr.get('asset') == sym and lr.get('timeframe') == st['timeframe'] and lr.get('key') == rk
    )
    if known and lr['blocked']:
        sem_txt = ('🔴 RIESGO ALTO: ' + lr['label'] + ' ' + fd2(lr['val']) + '% > '
                   + fd2(lr['limit']) + '% (Bloqueado)')
        long_txt = '🔴 Long Bloqueado'
    elif known:
        sem_txt = ('🟢 RIESGO OK: ' + lr['label'] + ' ' + fd2(lr['val']) + '% <= '
                   + fd2(lr['limit']) + '%')
        long_txt = '🟢 Abrir LONG (x' + str(LEVERAGE) + ')'
    else:
        sem_txt = '🚦 Semáforo de Riesgo (Toca para actualizar)'
        long_txt = '🟢 Abrir LONG (x' + str(LEVERAGE) + ')'
    cls_cfg = ASSET_CLASSES[ASSETS[sym]['type']]
    close_lbl = '🏁 Cerrar Posición Activa' if st['position'] is not None else '🔴 Abrir SHORT (x' + str(LEVERAGE) + ')'

    rows = [
        [InlineKeyboardButton(auto_txt, callback_data='ACT:TOGGLE_AUTO')],
        [
            InlineKeyboardButton('⏱️ Temp: ' + tf_lbl, callback_data='MENU:TF'),
            InlineKeyboardButton(cls_cfg['icon'] + ' Activo: ' + sym, callback_data='MENU:ASSET'),
        ],
        [InlineKeyboardButton(sem_txt, callback_data='ACT:REFRESH_RISK')],
        [
            InlineKeyboardButton('📊 Reporte Pro + Gráfico Dark', callback_data='ACT:REPORT_CHART'),
        ],
        [
            InlineKeyboardButton(long_txt, callback_data='ACT:BUY_LONG'),
            InlineKeyboardButton(close_lbl, callback_data='ACT:CLOSE_OR_SHORT'),
        ],
        [
            InlineKeyboardButton('💼 Cartera y PnL (x' + str(LEVERAGE) + ')', callback_data='ACT:BALANCE'),
            InlineKeyboardButton('📜 Historial Trades', callback_data='ACT:TRADES'),
        ],
        [
            InlineKeyboardButton('🏆 Estadísticas Winrate', callback_data='ACT:WINRATE'),
            InlineKeyboardButton('🧪 Diebold-Mariano (RF)', callback_data='ACT:DM'),
        ],
        [
            InlineKeyboardButton('🎯 ' + sm('RSI', '1° RSI'), callback_data='STRAT:RSI'),
            InlineKeyboardButton('📈 ' + sm('EMA50_200', '2° EMA 50/200'), callback_data='STRAT:EMA50_200'),
        ],
        [
            InlineKeyboardButton('📉 ' + sm('BOLLINGER', '3° Bollinger'), callback_data='STRAT:BOLLINGER'),
            InlineKeyboardButton('📐 ' + sm('FIBONACCI', '4° Fibonacci'), callback_data='STRAT:FIBONACCI'),
        ],
        [
            InlineKeyboardButton('🚀 ' + sm('SUPERTREND', '5° SuperTrend'), callback_data='STRAT:SUPERTREND'),
            InlineKeyboardButton('🏛️ ' + sm('CHARTISMO', '6° Chartismo Pro'), callback_data='STRAT:CHARTISMO'),
        ],
        [
            InlineKeyboardButton('🛡️ ' + rm('VAR99', 'VaR 1.5%'), callback_data='RISK:VAR99'),
            InlineKeyboardButton('🛡️ ' + rm('CVAR99', 'CVaR 2.2%'), callback_data='RISK:CVAR99'),
            InlineKeyboardButton('🛡️ ' + rm('CAVIAR99', 'CAViaR 1.5%'), callback_data='RISK:CAVIAR99'),
        ],
        [
            InlineKeyboardButton('📁 Exportar Excel', callback_data='ACT:EXCEL'),
            InlineKeyboardButton('🧠 Consultar IA Gemini', callback_data='ACT:GEMINI'),
        ],
    ]
    return InlineKeyboardMarkup(rows)


def build_tf_submenu():
    rows, row = [], []
    for k, v in TIMEFRAMES.items():
        mk = '✅ ' if k == STATE['timeframe'] else ''
        row.append(InlineKeyboardButton(mk + v['label'], callback_data='SETTF:' + k))
        if len(row) == 3:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton('⬅️ Volver al Panel Principal', callback_data='MENU:MAIN')])
    return InlineKeyboardMarkup(rows)


def build_class_submenu():
    cur_cls = ASSETS[STATE['asset']]['type']
    rows = []
    for cls, cfg in ASSET_CLASSES.items():
        mk = '✅ ' if cls == cur_cls else ''
        rows.append([InlineKeyboardButton(
            mk + cfg['icon'] + ' ' + cfg['label'] + ' (' + str(len(CATALOG[cls])) + ') — '
            + RISK_MODELS[cfg['risk']]['label'],
            callback_data='CLASS:' + cls
        )])
    rows.append([InlineKeyboardButton('⬅️ Volver al Panel Principal', callback_data='MENU:MAIN')])
    return InlineKeyboardMarkup(rows)


def build_asset_submenu(cls):
    rows, row = [], []
    for sym, name in CATALOG[cls]:
        mk = '✅ ' if sym == STATE['asset'] else ''
        short = sym.replace('_USDT', '')
        row.append(InlineKeyboardButton(mk + short + ' · ' + name, callback_data='SETASSET:' + sym))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton('⬅️ Cambiar clase de activo', callback_data='MENU:ASSET')])
    rows.append([InlineKeyboardButton('⬅️ Volver al Panel Principal', callback_data='MENU:MAIN')])
    return InlineKeyboardMarkup(rows)


def class_menu_text():
    return (
        '━━━ 🌐 SELECCIÓN DE MERCADO ━━━\n'
        + 'El motor ajusta automáticamente la métrica institucional:\n'
        + ' 🪙 Criptomonedas ➔ CAViaR 99% (Lím 1.50%)\n'
        + ' 🏢 Acciones EE.UU. ➔ CVaR 99% (Lím 2.20%)\n'
        + ' 🧺 ETFs Índices/Bonos ➔ VaR 99% (Lím 1.50%)'
    )


# =====================================================================
# 8. EXCEL, GEMINI Y HANDLERS DE TELEGRAM
# =====================================================================
def export_excel_report():
    df = get_candles()
    rk = evaluate_all_risks(df)
    sym = STATE['asset']
    ts_str = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    fname = 'Quant_x10_' + sym + '_' + STATE['timeframe'] + '_' + ts_str + '.xlsx'
    out = DATA_DIR / fname
    with pd.ExcelWriter(out, engine='openpyxl') as writer:
        df.assign(fecha_utc=pd.to_datetime(df['t'], unit='s', utc=True).dt.tz_localize(None)).to_excel(
            writer, sheet_name=('Historico_' + sym)[:31], index=False
        )
        pd.DataFrame([v for v in rk['all'].values()]).to_excel(
            writer, sheet_name='Metricas_Riesgo', index=False
        )
        (pd.read_csv(TRADES_FILE) if TRADES_FILE.exists() else pd.DataFrame()).to_excel(
            writer, sheet_name='Trades_x10', index=False
        )
    return out


def analyze_with_gemini(custom_q=None):
    df = get_candles()
    rep = format_full_report(df)
    q = custom_q or (
        'Evalúa la estructura chartista actual, niveles clave de ruptura/soporte, '
        'el estado del semáforo de riesgo y sugiere un plan claro operando a x10.'
    )
    prompt = (
        'Eres un estratega cuantitativo institucional. Responde en español con viñetas claras, '
        'directo al grano y fácil de entender. Recuerda siempre la gestión de riesgo en x10.\n\n'
        + 'DATOS EN TIEMPO REAL DEL BOT:\n' + rep + '\n\nCONSULTA: ' + q
    )
    cli = genai.Client(api_key=GEMINI_API_KEY)
    last_err = None
    for m in list(dict.fromkeys([GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'])):
        try:
            r = cli.models.generate_content(model=m, contents=prompt)
            if r and r.text:
                return r.text
        except Exception as exc:
            last_err = exc
    return 'No se pudo conectar con Gemini (' + str(last_err) + ').'


async def safe_edit_text(query, text, reply_markup=None):
    try:
        return await query.edit_message_text(text, reply_markup=reply_markup)
    except BadRequest as exc:
        if 'not modified' not in str(exc).lower():
            raise


async def safe_edit_markup(query):
    try:
        return await query.edit_message_reply_markup(reply_markup=build_dashboard_kb())
    except BadRequest as exc:
        if 'not modified' not in str(exc).lower():
            raise


async def refresh_risk_cache():
    try:
        df = await asyncio.to_thread(get_candles)
        await asyncio.to_thread(evaluate_all_risks, df)
        return None
    except Exception as exc:
        logging.exception('No se pudo calcular el semaforo de riesgo')
        return str(exc)


def panel_title():
    sym = STATE['asset']
    info = ASSETS[sym]
    cls_cfg = ASSET_CLASSES[info['type']]
    auto_st = '🟢 ACTIVO' if STATE['trading_enabled'] else '⏸️ EN PAUSA'
    return (
        '━━━ 🎛️ TERMINAL QUANT x' + str(LEVERAGE) + ' ━━━\n'
        + cls_cfg['icon'] + ' ' + info['name'] + ' (' + sym + ') | ⏱️ ' + TIMEFRAMES[STATE['timeframe']]['label'] + '\n'
        + '📐 Motor: ' + STRATEGIES[STATE['strategy']] + '\n'
        + '🤖 Auto-Trading: ' + auto_st + ' | 💵 Saldo: $' + fc2(STATE['balance_usdt'])
    )


async def on_error(update, context: ContextTypes.DEFAULT_TYPE):
    logging.error('Error en handler de Telegram: %s', context.error)


def authorized(update: Update):
    return TELEGRAM_CHAT_ID is not None and str(update.effective_chat.id) == str(TELEGRAM_CHAT_ID)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global TELEGRAM_CHAT_ID
    if TELEGRAM_CHAT_ID is None and update.effective_chat.type == 'private':
        TELEGRAM_CHAT_ID = update.effective_chat.id
        PAIR_FILE.write_text(json.dumps({'chat_id': TELEGRAM_CHAT_ID}), encoding='utf-8')
    if not authorized(update):
        return
    context.user_data.pop('waiting_gemini', None)
    await update.message.reply_text(panel_title(), reply_markup=build_dashboard_kb())


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if TELEGRAM_CHAT_ID is None or str(query.message.chat.id) != str(TELEGRAM_CHAT_ID):
        await query.answer('No autorizado', show_alert=True)
        return

    data = query.data or ''

    if data == 'MENU:TF':
        await query.answer()
        return await safe_edit_text(
            query,
            '━━━ ⏱️ TEMPORALIDAD DE OPERACIÓN ━━━\nSelecciona el marco temporal de las velas:',
            reply_markup=build_tf_submenu()
        )

    if data == 'MENU:ASSET':
        await query.answer()
        return await safe_edit_text(
            query, class_menu_text(), reply_markup=build_class_submenu()
        )

    if data.startswith('CLASS:'):
        cls = data.split(':', 1)[I1]
        if cls not in ASSET_CLASSES:
            return await query.answer('Clase inválida', show_alert=True)
        cfg = ASSET_CLASSES[cls]
        await query.answer()
        return await safe_edit_text(
            query,
            '━━━ ' + cfg['icon'] + ' ' + cfg['label'].upper() + ' ━━━\n'
            + 'Filtro asignado: ' + RISK_MODELS[cfg['risk']]['label']
            + ' (Límite ' + fd2(RISK_MODELS[cfg['risk']]['limit']) + '%)\n'
            + 'Elige un instrumento del catálogo:',
            reply_markup=build_asset_submenu(cls)
        )

    if data == 'MENU:MAIN':
        await query.answer()
        return await safe_edit_text(
            query, panel_title(), reply_markup=build_dashboard_kb()
        )

    if data.startswith('SETTF:'):
        ntf = data.split(':', 1)[I1]
        if ntf not in TIMEFRAMES:
            return await query.answer('Temporalidad inválida', show_alert=True)
        with LOCK:
            STATE['timeframe'] = ntf
            STATE['last_candle'] = None
            save_state()
        await query.answer('Temporalidad: ' + TIMEFRAMES[ntf]['label'])
        err = await refresh_risk_cache()
        extra = ('\n⚠️ Aviso de datos: ' + err) if err else ''
        return await safe_edit_text(
            query, panel_title() + extra, reply_markup=build_dashboard_kb()
        )

    if data.startswith('SETASSET:'):
        sym = data.split(':', 1)[I1]
        if sym not in ASSETS:
            return await query.answer('Activo inválido', show_alert=True)
        info = ASSETS[sym]
        with LOCK:
            STATE['asset'] = sym
            STATE['risk_metric'] = info['default_risk']
            STATE['strategy'] = info['default_strat']
            STATE['last_candle'] = None
            save_state()
        rk_name = RISK_MODELS[info['default_risk']]['label']
        await query.answer(sym + ' ➔ ' + rk_name, show_alert=False)
        err = await refresh_risk_cache()
        extra = ('\n⚠️ No se pudo leer el mercado: ' + err) if err else ''
        return await safe_edit_text(
            query, panel_title() + extra, reply_markup=build_dashboard_kb()
        )

    if data.startswith('STRAT:'):
        sk = data.split(':', 1)[I1]
        if sk not in STRATEGIES:
            return await query.answer('Estrategia inválida', show_alert=True)
        with LOCK:
            STATE['strategy'] = sk
            save_state()
        await query.answer('Estrategia: ' + STRATEGIES[sk])
        return await safe_edit_text(query, panel_title(), reply_markup=build_dashboard_kb())

    if data.startswith('RISK:'):
        rk = data.split(':', 1)[I1]
        if rk not in RISK_MODELS:
            return await query.answer('Métrica inválida', show_alert=True)
        with LOCK:
            STATE['risk_metric'] = rk
            save_state()
        rec = ASSETS[STATE['asset']]['default_risk']
        aviso = '' if rk == rec else ' (sugerido: ' + RISK_MODELS[rec]['label'] + ')'
        await query.answer('Filtro: ' + RISK_MODELS[rk]['label'] + aviso)
        await refresh_risk_cache()
        return await safe_edit_markup(query)

    if data == 'ACT:REFRESH_RISK':
        await query.answer('Actualizando métricas de riesgo...')
        err = await refresh_risk_cache()
        if err:
            return await query.message.reply_text('⚠️ Error leyendo mercado: ' + err)
        return await safe_edit_markup(query)

    if data == 'ACT:TOGGLE_AUTO':
        with LOCK:
            STATE['trading_enabled'] = not STATE['trading_enabled']
            save_state()
        est = 'ACTIVADO 🟢' if STATE['trading_enabled'] else 'PAUSADO ⏸️'
        await query.answer('Auto-Trading ' + est)
        return await safe_edit_text(query, panel_title(), reply_markup=build_dashboard_kb())

    if data == 'ACT:BUY_LONG':
        await query.answer('Validando riesgo y ejecutando LONG...')
        try:
            df = await asyncio.to_thread(get_candles)
            res = await asyncio.to_thread(execute_open_x10, df, 'LONG', 'MANUAL')
            await query.message.reply_text(res, reply_markup=build_dashboard_kb())
        except Exception as exc:
            await query.message.reply_text('⚠️ Error al abrir operación: ' + str(exc))
        return

    if data == 'ACT:CLOSE_OR_SHORT':
        await query.answer('Procesando orden...')
        try:
            pos = STATE['position']
            if pos is not None:
                df_pos = await asyncio.to_thread(get_candles, pos['asset'], pos['timeframe'])
                spot = float(df_pos['close'].iloc[-1])
                res = await asyncio.to_thread(execute_close_x10, spot, 'Cierre Manual')
            else:
                df = await asyncio.to_thread(get_candles)
                res = await asyncio.to_thread(execute_open_x10, df, 'SHORT', 'MANUAL')
            await query.message.reply_text(res, reply_markup=build_dashboard_kb())
        except Exception as exc:
            await query.message.reply_text('⚠️ Error en posición: ' + str(exc))
        return

    if data == 'ACT:BALANCE':
        await query.answer()
        pos = STATE['position']
        if pos:
            try:
                df = await asyncio.to_thread(get_candles, pos['asset'], pos['timeframe'])
                spot = float(df['close'].iloc[-1])
                d = 1.0 if pos['side'] == 'LONG' else -1.0
                upnl = pos['margin_usdt'] * pos['leverage'] * ((spot - pos['entry']) / pos['entry']) * d
                uroe = ((spot - pos['entry']) / pos['entry']) * d * pos['leverage'] * 100.0
                p_icon = '🟢' if upnl >= 0 else '🔴'
                p_info = (
                    '📌 POSICIÓN ABIERTA: ' + str(pos['asset']) + ' (' + str(pos['side']) + ' x' + str(pos['leverage']) + ')\n'
                    + ' ├─ Entrada: $' + fc2(pos['entry']) + ' | Actual: $' + fc2(spot) + '\n'
                    + ' ├─ ' + p_icon + ' PnL Flotante: ' + fs2(upnl) + ' USDT (' + fs2(uroe) + '% ROE)\n'
                    + ' └─ 🎯 TP: $' + fc2(pos['tp']) + ' | 🛡️ SL: $' + fc2(pos['sl']) + ' | 💀 Liq: $' + fc2(pos['liq'])
                )
            except Exception:
                p_info = '📌 Posición Activa: ' + str(pos['asset']) + ' ' + str(pos['side']) + ' @ $' + fc2(pos['entry'])
        else:
            p_info = '📭 Sin posiciones abiertas en este momento.'

        txt = (
            '━━━ 💼 CARTERA QUANT x' + str(LEVERAGE) + ' ━━━\n'
            + '💵 Capital Disponible: $' + fc2(STATE['balance_usdt']) + ' USDT\n'
            + '📈 PnL Neto Acumulado: ' + fs2(STATE['realized_pnl_usdt']) + ' USDT\n'
            + '⚖️ Margen Base / Orden: $' + fc0(MARGIN_USDT) + ' ($' + fc0(MARGIN_USDT * LEVERAGE) + ' nocional)\n\n'
            + p_info
        )
        return await query.message.reply_text(txt, reply_markup=build_dashboard_kb())

    if data == 'ACT:WINRATE':
        await query.answer('Generando estadísticas...')
        d, txt = await asyncio.to_thread(reporte_winrate)
        await asyncio.to_thread(fb_publicar_reportes)
        return await query.message.reply_text(txt, reply_markup=build_dashboard_kb())

    if data == 'ACT:DM':
        await query.answer('Ejecutando validación fuera de muestra...')
        try:
            d, txt = await asyncio.to_thread(reporte_dm)
            if FB['activo']:
                await asyncio.to_thread(lambda: FB['db'].document('bot/dm').set(d))
            return await query.message.reply_text(txt, reply_markup=build_dashboard_kb())
        except Exception as exc:
            logging.exception('Error en Diebold-Mariano')
            return await query.message.reply_text('⚠️ Error en el test: ' + str(exc), reply_markup=build_dashboard_kb())

    if data == 'ACT:TRADES':
        await query.answer()
        if not TRADES_FILE.exists():
            return await query.message.reply_text('📜 Aún no se registran operaciones cerradas.', reply_markup=build_dashboard_kb())
        tdf = pd.read_csv(TRADES_FILE).tail(8)
        lines = []
        for _, r in tdf.iterrows():
            em = '🟢' if float(r.pnl_usdt) >= 0 else '🔻'
            lines.append(
                em + ' ' + str(r.activo) + ' (' + str(r.lado) + ') ➔ '
                + fs2(r.pnl_usdt) + ' USDT [' + fs1(r.roe_pct) + '%] · ' + str(r.motivo)
            )
        return await query.message.reply_text(
            '━━━ 📜 ÚLTIMAS 8 OPERACIONES ━━━\n' + '\n'.join(lines),
            reply_markup=build_dashboard_kb()
        )

    if data == 'ACT:REPORT_CHART':
        await query.answer('Generando análisis chartista v3.2 y gráfico en vivo...')
        try:
            df = await asyncio.to_thread(get_candles)
            rep_txt = await asyncio.to_thread(format_full_report, df)
            img = await asyncio.to_thread(build_report_chart, df)
            await asyncio.to_thread(fb_publicar_analisis_grafico, df)
            await query.message.reply_photo(photo=img)
            return await query.message.reply_text(rep_txt, reply_markup=build_dashboard_kb())
        except Exception as exc:
            logging.exception('Error en Reporte + Grafico')
            return await query.message.reply_text('⚠️ Error generando reporte: ' + str(exc), reply_markup=build_dashboard_kb())

    if data == 'ACT:EXCEL':
        await query.answer('Generando libro Excel...')
        try:
            path = await asyncio.to_thread(export_excel_report)
            with path.open('rb') as f:
                await query.message.reply_document(document=f, filename=path.name)
            return await query.message.reply_text('✅ Libro Excel exportado con velas, riesgo y trades.', reply_markup=build_dashboard_kb())
        except Exception as exc:
            return await query.message.reply_text('⚠️ Error Excel: ' + str(exc))

    if data == 'ACT:GEMINI':
        await query.answer('Consultando a Gemini IA...')
        context.user_data['waiting_gemini'] = True
        try:
            ans = await asyncio.to_thread(analyze_with_gemini, None)
            await query.message.reply_text(
                '━━━ 🧠 DICTAMEN IA GEMINI (' + STATE['asset'] + ') ━━━\n\n'
                + ans[:3750] + '\n\n'
                + '✍️ Escribe cualquier duda específica en el chat para preguntarle sobre este activo.',
                reply_markup=build_dashboard_kb()
            )
        except Exception as exc:
            await query.message.reply_text('⚠️ Error Gemini: ' + str(exc))


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    txt = (update.message.text or '').strip()
    if context.user_data.pop('waiting_gemini', False):
        await update.message.reply_text('🧠 Analizando tu consulta con Gemini...')
        ans = await asyncio.to_thread(analyze_with_gemini, txt)
        return await update.message.reply_text(ans[:3900], reply_markup=build_dashboard_kb())
    await update.message.reply_text(panel_title(), reply_markup=build_dashboard_kb())


async def background_monitor(app: Application):
    await asyncio.sleep(4)
    while True:
        try:
            pos = STATE['position']
            fast_tf = (
                STATE['timeframe'] in ('1m', '5m')
                or (pos is not None and pos.get('timeframe') in ('1m', '5m'))
            )
            if STATE['trading_enabled'] or pos is not None:
                df = await asyncio.to_thread(get_candles)
                pos = STATE['position']
                pos_df = None
                if pos is not None and (pos['asset'] != STATE['asset'] or pos['timeframe'] != STATE['timeframe']):
                    pos_df = await asyncio.to_thread(get_candles, pos['asset'], pos['timeframe'])
                alerts = await asyncio.to_thread(step_auto_trading, df, pos_df)
                for msg in alerts:
                    if TELEGRAM_CHAT_ID and msg:
                        await app.bot.send_message(
                            chat_id=TELEGRAM_CHAT_ID,
                            text=msg,
                            reply_markup=build_dashboard_kb()
                        )
            await asyncio.sleep(12 if fast_tf else 35)
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.exception('Error en monitor automatico')
            await asyncio.sleep(45)


async def send_startup_banner(app: Application):
    if TELEGRAM_CHAT_ID:
        try:
            await app.bot.send_message(
                chat_id=TELEGRAM_CHAT_ID,
                text=(
                    '━━━ 🚀 BOT QUANT x' + str(LEVERAGE) + ' EN LÍNEA ━━━\n'
                    + '• Motor Chartista v3.2 (Triángulos + Cuñas + Canal R² + Filtro Anti-Clímax) activado.\n'
                    + '• Activo actual: ' + STATE['asset'] + ' (' + TIMEFRAMES[STATE['timeframe']]['label'] + ')\n'
                    + '• Filtro de riesgo: ' + RISK_MODELS[STATE['risk_metric']]['label'] + '\n'
                    + '• Estado de la VM: envía /vm'
                ),
                reply_markup=build_dashboard_kb()
            )
        except Exception:
            pass


# =====================================================================
# 9. PUENTE CON LA APP WEB (Firebase / Firestore)
# =====================================================================
FB = {'db': None, 'evento': threading.Event(), 'val_key': None, 'val_busy': False, 'activo': False}
T_INICIO = time.time()
INSTANCIA = os.urandom(4).hex()   # identifica esta ejecucion del bot
PUENTE_STOP = threading.Event()


def _py(x):
    if isinstance(x, dict):
        return {str(k): _py(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_py(v) for v in x]
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        return None if (x != x or x in (float('inf'), float('-inf'))) else float(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    return x


def fb_init():
    if FB['db'] is not None:
        return FB['db']
    if not Path(FIREBASE_CRED).exists():
        logging.warning('App web desconectada: no existe %s', FIREBASE_CRED)
        return None
    import firebase_admin
    from firebase_admin import credentials, firestore
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(FIREBASE_CRED))
    FB['db'] = firestore.client()
    return FB['db']


def fb_estado(df):
    pack = evaluate_all_risks(df)
    act = pack['active']
    try:
        sig, sig_txt = evaluate_strategy_signal(df)
    except Exception as exc:
        sig, sig_txt = None, 'Señal no disponible: ' + str(exc)[:80]
    info = ASSETS[STATE['asset']]
    vm = None
    try:
        import psutil
        vm = {'cpu': round(psutil.cpu_percent(interval=None)), 'ram': round(psutil.virtual_memory().percent)}
    except Exception:
        pass
    return _py({
        'asset': STATE['asset'], 'asset_name': info['name'],
        'clase': ASSET_CLASSES[info['type']]['label'],
        'timeframe': STATE['timeframe'], 'strategy': STATE['strategy'],
        'strategy_label': STRATEGIES[STATE['strategy']],
        'trading_enabled': bool(STATE['trading_enabled']), 'leverage': LEVERAGE,
        'balance': STATE['balance_usdt'], 'realized_pnl': STATE['realized_pnl_usdt'],
        'position': STATE['position'], 'last_signal': STATE['last_signal'],
        'signal_now': sig or 'HOLD', 'signal_text': sig_txt,
        'price': float(df['close'].iloc[-1]),
        'risk': {
            'key': pack['active_key'], 'label': act['label'], 'val': act['val'],
            'limit': act['limit'], 'blocked': bool(pack['blocked']),
            'all': [{'label': d['label'], 'val': d['val'], 'limit': d['limit'],
                     'blocked': bool(d['blocked']), 'target': d['target']}
                    for d in pack['all'].values()],
        },
        'vm': vm, 'uptime_min': round((time.time() - T_INICIO) / 60), 'instancia': INSTANCIA,
        'origen': os.getenv('BOT_ORIGEN') or ('Spyder local (Mac)' if sys.platform == 'darwin' else 'VM Google Cloud'),
        'ts': time.time(),
    })


def fb_velas(df):
    sub = df.tail(300)
    return {
        'asset': STATE['asset'], 'tf': STATE['timeframe'],
        'candles': [{'t': int(t), 'o': float(o), 'h': float(h), 'l': float(l), 'c': float(c)}
                    for t, o, h, l, c in zip(sub['t'], sub['open'], sub['high'], sub['low'], sub['close'])],
    }


def construir_overlay_grafico(df):
    """Genera las series de tiempo UNIX, niveles y marcadores para dibujar en vivo en TradingView."""
    sym = STATE['asset']
    tf = STATE['timeframe']
    strat = STATE['strategy']
    tf_sec = TIMEFRAMES[tf]['sec']
    sub = df.tail(CHART_LOOKBACK).reset_index(drop=True)
    ts = sub['t'].astype(int).tolist()
    n = len(sub)

    out = {
        'asset': sym,
        'tf': tf,
        'strategy': strat,
        'strategy_label': STRATEGIES[strat],
        'titulo': STRATEGIES[strat],
        'lineas': [],
        'niveles': [],
        'marcadores': [],
        'ts': time.time(),
    }

    if strat == 'CHARTISMO':
        ch = analyze_chartismo(df)
        x0 = max(0, int(ch['x0']))
        res_pts = [{'time': ts[i], 'value': round(float(ch['res_line'][i]), 4)} for i in range(x0, n)]
        sup_pts = [{'time': ts[i], 'value': round(float(ch['sup_line'][i]), 4)} for i in range(x0, n)]
        m_res_sec = (float(ch['res_line'][-1]) - float(ch['res_line'][-2])) / tf_sec if n >= 2 else 0.0
        m_sup_sec = (float(ch['sup_line'][-1]) - float(ch['sup_line'][-2])) / tf_sec if n >= 2 else 0.0

        out['titulo'] = ch['pattern'] + ' • ' + ch['kind']
        out['lineas'] = [
            {'nombre': ch['up_name'], 'color': '#fb7185', 'width': 2, 'style': 'solid',
             't_last': ts[-1], 'v_last': round(ch['res_now'], 4), 'slope_sec': m_res_sec, 'datos': res_pts},
            {'nombre': ch['lo_name'], 'color': '#38bdf8', 'width': 2, 'style': 'solid',
             't_last': ts[-1], 'v_last': round(ch['sup_now'], 4), 'slope_sec': m_sup_sec, 'datos': sup_pts},
        ]
        if ch['bias'] == 'UP' and abs(ch['target_up'] - ch['res_now']) > 1e-6:
            out['niveles'].append({'titulo': 'Objetivo ↑', 'precio': round(ch['target_up'], 4), 'color': '#34d399'})
        elif ch['bias'] == 'DOWN' and abs(ch['target_dn'] - ch['sup_now']) > 1e-6:
            out['niveles'].append({'titulo': 'Objetivo ↓', 'precio': round(ch['target_dn'], 4), 'color': '#f87171'})

        lbl_map = {p[I0]: txt for p, txt in ch['labels']}
        for p in ch['pivots']:
            idx = int(p[I0])
            if 0 <= idx < n:
                is_h = (p[I2] == 'H')
                out['marcadores'].append({
                    'time': ts[idx],
                    'position': 'aboveBar' if is_h else 'belowBar',
                    'color': '#fda4af' if is_h else '#93c5fd',
                    'shape': 'arrowDown' if is_h else 'arrowUp',
                    'text': lbl_map.get(idx, ''),
                })

    elif strat == 'FIBONACCI':
        fb = analyze_fibonacci(df)
        xo, yo = fb['origin']
        xe, ye = fb['end']
        xo_c = max(0, min(int(xo), n - 1))
        xe_c = max(0, min(int(xe), n - 1))
        out['titulo'] = fb['trend'] + ' (Retr. ' + fd1(fb['retr_pct']) + '%)'
        for lbl in ('23.6%', '38.2%', '50.0%', '61.8%', '78.6%'):
            strong = lbl in ('38.2%', '50.0%', '61.8%')
            out['niveles'].append({
                'titulo': 'Fib ' + lbl,
                'precio': round(float(fb['levels'][lbl]), 4),
                'color': '#fbbf24' if strong else '#64748b',
            })
        i0, i1 = (xo_c, xe_c) if xo_c <= xe_c else (xe_c, xo_c)
        v0, v1 = (yo, ye) if xo_c <= xe_c else (ye, yo)
        imp_pts = [{'time': ts[i0], 'value': round(float(v0), 4)}]
        if i1 != i0:
            imp_pts.append({'time': ts[i1], 'value': round(float(v1), 4)})
        out['lineas'].append({
            'nombre': 'Impulso Fib', 'color': '#f8fafc', 'width': 2, 'style': 'dashed',
            't_last': ts[i1], 'v_last': round(float(v1), 4), 'slope_sec': 0.0,
            'datos': imp_pts,
        })
        for f in fb['fans'][:4]:
            col = '#fb923c' if f['group'] == 'speed' else '#38bdf8'
            pts = [{'time': ts[i], 'value': round(float(yo + f['m'] * (i - xo_c)), 4)} for i in range(xo_c, n)]
            out['lineas'].append({
                'nombre': f['name'], 'color': col, 'width': 1, 'style': 'dashed',
                't_last': ts[-1], 'v_last': round(float(f['now']), 4), 'slope_sec': float(f['m']) / tf_sec,
                'datos': pts,
            })

    elif strat == 'EMA50_200':
        s0 = max(0, n - 60)
        out['lineas'] = [
            {'nombre': 'EMA 50', 'color': '#facc15', 'width': 2, 'style': 'solid', 'slope_sec': 0.0,
             'datos': [{'time': ts[i], 'value': round(float(sub['ema_50'].iloc[i]), 4)}
                       for i in range(s0, n) if pd.notna(sub['ema_50'].iloc[i])]},
            {'nombre': 'EMA 200', 'color': '#c084fc', 'width': 2, 'style': 'solid', 'slope_sec': 0.0,
             'datos': [{'time': ts[i], 'value': round(float(sub['ema_200'].iloc[i]), 4)}
                       for i in range(s0, n) if pd.notna(sub['ema_200'].iloc[i])]},
        ]

    elif strat == 'BOLLINGER':
        s0 = max(0, n - 55)
        out['lineas'] = [
            {'nombre': 'BB Sup', 'color': '#22d3ee', 'width': 2, 'style': 'solid', 'slope_sec': 0.0,
             'datos': [{'time': ts[i], 'value': round(float(sub['bb_up'].iloc[i]), 4)}
                       for i in range(s0, n) if pd.notna(sub['bb_up'].iloc[i])]},
            {'nombre': 'BB Media', 'color': '#94a3b8', 'width': 1, 'style': 'dashed', 'slope_sec': 0.0,
             'datos': [{'time': ts[i], 'value': round(float(sub['bb_mid'].iloc[i]), 4)}
                       for i in range(s0, n) if pd.notna(sub['bb_mid'].iloc[i])]},
            {'nombre': 'BB Inf', 'color': '#22d3ee', 'width': 2, 'style': 'solid', 'slope_sec': 0.0,
             'datos': [{'time': ts[i], 'value': round(float(sub['bb_dn'].iloc[i]), 4)}
                       for i in range(s0, n) if pd.notna(sub['bb_dn'].iloc[i])]},
        ]

    elif strat == 'SUPERTREND':
        s0 = max(0, n - 55)
        col_st = '#10b981' if int(sub['st_dir'].iloc[-1]) == 1 else '#ef4444'
        out['lineas'] = [
            {'nombre': 'SuperTrend', 'color': col_st, 'width': 2, 'style': 'solid', 'slope_sec': 0.0,
             'datos': [{'time': ts[i], 'value': round(float(sub['supertrend'].iloc[i]), 4)}
                       for i in range(s0, n) if pd.notna(sub['supertrend'].iloc[i])]},
        ]

    elif strat == 'RSI':
        r_now = float(sub['rsi'].iloc[-1])
        out['titulo'] = 'RSI(14) = ' + fd1(r_now)
        out['niveles'].append({'titulo': 'Spot (RSI ' + fd1(r_now) + ')',
                               'precio': round(float(sub['close'].iloc[-1]), 4), 'color': '#a78bfa'})

    out['marcadores'].sort(key=lambda m: m['time'])
    return _py(out)


def fb_publicar_analisis_grafico(df):
    """Publica el overlay tecnico en Firestore UNICAMENTE cuando el usuario genera un reporte."""
    db = fb_init() if FB['activo'] else None
    if db is None:
        return
    try:
        db.document('bot/analisis_grafico').set(construir_overlay_grafico(df))
    except Exception:
        logging.exception('No se pudo publicar el overlay grafico en vivo')


def fb_push_trade(record):
    db = fb_init() if FB['activo'] else None
    if db is None:
        return
    threading.Thread(target=fb_publicar_reportes, daemon=True).start()
    db.collection('trades_bot').add(_py({
        'ts': int(time.time() * 1000), 'activo': record.get('activo'), 'lado': record.get('lado'),
        'estrategia': record.get('estrategia'), 'temporalidad': record.get('temporalidad'),
        'entrada': record.get('entrada'), 'salida': record.get('salida'), 'motivo': record.get('motivo'),
        'roe_pct': record.get('roe_pct'), 'pnl_usdt': record.get('pnl_usdt'),
        'entrada_utc': record.get('entrada_utc'), 'salida_utc': record.get('salida_utc'),
        'orden_id': record.get('orden_id'),
    }))


def fb_precios():
    out = dict()
    try:
        cfg = gate_api.Configuration(host='https://api.gateio.ws/api/v4')
        cli = gate_api.ApiClient(cfg)
        try:
            for tk in gate_api.FuturesApi(cli).list_futures_tickers(settle='usdt'):
                if tk.contract in ASSETS:
                    out[tk.contract] = {'p': float(tk.last), 'chg': float(tk.change_percentage or 0)}
        finally:
            cli.close()
    except Exception as exc:
        logging.warning('Precios Gate no disponibles: %s', exc)
    for sym, info in ASSETS.items():
        if info['source'] != 'yahoo':
            continue
        try:
            url = ('https://query1.finance.yahoo.com/v8/finance/chart/' + info['ticker']
                   + '?interval=1d&range=5d')
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=15) as resp:
                meta = json.loads(resp.read().decode('utf-8'))['chart']['result'][I0]['meta']
            px = float(meta['regularMarketPrice'])
            prev = float(meta.get('regularMarketPreviousClose') or meta.get('previousClose') or meta.get('chartPreviousClose') or px)
            out[sym] = {'p': px, 'chg': (px / prev - 1.0) * 100.0 if prev else 0.0}
        except Exception as exc:
            logging.warning('Precio Yahoo %s no disponible: %s', sym, exc)
    out['ts'] = time.time()
    return _py(out)


def _dm_test(e1, e2, h):
    from scipy import stats
    d = e1 ** 2 - e2 ** 2
    n = len(d)
    dm = d.mean()
    g = [float(np.sum((d[k:] - dm) * (d[:n - k] - dm)) / n) for k in range(h)]
    var = (g[I0] + 2.0 * sum(g[1:])) / n
    if var <= 0:
        return 0.0, 1.0
    stat = dm / np.sqrt(var) * np.sqrt((n + 1 - 2 * h + h * (h - 1) / n) / n)
    return float(stat), float(2.0 * (1.0 - stats.t.cdf(abs(stat), df=n - 1)))


def validar_random_forest(df, h=6):
    """Simulacion de hiperparametros fuera de muestra: RMSE, MSE, MAE, MAPE, SMAPE, Variance Score,
    Diebold-Mariano contra caminata aleatoria, y matriz de confusion / F1 para Buy-Hold-Sell."""
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import confusion_matrix, explained_variance_score, f1_score
    c = df['close']
    X = pd.DataFrame(index=df.index)
    for k in (1, 3, 6, 12, 24):
        X['r_' + str(k)] = np.log(c / c.shift(k))
    X['vol'] = c.pct_change().rolling(20).std()
    X['rango'] = ((df['high'] - df['low']) / c).rolling(14).mean()
    X['rsi'] = df['rsi'] / 100.0
    X['ema50'] = df['ema_50'] / c - 1.0
    X['ema200'] = df['ema_200'] / c - 1.0
    X = X.replace([np.inf, -np.inf], np.nan)
    fwd = np.log(c.shift(-h) / c)
    tau = 0.5 * np.log(c / c.shift(1)).ewm(span=100).std() * np.sqrt(h)
    y = pd.Series(np.where(fwd > tau, 1, np.where(fwd < -tau, -1, 0)), index=df.index)
    ok = X.notna().all(axis=1) & fwd.notna() & tau.notna()
    X, y, fwd, c = X[ok], y[ok], fwd[ok], c[ok]
    if len(X) < 200:
        raise RuntimeError('Velas insuficientes para validar (' + str(len(X)) + ').')
    cut = int(len(X) * 0.7)
    tr, te = slice(0, cut - h), slice(cut, len(X))  # purga de h velas: sin fuga de informacion
    rw = c.iloc[te].to_numpy()                      # caminata aleatoria: precio futuro = precio actual
    real = rw * np.exp(fwd.iloc[te].to_numpy())
    tabla, mejor, matriz, errores = [], 0, None, dict()
    configs = [('Random Forest', t, d) for t, d in ((50, 4), (50, 8), (100, 4), (100, 8), (200, 6), (200, 12))]
    if CATBOOST_OK:
        configs += [('CatBoost', 200, 4), ('CatBoost', 400, 6)]
    for modelo, trees, depth in configs:
        if modelo == 'CatBoost':
            reg = CatBoostRegressor(iterations=trees, depth=depth, learning_rate=0.05,
                                    loss_function='RMSE', **CATBOOST_VM_PARAMS)
            clf = CatBoostClassifier(iterations=trees, depth=depth, learning_rate=0.05,
                                     loss_function='MultiClass', auto_class_weights='Balanced',
                                     **CATBOOST_VM_PARAMS)
        else:
            reg = RandomForestRegressor(n_estimators=trees, max_depth=depth, min_samples_leaf=10,
                                        max_features='sqrt', random_state=42, n_jobs=-1)
            clf = RandomForestClassifier(n_estimators=trees, max_depth=depth, min_samples_leaf=10,
                                         class_weight='balanced_subsample', max_features='sqrt',
                                         random_state=42, n_jobs=-1)
        reg.fit(X.iloc[tr], fwd.iloc[tr])
        pred = rw * np.exp(np.asarray(reg.predict(X.iloc[te]), dtype=float))
        err = real - pred
        clf.fit(X.iloc[tr], y.iloc[tr])
        yp = np.asarray(clf.predict(X.iloc[te])).ravel().astype(int)
        dm, pv = _dm_test(err, real - rw, h)
        fila = {
            'modelo': modelo, 'arboles': trees, 'prof': depth,
            'rmse': float(np.sqrt(np.mean(err ** 2))), 'mse': float(np.mean(err ** 2)),
            'mae': float(np.mean(np.abs(err))), 'mape': float(np.mean(np.abs(err / real)) * 100.0),
            'smape': float(np.mean(2.0 * np.abs(err) / (np.abs(real) + np.abs(pred))) * 100.0),
            'evs': float(explained_variance_score(real, pred)), 'dm': dm, 'p': pv,
            'acc': float((yp == y.iloc[te].to_numpy()).mean() * 100.0),
            'f1': float(f1_score(y.iloc[te], yp, average='macro', zero_division=0)),
        }
        tabla.append(fila)
        if modelo not in errores or fila['rmse'] < errores[modelo][I0]:
            errores[modelo] = (fila['rmse'], err)
        if matriz is None or fila['rmse'] < tabla[mejor]['rmse']:
            mejor = len(tabla) - 1
            matriz = confusion_matrix(y.iloc[te], yp, labels=[-1, I0, I1]).tolist()
    rf_vs_cat = None
    if 'CatBoost' in errores:
        dm_c, p_c = _dm_test(errores['Random Forest'][I1], errores['CatBoost'][I1], h)
        if p_c < 0.05:
            gana = 'Random Forest' if dm_c < 0 else 'CatBoost'
        else:
            gana = 'Empate (sin diferencia significativa)'
        rf_vs_cat = {'dm': dm_c, 'p': p_c, 'ganador': gana,
                     'rmse_rf': errores['Random Forest'][I0], 'rmse_cat': errores['CatBoost'][I0]}
    b = tabla[mejor]
    if b['dm'] < 0 and b['p'] < 0.05:
        ver = 'El mejor modelo (' + b['modelo'] + ') pronostica mejor que la caminata aleatoria (Diebold-Mariano significativo).'
    else:
        ver = ('El mejor modelo (' + b['modelo'] + ') NO supera de forma significativa a la caminata aleatoria (DM '
               + fs2(b['dm']) + ', p=' + fd2(b['p']) + '). Por eso el bot usa el Random Forest solo para acotar SL/TP '
               'y no como pronóstico del precio.')
    return _py({
        'asset': STATE['asset'], 'tf': STATE['timeframe'], 'horizonte': h,
        'n_train': cut - h, 'n_test': int(len(real)), 'tabla': tabla, 'mejor': mejor,
        'matriz': matriz, 'veredicto': ver, 'rf_vs_catboost': rf_vs_cat,
        'catboost': bool(CATBOOST_OK), 'ts': time.time(),
    })


def fb_validar(forzar=False):
    db = fb_init()
    key = STATE['asset'] + '|' + STATE['timeframe']
    if db is None or FB['val_busy'] or (FB['val_key'] == key and not forzar):
        return
    FB['val_busy'] = True
    try:
        df = get_candles()
        val = validar_random_forest(df)
        db.document('bot/validacion').set(val)
        fb_publicar_reportes(val)
        FB['val_key'] = key
        logging.info('Validacion RF publicada para %s', key)
    except Exception:
        logging.exception('No se pudo validar el Random Forest')
    finally:
        FB['val_busy'] = False


def fb_gemini(pregunta, contexto):
    if contexto == 'BOT':
        return analyze_with_gemini(pregunta or None)
    prompt = (
        'Eres analista financiero de una app educativa de simulación de bolsa. Responde en español, '
        'claro y breve. No prometas ganancias; es un simulador con dinero virtual.\n\n'
        + (('CONTEXTO DEL USUARIO:\n' + str(contexto)[:4000] + '\n\n') if contexto else '')
        + 'PREGUNTA: ' + str(pregunta)[:1000]
    )
    cli = genai.Client(api_key=GEMINI_API_KEY)
    last_err = None
    for m in list(dict.fromkeys([GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'])):
        try:
            r = cli.models.generate_content(model=m, contents=prompt)
            if r and r.text:
                return r.text
        except Exception as exc:
            last_err = exc
    return 'No se pudo conectar con Gemini (' + str(last_err) + ').'


def fb_atender_consulta(ref, data):
    try:
        resp = fb_gemini(data.get('pregunta', ''), data.get('contexto', ''))
    except Exception as exc:
        resp = 'Error al consultar Gemini: ' + str(exc)[:200]
    ref.update({'estado': 'lista', 'respuesta': resp[:6000], 'respondida': time.time()})


def fb_atender_comando(ref, data):
    tipo, valor, nota = data.get('tipo'), data.get('valor'), 'hecho'
    if tipo == 'portafolio':
        return fb_atender_portafolio(ref, data)
    if tipo == 'analisis':
        if valor in ('vivo', 'off'):
            ANALISIS['vivo'] = valor == 'vivo'
            _asegurar_bucle_analisis()
        a = fb_publicar_analisis()
        ref.update({'estado': 'hecho', 'atendido': time.time(),
                    'resultado': ('✅ Análisis ' + a['estrategia_label'] + ' publicado' if a else '⚠️ No se pudo publicar el análisis')
                    + (' · modo en vivo ' + ('activado' if ANALISIS['vivo'] else 'apagado') if valor in ('vivo', 'off') else '')})
        return
    if tipo in ('long', 'short', 'cerrar'):
        try:
            res = ejecutar_orden_app(tipo)
        except Exception as exc:
            res = 'Error al ejecutar la orden: ' + str(exc)[:200]
        logging.info('Orden de la app: %s -> %s', tipo, res.split(chr(10))[I0])
        ref.update({'estado': 'hecho', 'resultado': res, 'atendido': time.time()})
        tg_enviar('🌐 ORDEN DESDE LA APP WEB\n' + res)
        FB['evento'].set()
        return
    if tipo == 'telegram' and str(valor).startswith(('MENU:', 'CLASS:')):
        v = str(valor)
        if v == 'MENU:TF':
            filas, txt = _kb_a_filas(build_tf_submenu()), 'Elige la temporalidad:'
        elif v == 'MENU:ASSET':
            filas, txt = _kb_a_filas(build_class_submenu()), 'Elige la clase de activo:'
        elif v.startswith('CLASS:') and v.split(':', 1)[I1] in ASSET_CLASSES:
            filas, txt = _kb_a_filas(build_asset_submenu(v.split(':', 1)[I1])), 'Elige el activo:'
        else:
            filas, txt = _kb_a_filas(build_dashboard_kb()), panel_title()
        ref.update({'estado': 'hecho', 'resultado': txt, 'submenu': filas, 'atendido': time.time()})
        return
    if tipo == 'telegram':
        try:
            res = ejecutar_boton_telegram(valor)
        except Exception as exc:
            logging.exception('Boton de Telegram desde la app')
            res = 'Error al ejecutar la opción: ' + str(exc)[:200]
        ref.update({'estado': 'hecho', 'resultado': res[:9000], 'atendido': time.time()})
        fb_publicar_menu()
        FB['evento'].set()
        return
    if tipo == 'dm':
        tipo = 'validar'
    res = ''
    with LOCK:
        if tipo == 'toggle':
            STATE['trading_enabled'] = not STATE['trading_enabled']
            res = 'Auto-Trading ' + ('ENCENDIDO 🟢' if STATE['trading_enabled'] else 'PAUSADO 🔴')
        elif tipo == 'tf' and valor in TIMEFRAMES:
            STATE['timeframe'] = valor
            STATE['last_candle'] = None
            res = '✅ Temporalidad cambiada a ' + TIMEFRAMES[valor]['label']
        elif tipo == 'tf':
            nota, res = 'ignorado', '⚠️ Temporalidad no válida: ' + str(valor) + '. Usa: ' + ', '.join(TIMEFRAMES)
        elif tipo == 'activo' and valor in ASSETS:
            info = ASSETS[valor]
            STATE['asset'] = valor
            STATE['risk_metric'] = info['default_risk']
            STATE['strategy'] = info['default_strat']
            STATE['last_candle'] = None
            res = '✅ Activo cambiado a ' + valor
        elif tipo == 'estrategia' and valor in STRATEGIES:
            STATE['strategy'] = valor
            res = '✅ Estrategia: ' + STRATEGIES[valor]
        elif tipo == 'validar':
            threading.Thread(target=fb_validar, args=(True,), daemon=True).start()
        else:
            nota = 'ignorado'
            res = '⚠️ Comando no reconocido: ' + str(tipo) + ' ' + str(valor)
        save_state()
    logging.info('Comando de la app: %s %s -> %s', tipo, valor, nota)
    ref.update({'estado': nota, 'resultado': res or 'hecho', 'atendido': time.time()})
    if nota == 'hecho' and tipo in ('toggle', 'tf', 'activo', 'estrategia'):
        tg_enviar('🌐 CAMBIO DESDE LA APP WEB\n' + res)
    fb_publicar_menu()
    FB['evento'].set()


def _fb_escuchar(coleccion, atender):
    def on_snap(snaps, changes, read_time):
        for ch in changes:
            if ch.type.name != 'ADDED':
                continue
            data = ch.document.to_dict() or {}
            ref = ch.document.reference
            if PUENTE_STOP.is_set():
                return
            if time.time() * 1000 - float(data.get('ts', 0)) > 5 * 60 * 1000:
                ref.update({'estado': 'expirado'})
                continue
            threading.Thread(target=atender, args=(ref, data), daemon=True).start()
    from google.cloud.firestore_v1.base_query import FieldFilter
    w = FB['db'].collection(coleccion).where(filter=FieldFilter('estado', '==', 'pendiente')).on_snapshot(on_snap)
    sys._bolsalab_puente['watches'].append(w)


def _fb_bucle_estado():
    db = FB['db']
    while not PUENTE_STOP.is_set():
        try:
            df = get_candles()
            db.document('bot/estado').set(fb_estado(df))
            db.document('bot/velas').set(fb_velas(df))
            fb_publicar_menu()
            if FB['val_key'] != STATE['asset'] + '|' + STATE['timeframe'] and not FB['val_busy']:
                threading.Thread(target=fb_validar, daemon=True).start()
        except Exception:
            logging.exception('Puente app: error publicando estado')
        FB['evento'].wait(30)
        FB['evento'].clear()
    logging.info('Puente: hilo de estado detenido (instancia %s)', INSTANCIA)


def _fb_bucle_precios():
    db = FB['db']
    while not PUENTE_STOP.is_set():
        try:
            db.document('mercado/precios').set(fb_precios())
        except Exception:
            logging.exception('Puente app: error publicando precios')
        PUENTE_STOP.wait(60)


def iniciar_puente_app():
    """Arranca el puente en hilos aparte. Si no hay credenciales, el bot sigue funcionando igual."""
    if FB['activo']:
        return True
    prev = getattr(sys, '_bolsalab_puente', None)
    if isinstance(prev, dict):
        prev['stop'].set()
        for ev in prev.get('eventos', []):
            ev.set()
        for w in prev.get('watches', []):
            try:
                w.unsubscribe()
            except Exception:
                pass
        logging.info('Puente anterior detenido (instancia %s)', prev.get('instancia'))
    sys._bolsalab_puente = {'stop': PUENTE_STOP, 'watches': [], 'eventos': [FB['evento']],
                            'instancia': INSTANCIA}
    try:
        if fb_init() is None:
            return False
        FB['activo'] = True
        _fb_escuchar('comandos', fb_atender_comando)
        _fb_escuchar('consultas', fb_atender_consulta)
        threading.Thread(target=_fb_bucle_estado, daemon=True, name='puente-estado').start()
        threading.Thread(target=_fb_bucle_precios, daemon=True, name='puente-precios').start()
        logging.info('Puente con la app web ACTIVO (Firestore)')
        return True
    except Exception:
        logging.exception('No se pudo iniciar el puente con la app web')
        return False


def verificar():
    def linea(nombre, ok, extra=''):
        print((' OK ' if ok else ' FALLA ') + nombre + (' | ' + str(extra) if extra else ''))
    print('VERIFICACION PREVIA')
    linea('TELEGRAM_BOT_TOKEN', bool(TELEGRAM_BOT_TOKEN))
    linea('GEMINI_API_KEY', bool(GEMINI_API_KEY))
    linea('XAI_API_KEY (Grok)', bool(XAI_API_KEY and not XAI_API_KEY.startswith('PEGA_AQUI')))
    linea('GATE_API_KEY / SECRET', bool(GATE_API_KEY and GATE_API_SECRET), 'opcional: las velas son públicas')
    if GATE_TESTNET_KEY and GATE_TESTNET_SECRET:
        try:
            cli_t = gate_api.ApiClient(gate_api.Configuration(
                host=GATE_TESTNET_HOST, key=GATE_TESTNET_KEY, secret=GATE_TESTNET_SECRET))
            acc_t = gate_api.FuturesApi(cli_t).list_futures_accounts('usdt', _request_timeout=10)
            linea('Testnet Gate (llaves de red de prueba)', True,
                  'saldo ' + fd2(float(acc_t.available or 0)) + ' USDT de prueba')
            cli_t.close()
        except Exception as exc:
            linea('Testnet Gate (llaves de red de prueba)', False,
                  str(getattr(exc, 'label', '') or '') + ' ' + str(getattr(exc, 'message', '') or exc)[:120])
    else:
        linea('Testnet Gate', False, 'faltan GATE_TESTNET_KEY / GATE_TESTNET_SECRET en .env')
    linea('CatBoost VM Google Cloud', CATBOOST_OK,
          ('v' + str(cb.__version__)) if CATBOOST_OK else 'instalar con: pip install catboost')
    try:
        df = get_candles()
        linea('Velas ' + STATE['asset'] + ' ' + STATE['timeframe'], True, str(len(df)) + ' velas (producción)')
        pack = evaluate_all_risks(df)
        linea('Riesgo ' + pack['active']['label'], True, fd2(pack['active']['val']) + '%')
        ch = analyze_chartismo(df)
        linea('Motor Chartista v3.2', ch['res_now'] > ch['sup_now'], ch['pattern'] + ' | ' + ch['bias_txt'])
        v = validar_random_forest(df)
        linea('Validación Random Forest + CatBoost' if CATBOOST_OK else 'Validación Random Forest', True, 'RMSE ' + fd2(v['tabla'][v['mejor']]['rmse']))
    except Exception as exc:
        linea('Datos de mercado', False, exc)
    try:
        db = fb_init()
        if db is None:
            linea('Firebase', False, 'falta ' + FIREBASE_CRED)
        else:
            db.document('bot/verificacion').set({'ts': time.time()})
            linea('Firebase / Firestore', True, 'escritura correcta')
    except Exception as exc:
        linea('Firebase / Firestore', False, exc)
    if GEMINI_API_KEY:
        r = fb_gemini('Responde solo: OK', '')
        linea('Gemini responde', not r.startswith('No se pudo'), r[:60])


# =====================================================================
# 10. REPORTES (WINRATE Y DIEBOLD-MARIANO), ORDENES Y ESPEJO TELEGRAM
# =====================================================================
PRED_FILE = DATA_DIR / 'predicciones_rf.csv'
TG = {'app': None, 'loop': None}


def registrar_prediccion_rf(pos, exit_price, reason):
    pd.DataFrame([{
        'salida_utc': now_iso(), 'activo': pos['asset'], 'lado': pos['side'],
        'estrategia': pos['strategy'], 'entrada': float(pos['entry']),
        'tp_rf': float(pos['tp']), 'sl_rf': float(pos['sl']),
        'salida': float(exit_price), 'motivo': reason,
    }]).to_csv(PRED_FILE, mode='a', index=False, header=not PRED_FILE.exists(), encoding='utf-8-sig')


def reporte_winrate():
    if not TRADES_FILE.exists():
        return {'n': 0, 'ts': time.time()}, '━━━ 🏆 REPORTE WINRATE ━━━\nAún no hay trades cerrados.'
    t = pd.read_csv(TRADES_FILE)
    if t.empty:
        return {'n': 0, 'ts': time.time()}, '━━━ 🏆 REPORTE WINRATE ━━━\nAún no hay trades cerrados.'
    pnl = t['pnl_usdt'].astype(float)
    gan, per = pnl[pnl > 0], pnl[pnl <= 0]
    pf = float(gan.sum() / abs(per.sum())) if len(per) and per.sum() != 0 else None
    eq = pnl.cumsum()
    por = []
    for col, nombre in (('estrategia', 'estrategia'), ('activo', 'activo'), ('lado', 'lado')):
        for k, g in t.groupby(col):
            gp = g['pnl_usdt'].astype(float)
            por.append({'grupo': nombre, 'nombre': str(k), 'n': int(len(g)),
                        'winrate': float((gp > 0).mean() * 100.0), 'pnl': float(gp.sum())})
    d = {
        'n': int(len(t)), 'ganadores': int(len(gan)), 'perdedores': int(len(per)),
        'winrate': float(len(gan) / len(t) * 100.0),
        'pnl_total': float(pnl.sum()), 'promedio_ganador': float(gan.mean()) if len(gan) else 0.0,
        'promedio_perdedor': float(per.mean()) if len(per) else 0.0,
        'profit_factor': pf, 'mejor': float(pnl.max()), 'peor': float(pnl.min()),
        'max_drawdown': float((eq - eq.cummax()).min()),
        'roe_promedio': float(t['roe_pct'].astype(float).mean()),
        'ultimos': [1 if v > 0 else 0 for v in pnl.tail(10)], 'por': por, 'ts': time.time(),
    }
    w_bar = bar_meter(d['winrate'] / 100.0, 10)
    lin = [
        '━━━ 🏆 ESTADÍSTICAS WINRATE (' + str(d['n']) + ' TRADES) ━━━',
        '🎯 Acierto: [' + w_bar + '] ' + fd1(d['winrate']) + '% (' + str(d['ganadores']) + 'W / ' + str(d['perdedores']) + 'L)',
        '💵 PnL Neto: ' + fs2(d['pnl_total']) + ' USDT | ROE Medio: ' + fs2(d['roe_promedio']) + '%',
        '⚖️ Profit Factor: ' + (fd2(pf) if pf is not None else '∞ (sin pérdidas)') + ' | Max DD: ' + fs2(d['max_drawdown']) + ' USDT',
        '📈 Media Ganadora: ' + fs2(d['promedio_ganador']) + ' | Media Perdedora: ' + fs2(d['promedio_perdedor']) + ' USDT',
        '🔥 Racha reciente: ' + ''.join('🟢' if v else '🔴' for v in d['ultimos']),
        '', '📊 Desglose por Estrategia:',
    ]
    for p in por:
        if p['grupo'] == 'estrategia':
            lin.append(' • ' + p['nombre'] + ': ' + fd1(p['winrate']) + '% (' + str(p['n']) + ' ops ➔ ' + fs2(p['pnl']) + ' USDT)')
    if d['n'] < 20:
        lin.append('\nℹ️ Muestra menor a 20 operaciones: resultados aún en fase estadística inicial.')
    return _py(d), '\n'.join(lin)


def reporte_dm(val=None):
    if val is None:
        val = validar_random_forest(get_candles())
    b = val['tabla'][val['mejor']]
    velas = {
        'dm': b['dm'], 'p': b['p'], 'n': val['n_test'], 'horizonte': val['horizonte'],
        'rmse_rf': b['rmse'], 'modelo': b.get('modelo', 'Random Forest'), 'arboles': b['arboles'], 'prof': b['prof'],
        'gana_rf': bool(b['dm'] < 0 and b['p'] < 0.05),
    }
    trades = {'n': 0, 'suficiente': False}
    filas = []
    if PRED_FILE.exists():
        pr = pd.read_csv(PRED_FILE).tail(30)
        trades['n'] = int(len(pr))
        if len(pr) >= 8:
            real = pr['salida'].to_numpy(float)
            e_rf = real - pr['tp_rf'].to_numpy(float)
            e_rw = real - pr['entrada'].to_numpy(float)
            dm, pv = _dm_test(e_rf / real, e_rw / real, 1)
            trades.update({
                'suficiente': True, 'dm': dm, 'p': pv,
                'mae_rf_pct': float(np.mean(np.abs(e_rf / real)) * 100.0),
                'mae_rw_pct': float(np.mean(np.abs(e_rw / real)) * 100.0),
                'gana_rf': bool(dm < 0 and pv < 0.05),
            })
        for _, r in pr.tail(10).iterrows():
            filas.append({'activo': str(r['activo']), 'lado': str(r['lado']), 'entrada': float(r['entrada']),
                          'tp_rf': float(r['tp_rf']), 'salida': float(r['salida']),
                          'error_pct': float((r['salida'] - r['tp_rf']) / r['salida'] * 100.0),
                          'motivo': str(r['motivo'])})
    d = {'asset': val['asset'], 'tf': val['tf'], 'velas': velas, 'trades': trades,
         'ultimas_predicciones': filas, 'rf_vs_catboost': val.get('rf_vs_catboost'),
         'ts': time.time()}

    def lee(x):
        if x['gana_rf']:
            return '✅ RF supera significativamente al benchmark ingenuo (p < 0.05)'
        if x['dm'] > 0 and x['p'] < 0.05:
            return '⚠️ Benchmark ingenuo supera al RF (p < 0.05)'
        return '⚪ Sin diferencia estadística significativa frente a caminata aleatoria'
    lin = [
        '━━━ 🧪 TEST DIEBOLD-MARIANO (RF) ━━━',
        'Activo: ' + val['asset'] + ' | Temp: ' + val['tf'],
        '',
        '1️⃣ Evaluación en Velas Fuera de Muestra (' + str(velas['n']) + ' velas, h=' + str(velas['horizonte']) + '):',
        ' • Estadístico DM: ' + fs2(velas['dm']) + ' | p-valor: ' + fd4(velas['p']),
        ' • ' + lee(velas),
        '',
        '2️⃣ Evaluación en Operaciones Reales (' + str(trades['n']) + ' registradas):',
    ]
    if trades['suficiente']:
        lin += [' • Estadístico DM: ' + fs2(trades['dm']) + ' | p-valor: ' + fd4(trades['p']),
                ' • MAE Objetivo RF: ' + fd2(trades['mae_rf_pct']) + '% vs Ingenuo: ' + fd2(trades['mae_rw_pct']) + '%',
                ' • ' + lee(trades)]
    else:
        lin.append(' • Requiere mínimo 8 trades cerrados (actual: ' + str(trades['n']) + ').')
    rc = val.get('rf_vs_catboost')
    lin += ['', '3️⃣ Random Forest vs CatBoost (velas fuera de muestra):']
    if rc:
        lin += [' • RMSE RF: ' + fd2(rc['rmse_rf']) + ' | RMSE CatBoost: ' + fd2(rc['rmse_cat']),
                ' • DM: ' + fs2(rc['dm']) + ' | p-valor: ' + fd4(rc['p']) + ' ➔ ' + rc['ganador']]
    else:
        lin.append(' • CatBoost no está instalado en este equipo (pip install catboost).')
    return _py(d), '\n'.join(lin)


def fb_publicar_reportes(val=None):
    db = fb_init() if FB['activo'] else None
    if db is None:
        return
    try:
        db.document('bot/winrate').set(reporte_winrate()[I0])
        if val is not None:
            db.document('bot/dm').set(reporte_dm(val)[I0])
    except Exception:
        logging.exception('No se pudieron publicar los reportes')


def tg_enviar(texto):
    if TG['app'] is None or TG['loop'] is None or not TELEGRAM_CHAT_ID:
        return
    try:
        asyncio.run_coroutine_threadsafe(
            TG['app'].bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=texto[:3900],
                                       reply_markup=build_dashboard_kb()), TG['loop'])
    except Exception:
        logging.exception('No se pudo avisar a Telegram')


def ejecutar_orden_app(tipo):
    if tipo in ('long', 'short'):
        df = get_candles()
        return execute_open_x10(df, 'LONG' if tipo == 'long' else 'SHORT', 'APP WEB')
    pos = STATE['position']
    if pos is None:
        return '⚠️ No hay posición abierta para cerrar.'
    df_pos = get_candles(pos['asset'], pos['timeframe'])
    return execute_close_x10(float(df_pos['close'].iloc[-1]), 'Cierre desde la app web')


def _leer_bytes(obj):
    """Lee una imagen o archivo que se manda a Telegram sin consumirlo (para copiarlo a la app)."""
    try:
        if isinstance(obj, (bytes, bytearray)):
            return bytes(obj)
        if hasattr(obj, 'read') and hasattr(obj, 'seek'):
            pos = obj.tell()
            data = obj.read()
            obj.seek(pos)
            return data
    except Exception:
        logging.exception('Espejo: no se pudo leer el adjunto')
    return None


def fb_espejo(de, texto, tipo='texto', markup=None, adjunto=None, nombre=None):
    if not FB['activo'] or FB['db'] is None:
        return
    botones = []
    try:
        if markup is not None and getattr(markup, 'inline_keyboard', None):
            botones = [' | '.join(str(b.text) for b in fila) for fila in markup.inline_keyboard]
    except Exception:
        botones = []
    doc = {'ts': int(time.time() * 1000), 'de': de, 'texto': str(texto or '')[:3500], 'tipo': tipo,
           'botones': botones[:16]}
    if adjunto:
        if len(adjunto) <= 700_000:
            doc['adjunto_b64'] = base64.b64encode(adjunto).decode('ascii')
            doc['adjunto_tipo'] = 'image/png' if tipo == 'foto' else (
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                if str(nombre or '').endswith('.xlsx') else 'application/octet-stream')
            if nombre:
                doc['adjunto_nombre'] = nombre
        else:
            doc['texto'] += ' (archivo muy grande para mostrarlo en la app; está en Telegram)'
    threading.Thread(target=lambda: FB['db'].collection('telegram_espejo').add(doc), daemon=True).start()


def instalar_espejo_telegram():
    from telegram.ext import ExtBot
    if getattr(ExtBot, '_espejo_instalado', False):
        return
    o_msg, o_foto, o_doc, o_edit = (ExtBot.send_message, ExtBot.send_photo, ExtBot.send_document,
                                    ExtBot.edit_message_text)

    async def send_message(self, *a, **k):
        fb_espejo('bot', k.get('text', a[I1] if len(a) > 1 else ''), 'texto', k.get('reply_markup'))
        return await o_msg(self, *a, **k)

    async def send_photo(self, *a, **k):
        foto = k.get('photo', a[I1] if len(a) > 1 else None)
        fb_espejo('bot', '📊 ' + str(k.get('caption') or 'Gráfico'), 'foto', adjunto=_leer_bytes(foto))
        return await o_foto(self, *a, **k)

    async def send_document(self, *a, **k):
        doc = k.get('document', a[I1] if len(a) > 1 else None)
        nombre = str(k.get('filename') or getattr(doc, 'name', 'archivo')).split('/')[-1]
        fb_espejo('bot', '📁 ' + nombre, 'archivo', adjunto=_leer_bytes(doc), nombre=nombre)
        return await o_doc(self, *a, **k)

    async def edit_message_text(self, *a, **k):
        fb_espejo('bot', k.get('text', a[I0] if a else ''), 'texto', k.get('reply_markup'))
        return await o_edit(self, *a, **k)

    ExtBot.send_message, ExtBot.send_photo = send_message, send_photo
    ExtBot.send_document, ExtBot.edit_message_text = send_document, edit_message_text
    ExtBot._espejo_instalado = True


async def espejo_entrada(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        if not authorized(update):
            return
        if update.callback_query is not None:
            q = update.callback_query
            etiqueta = q.data or ''
            mk = q.message.reply_markup if q.message else None
            if mk is not None:
                for fila in mk.inline_keyboard:
                    for b in fila:
                        if b.callback_data == q.data:
                            etiqueta = b.text
            fb_espejo('usuario', '🔘 ' + str(etiqueta), 'boton')
        elif update.message is not None and update.message.text:
            fb_espejo('usuario', update.message.text, 'texto')
    except Exception:
        logging.exception('Espejo de Telegram: error registrando entrada')


# =====================================================================
# 11. CONTROL REMOTO: LA APP WEB USA EL MISMO MENU DE TELEGRAM
# =====================================================================
PREFIJOS_APP = ('SETTF:', 'SETASSET:', 'STRAT:', 'RISK:', 'ACT:')


def _kb_a_filas(markup):
    filas = []
    for fila in getattr(markup, 'inline_keyboard', []) or []:
        filas.append([{'t': str(b.text), 'd': str(b.callback_data or '')} for b in fila])
    return filas


def fb_publicar_menu():
    """Copia el teclado de Telegram (con sus marcas ✅, semaforo y estado) a bot/menu."""
    db = fb_init() if FB['activo'] else None
    if db is None:
        return
    try:
        activos = {cls: {'label': ASSET_CLASSES[cls]['label'], 'icon': ASSET_CLASSES[cls]['icon'],
                         'filas': _kb_a_filas(build_asset_submenu(cls))} for cls in ASSET_CLASSES}
        db.document('bot/menu').set({
            'titulo': panel_title(),
            'principal': _kb_a_filas(build_dashboard_kb()),
            'temporalidades': _kb_a_filas(build_tf_submenu()),
            'clases': _kb_a_filas(build_class_submenu()),
            'activos': activos,
            'ts': time.time(),
        })
    except Exception:
        logging.exception('No se pudo publicar el menu de Telegram')


def _etiqueta_boton(data):
    for fila in _kb_a_filas(build_dashboard_kb()):
        for b in fila:
            if b['d'] == data:
                return b['t']
    return data


class _ChatApp:
    def __init__(self):
        self.id = TELEGRAM_CHAT_ID
        self.type = 'private'


class _MensajeApp:
    """Imita query.message: lo que el bot 'responde' se envia de verdad al chat de Telegram."""
    def __init__(self, salida):
        self.chat = _ChatApp()
        self.salida = salida
        self.reply_markup = None
        self.message_id = 0

    async def reply_text(self, text, reply_markup=None, **k):
        self.salida.append(str(text))
        return await TG['app'].bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=str(text)[:4000],
                                                reply_markup=reply_markup)

    async def reply_photo(self, photo, caption=None, **k):
        self.salida.append('📊 Gráfico generado (míralo en el espejo de Telegram).')
        return await TG['app'].bot.send_photo(chat_id=TELEGRAM_CHAT_ID, photo=photo, caption=caption)

    async def reply_document(self, document, filename=None, **k):
        self.salida.append('📁 Archivo generado: ' + str(filename or ''))
        return await TG['app'].bot.send_document(chat_id=TELEGRAM_CHAT_ID, document=document,
                                                 filename=filename)


class _ConsultaApp:
    """Imita update.callback_query para reutilizar on_callback tal cual."""
    def __init__(self, data, salida):
        self.data = data
        self.salida = salida
        self.message = _MensajeApp(salida)
        self.from_user = None

    async def answer(self, text=None, show_alert=False, **k):
        if text:
            self.salida.append(str(text))

    async def edit_message_text(self, text, reply_markup=None, **k):
        return await self.message.reply_text(text, reply_markup=reply_markup)

    async def edit_message_reply_markup(self, reply_markup=None, **k):
        return await TG['app'].bot.send_message(chat_id=TELEGRAM_CHAT_ID,
                                                text='🌐 Actualizado desde la app\n' + panel_title(),
                                                reply_markup=reply_markup)


class _UpdateApp:
    def __init__(self, consulta):
        self.callback_query = consulta
        self.effective_chat = _ChatApp()
        self.message = None


class _ContextoApp:
    def __init__(self):
        self.user_data = dict()
        self.chat_data = dict()


def ejecutar_boton_telegram(data):
    """Ejecuta un boton del menu de Telegram pedido desde la app. Devuelve el texto del resultado."""
    if not any(str(data).startswith(p) for p in PREFIJOS_APP):
        return '⚠️ Opción no permitida desde la app: ' + str(data)

    if TG['app'] is None or TG['loop'] is None or not TELEGRAM_CHAT_ID:
        return '⚠️ Telegram no está activo en el bot (envía /start en Telegram una vez).'
    fb_espejo('usuario', '🌐 App: ' + _etiqueta_boton(data), 'boton')
    salida = []
    consulta = _ConsultaApp(data, salida)
    fut = asyncio.run_coroutine_threadsafe(on_callback(_UpdateApp(consulta), _ContextoApp()), TG['loop'])
    fut.result(timeout=240)
    return '\n\n'.join(salida) if salida else '✅ Hecho.'


# =====================================================================
# 12. PORTAFOLIO A LARGO PLAZO CON MACHINE LEARNING (Opciones 1 y 2 del proyecto)
# =====================================================================
from scipy.optimize import minimize as _minimize
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score, f1_score, confusion_matrix
from sklearn.ensemble import RandomForestClassifier

YAHOO_CRIPTO = {sym: sym.replace('_USDT', '-USD') for sym in ASSETS if ASSETS[sym]['type'] == 'CRYPTO'}
CACHE_DIARIO = dict()
CACHE_ML = dict()
H_PORT = 20
REGIMENES = ['baja', 'media', 'alta']


def _yahoo_diario(ticker, anios):
    clave = (ticker, anios)
    if clave in CACHE_DIARIO and time.time() - CACHE_DIARIO[clave][I0] < 6 * 3600:
        return CACHE_DIARIO[clave][I1]
    url = ('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker
           + '?interval=1d&range=' + str(int(anios)) + 'y')
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=25) as resp:
        res = json.loads(resp.read().decode('utf-8'))['chart']['result'][I0]
    cierre = res['indicators'].get('adjclose', [{}])[I0].get('adjclose') or res['indicators']['quote'][I0]['close']
    s = pd.Series(cierre, index=pd.to_datetime(res['timestamp'], unit='s').normalize(), dtype=float).dropna()
    s = s[~s.index.duplicated(keep='last')]
    CACHE_DIARIO[clave] = (time.time(), s)
    return s


def tasa_libre_riesgo():
    """Rendimiento anual del T-Bill a 13 semanas (^IRX). Si falla, 4%."""
    try:
        return float(_yahoo_diario('^IRX', 1).iloc[-1]) / 100.0
    except Exception:
        return 0.04


def precios_portafolio(simbolos, anios):
    series, faltan = dict(), []
    for sym in simbolos:
        tk = YAHOO_CRIPTO.get(sym, ASSETS[sym]['ticker'] if sym in ASSETS else sym)
        try:
            s = _yahoo_diario(tk, anios)
            if len(s) > 300:
                series[sym] = s
            else:
                faltan.append(sym)
        except Exception:
            faltan.append(sym)
    if len(series) < 3:
        raise RuntimeError('No hay suficientes activos con historia (faltan: ' + ', '.join(faltan) + ').')
    df = pd.DataFrame(series).sort_index().dropna()
    return df, faltan


def _rsi_serie(c, n=14):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def _panel_ml(precios):
    """Panel apilado (fecha, activo) con variables tecnicas y los dos objetivos."""
    lr = np.log(precios / precios.shift(1))
    mercado = precios['SPY'] if 'SPY' in precios else precios.mean(axis=1)
    lr_m = np.log(mercado / mercado.shift(1))
    filas = []
    for sym in precios.columns:
        c, r = precios[sym], lr[sym]
        X = pd.DataFrame(index=precios.index)
        for n in (1, 5, 20, 60, 120):
            X['ret_' + str(n)] = np.log(c / c.shift(n))
        for n in (5, 20, 60):
            X['vol_' + str(n)] = r.rolling(n).std() * np.sqrt(252)
        X['vol_ratio'] = X['vol_20'] / X['vol_60']
        X['rsi14'] = _rsi_serie(c) / 100
        X['dist_sma50'] = c / c.rolling(50).mean() - 1
        X['dist_sma200'] = c / c.rolling(200).mean() - 1
        X['drawdown60'] = c / c.rolling(60).max() - 1
        X['mkt_ret20'] = np.log(mercado / mercado.shift(20))
        X['mkt_vol20'] = lr_m.rolling(20).std() * np.sqrt(252)
        X['beta60'] = r.rolling(60).cov(lr_m) / lr_m.rolling(60).var()
        X['es_cripto'] = 1.0 if (sym in ASSETS and ASSETS[sym]['type'] == 'CRYPTO') else 0.0
        X['y_ret'] = np.log(c.shift(-H_PORT) / c)
        X['y_vol'] = r[::-1].rolling(H_PORT).std()[::-1].shift(-1) * np.sqrt(252)
        X['sym'] = sym
        filas.append(X)
    panel = pd.concat(filas).replace([np.inf, -np.inf], np.nan)
    panel.index.name = 'fecha'
    return panel.reset_index()


VARS_ML = [
    'ret_1', 'ret_5', 'ret_20', 'ret_60', 'ret_120',
    'vol_5', 'vol_20', 'vol_60', 'vol_ratio', 'rsi14',
    'dist_sma50', 'dist_sma200', 'drawdown60',
    'mkt_ret20', 'mkt_vol20', 'beta60', 'es_cripto',
]


def _modelos_clas():
    return {
        'Random Forest': RandomForestClassifier(n_estimators=200, max_depth=8, min_samples_leaf=20,
                                                class_weight='balanced_subsample', n_jobs=-1, random_state=42),
        'KNN': make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=50, weights='distance')),
        'Red neuronal': make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(32, 16), alpha=1e-3,
                                                                      max_iter=400, early_stopping=True,
                                                                      random_state=42)),
    }


def _modelos_reg():
    return {
        'Random Forest': RandomForestRegressor(n_estimators=200, max_depth=6, min_samples_leaf=50,
                                               n_jobs=-1, random_state=42),
        'KNN': make_pipeline(StandardScaler(), KNeighborsRegressor(n_neighbors=100, weights='distance')),
        'Red neuronal': make_pipeline(StandardScaler(), MLPRegressor(hidden_layer_sizes=(32, 16), alpha=1e-2,
                                                                     max_iter=400, early_stopping=True,
                                                                     random_state=42)),
    }


def _dm_diario(perdida_modelo, perdida_base, fechas):
    """Diebold-Mariano sobre la perdida promedio diaria (el panel se agrega por fecha)."""
    d = pd.DataFrame({'m': perdida_modelo, 'b': perdida_base, 'f': fechas}).groupby('f').mean()
    if len(d) < 30:
        return 0.0, 1.0
    return _dm_test(np.sqrt(d['m'].to_numpy()), np.sqrt(d['b'].to_numpy()), H_PORT)


def _metricas_precio(y_real, y_pred):
    """MAPE y SMAPE sobre el precio implicito (P0*exp(retorno)); sobre retornos cercanos a 0 explotan.
    Variance Score = explained_variance_score sobre los retornos."""
    from sklearn.metrics import explained_variance_score
    real = np.exp(np.asarray(y_real, float))
    pred = np.exp(np.asarray(y_pred, float))
    return {'mape': float(np.mean(np.abs(real - pred) / real) * 100),
            'smape': float(np.mean(2 * np.abs(real - pred) / (np.abs(real) + np.abs(pred))) * 100),
            'variance_score': float(explained_variance_score(y_real, y_pred))}


def laboratorio_ml(precios):
    """Entrena y valida los modelos de las Opciones 1 y 2. Devuelve metricas y predicciones actuales."""
    clave = (tuple(precios.columns), str(precios.index[-1].date()), len(precios))
    if clave in CACHE_ML:
        return CACHE_ML[clave]
    panel = _panel_ml(precios)
    datos = panel.dropna(subset=VARS_ML + ['y_ret', 'y_vol'])
    fechas = np.sort(datos['fecha'].unique())
    corte = fechas[int(len(fechas) * 0.7)]
    fin_train = fechas[max(0, int(len(fechas) * 0.7) - H_PORT)]
    tr = datos[datos['fecha'] <= fin_train]
    te = datos[datos['fecha'] >= corte]
    umbr = tr.groupby('sym')['y_vol'].quantile([1 / 3, 2 / 3]).unstack()

    def a_regimen(df, col):
        lo = df['sym'].map(umbr[1 / 3])
        hi = df['sym'].map(umbr[2 / 3])
        return np.where(df[col] <= lo, 0, np.where(df[col] <= hi, 1, 2))

    ytr_c, yte_c = a_regimen(tr, 'y_vol'), a_regimen(te, 'y_vol')
    base_c = a_regimen(te, 'vol_20')
    perd_base_c = (base_c != yte_c).astype(float)
    clas, mejor_c, matriz_c, modelos_c = [], None, None, dict()
    for nombre, m in _modelos_clas().items():
        m.fit(tr[VARS_ML], ytr_c)
        p = m.predict(te[VARS_ML])
        dm, pv = _dm_diario((p != yte_c).astype(float), perd_base_c, te['fecha'].to_numpy())
        fila = {'modelo': nombre, 'accuracy': float((p == yte_c).mean() * 100),
                'f1': float(f1_score(yte_c, p, average='macro', zero_division=0)), 'dm': dm, 'p': pv,
                'f1_por_clase': dict(zip(REGIMENES, [float(x) for x in f1_score(yte_c, p, average=None, labels=[I0, I1, I2], zero_division=0)]))}
        clas.append(fila)
        modelos_c[nombre] = m
        if mejor_c is None or fila['f1'] > mejor_c['f1']:
            mejor_c, matriz_c = fila, confusion_matrix(yte_c, p, labels=[I0, I1, I2]).tolist()
    base_clas = {'modelo': 'Ingenuo (el régimen actual se repite)',
                 'accuracy': float((base_c == yte_c).mean() * 100),
                 'f1': float(f1_score(yte_c, base_c, average='macro', zero_division=0)),
                 'f1_por_clase': dict(zip(REGIMENES, [float(x) for x in f1_score(yte_c, base_c, average=None, labels=[I0, I1, I2], zero_division=0)]))}

    media_hist = tr.groupby('sym')['y_ret'].mean()
    base_r = te['sym'].map(media_hist).to_numpy()
    y_te = te['y_ret'].to_numpy()
    reg, mejor_r, matriz_r, modelos_r = [], None, None, dict()
    for nombre, m in _modelos_reg().items():
        m.fit(tr[VARS_ML], tr['y_ret'])
        p = m.predict(te[VARS_ML])
        dm, pv = _dm_diario((y_te - p) ** 2, (y_te - base_r) ** 2, te['fecha'].to_numpy())
        fila = {'modelo': nombre, 'rmse': float(np.sqrt(mean_squared_error(y_te, p)) * 100),
                'mse': float(mean_squared_error(y_te, p) * 1e4), 'mae': float(mean_absolute_error(y_te, p) * 100),
                'r2': float(r2_score(y_te, p)), 'acierto_direccion': float(((p > 0) == (y_te > 0)).mean() * 100),
                'dm': dm, 'p': pv, **_metricas_precio(y_te, p)}
        reg.append(fila)
        modelos_r[nombre] = m
        if mejor_r is None or fila['rmse'] < mejor_r['rmse']:
            mejor_r = fila
            matriz_r = confusion_matrix((y_te > 0).astype(int), (p > 0).astype(int), labels=[I0, I1]).tolist()
    base_reg = {'modelo': 'Ingenuo (promedio histórico)',
                'rmse': float(np.sqrt(mean_squared_error(y_te, base_r)) * 100),
                'mae': float(mean_absolute_error(y_te, base_r) * 100),
                'mse': float(mean_squared_error(y_te, base_r) * 1e4), 'r2': float(r2_score(y_te, base_r)),
                **_metricas_precio(y_te, base_r)}

    primer = te[te['fecha'] == te['fecha'].min()].set_index('sym')
    mu_corte = pd.Series(modelos_r[mejor_r['modelo']].predict(primer[VARS_ML]), index=primer.index)

    ult = panel[panel['fecha'] == panel['fecha'].max()].set_index('sym').dropna(subset=VARS_ML)
    todo = datos
    mc = _modelos_clas()[mejor_c['modelo']]
    mc.fit(todo[VARS_ML], a_regimen(todo, 'y_vol'))
    mr = _modelos_reg()[mejor_r['modelo']]
    mr.fit(todo[VARS_ML], todo['y_ret'])
    probs = mc.predict_proba(ult[VARS_ML])
    reg_hoy = pd.Series([REGIMENES[int(i)] for i in mc.classes_[probs.argmax(axis=1)]], index=ult.index)
    prob_hoy = pd.Series(probs.max(axis=1), index=ult.index)
    ret_hoy = pd.Series(mr.predict(ult[VARS_ML]), index=ult.index)

    out = {
        'regimen': {'modelos': clas, 'mejor': mejor_c['modelo'], 'matriz': matriz_c, 'base': base_clas,
                    'etiquetas': REGIMENES},
        'rendimiento': {'modelos': reg, 'mejor': mejor_r['modelo'], 'matriz_direccion': matriz_r,
                        'etiquetas_direccion': ['baja', 'sube'], 'base': base_reg},
        'n_train': int(len(tr)), 'n_test': int(len(te)), 'corte': str(pd.Timestamp(corte).date()),
        'horizonte_dias': H_PORT, 'temporalidad': 'diaria', 'variables': VARS_ML,
        '_reg_hoy': reg_hoy, '_prob_hoy': prob_hoy, '_ret_hoy': ret_hoy, '_mu_corte': mu_corte,
    }
    CACHE_ML[clave] = out
    return out


def _metricas(w, mu, cov, rf):
    r = float(w @ mu)
    v = float(np.sqrt(max(w @ cov @ w, 1e-12)))
    return r, v, (r - rf) / v if v > 0 else 0.0


def _optimizar(mu, cov, rf, lim, objetivo, meta=None):
    cons = [{'type': 'eq', 'fun': lambda w: w.sum() - 1.0}]
    if objetivo == 'meta':
        cons.append({'type': 'eq', 'fun': lambda w: w @ mu - meta})
        fun = lambda w: w @ cov @ w
    elif objetivo == 'min_var':
        fun = lambda w: w @ cov @ w
    elif objetivo == 'paridad':
        activo = np.array([b[I1] > 1e-9 for b in lim])

        def fun(w):
            rc = (w * (cov @ w))[activo]
            return float(((rc - rc.mean()) ** 2).sum() * 1e4)
    else:
        fun = lambda w: -(w @ mu - rf) / np.sqrt(max(w @ cov @ w, 1e-12))
    x0 = np.array([max(min(1.0 / len(mu), b[I1]), 1e-4) for b in lim])
    x0 = x0 / x0.sum()
    res = _minimize(fun, x0, method='SLSQP', bounds=lim, constraints=cons,
                    options={'maxiter': 600, 'ftol': 1e-11})
    if not res.success:
        return None
    w = np.clip(res.x, 0, None)
    return w / w.sum()


def _riesgo_cartera(ret_dia, w, rf):
    rp = ret_dia.values @ w
    q = np.percentile(rp, 5)
    abajo = np.minimum(rp - rf / 252, 0)
    dd = np.sqrt((abajo ** 2).mean()) * np.sqrt(252)
    sortino = (rp.mean() * 252 - rf) / dd if dd > 0 else 0.0
    return float(-q * 100), float(-rp[rp <= q].mean() * 100), float(sortino)


def _cartera(nombre, desc, w, simbolos, mu, cov, rf, capital, ret_dia, precios, info_ml):
    r, v, sh = _metricas(w, mu, cov, rf)
    var95, cvar95, sortino = _riesgo_cartera(ret_dia, w, rf)
    pesos = []
    for i in np.argsort(-w):
        if w[i] < 0.005:
            continue
        sym = simbolos[i]
        monto = capital * float(w[i])
        px = float(precios[sym].iloc[-1])
        pesos.append({'sym': sym, 'nombre': ASSETS[sym]['name'] if sym in ASSETS else sym,
                      'clase': ASSETS[sym]['type'] if sym in ASSETS else '', 'peso': float(w[i]),
                      'monto': monto, 'precio': px, 'cantidad': monto / px,
                      'regimen': info_ml.get(sym, {}).get('regimen')})
    return {'nombre': nombre, 'descripcion': desc, 'pesos': pesos, 'rendimiento': r * 100,
            'volatilidad': v * 100, 'sharpe': sh, 'sortino': sortino, 'var95_dia': var95, 'cvar95_dia': cvar95}


def construir_portafolio(perfil='moderado', capital=10000.0, activos=None, max_peso=0.35, anios=5,
                         mezcla_ml=0.5):
    perfil = perfil if perfil in ('conservador', 'moderado', 'agresivo') else 'moderado'
    if not activos:
        base = [s for s in ASSETS if ASSETS[s]['type'] in ('STOCK', 'ETF')]
        activos = base + (['BTC_USDT'] if perfil == 'conservador' else ['BTC_USDT', 'ETH_USDT'])
    activos = [a for a in activos if a in ASSETS][:30]
    if 'SPY' in ASSETS and 'SPY' not in activos:
        activos.append('SPY')
    precios, faltan = precios_portafolio(activos, max(int(anios), 3))
    simbolos = list(precios.columns)
    ret = np.log(precios / precios.shift(1)).dropna()
    rf = tasa_libre_riesgo()
    ml = laboratorio_ml(precios)

    mu_hist = ret.mean().values * 252
    mu_ml = np.array([float(ml['_ret_hoy'].get(s, np.nan)) * 252 / H_PORT for s in simbolos])
    mu_ml = np.where(np.isnan(mu_ml), mu_hist, mu_ml)
    mu = mezcla_ml * mu_ml + (1 - mezcla_ml) * mu_hist
    cov = ret.cov().values * 252

    regimen = {s: ml['_reg_hoy'].get(s) for s in simbolos}
    tope_alta = {'conservador': 0.0, 'moderado': 0.10, 'agresivo': max_peso}[perfil]
    tope_cripto = {'conservador': 0.05, 'moderado': 0.15, 'agresivo': 0.30}[perfil]
    lim = []
    for s in simbolos:
        t = max_peso
        if ASSETS.get(s, {}).get('type') == 'CRYPTO':
            t = min(t, tope_cripto)
        if regimen.get(s) == 'alta':
            t = min(t, tope_alta)
        lim.append((0.0, t))
    if sum(b[I1] for b in lim) < 1.0:
        raise RuntimeError('Con este perfil quedan muy pocos activos aceptables; agrega más activos o sube el peso máximo.')

    w_min = _optimizar(mu, cov, rf, lim, 'min_var')
    w_sh = _optimizar(mu, cov, rf, lim, 'sharpe')
    w_rp = _optimizar(mu, cov, rf, lim, 'paridad')
    if w_min is None or w_sh is None:
        raise RuntimeError('La optimización no convergió con estos activos.')
    n = len(simbolos)
    w_eq = np.ones(n) / n
    frontera = []
    r_min = _metricas(w_min, mu, cov, rf)[I0]
    r_top, resto = 0.0, 1.0
    for i in np.argsort(-mu):
        x = min(lim[i][I1], resto)
        r_top, resto = r_top + x * float(mu[i]), resto - x
        if resto <= 1e-12:
            break
    r_top -= 1e-6
    for meta in np.linspace(r_min, max(r_min, r_top), 25):
        w = _optimizar(mu, cov, rf, lim, 'meta', meta=meta)
        if w is not None:
            rr, vv, ss = _metricas(w, mu, cov, rf)
            frontera.append({'rendimiento': rr * 100, 'volatilidad': vv * 100, 'sharpe': ss})
    if perfil == 'conservador':
        w_perfil, txt = w_min, 'Mínima volatilidad, sin activos en régimen de volatilidad alta.'
    elif perfil == 'moderado':
        w_perfil, txt = w_sh, 'Máximo ratio de Sharpe con rendimientos esperados del modelo ML.'
    else:
        r_sh = _metricas(w_sh, mu, cov, rf)[I0]
        meta = r_sh + 0.6 * (max(f['rendimiento'] for f in frontera) / 100 - r_sh) if frontera else r_sh
        w_perfil = _optimizar(mu, cov, rf, lim, 'meta', meta=meta)
        if w_perfil is None:
            w_perfil = w_sh
        txt = 'Más rendimiento esperado a cambio de más volatilidad (sobre la frontera eficiente).'
    info_ml = {s: {'regimen': regimen.get(s)} for s in simbolos}
    carteras = [
        _cartera('Recomendada (' + perfil + ')', txt, w_perfil, simbolos, mu, cov, rf, capital, ret, precios, info_ml),
        _cartera('Máximo Sharpe', 'Tangente a la frontera eficiente.', w_sh, simbolos, mu, cov, rf, capital, ret, precios, info_ml),
        _cartera('Mínima varianza', 'La de menor riesgo.', w_min, simbolos, mu, cov, rf, capital, ret, precios, info_ml),
    ]
    if w_rp is not None:
        carteras.append(_cartera('Paridad de riesgo', 'Cada activo aporta el mismo riesgo a la cartera.',
                                 w_rp, simbolos, mu, cov, rf, capital, ret, precios, info_ml))
    carteras.append(_cartera('Pesos iguales (1/N)', 'Referencia sin optimizar.', w_eq, simbolos, mu, cov, rf,
                             capital, ret, precios, info_ml))

    fuera = None
    try:
        corte = pd.Timestamp(ml['corte'])
        r_a, r_b = ret[ret.index < corte], ret[ret.index >= corte]
        mu_h = r_a.mean().values * 252
        mu_m = np.array([float(ml['_mu_corte'].get(s, np.nan)) * 252 / H_PORT for s in simbolos])
        mu_c = mezcla_ml * np.where(np.isnan(mu_m), mu_h, mu_m) + (1 - mezcla_ml) * mu_h
        cov_a = r_a.cov().values * 252
        lim_libre = [(0.0, b[I1] if ASSETS.get(simbolos[i], {}).get('type') != 'CRYPTO' else tope_cripto)
                     for i, b in enumerate([(0.0, max_peso)] * n)]
        w_oos_ml = _optimizar(mu_c, cov_a, rf, lim_libre, 'sharpe')
        w_oos_hist = _optimizar(mu_h, cov_a, rf, lim_libre, 'sharpe')
        w_oos_mv = _optimizar(mu_h, cov_a, rf, lim_libre, 'min_var')
        w_oos_rp = _optimizar(mu_h, cov_a, rf, lim_libre, 'paridad')
        w_oos_eq = np.ones(n) / n
        acum = lambda w: float((np.exp((r_b.values @ w).sum()) - 1) * 100) if w is not None else None

        def _sharpe_oos(w):
            if w is None or len(r_b) < 2:
                return None
            rp = r_b.values @ w
            sd = float(np.std(rp, ddof=1) * np.sqrt(252))
            if sd <= 1e-9:
                return None
            return round(float((np.mean(rp) * 252 - rf) / sd), 2)

        fuera = {'desde': str(r_b.index[I0].date()), 'hasta': str(r_b.index[-1].date()),
                 'sharpe_con_ml': acum(w_oos_ml),
                 'sharpe_historico': acum(w_oos_hist),
                 'minima_varianza': acum(w_oos_mv),
                 'paridad_riesgo': acum(w_oos_rp),
                 'pesos_iguales': acum(w_oos_eq),
                 'sharpe_real_con_ml': _sharpe_oos(w_oos_ml),
                 'sharpe_real_historico': _sharpe_oos(w_oos_hist),
                 'sharpe_real_minvar': _sharpe_oos(w_oos_mv),
                 'sharpe_real_paridad': _sharpe_oos(w_oos_rp),
                 'sharpe_real_1n': _sharpe_oos(w_oos_eq)}
        if 'SPY' in simbolos:
            w_spy = np.eye(n)[simbolos.index('SPY')]
            fuera['spy'] = acum(w_spy)
            fuera['sharpe_real_spy'] = _sharpe_oos(w_spy)
    except Exception:
        logging.exception('Prueba fuera de muestra del portafolio')

    corr_df = ret[simbolos].corr()
    correlacion_pearson = {
        s1: {s2: round(float(corr_df.loc[s1, s2]), 4) for s2 in simbolos}
        for s1 in simbolos
    }

    por_activo = []
    for i, s in enumerate(simbolos):
        por_activo.append({'sym': s, 'nombre': ASSETS[s]['name'] if s in ASSETS else s,
                           'clase': ASSETS.get(s, {}).get('type', ''),
                           'regimen': regimen.get(s), 'prob_regimen': float(ml['_prob_hoy'].get(s, np.nan)),
                           'rend_ml': float(mu_ml[i] * 100), 'rend_hist': float(mu_hist[i] * 100),
                           'rend_usado': float(mu[i] * 100), 'volatilidad': float(np.sqrt(cov[i, i]) * 100),
                           'tope': float(lim[i][I1])})
    publico_ml = {k: v for k, v in ml.items() if not k.startswith('_')}
    return _py({
        'perfil': perfil, 'capital': capital, 'anios': anios, 'max_peso': max_peso, 'mezcla_ml': mezcla_ml,
        'tasa_libre': rf * 100, 'desde': str(precios.index[I0].date()), 'hasta': str(precios.index[-1].date()),
        'dias': int(len(ret)), 'activos': por_activo, 'faltan': faltan, 'frontera': frontera,
        'carteras': carteras, 'fuera_de_muestra': fuera, 'ml': publico_ml,
        'correlacion_pearson': correlacion_pearson,
        'aviso': 'Rendimientos esperados = 50% predicción del modelo ML + 50% promedio histórico; volatilidades '
                 'con datos diarios. No garantizan resultados futuros. Simulación educativa.',
        'ts': time.time(),
    })


def _actualizar_comando(ref, datos):
    """Actualiza el comando en Firestore; si la app ya lo borro (NotFound), solo lo anota en el log."""
    try:
        ref.update(datos)
    except Exception as exc:
        logging.warning('El comando %s ya no existe en Firestore (la app lo borro): %s', ref.id, str(exc)[:80])


def fb_atender_portafolio(ref, data):
    p = data.get('valor') or dict()
    try:
        res = construir_portafolio(p.get('perfil', 'moderado'), float(p.get('capital') or 10000),
                                   p.get('activos'), float(p.get('max_peso') or 0.35), int(p.get('anios') or 5))
        res['uid'] = data.get('uid')
        FB['db'].collection('portafolios').document(ref.id).set(res)
        c = res['carteras'][I0]
        txt = (c['nombre'] + ': rendimiento esperado ' + fd2(c['rendimiento']) + '% anual, volatilidad '
               + fd2(c['volatilidad']) + '%, Sharpe ' + fd2(c['sharpe']) + ', Sortino ' + fd2(c['sortino']))
        _actualizar_comando(ref, {'estado': 'hecho', 'resultado': txt, 'portafolio_id': ref.id, 'atendido': time.time()})
    except Exception as exc:
        logging.exception('Portafolio')
        _actualizar_comando(ref, {'estado': 'error', 'resultado': 'No se pudo construir el portafolio: ' + str(exc)[:200],
                    'atendido': time.time()})


# =====================================================================================
# 13. ANALISIS TECNICO SOBRE LA GRAFICA EN VIVO DE LA APP (bot/analisis)
# =====================================================================================
ANALISIS = {'vivo': False, 'ultima_t': None, 'hilo': None}


def _seg(nombre, t1, p1, t2, p2, color, estilo='solida', ancho=2):
    return {'nombre': nombre, 't1': int(t1), 'p1': float(p1), 't2': int(t2), 'p2': float(p2),
            'color': color, 'estilo': estilo, 'ancho': ancho}


def _serie(nombre, df, col, color, panel='precio', ancho=2):
    sub = df[['t', col]].dropna().tail(300)
    return {'nombre': nombre, 'panel': panel, 'color': color, 'ancho': ancho,
            'puntos': [{'t': int(t), 'v': float(v)} for t, v in zip(sub['t'], sub[col])]}


def construir_analisis(df=None):
    df = df if df is not None else get_candles()
    est = STATE['strategy']
    t = df['t'].to_numpy(dtype=np.int64)
    out = {'asset': STATE['asset'], 'tf': STATE['timeframe'], 'estrategia': est,
           'estrategia_label': STRATEGIES.get(est, est), 'ts': time.time(), 'vela_t': int(t[-1]),
           'precio': float(df['close'].iloc[-1]), 'lineas': [], 'niveles': [], 'series': [],
           'zonas': [], 'marcadores': [], 'resumen': '', 'senal': None, 'senal_txt': ''}
    try:
        sig, sig_txt = evaluate_strategy_signal(df)
    except Exception as exc:
        sig, sig_txt = None, 'Señal no disponible: ' + str(exc)[:80]
    out['senal'], out['senal_txt'] = sig, sig_txt

    if est == 'CHARTISMO':
        ch = analyze_chartismo(df)
        n = ch['lookback']
        off = len(df) - n
        tt = lambda i: t[off + int(min(max(i, 0), n - 1))]
        x0 = ch['x0']
        out['lineas'] += [
            _seg(ch['up_name'], tt(x0), ch['res_line'][x0], tt(n - 1), ch['res_line'][-1], '#f87171'),
            _seg(ch['lo_name'], tt(x0), ch['sup_line'][x0], tt(n - 1), ch['sup_line'][-1], '#60a5fa'),
        ]
        out['niveles'] += [
            {'nombre': 'Gatillo LONG (cierre >)', 'precio': ch['res_filt'], 'color': '#22c55e', 'estilo': 'punteada'},
            {'nombre': 'Gatillo SHORT (cierre <)', 'precio': ch['sup_filt'], 'color': '#ef4444', 'estilo': 'punteada'},
            {'nombre': 'Objetivo alcista', 'precio': ch['target_up'], 'color': '#86efac', 'estilo': 'rayas'},
            {'nombre': 'Objetivo bajista', 'precio': ch['target_dn'], 'color': '#fca5a5', 'estilo': 'rayas'},
        ]
        for p in ch['pivots']:
            out['marcadores'].append({'t': int(tt(p[I0])), 'precio': float(p[I1]),
                                      'posicion': 'arriba' if p[I2] == 'H' else 'abajo',
                                      'forma': 'circulo', 'color': '#a78bfa', 'texto': p[I2]})
        for g in ch['gaps']:
            out['zonas'].append({'nombre': 'Gap abierto', 'desde': g['lo'], 'hasta': g['hi'],
                                 't1': int(tt(g['x'])), 'color': '#facc15'})
        out['resumen'] = (ch['pattern'] + ' · ' + ch['kind'] + ' · Sesgo ' + ch['bias_txt']
                          + ' · ' + ch['breakout_text'] + ' · ' + ch['vol_txt'])
    elif est == 'FIBONACCI':
        fb = analyze_fibonacci(df)
        n = fb['lookback']
        off = len(df) - n
        tt = lambda i: t[off + int(min(max(i, 0), n - 1))]
        (xo, yo), (xe, ye) = fb['origin'], fb['end']
        out['lineas'].append(_seg('Impulso', tt(xo), yo, tt(xe), ye, '#e5e7eb', 'rayas', 1))
        for nombre, precio in fb['levels'].items():
            out['niveles'].append({'nombre': 'Fib ' + nombre, 'precio': precio, 'color': '#fbbf24',
                                   'estilo': 'punteada', 't1': int(tt(min(xo, xe)))})
        colores = {'speed': '#38bdf8', 'fib': '#f472b6', 'gann': '#a3e635'}
        for f in list(fb['fans']) + [fb['gann11']]:
            out['lineas'].append(_seg(f['name'], tt(xo), yo, tt(n - 1), f['now'],
                                      colores.get(f.get('group'), '#94a3b8'), 'solida', 1))
        out['niveles'] += [{'nombre': 'Soporte', 'precio': fb['support'], 'color': '#22c55e', 'estilo': 'solida'},
                           {'nombre': 'Resistencia', 'precio': fb['resistance'], 'color': '#ef4444', 'estilo': 'solida'}]
        out['resumen'] = 'Fibonacci (' + str(fb['trend']) + ') · ' + fb['fan_txt']
    elif est == 'EMA50_200':
        out['series'] += [_serie('EMA 50', df, 'ema_50', '#fbbf24'), _serie('EMA 200', df, 'ema_200', '#a78bfa')]
        out['resumen'] = sig_txt
    elif est == 'BOLLINGER':
        out['series'] += [_serie('Banda superior', df, 'bb_up', '#f87171', ancho=1),
                          _serie('Media 20', df, 'bb_mid', '#94a3b8', ancho=1),
                          _serie('Banda inferior', df, 'bb_dn', '#60a5fa', ancho=1)]
        out['resumen'] = sig_txt
    elif est == 'RSI':
        out['series'].append(_serie('RSI 14', df, 'rsi', '#a78bfa', panel='rsi'))
        out['niveles'] += [{'nombre': 'Sobrecompra 70', 'precio': 70, 'color': '#ef4444', 'estilo': 'rayas', 'panel': 'rsi'},
                           {'nombre': 'Sobreventa 30', 'precio': 30, 'color': '#22c55e', 'estilo': 'rayas', 'panel': 'rsi'}]
        out['resumen'] = sig_txt
    else:
        s = _serie('SuperTrend', df, 'supertrend', '#22c55e')
        dirs = dict(zip(df['t'].astype(int), df['st_dir']))
        for pt in s['puntos']:
            pt['color'] = '#22c55e' if int(dirs.get(pt['t'], 1)) == 1 else '#ef4444'
        out['series'].append(s)
        out['resumen'] = sig_txt

    pos = STATE.get('position')
    if pos and pos.get('asset') == STATE['asset']:
        out['niveles'] += [
            {'nombre': 'Entrada ' + pos['side'], 'precio': pos['entry'], 'color': '#e5e7eb', 'estilo': 'solida'},
            {'nombre': 'SL', 'precio': pos['sl'], 'color': '#ef4444', 'estilo': 'solida'},
            {'nombre': 'TP', 'precio': pos['tp'], 'color': '#22c55e', 'estilo': 'solida'},
        ]
    if sig:
        out['marcadores'].append({'t': int(t[-1]), 'precio': out['precio'],
                                  'posicion': 'abajo' if sig == 'LONG' else 'arriba',
                                  'forma': 'flecha_arriba' if sig == 'LONG' else 'flecha_abajo',
                                  'color': '#22c55e' if sig == 'LONG' else '#ef4444', 'texto': 'Señal ' + sig})
    return _py(out)


def fb_publicar_analisis(df=None):
    db = fb_init() if FB['activo'] else None
    if db is None:
        return None
    try:
        a = construir_analisis(df)
        db.collection('bot').document('analisis').set(a)
        try:
            fb_publicar_analisis_grafico(df if df is not None else get_candles())
        except Exception:
            logging.exception('analisis_grafico')
        ANALISIS['ultima_t'] = a['vela_t']
        return a
    except Exception:
        logging.exception('No se pudo publicar el análisis en la app')
        return None


def _bucle_analisis_vivo():
    while not PUENTE_STOP.is_set():
        if ANALISIS['vivo']:
            try:
                df = get_candles()
                if int(df['t'].iloc[-1]) != ANALISIS['ultima_t']:
                    fb_publicar_analisis(df)
            except Exception:
                logging.exception('Análisis en vivo')
        PUENTE_STOP.wait(15)


def _asegurar_bucle_analisis():
    h = ANALISIS['hilo']
    if h is None or not h.is_alive():
        ANALISIS['hilo'] = threading.Thread(target=_bucle_analisis_vivo, daemon=True, name='analisis_vivo')
        ANALISIS['hilo'].start()


_build_report_chart_original = build_report_chart


def build_report_chart(df):
    """Mismo grafico del reporte; ademas manda el analisis a la grafica en vivo de la app."""
    img = _build_report_chart_original(df)
    threading.Thread(target=fb_publicar_analisis, args=(df,), daemon=True).start()
    return img


# =====================================================================================
# 14. MODULO INDEPENDIENTE: SENTIMIENTO DE MERCADO EN X (GROK / xAI) + VALVULA DARK PRO
#     100% aislado: NO modifica logica de trading, riesgo, ordenes, exchange ni estado.
#     Usa XAI_API_KEY y XAI_MODEL definidos al inicio en la Seccion 1.
# =====================================================================================
import re as _re_grok
import textwrap as _tw_grok
from matplotlib.patches import Wedge as _Wedge, Circle as _Circle, FancyBboxPatch as _FancyBbox, Polygon as _Polygon

SENTIMENT_WEIGHTS = {
    'comunidad': 0.50,  # 50% Comunidad general de inversionistas en X
    'medios': 0.35,     # 35% Medios / cuentas financieras especializadas
    'oficial': 0.15,    # 15% Fuentes oficiales de la empresa / protocolo / emisor
}

SENTIMENT_PALETTE = {
    'ALCISTA': {'main': '#10b981', 'glow': '#34d399', 'bg': '#06281e', 'label': 'ALCISTA'},
    'BAJISTA': {'main': '#ef4444', 'glow': '#f87171', 'bg': '#2c0b0e', 'label': 'BAJISTA'},
    'NEUTRAL': {'main': '#94a3b8', 'glow': '#cbd5e1', 'bg': '#1e293b', 'label': 'NEUTRAL'},
    'HOLD':    {'main': '#f59e0b', 'glow': '#fbbf24', 'bg': '#2e2006', 'label': 'HOLD'},
}


def _limpiar_ticker_busqueda(sym):
    info = ASSETS.get(sym, {'ticker': sym, 'name': sym, 'type': 'STOCK'})
    clean = sym.replace('_USDT', '')
    cashtag = '$' + clean
    if info['type'] == 'CRYPTO':
        contexto_oficial = (
            'cuentas oficiales de la fundación/red, desarrolladores principales, '
            'actualizaciones técnicas y flujos institucionales oficiales'
        )
    elif info['type'] == 'ETF':
        contexto_oficial = (
            'comunicados de la gestora del ETF, datos macroeconómicos oficiales '
            '(Fed, Tesoro, índices subyacentes) y flujos de fondos'
        )
    else:
        contexto_oficial = (
            'relación con inversionistas (IR) de la empresa, reportes trimestrales/SEC, '
            'guidance oficial y comunicados corporativos'
        )
    return clean, cashtag, info['name'], info['type'], contexto_oficial


def _extraer_texto_xai(payload):
    """Extrae el texto final tanto de /v1/responses como de /v1/chat/completions."""
    if isinstance(payload.get('output_text'), str) and payload['output_text'].strip():
        return payload['output_text'].strip()
    partes = []
    for item in payload.get('output', []) or []:
        if item.get('type') == 'message':
            for c in item.get('content', []) or []:
                if c.get('type') in ('output_text', 'text') and c.get('text'):
                    partes.append(str(c['text']))
    if partes:
        return '\n'.join(partes).strip()
    choices = payload.get('choices') or []
    if choices:
        msg = choices[I0].get('message') or {}
        if msg.get('content'):
            return str(msg['content']).strip()
    raise RuntimeError('Respuesta vacía de la API de Grok/xAI.')


def _parsear_json_grok(raw_txt):
    limpio = _re_grok.sub(r'```(?:json)?', '', raw_txt, flags=_re_grok.IGNORECASE).strip()
    ini = limpio.find('{')
    fin = limpio.rfind('}')
    if ini == -1 or fin == -1 or fin <= ini:
        raise ValueError('Grok no devolvió un bloque JSON válido.')
    return json.loads(limpio[ini:fin + 1])


def _auditar_y_calcular_sentimiento(raw_data, sym):
    """Aplica la ponderación híbrida 50/35/15 y las reglas cuantitativas auditadas."""
    s_com = float(np.clip(float(raw_data.get('score_comunidad', 0.0)), -100.0, 100.0))
    s_med = float(np.clip(float(raw_data.get('score_medios', 0.0)), -100.0, 100.0))
    s_ofi = float(np.clip(float(raw_data.get('score_oficial', 0.0)), -100.0, 100.0))

    score = (
        SENTIMENT_WEIGHTS['comunidad'] * s_com
        + SENTIMENT_WEIGHTS['medios'] * s_med
        + SENTIMENT_WEIGHTS['oficial'] * s_ofi
    )
    score = float(np.clip(round(score, 1), -100.0, 100.0))

    inst_avg = (0.35 * s_med + 0.15 * s_ofi) / 0.50
    divergencia = abs(s_com - inst_avg)
    conf_raw = float(np.clip(float(raw_data.get('confianza_pct', 68.0)), 15.0, 99.0))
    if divergencia > 55.0:
        confianza = max(30.0, round(conf_raw - (divergencia - 55.0) * 0.35, 1))
    else:
        confianza = round(conf_raw, 1)

    conflicto_fuerte = (s_com * inst_avg < 0) and (divergencia >= 50.0)
    catalizador_espera = bool(raw_data.get('espera_catalizador', False))

    if conflicto_fuerte or (abs(score) >= 22.0 and confianza < 55.0):
        estado = 'HOLD'
    elif score >= 22.0:
        estado = 'ALCISTA'
    elif score <= -22.0:
        estado = 'BAJISTA'
    elif 10.0 < abs(score) < 22.0 or catalizador_espera:
        estado = 'HOLD'
    else:
        estado = 'NEUTRAL'

    p_alc = max(0.0, float(raw_data.get('pct_alcista', 0.0)))
    p_neu = max(0.0, float(raw_data.get('pct_neutral', 0.0)))
    p_baj = max(0.0, float(raw_data.get('pct_bajista', 0.0)))
    suma = p_alc + p_neu + p_baj
    if suma <= 1.0:
        p_alc = np.clip(50.0 + score * 0.42, 5.0, 90.0)
        p_baj = np.clip(50.0 - score * 0.42, 5.0, 90.0)
        p_neu = max(8.0, 100.0 - abs(score) * 0.65)
        suma = p_alc + p_neu + p_baj

    p_alc = round(p_alc / suma * 100.0, 1)
    p_baj = round(p_baj / suma * 100.0, 1)
    p_neu = round(max(0.0, 100.0 - p_alc - p_baj), 1)

    clean, cashtag, nombre, clase, _ = _limpiar_ticker_busqueda(sym)
    hallazgos = str(raw_data.get('que_encontro') or 'Sin hallazgos relevantes recientes.').strip()
    razon = str(raw_data.get('por_que') or 'Resultado derivado de la ponderación híbrida 50/35/15.').strip()

    return {
        'symbol': sym,
        'ticker': clean,
        'cashtag': cashtag,
        'name': nombre,
        'asset_type': clase,
        'estado': estado,
        'score': score,
        'score_comunidad': round(s_com, 1),
        'score_medios': round(s_med, 1),
        'score_oficial': round(s_ofi, 1),
        'divergencia': round(divergencia, 1),
        'confianza': confianza,
        'pct_alcista': p_alc,
        'pct_neutral': p_neu,
        'pct_bajista': p_baj,
        'que_encontro': hallazgos,
        'por_que': razon,
        'timestamp_utc': datetime.now(timezone.utc).strftime('%d-%b-%Y %H:%M UTC'),
    }


def consultar_sentimiento_grok(asset=None):
    """Consulta Grok (xAI) con búsqueda en vivo en X + Web y aplica el modelo híbrido."""
    if not XAI_API_KEY or XAI_API_KEY.startswith('PEGA_AQUI'):
        raise RuntimeError(
            'Falta colocar tu XAI_API_KEY en la Sección 1 del código (o en tu archivo .env).'
        )
    sym = asset or STATE['asset']
    clean, cashtag, nombre, clase, contexto_oficial = _limpiar_ticker_busqueda(sym)

    sys_prompt = (
        'Eres un analista cuantitativo institucional especializado en inteligencia de sentimiento '
        'en tiempo real sobre X (Twitter) y medios financieros. '
        'Ignora bots, sorteos, spam y cuentas promocionales repetitivas. '
        'Responde UNICAMENTE con un objeto JSON válido, sin texto adicional ni markdown.'
    )
    user_prompt = (
        f'Investiga en tiempo real (últimas 24 a 72 horas) el sentimiento de mercado sobre '
        f'{nombre} (Ticker: {clean} / {cashtag}, Clase: {clase}).\n'
        f'Evalúa por separado estos 3 pilares en escala de -100 (extremadamente bajista) a +100 (extremadamente alcista):\n'
        f'1) Comunidad general de inversionistas y traders en X (peso 50%): flujo orgánico en {cashtag}, '
        f'narrativa minorista, posicionamiento.\n'
        f'2) Medios especializados y cuentas financieras/analistas institucionales en X y web (peso 35%): '
        f'titulares, upgrades/downgrades, flujo macro.\n'
        f'3) Fuentes oficiales (peso 15%): {contexto_oficial}.\n\n'
        f'Devuelve EXACTAMENTE este esquema JSON en español:\n'
        f'{{\n'
        f'  "score_comunidad": numero entre -100 y 100,\n'
        f'  "score_medios": numero entre -100 y 100,\n'
        f'  "score_oficial": numero entre -100 y 100,\n'
        f'  "pct_alcista": porcentaje estimado 0-100,\n'
        f'  "pct_neutral": porcentaje estimado 0-100,\n'
        f'  "pct_bajista": porcentaje estimado 0-100,\n'
        f'  "confianza_pct": nivel de confianza del analisis 0-100 segun volumen y calidad de datos,\n'
        f'  "espera_catalizador": true o false (si el mercado espera un evento inminente como earnings o Fed),\n'
        f'  "que_encontro": "UNA sola frase (máx 85 caracteres) con lo más importante que se dice hoy del activo.",\n'
        f'  "por_que": "UNA sola frase (máx 85 caracteres) con el motivo principal de la lectura."\n'
        f'}}'
    )

    headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + XAI_API_KEY,
        'User-Agent': 'QuantBotMultiAsset/1.0',
    }

    modelos = list(dict.fromkeys([XAI_MODEL, 'grok-4.7', 'grok-4.1-fast', 'grok-4']))
    last_err = None

    for mod in modelos:
        body = {
            'model': mod,
            'input': [
                {'role': 'system', 'content': sys_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            'tools': [
                {'type': 'x_search'},
                {'type': 'web_search'},
            ],
            'temperature': 0.2,
        }
        try:
            req = urllib.request.Request(
                'https://api.x.ai/v1/responses',
                data=json.dumps(body).encode('utf-8'),
                headers=headers,
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=90) as resp:
                payload = json.loads(resp.read().decode('utf-8'))
            txt = _extraer_texto_xai(payload)
            return _auditar_y_calcular_sentimiento(_parsear_json_grok(txt), sym)
        except Exception as exc:
            last_err = exc

    for mod in modelos:
        body_cc = {
            'model': mod,
            'messages': [
                {'role': 'system', 'content': sys_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            'temperature': 0.2,
        }
        try:
            req = urllib.request.Request(
                'https://api.x.ai/v1/chat/completions',
                data=json.dumps(body_cc).encode('utf-8'),
                headers=headers,
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=75) as resp:
                payload = json.loads(resp.read().decode('utf-8'))
            txt = _extraer_texto_xai(payload)
            return _auditar_y_calcular_sentimiento(_parsear_json_grok(txt), sym)
        except Exception as exc:
            last_err = exc

    raise RuntimeError('No se pudo obtener respuesta de Grok/xAI: ' + str(last_err))


def generar_tarjeta_sentimiento_grok(data):
    """Tarjeta Dark-Black para Telegram: velocimetro + semaforo + distribucion + 3 pilares (sin bloques de texto)."""
    bg_black = '#05070c'
    card_bg = '#0b101b'
    card_border = '#1e293b'
    txt_white = '#f8fafc'
    txt_muted = '#94a3b8'

    est = data['estado']
    pal = SENTIMENT_PALETTE.get(est, SENTIMENT_PALETTE['NEUTRAL'])
    score = float(data['score'])

    fig = plt.figure(figsize=(8.2, 8.0), dpi=150, facecolor=bg_black)
    ax = fig.add_axes([0.0, 0.0, 1.0, 1.0], facecolor=bg_black)
    ax.set_xlim(0, 100)
    ax.set_ylim(29.5, 128)
    ax.axis('off')

    def draw_box(x, y, w, h, fc=card_bg, ec=card_border, lw=1.2, pad=0.8):
        ax.add_patch(_FancyBbox(
            (x, y), w, h,
            boxstyle=f'round,pad={pad},rounding_size=2.2',
            facecolor=fc, edgecolor=ec, linewidth=lw, zorder=1
        ))

    draw_box(3.5, 32.0, 93.0, 93.0, fc='#070b14', ec='#172033', lw=1.5, pad=0.4)
    draw_box(6.0, 111.5, 88.0, 10.5, fc=card_bg, ec=card_border, lw=1.1, pad=0.5)

    ax.text(8.5, 118.8, 'SENTIMIENTO DE MERCADO  ·  GROK / X LIVE',
            color='#38bdf8', fontsize=9.5, fontweight='bold', va='center')
    ax.text(91.5, 118.8, data['timestamp_utc'],
            color=txt_muted, fontsize=8.5, ha='right', va='center')

    titulo_activo = f"{data['name']}  ({data['ticker']})"
    ax.text(8.5, 114.2, titulo_activo,
            color=txt_white, fontsize=16.5, fontweight='bold', va='center')
    ax.text(91.5, 114.2, f"Clase: {data['asset_type']}  |  Híbrido 50/35/15",
            color='#64748b', fontsize=8.5, ha='right', va='center')

    draw_box(6.0, 59.5, 88.0, 49.5, fc=card_bg, ec=card_border, lw=1.1, pad=0.5)

    draw_box(27.0, 99.5, 46.0, 7.2, fc=pal['bg'], ec=pal['main'], lw=1.8, pad=0.3)
    ax.text(50.0, 103.1, pal['label'],
            color=pal['glow'], fontsize=20, fontweight='bold', ha='center', va='center')

    ax_g = fig.add_axes([0.08, 0.3178, 0.66, 0.3963], facecolor='none')
    ax_g.set_aspect('equal')
    ax_g.set_xlim(-1.28, 1.28)
    ax_g.set_ylim(-0.30, 1.18)
    ax_g.axis('off')

    ax_g.add_patch(_Wedge((0, 0), 1.06, 0, 180, width=0.03, facecolor='#1e293b', edgecolor='#334155', lw=1.0))

    tramos = [
        (140, 180, '#ef4444', 0.88),
        (110, 140, '#f87171', 0.65),
        (98,  110, '#f59e0b', 0.82),
        (82,   98, '#94a3b8', 0.78),
        (70,   82, '#f59e0b', 0.82),
        (40,   70, '#34d399', 0.65),
        (0,    40, '#10b981', 0.90),
    ]
    for th1, th2, col_seg, alp in tramos:
        ax_g.add_patch(_Wedge(
            (0, 0), 1.00, th1, th2, width=0.24,
            facecolor=col_seg, edgecolor='#0b101b', lw=1.6, alpha=alp
        ))

    ax_g.add_patch(_Wedge((0, 0), 0.72, 0, 180, width=0.012, facecolor='#334155', edgecolor='none'))
    for sc_mark in (-100, -50, -22, 0, 22, 50, 100):
        ang_m = np.deg2rad(90.0 - (sc_mark / 100.0) * 90.0)
        r_in, r_out = 0.67, 0.74
        ax_g.plot([r_in * np.cos(ang_m), r_out * np.cos(ang_m)],
                  [r_in * np.sin(ang_m), r_out * np.sin(ang_m)],
                  color='#cbd5e1', lw=1.2)
        if sc_mark in (-100, -50, 50, 100):
            r_tx = 1.13
            lbl_m = f'+{sc_mark}' if sc_mark > 0 else str(sc_mark)
            ax_g.text(r_tx * np.cos(ang_m), r_tx * np.sin(ang_m), lbl_m,
                      color='#94a3b8', fontsize=8.0, fontweight='bold', ha='center', va='center')

    ax_g.text(-1.02, -0.14, 'BAJISTA', color='#ef4444', fontsize=8.5, fontweight='bold', ha='center')
    ax_g.text(0.0, 1.12, 'NEUTRAL', color='#94a3b8', fontsize=8.0, fontweight='bold', ha='center')
    ax_g.text(1.02, -0.14, 'ALCISTA', color='#10b981', fontsize=8.5, fontweight='bold', ha='center')

    ang_val = np.deg2rad(90.0 - (score / 100.0) * 90.0)
    tip = (0.86 * np.cos(ang_val), 0.86 * np.sin(ang_val))
    b_left = (0.055 * np.cos(ang_val + np.pi / 2), 0.055 * np.sin(ang_val + np.pi / 2))
    b_right = (0.055 * np.cos(ang_val - np.pi / 2), 0.055 * np.sin(ang_val - np.pi / 2))
    tail = (-0.12 * np.cos(ang_val), -0.12 * np.sin(ang_val))
    ax_g.add_patch(_Polygon([b_left, tip, b_right, tail], closed=True,
                            facecolor='#f8fafc', edgecolor=pal['main'], lw=1.6, zorder=8))

    ax_g.add_patch(_Circle((0, 0), 0.13, facecolor='#0f172a', edgecolor=pal['main'], lw=2.4, zorder=9))
    ax_g.add_patch(_Circle((0, 0), 0.05, facecolor=pal['glow'], edgecolor='none', zorder=10))

    score_str = f"{score:+.1f}"
    ax_g.text(0.0, -0.23, f"SCORE TENDENCIA:  {score_str} / 100",
              color=pal['glow'], fontsize=11.5, fontweight='bold', ha='center', va='center')

    draw_box(74.5, 62.5, 16.5, 34.0, fc='#070b14', ec='#1e293b', lw=1.0, pad=0.4)
    ax.text(82.75, 94.2, 'SEMÁFORO', color=txt_muted, fontsize=7.8, fontweight='bold', ha='center')
    luces = [
        ('ALCISTA', '#10b981', 88.0),
        ('HOLD',    '#f59e0b', 80.5),
        ('NEUTRAL', '#94a3b8', 73.0),
        ('BAJISTA', '#ef4444', 65.5),
    ]
    for clave_luz, col_luz, y_luz in luces:
        activo_l = (est == clave_luz)
        if activo_l:
            ax.scatter([78.2], [y_luz], s=260, color=col_luz, alpha=0.28, zorder=4)
            ax.scatter([78.2], [y_luz], s=105, color=col_luz, edgecolors='#ffffff', linewidths=1.1, zorder=5)
            ax.text(81.0, y_luz, clave_luz, color=txt_white, fontsize=7.8, fontweight='bold', va='center')
        else:
            ax.scatter([78.2], [y_luz], s=85, color='#1e293b', edgecolors='#334155', linewidths=0.9, zorder=4)
            ax.text(81.0, y_luz, clave_luz, color='#475569', fontsize=7.5, va='center')

    draw_box(6.0, 34.5, 88.0, 22.5, fc=card_bg, ec=card_border, lw=1.1, pad=0.5)

    ax.text(8.5, 54.3, 'DISTRIBUCIÓN DEL SENTIMIENTO', color=txt_white, fontsize=9.2, fontweight='bold')
    ax.text(91.5, 54.3, f"CONFIANZA IA: {data['confianza']:.0f}%",
            color='#38bdf8', fontsize=9.2, fontweight='bold', ha='right')

    bar_x, bar_y, bar_w, bar_h = 8.5, 49.2, 83.0, 3.2
    w_alc = bar_w * (data['pct_alcista'] / 100.0)
    w_neu = bar_w * (data['pct_neutral'] / 100.0)
    w_baj = max(0.0, bar_w - w_alc - w_neu)

    if w_alc > 0:
        ax.barh(bar_y, w_alc, height=bar_h, left=bar_x, color='#10b981', edgecolor='none', zorder=3)
    if w_neu > 0:
        ax.barh(bar_y, w_neu, height=bar_h, left=bar_x + w_alc, color='#64748b', edgecolor='none', zorder=3)
    if w_baj > 0:
        ax.barh(bar_y, w_baj, height=bar_h, left=bar_x + w_alc + w_neu, color='#ef4444', edgecolor='none', zorder=3)

    ax.text(8.5, 45.4, f"● Alcista: {data['pct_alcista']:.1f}%", color='#10b981', fontsize=8.5, fontweight='bold')
    ax.text(50.0, 45.4, f"● Neutral: {data['pct_neutral']:.1f}%", color='#94a3b8', fontsize=8.5, fontweight='bold', ha='center')
    ax.text(91.5, 45.4, f"● Bajista: {data['pct_bajista']:.1f}%", color='#ef4444', fontsize=8.5, fontweight='bold', ha='right')

    pilares = [
        ('Comunidad X (50%)', data['score_comunidad'], 8.5),
        ('Medios Esp. (35%)', data['score_medios'], 37.5),
        ('Oficiales (15%)',   data['score_oficial'], 66.5),
    ]
    for nombre_p, val_p, px_i in pilares:
        col_p = '#10b981' if val_p >= 15 else ('#ef4444' if val_p <= -15 else '#94a3b8')
        draw_box(px_i, 36.2, 25.0, 6.4, fc='#070b14', ec='#1e293b', lw=0.9, pad=0.25)
        ax.text(px_i + 12.5, 40.7, nombre_p, color=txt_muted, fontsize=7.6, ha='center', va='center')
        ax.text(px_i + 12.5, 37.9, f"{val_p:+.1f}", color=col_p, fontsize=10.2, fontweight='bold', ha='center', va='center')

    stream = io.BytesIO()
    fig.savefig(stream, format='png', dpi=150, facecolor=bg_black)
    plt.close(fig)
    stream.seek(0)
    return stream


# --- ACOPLAMIENTO NO INVASIVO AL PANEL DE TELEGRAM (SIN MODIFICAR FUNCIONES ORIGINALES) ---
_build_dashboard_kb_original = build_dashboard_kb
_on_callback_original = on_callback


def build_dashboard_kb():
    kb_orig = _build_dashboard_kb_original()
    filas = [list(f) for f in kb_orig.inline_keyboard]
    sym = STATE.get('asset', 'BTC_USDT')
    filas.append([
        InlineKeyboardButton(
            '🧭 Sentimiento X / Grok (' + sym.replace('_USDT', '') + ')',
            callback_data='ACT:GROK_SENTIMENT'
        )
    ])
    return InlineKeyboardMarkup(filas)


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query and (query.data or '') == 'ACT:GROK_SENTIMENT':
        if TELEGRAM_CHAT_ID is None or str(query.message.chat.id) != str(TELEGRAM_CHAT_ID):
            await query.answer('No autorizado', show_alert=True)
            return
        sym = STATE['asset']
        await query.answer('Consultando sentimiento en vivo en X con Grok...')
        msg_wait = await query.message.reply_text(
            '⏳ Analizando sentimiento en vivo en X, medios y fuentes oficiales con Grok para '
            + sym + '...'
        )
        try:
            datos_sent = await asyncio.to_thread(consultar_sentimiento_grok, sym)
            img_card = await asyncio.to_thread(generar_tarjeta_sentimiento_grok, datos_sent)
            resumen_corto = (
                '🧭 ' + datos_sent['ticker'] + ' · ' + datos_sent['estado']
                + ' (' + format(datos_sent['score'], '+.0f') + '/100)\n'
                + '🟢 ' + fd0_pct(datos_sent['pct_alcista']) + ' · ⚪ ' + fd0_pct(datos_sent['pct_neutral'])
                + ' · 🔴 ' + fd0_pct(datos_sent['pct_bajista'])
                + ' · Confianza ' + fd0_pct(datos_sent['confianza'])
            )
            try:
                await msg_wait.delete()
            except Exception:
                pass
            await query.message.reply_photo(photo=img_card, caption=resumen_corto)
            return await query.message.reply_text(panel_title(), reply_markup=build_dashboard_kb())
        except Exception as exc:
            logging.exception('Error en Sentimiento Grok')
            try:
                await msg_wait.delete()
            except Exception:
                pass
            return await query.message.reply_text(
                '⚠️ No se pudo generar el sentimiento con Grok: ' + str(exc),
                reply_markup=build_dashboard_kb()
            )
    return await _on_callback_original(update, context)


def vm_status_text():
    """Estado de la maquina donde corre el bot (VM de Google Cloud): CPU, RAM, disco y tiempo encendida."""
    import platform
    import socket

    def dur(seg):
        seg = int(max(0, seg))
        d, r = divmod(seg, 86400)
        hh, r = divmod(r, 3600)
        return (str(d) + 'd ' if d else '') + str(hh) + 'h ' + str(r // 60) + 'm'

    lineas = ['━━━ 🖥️ ESTADO DE LA VM ━━━',
              '├─ Equipo: ' + socket.gethostname() + ' (' + platform.system() + ' ' + platform.release() + ')']
    try:
        import psutil
        mem = psutil.virtual_memory()
        disco = psutil.disk_usage(str(DATA_DIR))
        lineas += [
            '├─ CPU: ' + fd0_pct(psutil.cpu_percent(interval=0.6)) + ' (' + str(psutil.cpu_count()) + ' núcleos)',
            '├─ RAM: ' + fd0_pct(mem.percent) + ' de ' + fd1(mem.total / 1e9) + ' GB',
            '├─ Disco: ' + fd0_pct(disco.percent) + ' de ' + fd1(disco.total / 1e9) + ' GB',
            '├─ VM encendida hace: ' + dur(time.time() - psutil.boot_time()),
        ]
    except Exception:
        lineas.append('├─ CPU/RAM: no disponible (falta instalar psutil)')
    pos = STATE['position']
    lineas += [
        '├─ Bot corriendo hace: ' + dur(time.time() - T_INICIO),
        '├─ Trading automático: ' + ('🟢 ON' if STATE['trading_enabled'] else '⏸️ PAUSA'),
        '├─ Activo: ' + str(STATE['asset']) + ' (' + TIMEFRAMES[STATE['timeframe']]['label'] + ') | '
        + STRATEGIES[STATE['strategy']],
        '├─ Posición: ' + ((pos['side'] + ' ' + pos['asset']) if pos else 'ninguna'),
        '├─ Testnet Gate: ' + ('llaves cargadas' if (GATE_TESTNET_KEY and GATE_TESTNET_SECRET) else 'sin llaves'),
        '└─ Hora del servidor (UTC): ' + datetime.now(timezone.utc).strftime('%d-%b-%Y %H:%M'),
    ]
    return '\n'.join(lineas)


async def cmd_vm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    texto = await asyncio.to_thread(vm_status_text)
    await update.message.reply_text(texto, reply_markup=build_dashboard_kb())


def stop_previous_instance():
    prev = getattr(sys, '_quant_bot_stop', None)
    if isinstance(prev, dict) and 'thread' in prev and prev['thread'].is_alive():
        print('Deteniendo instancia previa en Spyder...')
        if 'loop' in prev and 'event' in prev:
            try:
                prev['loop'].call_soon_threadsafe(prev['event'].set)
            except Exception:
                pass
        prev['thread'].join(timeout=8.0)


def main():
    if '--verificar' in sys.argv:
        return verificar()
    if (not TELEGRAM_BOT_TOKEN) or TELEGRAM_BOT_TOKEN.startswith('PEGA_AQUI'):
        print('Falta TELEGRAM_BOT_TOKEN: crea el archivo .env junto al bot (ver .env.example).')
        return
    stop_previous_instance()
    iniciar_puente_app()
    stop_ctl = dict()

    async def _async_bot_lifecycle():
        stop_ctl['loop'] = asyncio.get_running_loop()
        stop_ctl['event'] = asyncio.Event()

        req = HTTPXRequest(
            connect_timeout=60.0, read_timeout=60.0,
            write_timeout=60.0, pool_timeout=60.0, media_write_timeout=60.0
        )
        app = (
            Application.builder()
            .token(TELEGRAM_BOT_TOKEN)
            .request(req)
            .concurrent_updates(True)   # Spyder: evita 'Query is too old' si pulsas otro boton mientras Grok/Gemini responde
            .build()
        )
        instalar_espejo_telegram()
        TG['app'], TG['loop'] = app, asyncio.get_running_loop()
        app.add_handler(MessageHandler(filters.TEXT, espejo_entrada), group=-1)
        app.add_handler(CallbackQueryHandler(espejo_entrada), group=-1)
        app.add_handler(CommandHandler('start', start))
        app.add_handler(CommandHandler(['vm', 'estado'], cmd_vm))
        app.add_handler(CallbackQueryHandler(on_callback))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
        app.add_error_handler(on_error)

        monitor_task = None
        async with app:
            await app.start()
            await send_startup_banner(app)
            monitor_task = asyncio.create_task(background_monitor(app))
            await app.updater.start_polling(drop_pending_updates=True)
            print('BOT QUANT x10 INICIADO - Envia /start en Telegram. (Boton Stop / Ctrl+C para detener)')
            try:
                await stop_ctl['event'].wait()
            finally:
                if monitor_task:
                    monitor_task.cancel()
                    try:
                        await monitor_task
                    except asyncio.CancelledError:
                        pass
                await app.updater.stop()
                await app.stop()

    bot_thread = threading.Thread(target=lambda: asyncio.run(_async_bot_lifecycle()), daemon=True)
    stop_ctl['thread'] = bot_thread
    sys._quant_bot_stop = stop_ctl
    bot_thread.start()

    try:
        while bot_thread.is_alive():
            bot_thread.join(timeout=0.5)
    except KeyboardInterrupt:
        print('\nCerrando conexion con Telegram de forma segura...')
        if 'loop' in stop_ctl and 'event' in stop_ctl:
            stop_ctl['loop'].call_soon_threadsafe(stop_ctl['event'].set)
        bot_thread.join(timeout=10.0)
        print('Bot detenido correctamente.')


if __name__ == '__main__':
    main()