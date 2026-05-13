// ═══════════════════════════════════════════
//  COINHAT DEX — API Only
// ═══════════════════════════════════════════
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── Security ──
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json());

// ── Rate limiting ──
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' }
}));

// ── Env com Fallback ──
const REFERRAL = process.env.REFERRAL_ID || 'coinhat';
const FEE_BPS = process.env.JUPITER_FEE_BPS || '50';
const SOL_MINT = process.env.SOL_MINT || 'So11111111111111112';
const USDC_MINT = process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEX_BASE = process.env.DEXSCREENER_BASE || 'https://api.dexscreener.com';
const BIN_BASE = process.env.BINANCE_BASE || 'https://api.binance.com';
const JUP_BASE = process.env.JUPITER_BASE || 'https://jup.ag';

// ── Helpers ──
const loadJSON = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', `${name}.json`), 'utf8'));
  } catch {
    return [];
  }
};

const proxyFetch = async (url, timeout = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { 
      signal: controller.signal,
      headers: { 
        'User-Agent': 'Mozilla/5.0 Coinhat/1.0',
        'Accept': 'application/json'
      } 
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error('HTTP Error:', res.status, url);
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    console.error('proxyFetch error:', url, e.message);
    throw e;
  }
};

// ═══════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════

app.get('/api/coins', async (req, res) => {
  try {
    const boosts = await proxyFetch(`${DEX_BASE}/token-boosts/top/v1`);
    const solAddrs = boosts.filter(t => t.chainId === 'solana').slice(0, 20).map(t => t.tokenAddress);
    
    let coins = [];
    if (solAddrs.length) {
      const data = await proxyFetch(`${DEX_BASE}/latest/dex/tokens/${solAddrs.join(',')}`);
      const seen = new Map();
      (data.pairs || []).filter(p => p.chainId === 'solana').forEach(p => {
        const k = p.baseToken?.address;
        if (!k) return;
        const liq = parseFloat(p.liquidity?.usd || 0);
        const cur = seen.get(k);
        if (!cur || liq > parseFloat(cur.liquidity?.usd || 0)) seen.set(k, p);
      });
      coins = [...seen.values()].slice(0, 18);
    }

    if (coins.length < 6) {
      const fallback = await proxyFetch(`${DEX_BASE}/latest/dex/search?q=solana+meme`);
      const existing = new Set(coins.map(p => p.baseToken?.address));
      for (const p of (fallback.pairs || []).filter(p => p.chainId === 'solana')) {
        if (!existing.has(p.baseToken?.address)) {
          coins.push(p);
          existing.add(p.baseToken?.address);
        }
        if (coins.length >= 18) break;
      }
    }

    const clean = coins.map(p => ({
      pairAddress: p.pairAddress,
      name: p.baseToken?.name || '—',
      symbol: p.baseToken?.symbol || '—',
      address: p.baseToken?.address || '',
      priceUsd: p.priceUsd,
      change24h: p.priceChange?.h24 || 0,
      marketCap: p.marketCap || 0,
      volume24h: p.volume?.h24 || 0,
      liquidity: p.liquidity?.usd || 0,
      imageUrl: p.info?.imageUrl || null,
      websites: (p.info?.websites || []).map(w => w.url),
      socials: (p.info?.socials || []).map(s => ({ type: s.type, url: s.url }))
    }));

    res.json({ coins: clean, ts: Date.now() });
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch coins', coins: [] });
  }
});

app.get('/api/ticker', async (req, res) => {
  try {
    const data = await proxyFetch(`${BIN_BASE}/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","SOLUSDT"]`);
    const tickers = data.map(t => ({
      symbol: t.symbol.replace('USDT', ''),
      price: parseFloat(t.lastPrice),
      change: parseFloat(t.priceChangePercent)
    }));
    res.json({ tickers });
  } catch {
    res.json({
      tickers: [
        { symbol: 'BTC', price: 67000, change: 1.2 },
        { symbol: 'ETH', price: 3400, change: 0.8 },
        { symbol: 'SOL', price: 168, change: 3.4 }
      ]
    });
  }
});

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ pairs: [] });
  try {
    const data = await proxyFetch(`${DEX_BASE}/latest/dex/search?q=${encodeURIComponent(q)}`);
    const pairs = (data.pairs || []).filter(p => p.chainId === 'solana').slice(0, 7).map(p => ({
      pairAddress: p.pairAddress,
      name: p.baseToken?.name || '—',
      symbol: p.baseToken?.symbol || '—',
      address: p.baseToken?.address || '',
      priceUsd: p.priceUsd,
      change24h: p.priceChange?.h24 || 0,
      marketCap: p.marketCap || 0,
      volume24h: p.volume?.h24 || 0,
      liquidity: p.liquidity?.usd || 0,
      imageUrl: p.info?.imageUrl || null,
      websites: (p.info?.websites || []).map(w => w.url),
      socials: (p.info?.socials || []).map(s => ({ type: s.type, url: s.url }))
    }));
    res.json({ pairs });
  } catch {
    res.status(502).json({ error: 'Search failed', pairs: [] });
  }
});

app.get('/api/chart-url/:pair', (req, res) => {
  const pair = req.params.pair.replace(/[^a-zA-Z0-9_-]/g, '');
  res.json({ url: `https://dexscreener.com/solana/${pair}?embed=1&theme=light&info=0&trades=0` });
});

app.get('/api/swap-url', (req, res) => {
  const outputMint = (req.query.output || USDC_MINT).replace(/[^a-zA-Z0-9]/g, '');
  const inputMint = (req.query.input || SOL_MINT).replace(/[^a-zA-Z0-9]/g, '');
  res.json({
    url: `${JUP_BASE}/swap/${inputMint}-${outputMint}?referral=${REFERRAL}`,
    feeBps: parseInt(FEE_BPS)
  });
});

app.get('/api/jupiter-config', (req, res) => {
  res.json({
    endpoint: 'https://api.mainnet-beta.solana.com',
    feeBps: parseInt(FEE_BPS),
    referral: REFERRAL,
    initialInputMint: SOL_MINT,
    initialOutputMint: USDC_MINT
  });
});

app.get('/api/airdrops', (req, res) => {
  const data = loadJSON('airdrops').map(item => 
    item.slug === 'jupiter' ? { ...item, url: `${JUP_BASE}/?referral=${REFERRAL}` } : item
  );
  res.json({ items: data });
});

app.get('/api/noticias', (req, res) => res.json({ items: loadJSON('noticias') }));
app.get('/api/alphas', (req, res) => res.json({ items: loadJSON('alphas') }));

app.get('/api/parceiros', (req, res) => {
  const data = loadJSON('parceiros').map(item => 
    item.slug === 'jupiter' ? { ...item, url: `${JUP_BASE}/?referral=${REFERRAL}` } : item
  );
  res.json({ items: data });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.get('/', (req, res) => res.json({ status: 'Coinhat API Online', docs: '/api/health' }));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`Coinhat API running on ${PORT}`));
