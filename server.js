// Servidor do Checklist Operacional (Farmasi Arena).
// Sem dependências: Node 20 puro. Os dados ficam em um arquivo JSON na pasta DADOS_DIR,
// que no Coolify deve ser um volume persistente.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTA = Number(process.env.PORT || 3000);
const DADOS_DIR = process.env.DADOS_DIR || path.join(__dirname, 'dados');
const ARQ = path.join(DADOS_DIR, 'checklists.json');
const SENHA = process.env.SENHA || '';
const COLECOES = new Set(['config', 'checklists']);
const LIMITE_CORPO = 1024 * 1024;

// ---------- dados ----------
fs.mkdirSync(DADOS_DIR, { recursive: true });
function carregar() {
  if (fs.existsSync(ARQ)) return JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  const inicial = path.join(__dirname, 'inicial.json');
  const d = fs.existsSync(inicial) ? JSON.parse(fs.readFileSync(inicial, 'utf8')) : { config: {}, checklists: {} };
  console.log('Banco novo criado a partir de', fs.existsSync(inicial) ? 'inicial.json' : 'zero');
  return d;
}
let dados = carregar();
let versao = Date.now();
salvar();

function salvar() {
  const tmp = ARQ + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dados));
  fs.renameSync(tmp, ARQ);
  copiaDoDia();
}
// Uma cópia por dia, guardando as últimas 30
function copiaDoDia() {
  const dir = path.join(DADOS_DIR, 'copias');
  fs.mkdirSync(dir, { recursive: true });
  const nome = path.join(dir, `checklists-${new Date().toISOString().slice(0, 10)}.json`);
  if (fs.existsSync(nome)) return;
  fs.copyFileSync(ARQ, nome);
  const velhas = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().slice(0, -30);
  velhas.forEach(f => fs.unlinkSync(path.join(dir, f)));
}
function mesclar(a, b) {
  for (const k of Object.keys(b)) {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) mesclar(a[k], v);
    else a[k] = v;
  }
  return a;
}

// ---------- ao vivo ----------
const ouvintes = new Set();
function avisarMudanca() {
  versao = Date.now();
  for (const res of ouvintes) res.write(`data: ${versao}\n\n`);
}
setInterval(() => { for (const res of ouvintes) res.write(': ping\n\n'); }, 25000);

// ---------- senha da equipe ----------
const ficha = SENHA ? crypto.createHmac('sha256', SENHA).update('checklist-equipe').digest('hex') : '';
const tentativas = new Map();
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function autorizado(req) {
  if (!SENHA) return true;
  const c = cookies(req).ck_sessao || '';
  return c.length === ficha.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(ficha));
}
function ipDe(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress; }
function bloqueado(ip) {
  const agora = Date.now(), t = (tentativas.get(ip) || []).filter(x => agora - x < 10 * 60000);
  tentativas.set(ip, t);
  return t.length >= 10;
}

// ---------- http ----------
function json(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(corpo === undefined ? '' : JSON.stringify(corpo));
}
function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let tam = 0; const partes = [];
    req.on('data', p => { tam += p.length; if (tam > LIMITE_CORPO) { falha({ status: 413 }); req.destroy(); } else partes.push(p); });
    req.on('end', () => { try { ok(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : null); } catch { falha({ status: 400 }); } });
    req.on('error', () => falha({ status: 400 }));
  });
}

const PAGINA = path.join(__dirname, 'public', 'pagina.html');
function servirPagina(res) {
  const corpo = fs.readFileSync(PAGINA, 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<meta name="theme-color" content="#a10f12"><link rel="icon" href="logo_gl.png">'
    + '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
    + '</head><body>' + corpo + '</body></html>');
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') return servirPagina(res);
    if (p === '/logo_gl.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      return fs.createReadStream(path.join(__dirname, 'public', 'logo_gl.png')).pipe(res);
    }
    if (p === '/api/health') return json(res, 200, { ok: true, checklists: Object.keys(dados.checklists || {}).length });

    if (p === '/api/entrar' && req.method === 'POST') {
      const ip = ipDe(req);
      if (bloqueado(ip)) return json(res, 429, { erro: 'Muitas tentativas. Espere 10 minutos.' });
      const corpo = await lerCorpo(req);
      if (!SENHA || (corpo && corpo.senha === SENHA)) {
        const seguro = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
        res.setHeader('set-cookie', `ck_sessao=${ficha}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}${seguro}`);
        return json(res, 200, { ok: true });
      }
      tentativas.get(ip).push(Date.now());
      return json(res, 401, { erro: 'Senha errada' });
    }

    if (p.startsWith('/api/') && !autorizado(req)) return json(res, 401, { erro: 'Entre com a senha da equipe' });

    if (p === '/api/dados' && req.method === 'GET') return json(res, 200, { ...dados, versao });

    if (p === '/api/eventos') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`data: ${versao}\n\n`);
      ouvintes.add(res);
      req.on('close', () => ouvintes.delete(res));
      return;
    }

    const m = p.match(/^\/api\/doc\/([a-z]+)\/([A-Za-z0-9_\-.~:@+]{1,200})$/);
    if (m && COLECOES.has(m[1])) {
      const [, col, id] = m;
      if (col === 'config' && id !== 'modelo') return json(res, 400, { erro: 'Documento inválido' });
      dados[col] = dados[col] || {};
      if (req.method === 'DELETE') { delete dados[col][id]; salvar(); avisarMudanca(); return json(res, 204); }
      const corpo = await lerCorpo(req);
      if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return json(res, 400, { erro: 'Corpo inválido' });
      if (req.method === 'PUT') dados[col][id] = corpo;
      else if (req.method === 'PATCH') {
        if (!dados[col][id]) return json(res, 400, { erro: 'Documento não existe' });
        mesclar(dados[col][id], corpo);
      } else return json(res, 405, { erro: 'Método não aceito' });
      salvar(); avisarMudanca();
      return json(res, 204);
    }
    json(res, 404, { erro: 'Não encontrado' });
  } catch (e) {
    if (e && e.status) return json(res, e.status, { erro: 'Pedido inválido' });
    console.error(e);
    json(res, 500, { erro: 'Erro interno' });
  }
});

servidor.listen(PORTA, () => console.log(`Checklist no ar na porta ${PORTA}${SENHA ? ' (com senha)' : ' (SEM senha: defina SENHA)'}`));
