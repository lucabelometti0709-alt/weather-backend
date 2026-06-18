// Semplice Express server per Render con caching e retry/backoff verso Open-Meteo
// Copia questo file in weather-backend (sostituisci la tua implementazione esistente)

const express = require('express');
const fetch = require('node-fetch'); // node 18+: puoi usare fetch nativo se preferisci
const NodeCache = require('node-cache');

const app = express();

// Config via env
const PORT = process.env.PORT || 3000;
const CACHE_TTL = Number(process.env.BACKEND_CACHE_TTL_SECONDS || 300); // default 5 minuti
const MAX_RETRY = Number(process.env.BACKEND_MAX_RETRY || 5);

// Caching in-memory (sostituire con Redis in produzione se necessario)
const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: Math.max(60, Math.floor(CACHE_TTL / 2)) });

// util: sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// fetch con gestione 429 e backoff esponenziale + jitter, ritorna response object
async function fetchWithRetry(url, options = {}, maxAttempts = MAX_RETRY) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);

      // If upstream tells us to retry, respect Retry-After header when present
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter) {
          // retry-after può essere in secondi o data; qui assumiamo secondi se parsabile
          const waitSecs = Number(retryAfter);
          const waitMs = !Number.isNaN(waitSecs) ? waitSecs * 1000 : 1000;
          await sleep(waitMs);
          continue;
        }
        // Altrimenti backoff esponenziale con jitter
        const base = Math.pow(2, attempt) * 1000;
        const jitter = Math.floor(Math.random() * 500);
        await sleep(base + jitter);
        continue;
      }

      // altri errori non 2xx
      if (!res.ok) {
        // per 5xx possiamo provare ancora, per 4xx no (tranne 429 che gestiamo sopra)
        if (res.status >= 500 && attempt < maxAttempts - 1) {
          const base = Math.pow(2, attempt) * 500;
          const jitter = Math.floor(Math.random() * 300);
          await sleep(base + jitter);
          continue;
        }
        // restituire res così com'è (client gestirà status)
        return res;
      }

      // ok
      return res;
    } catch (err) {
      // errori di rete: ritenta con backoff
      if (attempt < maxAttempts - 1) {
        const base = Math.pow(2, attempt) * 500;
        const jitter = Math.floor(Math.random() * 300);
        await sleep(base + jitter);
        continue;
      }
      throw err;
    }
  }
  // Se arriviamo qui, tutte le retry fallite
  throw new Error('Max retry attempts reached');
}

// Utility per costruire chiave di cache coerente
function buildCacheKey(reqQuery) {
  // consideriamo lat/lon e tutti i parametri di query (ordinati) per una chiave stabile
  const entries = Object.entries(reqQuery).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

// Endpoint: /api/weather?latitude=...&longitude=...&otherparams...
app.get('/api/weather', async (req, res) => {
  const query = req.query;
  if (!query.latitude || !query.longitude) {
    return res.status(400).json({ error: 'Missing latitude or longitude' });
  }

  const cacheKey = buildCacheKey(query);
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  // Costruisci URL Open-Meteo (adatta i parametri come vuoi)
  const params = new URLSearchParams(query);
  const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  try {
    const upstreamRes = await fetchWithRetry(openMeteoUrl, { method: 'GET' });

    if (upstreamRes.status === 429) {
      const retryAfter = upstreamRes.headers.get('retry-after') || '';
      // Propaghiamo 429 al client con Retry-After (se presente)
      return res.status(429).set('Retry-After', retryAfter).json({ error: 'Upstream rate limit (open-meteo) - try again later' });
    }

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      console.error('Upstream error', upstreamRes.status, text);
      return res.status(502).json({ error: 'Upstream error', status: upstreamRes.status, body: text });
    }

    const data = await upstreamRes.json();

    // Salva in cache e ritorna
    cache.set(cacheKey, data);
    return res.json({ ...data, cached: false });
  } catch (err) {
    console.error('Error fetching upstream', err);
    return res.status(500).json({ error: 'Internal server error fetching upstream' });
  }
});

// Health
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`Weather backend listening on port ${PORT} - cache TTL ${CACHE_TTL}s`);
});
