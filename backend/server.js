// ═══════════════════════════════════════════════════════
//  COINHAT DEX — Hardened Backend
//  Secure • Fault Tolerant • Render Friendly
// ═══════════════════════════════════════════════════════

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

// ── APP ───────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// ── SECURITY ──────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(compression());

// ── RATE LIMIT ────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
}));

// ── ENV ───────────────────────────────────────────────
const REFERRAL = process.env.REFERRAL_ID || 'coinhat';
const FEE_BPS = parseInt(process.env.JUPITER_FEE_BPS || '50');

const SOL_MINT =
  process.env.SOL_MINT ||
  'So11111111111111111111111111111111111111112';

const USDC_MINT =
  process.env.USDC_MINT ||
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const DEX_BASE =
  process.env.DEXSCREENER_BASE ||
  'https://api.dexscreener.com';

const BIN_BASE =
  process.env.BINANCE_BASE ||
  'https://api.binance.com';

const JUP_BASE =
  process.env.JUPITER_BASE ||
  'https://jup.ag';

// ── CACHE ─────────────────────────────────────────────
const CACHE = new Map();

function setCache(key, data, ttl = 15000) {
  CACHE.set(key, {
    data,
    exp: Date.now() + ttl
  });
}

function getCache(key) {
  const item = CACHE.get(key);

  if (!item) return null;

  if (Date.now() > item.exp) {
    CACHE.delete(key);
    return null;
  }

  return item.data;
}

// ── HELPERS ───────────────────────────────────────────
function safeNum(v, d = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function sanitize(str = '') {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, '');
}

function loadJSON(name) {
  try {
    const file = path.join(__dirname, 'data', `${name}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

// ── SAFE FETCH ───────────────────────────────────────
async function proxyFetch(url, timeout = 10000) {
  const cached = getCache(url);
  if (cached) return cached;

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CoinhatDEX/2.0',
        'Accept': 'application/json'
      }
    });

    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const text = await res.text();

    let json;

    try {
      json = JSON.parse(text);
    } catch {
      console.error('Invalid JSON:', url);
      throw new Error('Invalid JSON');
    }

    setCache(url, json);

    return json;

  } catch (err) {
    clearTimeout(timer);

    console.error('[FETCH ERROR]', url);
    console.error(err.message);

    throw err;
  }
}

// ── NORMALIZE TOKEN ──────────────────────────────────
function normalizePair(p) {
  return {
    pairAddress: p?.pairAddress || '',
    name: p?.baseToken?.name || 'Unknown',
    symbol: p?.baseToken?.symbol || '???',
    address: p?.baseToken?.address || '',

    priceUsd: safeNum(p?.priceUsd),
    change24h: safeNum(p?.priceChange?.h24),

    marketCap: safeNum(p?.marketCap),
    volume24h: safeNum(p?.volume?.h24),
    liquidity: safeNum(p?.liquidity?.usd),

    imageUrl: p?.info?.imageUrl || null,

    websites: safeArr(p?.info?.websites)
      .map(w => w?.url)
      .filter(Boolean),

    socials: safeArr(p?.info?.socials)
      .map(s => ({
        type: s?.type || '',
        url: s?.url || ''
      }))
  };
}

// ═══════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════

// ── HEALTH ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    ts: Date.now()
  });
});

// — SWAP COM TAXA DE 1% —
app.post('/api/swap', (req, res) => {
  const { outputMint, amount = 0.1 } = req.body;
  
  if (!outputMint) {
    return res.status(400).json({ error: 'outputMint required' });
  }

  const url = `https://jup.ag/swap/SOL-${outputMint}?amount=${amount}&platformFeeBps=100&feeAccount=9GXNpv77DFnCAa4z4GgYFuAhBvZp3vrsG5JBoS5vZg4k`;
  
  res.json({ url });
});   

// ── COINS ─────────────────────────────────────────────
app.get('/api/coins', async (req, res) => {

  try {

    let coins = [];

    // ── TOP BOOSTS ────────────────────────────────────
    try {

      const boosts = await proxyFetch(
        `${DEX_BASE}/token-boosts/top/v1`
      );

      const solAddrs = safeArr(boosts)
        .filter(t => t?.chainId === 'solana')
        .slice(0, 20)
        .map(t => t?.tokenAddress)
        .filter(Boolean);

      if (solAddrs.length) {

        const data = await proxyFetch(
          `${DEX_BASE}/latest/dex/tokens/${solAddrs.join(',')}`
        );

        const bestPairs = new Map();

        safeArr(data?.pairs)
          .filter(p => p?.chainId === 'solana')
          .forEach(p => {

            const addr = p?.baseToken?.address;
            if (!addr) return;

            const liq = safeNum(p?.liquidity?.usd);

            const cur = bestPairs.get(addr);

            if (
              !cur ||
              liq > safeNum(cur?.liquidity?.usd)
            ) {
              bestPairs.set(addr, p);
            }
          });

        coins = [...bestPairs.values()];
      }

    } catch (e) {
      console.error('Boost route failed');
    }

    // ── FALLBACK SEARCH ──────────────────────────────
    if (coins.length < 8) {

      try {

        const fallback = await proxyFetch(
          `${DEX_BASE}/latest/dex/search?q=solana`
        );

        const existing = new Set(
          coins.map(c => c?.baseToken?.address)
        );

        for (const p of safeArr(fallback?.pairs)) {

          if (p?.chainId !== 'solana') continue;

          const addr = p?.baseToken?.address;

          if (!addr || existing.has(addr)) continue;

          existing.add(addr);

          coins.push(p);

          if (coins.length >= 18) break;
        }

      } catch (e) {
        console.error('Fallback search failed');
      }
    }

    const clean = coins
      .slice(0, 18)
      .map(normalizePair);

    res.json({
      ok: true,
      total: clean.length,
      coins: clean,
      ts: Date.now()
    });

  } catch (e) {

    console.error('/api/coins failed');

    res.status(502).json({
      ok: false,
      error: 'Failed to fetch coins',
      coins: []
    });
  }
});

// ── SEARCH ────────────────────────────────────────────
app.get('/api/search', async (req, res) => {

  const q = String(req.query.q || '').trim();

  if (q.length < 2) {
    return res.json({
      ok: true,
      pairs: []
    });
  }

  try {

    const data = await proxyFetch(
      `${DEX_BASE}/latest/dex/search?q=${encodeURIComponent(q)}`
    );

    const pairs = safeArr(data?.pairs)
      .filter(p => p?.chainId === 'solana')
      .slice(0, 7)
      .map(normalizePair);

    res.json({
      ok: true,
      pairs
    });

  } catch {

    res.status(502).json({
      ok: false,
      error: 'Search failed',
      pairs: []
    });
  }
});

// ── TICKER ────────────────────────────────────────────
app.get('/api/ticker', async (req, res) => {

  try {

    const data = await proxyFetch(
      `${BIN_BASE}/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","SOLUSDT"]`
    );

    const tickers = safeArr(data).map(t => ({
      symbol: String(t?.symbol || '').replace('USDT', ''),
      price: safeNum(t?.lastPrice),
      change: safeNum(t?.priceChangePercent)
    }));

    res.json({
      ok: true,
      tickers
    });

  } catch {

    res.json({
      ok: true,
      tickers: [
        { symbol: 'BTC', price: 67000, change: 1.2 },
        { symbol: 'ETH', price: 3400, change: 0.8 },
        { symbol: 'SOL', price: 168, change: 3.4 }
      ]
    });
  }
});

// ── CHART URL ─────────────────────────────────────────
app.get('/api/chart-url/:pair', (req, res) => {

  const pair = sanitize(req.params.pair);

  res.json({
    url:
      `https://dexscreener.com/solana/${pair}` +
      '?embed=1&theme=light&info=0&trades=0'
  });
});

// ── SWAP URL ──────────────────────────────────────────
app.get('/api/swap-url', (req, res) => {

  const outputMint = sanitize(
    req.query.output || USDC_MINT
  );

  const inputMint = sanitize(
    req.query.input || SOL_MINT
  );

  res.json({
    url:
      `${JUP_BASE}/swap/${inputMint}-${outputMint}` +
      `?referral=${REFERRAL}`,

    feeBps: FEE_BPS
  });
});

// ── CONFIG ────────────────────────────────────────────
app.get('/api/jupiter-config', (req, res) => {

  res.json({
    endpoint: 'https://api.mainnet-beta.solana.com',
    feeBps: FEE_BPS,
    referral: REFERRAL,
    initialInputMint: SOL_MINT,
    initialOutputMint: USDC_MINT
  });
});

// ── STATIC JSON ROUTES ────────────────────────────────
app.get('/api/noticias', (req, res) => {
  res.json({ items: loadJSON('noticias') });
});

app.get('/api/alphas', (req, res) => {
  res.json({ items: loadJSON('alphas') });
});

app.get('/api/airdrops', (req, res) => {

  const items = loadJSON('airdrops').map(i => {

    if (i.slug === 'jupiter') {
      return {
        ...i,
        url: `${JUP_BASE}/?referral=${REFERRAL}`
      };
    }

    return i;
  });

  res.json({ items });
});

app.get('/api/parceiros', (req, res) => {

  const items = loadJSON('parceiros').map(i => {

    if (i.slug === 'jupiter') {
      return {
        ...i,
        url: `${JUP_BASE}/?referral=${REFERRAL}`
      };
    }

    return i;
  });

  res.json({ items });
});

// ── ROOT ──────────────────────────────────────────────
app.get('/', (req, res) => {

  res.json({
    name: 'Coinhat DEX API',
    status: 'online',
    docs: '/api/health'
  });
});

// ── 404 ───────────────────────────────────────────────
app.use((req, res) => {

  res.status(404).json({
    error: 'Not found'
  });
});

// ── GLOBAL ERROR ──────────────────────────────────────
app.use((err, req, res, next) => {

  console.error('[GLOBAL ERROR]');
  console.error(err);

  res.status(500).json({
    error: 'Internal server error'
  });
});

// ── START ─────────────────────────────────────────────
app.listen(PORT, () => {

  console.log('');
  console.log('══════════════════════════════');
  console.log(` Coinhat API running : ${PORT}`);
  console.log('══════════════════════════════');
  console.log('');
});
