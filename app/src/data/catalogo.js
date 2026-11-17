/**
 * Catálogo oficial de 28 activos (Sección 4 de ESPECIFICACION.md)
 * Símbolo interno -> Símbolo TradingView y metadatos
 */

export const CATEGORIAS_CATALOGO = [
  { id: 'CRYPTO', label: 'Cripto' },
  { id: 'STOCK', label: 'Acciones' },
  { id: 'ETF', label: 'ETFs' },
];

export const CATALOGO_ACTIVOS = [
  // 10 Criptomonedas (WebSocket Binance + respaldo mercado/precios)
  { sym: 'BTC_USDT', nombre: 'Bitcoin', clase: 'CRYPTO', tv: 'BINANCE:BTCUSDT', binanceStream: 'btcusdt@miniTicker', binancePar: 'BTCUSDT' },
  { sym: 'ETH_USDT', nombre: 'Ethereum', clase: 'CRYPTO', tv: 'BINANCE:ETHUSDT', binanceStream: 'ethusdt@miniTicker', binancePar: 'ETHUSDT' },
  { sym: 'SOL_USDT', nombre: 'Solana', clase: 'CRYPTO', tv: 'BINANCE:SOLUSDT', binanceStream: 'solusdt@miniTicker', binancePar: 'SOLUSDT' },
  { sym: 'XRP_USDT', nombre: 'XRP', clase: 'CRYPTO', tv: 'BINANCE:XRPUSDT', binanceStream: 'xrpusdt@miniTicker', binancePar: 'XRPUSDT' },
  { sym: 'BNB_USDT', nombre: 'BNB', clase: 'CRYPTO', tv: 'BINANCE:BNBUSDT', binanceStream: 'bnbusdt@miniTicker', binancePar: 'BNBUSDT' },
  { sym: 'DOGE_USDT', nombre: 'Dogecoin', clase: 'CRYPTO', tv: 'BINANCE:DOGEUSDT', binanceStream: 'dogeusdt@miniTicker', binancePar: 'DOGEUSDT' },
  { sym: 'ADA_USDT', nombre: 'Cardano', clase: 'CRYPTO', tv: 'BINANCE:ADAUSDT', binanceStream: 'adausdt@miniTicker', binancePar: 'ADAUSDT' },
  { sym: 'AVAX_USDT', nombre: 'Avalanche', clase: 'CRYPTO', tv: 'BINANCE:AVAXUSDT', binanceStream: 'avaxusdt@miniTicker', binancePar: 'AVAXUSDT' },
  { sym: 'LINK_USDT', nombre: 'Chainlink', clase: 'CRYPTO', tv: 'BINANCE:LINKUSDT', binanceStream: 'linkusdt@miniTicker', binancePar: 'LINKUSDT' },
  { sym: 'LTC_USDT', nombre: 'Litecoin', clase: 'CRYPTO', tv: 'BINANCE:LTCUSDT', binanceStream: 'ltcusdt@miniTicker', binancePar: 'LTCUSDT' },

  // 10 Acciones (precio solo de mercado/precios)
  { sym: 'NVDA', nombre: 'NVIDIA', clase: 'STOCK', tv: 'NASDAQ:NVDA' },
  { sym: 'AAPL', nombre: 'Apple', clase: 'STOCK', tv: 'NASDAQ:AAPL' },
  { sym: 'TSLA', nombre: 'Tesla', clase: 'STOCK', tv: 'NASDAQ:TSLA' },
  { sym: 'MSFT', nombre: 'Microsoft', clase: 'STOCK', tv: 'NASDAQ:MSFT' },
  { sym: 'AMZN', nombre: 'Amazon', clase: 'STOCK', tv: 'NASDAQ:AMZN' },
  { sym: 'GOOGL', nombre: 'Alphabet', clase: 'STOCK', tv: 'NASDAQ:GOOGL' },
  { sym: 'META', nombre: 'Meta', clase: 'STOCK', tv: 'NASDAQ:META' },
  { sym: 'AMD', nombre: 'AMD', clase: 'STOCK', tv: 'NASDAQ:AMD' },
  { sym: 'NFLX', nombre: 'Netflix', clase: 'STOCK', tv: 'NASDAQ:NFLX' },
  { sym: 'JPM', nombre: 'JPMorgan', clase: 'STOCK', tv: 'NYSE:JPM' },

  // 8 ETFs (precio solo de mercado/precios)
  { sym: 'SPY', nombre: 'S&P 500', clase: 'ETF', tv: 'AMEX:SPY' },
  { sym: 'QQQ', nombre: 'Nasdaq 100', clase: 'ETF', tv: 'NASDAQ:QQQ' },
  { sym: 'IWM', nombre: 'Russell 2000', clase: 'ETF', tv: 'AMEX:IWM' },
  { sym: 'DIA', nombre: 'Dow Jones', clase: 'ETF', tv: 'AMEX:DIA' },
  { sym: 'GLD', nombre: 'Oro', clase: 'ETF', tv: 'AMEX:GLD' },
  { sym: 'TLT', nombre: 'Bonos Tesoro 20+', clase: 'ETF', tv: 'NASDAQ:TLT' },
  { sym: 'XLK', nombre: 'Tecnología', clase: 'ETF', tv: 'AMEX:XLK' },
  { sym: 'EEM', nombre: 'Emergentes', clase: 'ETF', tv: 'AMEX:EEM' },
];

export const MAPA_ACTIVOS = Object.fromEntries(
  CATALOGO_ACTIVOS.map((item) => [item.sym, item])
);

export const MAPA_BINANCE_PAR_A_SYM = Object.fromEntries(
  CATALOGO_ACTIVOS.filter((item) => item.binancePar).map((item) => [item.binancePar, item.sym])
);

export const BINANCE_WS_URL =
  'wss://stream.binance.com:9443/stream?streams=' +
  CATALOGO_ACTIVOS.filter((a) => a.binanceStream)
    .map((a) => a.binanceStream)
    .join('/');
