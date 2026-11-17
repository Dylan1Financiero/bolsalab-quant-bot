import React, { useEffect, useRef } from 'react';

let tvScriptPromise = null;

function cargarScriptTradingView() {
  if (typeof window !== 'undefined' && window.TradingView) {
    return Promise.resolve();
  }
  if (tvScriptPromise) {
    return tvScriptPromise;
  }
  tvScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
    if (existing) {
      if (window.TradingView) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (e) => reject(e));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });
  return tvScriptPromise;
}

export default function TradingViewWidget({
  tvSymbol = 'BINANCE:BTCUSDT',
  interval = '5',
  height = 380,
}) {
  const containerRef = useRef(null);
  const containerIdRef = useRef(
    `tv_adv_chart_${Math.random().toString(36).slice(2, 10)}`
  );

  useEffect(() => {
    let cancelado = false;

    cargarScriptTradingView()
      .then(() => {
        if (cancelado || !containerRef.current || !window.TradingView) return;
        containerRef.current.innerHTML = '';

        // eslint-disable-next-line no-new
        new window.TradingView.widget({
          autosize: true,
          symbol: tvSymbol || 'BINANCE:BTCUSDT',
          interval: String(interval || '5'),
          timezone: 'America/Monterrey',
          theme: 'dark',
          style: '1',
          locale: 'es',
          toolbar_bg: '#0F0F12',
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: false,
          withdateranges: true,
          save_image: false,
          container_id: containerIdRef.current,
          backgroundColor: '#0F0F12',
          gridColor: '#18181D',
        });
      })
      .catch((err) => {
        console.error('No se pudo cargar TradingView tv.js:', err);
      });

    return () => {
      cancelado = true;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [tvSymbol, interval]);

  return (
    <div
      className="tv-widget-wrapper"
      style={{ height: typeof height === 'number' ? `${height}px` : height, width: '100%' }}
    >
      <div
        id={containerIdRef.current}
        ref={containerRef}
        className="tv-widget-container"
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
}
