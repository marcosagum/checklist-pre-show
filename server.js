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
const SENHA_ADMIN = process.env.SENHA_ADMIN || '';
const COLECOES = new Set(['config', 'checklists', 'montagens']);
const LIMITE_CORPO = 1024 * 1024;
const LIMITE_ARQUIVO = 10 * 1024 * 1024;
const LIMITE_MAPA = 25 * 1024 * 1024; // mapa das barricadas pode vir em PDF grande
// Fotos e plantas ficam no volume, nunca no repositório (que é público)
const PASTAS = { fotos: path.join(DADOS_DIR, 'fotos'), plantas: path.join(DADOS_DIR, 'plantas'), mapas: path.join(DADOS_DIR, 'mapas') };
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

// ---------- dados ----------
fs.mkdirSync(DADOS_DIR, { recursive: true });
Object.values(PASTAS).forEach(d => fs.mkdirSync(d, { recursive: true }));
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

// ---------- senhas ----------
// SENHA = equipe (marca itens e escreve observações). SENHA_ADMIN = administrador (pode tudo).
// Sem SENHA_ADMIN, a SENHA continua dando acesso total, como antes.
const fichaDe = (senha, papel) => crypto.createHmac('sha256', senha).update('checklist-' + papel).digest('hex');
const fichaEquipe = SENHA ? fichaDe(SENHA, 'equipe') : '';
const fichaAdmin = SENHA_ADMIN ? fichaDe(SENHA_ADMIN, 'admin') : '';
const tentativas = new Map();
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function igual(a, b) { return !!b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function papelDe(req) {
  if (!SENHA && !SENHA_ADMIN) return 'admin';
  const c = cookies(req).ck_sessao || '';
  if (igual(c, fichaAdmin)) return 'admin';
  if (igual(c, fichaEquipe)) return SENHA_ADMIN ? 'equipe' : 'admin';
  return null;
}
// A equipe só pode mudar a situação (s) e a observação (obs) de itens que já existem, e as observações gerais
function permitidoEquipe(col, id, metodo, corpo) {
  if (col !== 'checklists' || metodo !== 'PATCH') return false;
  const doc = dados.checklists && dados.checklists[id];
  if (!doc) return false;
  const ids = new Set();
  (doc.secoes || []).forEach(s => (s.grupos || []).forEach(g => (g.itens || []).forEach(i => ids.add(i.id))));
  for (const k of Object.keys(corpo)) {
    if (k === 'obsGeral') { if (typeof corpo.obsGeral !== 'string' || corpo.obsGeral.length > 5000) return false; continue; }
    if (k !== 'estado' || !corpo.estado || typeof corpo.estado !== 'object' || Array.isArray(corpo.estado)) return false;
    for (const [iid, v] of Object.entries(corpo.estado)) {
      if (!ids.has(iid) || !v || typeof v !== 'object' || Array.isArray(v)) return false;
      for (const [f, x] of Object.entries(v)) {
        if (f === 's') { if (!['', 'ok', 'nao', 'na'].includes(x)) return false; }
        else if (f === 'obs') { if (typeof x !== 'string' || x.length > 1000) return false; }
        else return false;
      }
    }
  }
  return true;
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

function lerBinario(req, limite = LIMITE_ARQUIVO) {
  return new Promise((ok, falha) => {
    let tam = 0; const partes = [];
    req.on('data', p => { tam += p.length; if (tam > limite) { falha({ status: 413 }); req.destroy(); } else partes.push(p); });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', () => falha({ status: 400 }));
  });
}
// Confere a assinatura do arquivo, para aceitar só imagem de verdade
function ehImagem(buf, ext) {
  if (ext === 'jpg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (ext === 'png') return buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === 'webp') return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  return false;
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
      const senha = corpo && typeof corpo.senha === 'string' ? corpo.senha : '';
      let ficha = '', papel = '';
      if (SENHA_ADMIN && senha === SENHA_ADMIN) { ficha = fichaAdmin; papel = 'admin'; }
      else if (SENHA && senha === SENHA) { ficha = fichaEquipe; papel = SENHA_ADMIN ? 'equipe' : 'admin'; }
      if (ficha) {
        const seguro = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
        res.setHeader('set-cookie', `ck_sessao=${ficha}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}${seguro}`);
        return json(res, 200, { ok: true, papel });
      }
      tentativas.get(ip).push(Date.now());
      return json(res, 401, { erro: 'Senha errada' });
    }
    if (p === '/api/sair' && req.method === 'POST') {
      res.setHeader('set-cookie', 'ck_sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return json(res, 200, { ok: true });
    }

    const papel = papelDe(req);
    if (p.startsWith('/api/') && !papel) return json(res, 401, { erro: 'Entre com a senha da equipe' });

    if (p === '/api/dados' && req.method === 'GET') return json(res, 200, { ...dados, versao, papel });

    if (p === '/api/eventos') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`data: ${versao}\n\n`);
      ouvintes.add(res);
      req.on('close', () => ouvintes.delete(res));
      return;
    }

    // Ver uma foto ou planta (qualquer senha)
    const ma = p.match(/^\/api\/arquivo\/(fotos|plantas|mapas)\/([a-z0-9-]{1,80}\.(?:jpg|png|webp|pdf))$/);
    if (ma && req.method === 'GET') {
      const ext = ma[2].split('.').pop();
      if (ext === 'pdf' && ma[1] !== 'mapas') return json(res, 404, { erro: 'Arquivo não encontrado' });
      const arq = path.join(PASTAS[ma[1]], ma[2]);
      if (!fs.existsSync(arq)) return json(res, 404, { erro: 'Arquivo não encontrado' });
      res.writeHead(200, { 'content-type': MIME[ext], 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=604800, immutable',
        ...(ext === 'pdf' ? { 'content-disposition': 'inline; filename="mapa-barricadas.pdf"' } : {}) });
      return fs.createReadStream(arq).pipe(res);
    }
    // Enviar foto de montagem (só administrador). O nome é novo a cada envio, então o cache nunca fica velho.
    if (p === '/api/fotos' && req.method === 'POST') {
      if (papel !== 'admin') return json(res, 403, { erro: 'Só o administrador pode enviar fotos' });
      const ext = TIPOS[(req.headers['content-type'] || '').split(';')[0]];
      if (!ext) return json(res, 400, { erro: 'Envie uma imagem JPG, PNG ou WEBP' });
      const buf = await lerBinario(req);
      if (!ehImagem(buf, ext)) return json(res, 400, { erro: 'O arquivo não é uma imagem válida' });
      const nome = crypto.randomBytes(10).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(PASTAS.fotos, nome), buf);
      return json(res, 200, { arquivo: nome });
    }
    // Enviar mapa das barricadas de uma montagem (só administrador): PDF ou imagem
    if (p === '/api/mapas' && req.method === 'POST') {
      if (papel !== 'admin') return json(res, 403, { erro: 'Só o administrador pode enviar o mapa' });
      const tipo = (req.headers['content-type'] || '').split(';')[0];
      const ext = tipo === 'application/pdf' ? 'pdf' : TIPOS[tipo];
      if (!ext) return json(res, 400, { erro: 'Envie um PDF ou uma imagem JPG, PNG ou WEBP' });
      const buf = await lerBinario(req, LIMITE_MAPA);
      const valido = ext === 'pdf' ? buf.slice(0, 5).toString() === '%PDF-' : ehImagem(buf, ext);
      if (!valido) return json(res, 400, { erro: ext === 'pdf' ? 'O arquivo não é um PDF válido' : 'O arquivo não é uma imagem válida' });
      const nome = crypto.randomBytes(10).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(PASTAS.mapas, nome), buf);
      return json(res, 200, { arquivo: nome });
    }
    // Trocar a planta de um nível (só administrador)
    const mp = p.match(/^\/api\/plantas\/([0-3])$/);
    if (mp && req.method === 'PUT') {
      if (papel !== 'admin') return json(res, 403, { erro: 'Só o administrador pode trocar a planta' });
      const ext = TIPOS[(req.headers['content-type'] || '').split(';')[0]];
      if (!ext) return json(res, 400, { erro: 'Envie uma imagem JPG, PNG ou WEBP' });
      const w = Number(url.searchParams.get('w')), h = Number(url.searchParams.get('h'));
      if (!(w > 0 && h > 0)) return json(res, 400, { erro: 'Faltou a largura e a altura da imagem' });
      const buf = await lerBinario(req);
      if (!ehImagem(buf, ext)) return json(res, 400, { erro: 'O arquivo não é uma imagem válida' });
      const nome = `n${mp[1]}-${Date.now().toString(36)}.${ext}`;
      fs.writeFileSync(path.join(PASTAS.plantas, nome), buf);
      dados.config = dados.config || {};
      const plantas = dados.config.plantas = dados.config.plantas || {};
      const antiga = plantas[mp[1]] && plantas[mp[1]].arquivo;
      plantas[mp[1]] = { arquivo: nome, w, h, atualizadoEm: Date.now() };
      salvar(); avisarMudanca();
      if (antiga && antiga !== nome) fs.rm(path.join(PASTAS.plantas, antiga), { force: true }, () => {});
      return json(res, 200, plantas[mp[1]]);
    }

    const m = p.match(/^\/api\/doc\/([a-z]+)\/([A-Za-z0-9_\-.~:@+]{1,200})$/);
    if (m && COLECOES.has(m[1])) {
      const [, col, id] = m;
      // config/modelo = itens do checklist; config/fixos = pórticos fixos de cada nível
      if (col === 'config' && id !== 'modelo' && id !== 'fixos') return json(res, 400, { erro: 'Documento inválido' });
      dados[col] = dados[col] || {};
      if (req.method === 'DELETE') {
        if (papel !== 'admin') return json(res, 403, { erro: 'Só o administrador pode excluir' });
        delete dados[col][id]; salvar(); avisarMudanca(); return json(res, 204);
      }
      const corpo = await lerCorpo(req);
      if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return json(res, 400, { erro: 'Corpo inválido' });
      if (papel !== 'admin' && !permitidoEquipe(col, id, req.method, corpo)) return json(res, 403, { erro: 'Esta senha só permite marcar itens e escrever observações' });
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

servidor.listen(PORTA, () => console.log(`Checklist no ar na porta ${PORTA} · senha da equipe: ${SENHA ? 'sim' : 'NÃO'} · senha de administrador: ${SENHA_ADMIN ? 'sim' : 'NÃO'}`));
