const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let gameState = null;

// --- Simple survey state & storage ---
const dataDir = path.resolve(__dirname, 'data');
try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
const surveyFile = path.join(dataDir, 'survey-default.json');
let survey = { sessionId: 'default', active: false, currentQuestionIndex: 0, currentQuestionText: '', responses: [], synonyms: {} };
try {
  if (fs.existsSync(surveyFile)) {
    const raw = fs.readFileSync(surveyFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') survey = { ...survey, ...parsed, responses: parsed.responses || [], synonyms: parsed.synonyms || {} };
  }
} catch (e) { console.warn('[survey] failed to load persisted file:', e?.message || e); }
function persistSurvey() {
  try { fs.writeFileSync(surveyFile, JSON.stringify(survey, null, 2), 'utf8'); } catch {}
}

// GET survey state
app.get('/api/survey/state', (req, res) => {
  const qIdx = Number.isFinite(survey.currentQuestionIndex) ? survey.currentQuestionIndex : 0;
  const totalForQ = survey.responses.filter(r => r.questionIndex === qIdx).length;
  res.json({ sessionId: survey.sessionId, active: survey.active, currentQuestionIndex: qIdx, questionText: survey.currentQuestionText || '', totalResponses: totalForQ });
});

// Simple health ping
app.get('/api/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// POST survey state (admin control)
app.post('/api/survey/state', (req, res) => {
  const { active, currentQuestionIndex, questionText } = req.body || {};
  console.log('[survey] set state', { active, currentQuestionIndex, hasText: !!questionText });
  if (typeof active === 'boolean') survey.active = active;
  if (Number.isFinite(currentQuestionIndex)) survey.currentQuestionIndex = Math.max(0, currentQuestionIndex|0);
  if (typeof questionText === 'string') survey.currentQuestionText = questionText;
  persistSurvey();
  res.json({ ok: true, state: { sessionId: survey.sessionId, active: survey.active, currentQuestionIndex: survey.currentQuestionIndex, questionText: survey.currentQuestionText } });
});

// POST survey response
app.post('/api/survey/response', (req, res) => {
  try {
    if (!survey.active) return res.status(400).json({ ok: false, error: 'survey_inactive' });
    const { raw, questionIndex, clientId } = req.body || {};
    const qIdx = Number.isFinite(questionIndex) ? (questionIndex|0) : survey.currentQuestionIndex|0;
    const txt = (raw || '').toString().trim();
    if (!txt) return res.status(400).json({ ok: false, error: 'empty' });
    console.log('[survey] response', { qIdx, len: txt.length, clientId: (clientId||'').toString().slice(0,8) });
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      ts: Date.now(),
      ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString(),
      clientId: (clientId || '').toString(),
      questionIndex: qIdx,
      questionText: survey.currentQuestionText || '',
      sessionId: survey.sessionId,
      raw: txt
    };
    survey.responses.push(entry);
    persistSurvey();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Export responses as JSON
app.get('/api/survey/responses', (_req, res) => {
  try {
    res.json({ sessionId: survey.sessionId, responses: survey.responses || [] });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// Export responses as CSV
app.get('/api/survey/export.csv', (_req, res) => {
  try {
    const rows = survey.responses || [];
    const header = ['ts','sessionId','questionIndex','questionText','clientId','ip','raw'];
    const escape = (v) => {
      const s = (v==null?'' : String(v));
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines = [header.join(',')].concat(rows.map(r => [r.ts, r.sessionId, r.questionIndex, r.questionText, r.clientId, r.ip, r.raw].map(escape).join(',')));
    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="survey-responses.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).send('error');
  }
});

// Synonyms mapping (persisted)
app.get('/api/survey/synonyms', (_req, res) => {
  try { res.json({ synonyms: survey.synonyms || {} }); } catch { res.json({ synonyms: {} }); }
});
app.post('/api/survey/synonyms', (req, res) => {
  try {
    const { synonyms } = req.body || {};
    if (synonyms && typeof synonyms === 'object') {
      survey.synonyms = synonyms;
      persistSurvey();
    }
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
});

// AI config status (no secrets)
app.get('/api/survey/ai-config', (_req, res) => {
  try {
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasAzure = !!process.env.AZURE_OPENAI_API_KEY && !!process.env.AZURE_OPENAI_ENDPOINT && !!process.env.AZURE_OPENAI_DEPLOYMENT;
    const provider = (process.env.AI_PROVIDER || '').toLowerCase() === 'azure' ? (hasAzure ? 'azure' : null) : (hasOpenAI ? 'openai' : (hasAzure ? 'azure' : null));
    const available = !!provider;
    res.json({ available, provider });
  } catch {
    res.json({ available: false, provider: null });
  }
});

// --- AI-assisted clustering (OpenAI or Azure OpenAI) ---
function httpPostJson(urlString, headers, payload) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlString);
      const opts = {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
      };
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(opts, resp => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
          try { resolve({ status: resp.statusCode, body: data, json: JSON.parse(data) }); }
          catch { resolve({ status: resp.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify(payload || {}));
      req.end();
    } catch (e) { reject(e); }
  });
}

function buildAiMessages(questionText, items, synonymsMap) {
  const system = {
    role: 'system',
    content: 'You cluster short survey answers for a Family Feud game. Group semantically similar answers and produce concise canonical labels (1-3 words). Return strict JSON only.'
  };
  const user = {
    role: 'user',
    content: JSON.stringify({
      instructions: 'Cluster the answers into canonical groups. Apply the provided synonyms as equivalent. Return JSON: { clusters: [ { label: string, memberIds: string[], examples?: string[] } ] }. Use at most 20 clusters if there are many small unique answers. Prefer common groups.',
      question: questionText || '',
      synonyms: synonymsMap || {},
      answers: items
    })
  };
  return [system, user];
}

async function callOpenAIChat(messages, options) {
  const provider = (process.env.AI_PROVIDER || '').toLowerCase();
  if (provider === 'azure') {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const key = process.env.AZURE_OPENAI_API_KEY;
    const deploy = process.env.AZURE_OPENAI_DEPLOYMENT;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';
    if (!endpoint || !key || !deploy) throw new Error('azure_openai_not_configured');
    const url = `${endpoint.replace(/\/$/,'')}/openai/deployments/${encodeURIComponent(deploy)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    const headers = { 'api-key': key };
    const body = { messages, temperature: 0.2, response_format: { type: 'json_object' } };
    const resp = await httpPostJson(url, headers, body);
    if ((resp.status||500) >= 400) throw new Error(`azure_openai_error_${resp.status}`);
    const content = resp.json?.choices?.[0]?.message?.content || resp.body || '';
    return content;
  } else {
    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
    const key = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    if (!key) throw new Error('openai_not_configured');
    const url = `${base.replace(/\/$/,'')}/v1/chat/completions`;
    const headers = { 'Authorization': `Bearer ${key}` };
    const body = { model, messages, temperature: 0.2, response_format: { type: 'json_object' } };
    const resp = await httpPostJson(url, headers, body);
    if ((resp.status||500) >= 400) throw new Error(`openai_error_${resp.status}`);
    const content = resp.json?.choices?.[0]?.message?.content || resp.body || '';
    return content;
  }
}

app.post('/api/survey/ai-cluster', async (req, res) => {
  try {
    const { questionIndex } = req.body || {};
    const qIdx = Number.isFinite(questionIndex) ? (questionIndex|0) : (survey.currentQuestionIndex|0);
    const all = (survey.responses || []).filter(r => (r.questionIndex|0) === qIdx);
    if (!all.length) return res.json({ clusters: [] });

    // Build items (limit to avoid huge prompts)
    const LIMIT = Math.min(500, all.length);
    const items = all.slice(0, LIMIT).map(r => ({ id: r.id, text: (r.raw||'').toString().slice(0, 120) }));
    const messages = buildAiMessages(survey.currentQuestionText || '', items, survey.synonyms || {});

    // Ensure configured
    if (!process.env.OPENAI_API_KEY && !process.env.AZURE_OPENAI_API_KEY) {
      console.warn('[ai] Not configured: set OPENAI_API_KEY or AZURE_OPENAI_API_KEY');
      return res.status(501).json({ ok: false, error: 'ai_not_configured' });
    }

    const content = await callOpenAIChat(messages, {}).catch(e => {
      console.error('[ai] call failed:', e?.message || e);
      throw e;
    });
    let parsed;
    try { parsed = JSON.parse(content); }
    catch (e) { parsed = null; console.warn('[ai] Non-JSON response snippet:', String(content).slice(0, 300)); }
    if (!parsed || !Array.isArray(parsed.clusters)) {
      return res.status(502).json({ ok: false, error: 'ai_bad_response', raw: content?.slice?.(0, 500) });
    }

    // Map to clusters with counts/percentages/examples
    const byId = new Map(all.map(r => [r.id, r]));
    const total = Math.max(1, all.length);
    const clusters = (parsed.clusters || []).map(c => {
      const memberIds = Array.isArray(c.memberIds) ? c.memberIds.filter(id => byId.has(id)) : [];
      const examples = (Array.isArray(c.examples) ? c.examples : memberIds.slice(0,4).map(id => byId.get(id)?.raw)).filter(Boolean);
      const count = memberIds.length;
      const percentage = Math.round((count*100)/total);
      return { label: (c.label||'').toString().slice(0, 60), members: memberIds, examples, count, percentage };
    }).sort((a,b)=> b.count - a.count);

    res.json({ ok: true, clusters });
  } catch (e) {
    console.error('[ai] server error:', e?.message || e);
    res.status(500).json({ ok: false, error: 'ai_server_error', message: e?.message || String(e) });
  }
});

wss.on('connection', ws => {
  // Send current state to new client
  if (gameState) ws.send(JSON.stringify({ type: 'sync', data: gameState }));

  ws.on('message', message => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'update') {
        gameState = msg.data;
        // Broadcast to all clients
        wss.clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'sync', data: gameState }));
          }
        });
      } else if (msg.type === 'event') {
        // Broadcast ephemeral events (e.g., audio cues) to all clients
        const payload = { type: 'event', event: msg.event, payload: msg.payload };
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(payload));
          }
        });
      }
    } catch (e) {
      console.error('Invalid message', e);
    }
  });
});

// Try to serve the built Angular app if present
const candidateDirs = [
  path.resolve(__dirname, '..', 'dist', 'familyfeud', 'browser'),
  path.resolve(__dirname, '..', 'dist', 'familyfeud')
];
let staticDir = '';
for (const d of candidateDirs) {
  try {
    if (fs.existsSync(path.join(d, 'index.html'))) { staticDir = d; break; }
  } catch {}
}
if (staticDir) {
  app.use(express.static(staticDir));
  // Fallback to index.html for SPA routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });
  console.log(`[server] Serving static UI from: ${staticDir}`);
} else {
  console.log('[server] No built UI found (dist/familyfeud[/browser]). Only WebSocket API will be available.');
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  const url = staticDir ? `${base}/presentation` : base;
  console.log(`Server running on ${base} (WebSocket + ${staticDir ? 'UI' : 'no UI'})`);
  // Attempt to open a browser window (best-effort)
  tryOpenBrowser(url);
});

function tryOpenBrowser(url) {
  try {
    if (process.env.NO_OPEN_BROWSER === '1') return;
    const platform = process.platform;
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      return;
    }
    if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' });
      return;
    }
    // Linux and others
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  } catch (e) {
    console.warn('[server] Could not auto-open browser:', e?.message || e);
  }
}
