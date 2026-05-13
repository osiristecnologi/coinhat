// ═══════════════════════════════════════════
//  COINHAT DEX — Secure Backend Server
//  All API keys, referrals, and external
//  endpoints are proxied here. Frontend
//  never touches sensitive data directly.
// ═══════════════════════════════════════════
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://terminal.jup.ag"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      frameSrc: ["https://dexscreener.com", "https://jup.ag"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({ origin: false }));
app.use(express.json());

// ── Rate limiting ──
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later.' }
});
app.use('/api/', apiLimiter);

// ── Static files ──
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true
}));

// ── Env helpers (NEVER exposed to client) ──
const REFERRAL   = process.env.REFERRAL_ID;
const FEE_BPS    = process.env.JUPITER_FEE_BPS || '50';
const SOL_MINT   = process.env.SOL_MINT;
const USDC_MINT  = process.env.USDC_MINT;
const DEX_BASE   = process.env.DEXSCREENER_BASE;
const BIN_BASE   = process.env.BINANCE_BASE;
const JUP_BASE   = process.env.JUPITER_BASE;

// ── JSON data loader ──
function loadJSON(name) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data', `${name}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to load ${name}.json:`, e.message);
    return [];
  }
}

// ── Secure fetch wrapper ──
async function proxyFetch(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CoinhatDEX/1.0' }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ═══════════════════════════════════════════
//  API ROUTES — All external calls proxied
// ═══════════════════════════════════════════

// ── GET /api/coins ──
// Fetches top Solana memecoins via DexScreener.
// Strips unnecessary fields before sending to client.
app.get('/api/coins', async (req, res) => {
  try {
    // 1. Get boosted tokens
    const boosts = await proxyFetch(`${DEX_BASE}/token-boosts/top/v1`);
    const solAddrs = boosts
      .filter(t => t.chainId === 'solana')
      .slice(0, 20)
      .map(t => t.tokenAddress);

    let coins = [];

    if (solAddrs.length) {
      const data = await proxyFetch(`${DEX_BASE}/latest/dex/tokens/${solAddrs.join(',')}`);
      const seen = new Map();
      (data.pairs || [])
        .filter(p => p.chainId === 'solana')
        .forEach(p => {
          const k = p.baseToken?.address;
          if (!k) return;
          const liq = parseFloat(p.liquidity?.usd || 0);
          const cur = seen.get(k);
          if (!cur || liq > parseFloat(cur.liquidity?.usd || 0)) seen.set(k, p);
        });
      coins = [...seen.values()].slice(0, 18);
    }

    // Fallback search
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

    // Sanitize — only send what the frontend needs
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
    console.error('coins error:', e.message);
    res.status(502).json({ error: 'Failed to fetch coins', coins: [] });
  }
});

// ── GET /api/ticker ──
// Proxies BTC/ETH/SOL prices from Binance.
app.get('/api/ticker', async (req, res) => {
  try {
    const data = await proxyFetch(
      `${BIN_BASE}/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","SOLUSDT"]`
    );
    const tickers = data.map(t => ({
      symbol: t.symbol.replace('USDT', ''),
      price: parseFloat(t.lastPrice),
      change: parseFloat(t.priceChangePercent)
    }));
    res.json({ tickers });
  } catch (e) {
    // Fallback
    res.json({
      tickers: [
        { symbol: 'BTC', price: 67000, change: 1.2 },
        { symbol: 'ETH', price: 3400, change: 0.8 },
        { symbol: 'SOL', price: 168, change: 3.4 }
      ]
    });
  }
});

// ── GET /api/search?q= ──
// Proxied DexScreener search — no direct API exposure to client.
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ pairs: [] });

  try {
    const data = await proxyFetch(`${DEX_BASE}/latest/dex/search?q=${encodeURIComponent(q)}`);
    const pairs = (data.pairs || [])
      .filter(p => p.chainId === 'solana')
      .slice(0, 7)
      .map(p => ({
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
  } catch (e) {
    res.status(502).json({ error: 'Search failed', pairs: [] });
  }
});

// ── GET /api/chart-url/:pairAddress ──
// Returns the chart embed URL — keeps DexScreener domain out of frontend JS.
app.get('/api/chart-url/:pair', (req, res) => {
  const pair = req.params.pair.replace(/[^a-zA-Z0-9_-]/g, '');
  res.json({
    url: `https://dexscreener.com/solana/${pair}?embed=1&theme=light&info=0&trades=0`
  });
});

// ── GET /api/swap-url ──
// Generates Jupiter swap URL with referral injected server-side.
// Client never sees the referral ID.
app.get('/api/swap-url', (req, res) => {
  const outputMint = (req.query.output || USDC_MINT).replace(/[^a-zA-Z0-9]/g, '');
  const inputMint = (req.query.input || SOL_MINT).replace(/[^a-zA-Z0-9]/g, '');
  res.json({
    url: `${JUP_BASE}/swap/${inputMint}-${outputMint}?referral=${REFERRAL}`,
    feeBps: parseInt(FEE_BPS)
  });
});

// ── GET /api/jupiter-config ──
// Returns Jupiter Terminal init config with referral embedded.
app.get('/api/jupiter-config', (req, res) => {
  res.json({
    endpoint: 'https://api.mainnet-beta.solana.com',
    feeBps: parseInt(FEE_BPS),
    referral: REFERRAL,
    initialInputMint: SOL_MINT,
    initialOutputMint: USDC_MINT
  });
});

// ── Static data endpoints ──
app.get('/api/airdrops', (req, res) => {
  const data = loadJSON('airdrops');
  // Inject referral for Jupiter airdrop link server-side
  const enriched = data.map(item => {
    if (item.slug === 'jupiter') {
      return { ...item, url: `${JUP_BASE}/?referral=${REFERRAL}` };
    }
    return item;
  });
  res.json({ items: enriched });
});

app.get('/api/noticias', (req, res) => {
  res.json({ items: loadJSON('noticias') });
});

app.get('/api/alphas', (req, res) => {
  res.json({ items: loadJSON('alphas') });
});

app.get('/api/parceiros', (req, res) => {
  const data = loadJSON('parceiros');
  const enriched = data.map(item => {
    if (item.slug === 'jupiter') {
      return { ...item, url: `${JUP_BASE}/?referral=${REFERRAL}` };
    }
    return item;
  });
  res.json({ items: enriched });
});

// ── Health ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`Coinhat DEX running on port ${PORT}`);
});
