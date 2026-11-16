// Senha do painel, sessões e proteção contra tentativas repetidas
const path = require('path');
const crypto = require('crypto');
const { DADOS, DIA, MIN, lerJson, salvarJson, log } = require('./util');

const ARQ = path.join(DADOS, 'acesso.json');
const acesso = lerJson(ARQ, { senha: null, sessoes: {} });
const COOKIE = 'painel_sessao';
const DURACAO = 30 * DIA;

function hash(senha, sal = crypto.randomBytes(16).toString('hex')) {
  return `${sal}:${crypto.scryptSync(senha, sal, 64).toString('hex')}`;
}

function confere(senha, guardado) {
  const [sal, h] = String(guardado || '').split(':');
  if (!sal || !h) return false;
  const teste = crypto.scryptSync(senha, sal, 64);
  return crypto.timingSafeEqual(teste, Buffer.from(h, 'hex'));
}

function salvar() {
  const agora = Date.now();
  for (const [t, s] of Object.entries(acesso.sessoes)) if (s.expira < agora) delete acesso.sessoes[t];
  salvarJson(ARQ, acesso);
}

function senhaValida(senha) {
  return typeof senha === 'string' && senha.length >= 8;
}

// Pedido vindo pela internet (túnel) ou do próprio computador?
function ehRemoto(req) {
  return Boolean(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);
}

function ipDe(req) {
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?';
}

function lerCookie(req) {
  const c = req.headers.cookie || '';
  const m = c.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function sessaoValida(req) {
  const t = lerCookie(req);
  const s = t && acesso.sessoes[t];
  return Boolean(s && s.expira > Date.now());
}

function criarSessao(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  acesso.sessoes[token] = { criada: Date.now(), expira: Date.now() + DURACAO, ip: ipDe(req) };
  salvar();
  const seguro = ehRemoto(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DURACAO / 1000}${seguro}`);
}

function encerrarSessao(req, res) {
  const t = lerCookie(req);
  if (t) delete acesso.sessoes[t];
  salvar();
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

// Bloqueia 15 minutos depois de 5 senhas erradas do mesmo IP
const tentativas = new Map();
function bloqueado(ip) {
  const t = tentativas.get(ip);
  return t && t.qtd >= 5 && Date.now() - t.ultima < 15 * MIN;
}
function registrarErro(ip) {
  const t = tentativas.get(ip) || { qtd: 0, ultima: 0 };
  if (Date.now() - t.ultima > 15 * MIN) t.qtd = 0;
  t.qtd++;
  t.ultima = Date.now();
  tentativas.set(ip, t);
}

function rotas(app) {
  app.get('/api/sessao', (req, res) => {
    res.json({ logado: sessaoValida(req), temSenha: Boolean(acesso.senha), remoto: ehRemoto(req) });
  });

  // A primeira senha só pode ser criada no computador da farmácia
  app.post('/api/criar-senha', (req, res) => {
    if (acesso.senha) return res.status(400).json({ erro: 'A senha já foi criada.' });
    if (ehRemoto(req)) return res.status(403).json({ erro: 'Crie a senha no computador da farmácia.' });
    if (!senhaValida(req.body.senha)) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
    acesso.senha = hash(req.body.senha);
    criarSessao(req, res);
    log('Senha do painel criada.');
    res.json({ ok: true });
  });

  app.post('/api/login', (req, res) => {
    const ip = ipDe(req);
    if (bloqueado(ip)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos.' });
    if (!acesso.senha || !confere(String(req.body.senha || ''), acesso.senha)) {
      registrarErro(ip);
      log(`Senha errada no painel (${ehRemoto(req) ? 'pela internet' : 'no computador'}, IP ${ip})`);
      return res.status(401).json({ erro: 'Senha incorreta.' });
    }
    tentativas.delete(ip);
    criarSessao(req, res);
    log(`Login no painel (${ehRemoto(req) ? 'pela internet' : 'no computador'})`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    encerrarSessao(req, res);
    res.json({ ok: true });
  });

  // Daqui para baixo, tudo exige login
  app.use('/api', (req, res, next) => {
    if (!sessaoValida(req)) return res.status(401).json({ erro: 'Faça login novamente.' });
    next();
  });

  app.post('/api/trocar-senha', (req, res) => {
    if (!confere(String(req.body.atual || ''), acesso.senha)) return res.status(400).json({ erro: 'Senha atual incorreta.' });
    if (!senhaValida(req.body.nova)) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 8 caracteres.' });
    acesso.senha = hash(req.body.nova);
    acesso.sessoes = {}; // desconecta todos os aparelhos
    criarSessao(req, res);
    log('Senha do painel alterada. Outros aparelhos foram desconectados.');
    res.json({ ok: true });
  });

  app.post('/api/sair-de-todos', (req, res) => {
    acesso.sessoes = {};
    criarSessao(req, res);
    res.json({ ok: true });
  });
}

module.exports = { rotas, ehRemoto };
