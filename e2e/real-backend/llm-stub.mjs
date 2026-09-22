/**
 * MAP P6.3 — provider LLM stub per l'E2E a backend REALE
 * =====================================================
 * L'unica finzione di questo harness: il **modello**. Il resto è il percorso
 * vero (router Express, `runWorldGeneration`, preset reale, `map.geojson` reale,
 * SQLite reale, `GET /map-assets` reale).
 *
 * Serve un endpoint OpenAI-compatibile (`POST /v1/chat/completions`) perché il
 * `BalanceAgent` interroga il provider per le politie curate del preset: senza
 * risposta il percorso degraderebbe al baseline deterministico (`generateCountryBatch`
 * cattura l'errore), ma un mondo con dati coerenti rende la prova più significativa.
 * Nessuna rete esterna, nessun credito LLM.
 */
import http from 'node:http';

const PORT = Number(process.env.LLM_STUB_PORT || 8791);
const HOST = '127.0.0.1';

/** Stati deterministici per i codici richiesti (codice = `XXX: Nome`). */
function balancePayload(userText) {
  const codes = [...String(userText || '').matchAll(/^([A-Z]{3}):/gm)].map(match => match[1]);
  const countries = {};
  for (const code of codes) {
    countries[code] = {
      population: 20_000_000,
      gdp: 40,
      military: 30,
      ideology: 'repubblica',
      allies: [],
      enemies: [],
      status: 'regional',
    };
  }
  return { countries };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('stub-ok');
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    let body = {};
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      body = {};
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = String(messages.find(m => m?.role === 'system')?.content || '');
    const user = String(messages.find(m => m?.role === 'user')?.content || '');
    // Solo il bilanciamento iniziale ha un contenuto strutturato; per ogni
    // altra meccanica un oggetto vuoto è una risposta valida e innocua.
    const content = system.includes('"countries"') ? JSON.stringify(balancePayload(user)) : '{}';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'stub-completion',
      object: 'chat.completion',
      model: body.model || 'world-story-stub',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`[llm-stub] OpenAI-compatible stub su http://${HOST}:${PORT}/v1`);
});
