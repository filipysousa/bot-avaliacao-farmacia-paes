// Conexão com o WhatsApp e lógica de pedido de avaliação
//
// Comandos que o atendente digita na conversa do cliente (o bot apaga o comando):
//   #fim            -> encerra e pede a nota agora
//   #fim ana        -> idem, registrando a atendente "ana"
//   #ana            -> só marca que a "ana" está atendendo (vale para o pedido automático)
//   #semnota        -> não pedir avaliação nesta conversa

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const store = require('./store');
const {
  DIR, MIN, HORA, log, preencher, soDigitos, telefoneBR, mesmoNumero,
} = require('./util');

const eventos = new EventEmitter();
const INICIO = Date.now();

const status = {
  estado: 'iniciando', // iniciando | qr | conectado | desconectado
  qr: null,            // imagem (data URL) do QR code
  numero: null,
  nome: null,
  desde: Date.now(),
  ultimoErro: null,
};

function mudarEstado(estado, extra = {}) {
  Object.assign(status, { estado, desde: Date.now() }, extra);
  eventos.emit('estado', status);
}

// ---------------------------------------------------------------- navegador

const NAVEGADORES = [
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
].filter(Boolean);

let client = null;

// A sessão do WhatsApp (perfil do navegador) fica FORA do OneDrive/Google Drive:
// a sincronização trava e corrompe esses arquivos enquanto o navegador usa.
const PASTA_LOCAL = path.join(process.env.LOCALAPPDATA || DIR, 'BotFarmaciaPaes');
const PASTA_SESSAO = path.join(PASTA_LOCAL, 'sessao');
fs.mkdirSync(PASTA_LOCAL, { recursive: true });

function criarCliente() {
  const c = new Client({
    authStrategy: new LocalAuth({ dataPath: PASTA_SESSAO }),
    webVersionCache: { type: 'local', path: path.join(PASTA_LOCAL, 'cache-whatsapp') },
    authTimeoutMs: 120000,
    puppeteer: {
      headless: true,
      executablePath: NAVEGADORES.find((p) => fs.existsSync(p)),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  c.on('qr', async (qr) => {
    if (c !== client) return;
    mudarEstado('qr', { qr: await QRCode.toDataURL(qr, { margin: 1, width: 300 }) });
    log('QR code gerado. Escaneie pelo painel.');
  });
  c.on('loading_screen', (pct, msg) => log(`Carregando WhatsApp: ${pct}% ${msg || ''}`));
  c.on('change_state', (s) => log(`Estado do WhatsApp: ${s}`));
  c.on('authenticated', () => {
    if (c !== client) return;
    log('QR code aceito. Sincronizando as conversas (pode levar alguns minutos na primeira vez)...');
    mudarEstado('sincronizando', { qr: null });
  });
  c.on('auth_failure', (m) => {
    if (c !== client) return;
    log(`Falha na autenticação: ${m}. Vou gerar um QR code novo.`);
    novaSessao(`Falha na autenticação: ${m}`);
  });
  c.on('ready', () => {
    if (c !== client) return;
    mudarEstado('conectado', { qr: null, numero: c.info?.wid?.user || null, nome: c.info?.pushname || null, ultimoErro: null });
    log(`✅ WhatsApp conectado (${status.nome || ''} ${status.numero || ''}).`);
  });
  c.on('disconnected', (motivo) => {
    if (c !== client) return;
    log(`WhatsApp desconectado: ${motivo}`);
    eventos.emit('desconectado', motivo);
    // Se o aparelho foi desconectado pelo celular, a sessão não vale mais: gera QR novo
    if (/LOGOUT|UNPAIRED|CONFLICT|NAVIGATION/i.test(String(motivo))) novaSessao(`Desconectado (${motivo})`);
    else reiniciar(`Desconectado (${motivo})`);
  });
  c.on('message_create', (msg) => tratarMensagem(msg).catch((e) => log(`Erro ao processar mensagem: ${e.stack || e.message}`)));
  return c;
}

// Vigia: se a conexão ficar presa sem QR e sem conectar, recomeça do zero
let vigia = null;
let falhasSeguidas = 0;
function vigiar() {
  clearTimeout(vigia);
  vigia = setTimeout(() => {
    if (status.estado === 'iniciando' || status.estado === 'sincronizando') {
      falhasSeguidas++;
      log(`A conexão não completou (${status.estado}). ${falhasSeguidas >= 2 ? 'Apagando a sessão e gerando um QR code novo.' : 'Tentando de novo.'}`);
      if (falhasSeguidas >= 2) novaSessao('A conexão travou. Escaneie o QR code novo.');
      else reiniciar('A conexão travou');
    }
  }, status.estado === 'sincronizando' ? 4 * MIN : 2 * MIN);
}
eventos.on('estado', (s) => {
  if (s.estado === 'conectado') falhasSeguidas = 0;
  if (s.estado === 'iniciando' || s.estado === 'sincronizando') vigiar();
  else clearTimeout(vigia);
});

let ocupado = false; // evita dois reinícios ao mesmo tempo

async function fecharCliente() {
  const antigo = client;
  client = null;
  if (!antigo) return;
  await Promise.race([antigo.destroy().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
}

async function apagarSessao() {
  // O navegador pode demorar a soltar os arquivos: tenta algumas vezes
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(PASTA_SESSAO, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  log('Não consegui apagar a sessão antiga. Feche o programa, apague a pasta "sessao" e abra de novo.');
}

// Não espera o initialize terminar (ele pode demorar ou travar); o vigia cuida disso
async function iniciar() {
  const c = criarCliente();
  client = c;
  mudarEstado('iniciando', { qr: null });
  log('Iniciando WhatsApp...');
  c.initialize().catch((e) => {
    if (c !== client) return;
    falhasSeguidas++;
    log(`Erro ao iniciar o WhatsApp: ${e.message}`);
    mudarEstado('desconectado', { ultimoErro: e.message });
    // Tenta de novo sozinho; na segunda falha seguida, recomeça com sessão nova
    setTimeout(() => {
      if (c !== client) return;
      if (falhasSeguidas >= 2) novaSessao(`Erro ao iniciar: ${e.message}`);
      else reiniciar(`Erro ao iniciar: ${e.message}`);
    }, 20000);
  });
}

async function reiniciar(motivo) {
  if (ocupado) return;
  ocupado = true;
  try {
    if (motivo) mudarEstado('iniciando', { ultimoErro: motivo, numero: null, nome: null });
    await fecharCliente();
    await new Promise((r) => setTimeout(r, 3000));
    await iniciar();
  } finally {
    ocupado = false;
  }
}

// Apaga a sessão e gera um QR code novo
async function novaSessao(motivo) {
  if (ocupado) return;
  ocupado = true;
  try {
    mudarEstado('iniciando', { ultimoErro: motivo || null, numero: null, nome: null, qr: null });
    await fecharCliente();
    await apagarSessao();
    await iniciar();
  } finally {
    ocupado = false;
  }
}

// Desconecta o número atual (para conectar outro ou o mesmo de novo)
async function desconectar() {
  if (client && status.estado === 'conectado') {
    await Promise.race([client.logout().catch((e) => log(`Erro ao desconectar: ${e.message}`)), new Promise((r) => setTimeout(r, 15000))]);
  }
  await novaSessao('Desconectado pelo painel');
}

const conectado = () => client && status.estado === 'conectado';

// ---------------------------------------------------------------- envio

const enviadosPeloBot = new Map(); // textos recém-enviados, para não confundir com o atendente

function marcarEnvio(texto) {
  enviadosPeloBot.set(String(texto).trim(), Date.now());
}

function foiOBot(texto) {
  const t = String(texto || '').trim();
  const quando = enviadosPeloBot.get(t);
  if (quando && Date.now() - quando < 2 * MIN) {
    enviadosPeloBot.delete(t);
    return true;
  }
  return false;
}

async function idDoNumero(numero) {
  const d = telefoneBR(numero);
  if (!d) return null;
  const r = await client.getNumberId(d);
  return r ? r._serialized : null;
}

async function enviar(chatId, texto) {
  if (!conectado()) return null;
  marcarEnvio(texto);
  try {
    return await client.sendMessage(chatId, texto);
  } catch (e) {
    log(`Erro ao enviar para ${chatId}: ${e.message}`);
    return null;
  }
}

async function enviarParaNumero(numero, texto) {
  if (!conectado()) throw new Error('WhatsApp não está conectado.');
  const id = await idDoNumero(numero);
  if (!id) throw new Error(`O número ${numero} não tem WhatsApp.`);
  const m = await enviar(id, texto);
  if (!m) throw new Error('Não foi possível enviar a mensagem.');
  return { id, mensagem: m };
}

// Envia ao farmacêutico e apaga só aquela mensagem do WhatsApp da farmácia
async function enviarAoFarmaceutico(texto) {
  const cfg = store.config().farmaceutico;
  if (!cfg.numero) throw new Error('Número do farmacêutico não configurado.');
  const { id, mensagem } = await enviarParaNumero(cfg.numero, texto);
  if (!cfg.apagarAposEnviar) return;

  await new Promise((r) => setTimeout(r, 2500)); // espera a entrega ao servidor
  try {
    await mensagem.delete(false); // "apagar para mim": some só do lado da farmácia
    const chat = await client.getChatById(id);
    const restantes = await chat.fetchMessages({ limit: 1 });
    if (!restantes.length) await chat.delete(); // conversa ficou vazia: remove da lista
  } catch (e) {
    log(`Aviso enviado, mas não consegui apagar do WhatsApp da farmácia: ${e.message}`);
  }
}

// ---------------------------------------------------------------- conversas

function conversa(chatId) {
  if (!store.estado[chatId]) store.estado[chatId] = { status: 'livre' };
  return store.estado[chatId];
}

function chatValido(id) {
  return id && (id.endsWith('@c.us') || id.endsWith('@lid'));
}

// O WhatsApp pode identificar o cliente por um "LID" (código de privacidade, ex.: 140840601141383@lid)
// em vez do telefone. Aqui convertemos o LID no telefone real.
async function telefoneDoLid(lid) {
  try {
    const [r] = await client.getContactLidAndPhone([lid]);
    const pn = soDigitos(String(r?.pn || '').split('@')[0]);
    return pn.length >= 10 ? pn : null;
  } catch {
    return null;
  }
}

async function dadosContato(chatId, c) {
  try {
    const contato = await client.getContactById(chatId);
    c.nome = contato.pushname || contato.name || c.nome || '';
    if (!chatId.endsWith('@lid')) c.telefone = contato.number || chatId.split('@')[0];
  } catch { /* segue com o que tiver */ }
  if (chatId.endsWith('@lid') && (!c.telefone || c.telefone === chatId.split('@')[0])) {
    c.telefone = (await telefoneDoLid(chatId)) || chatId.split('@')[0];
  }
  c.telefone = c.telefone || chatId.split('@')[0];
}

// Corrige registros antigos que ficaram com o LID no lugar do telefone
async function corrigirTelefones() {
  let mudou = false;
  for (const a of store.avaliacoes) {
    if (a.chatId?.endsWith('@lid') && a.telefone === a.chatId.split('@')[0]) {
      const tel = await telefoneDoLid(a.chatId);
      if (tel) { a.telefone = tel; mudou = true; }
    }
  }
  if (mudou) {
    store.salvarAvaliacoes();
    log('Telefones de avaliações antigas corrigidos.');
  }
  for (const [chatId, c] of Object.entries(store.estado)) {
    if (chatId.endsWith('@lid') && c.telefone === chatId.split('@')[0]) {
      const tel = await telefoneDoLid(chatId);
      if (tel) c.telefone = tel;
    }
  }
  store.salvarEstado();
}
eventos.on('estado', (s) => {
  if (s.estado === 'conectado') setTimeout(() => corrigirTelefones().catch((e) => log(`Erro ao corrigir telefones: ${e.message}`)), 5000);
});

function ehFarmaceutico(telefone) {
  const n = store.config().farmaceutico.numero;
  return n && mesmoNumero(telefone, n);
}

function ignorado(telefone) {
  return ehFarmaceutico(telefone) || store.config().numerosIgnorados.some((n) => mesmoNumero(telefone, n));
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
function dentroDoHorario(data = new Date()) {
  const h = store.config().horarios;
  if (h.plantao) return true;
  const dia = h.dias[DIAS[data.getDay()]];
  if (!dia || !dia.ativo) return false;
  const agora = `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
  return agora >= dia.inicio && agora < dia.fim;
}

const PALAVRAS = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

// Entende "8", "nota 8", "8/10", "10!", "8️⃣", "🔟", "dez"...
function extrairNota(texto) {
  if (!texto) return null;
  let t = texto.replace(/🔟/g, '10').replace(/[️⃣]/g, '').trim().toLowerCase();
  if (t.length > 40) return null;
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const num = t.match(/\b(10|[0-9])\b/);
  if (num) return Number(num[1]);
  for (const [palavra, valor] of Object.entries(PALAVRAS)) {
    if (new RegExp(`\\b${palavra}\\b`).test(t)) return valor;
  }
  return null;
}

function varsMensagem(c, extra = {}) {
  const cfg = store.config();
  const primeiroNome = (c.nome || '').trim().split(/\s+/)[0];
  return {
    nome: primeiroNome ? `, ${primeiroNome}` : '',
    farmacia: cfg.nomeFarmacia,
    cidade: cfg.cidade,
    link: cfg.google.link,
    ...extra,
  };
}

async function pedirAvaliacao(chatId, origem) {
  const c = conversa(chatId);
  await dadosContato(chatId, c);
  if (ignorado(c.telefone)) return;

  const texto = preencher(store.config().mensagens.pedido, varsMensagem(c));
  if (!(await enviar(chatId, texto))) return;

  Object.assign(c, {
    status: 'aguardandoNota', pedidoEm: Date.now(), ultimoPedido: Date.now(),
    origem, avisouInvalido: false,
  });
  store.salvarEstado();
  log(`Pedido de avaliação enviado para ${c.nome || ''} (${c.telefone}) [${origem}${c.atendente ? `, ${c.atendente}` : ''}]`);
}

async function registrarNota(chatId, c, nota) {
  const cfg = store.config();
  const baixa = nota <= cfg.pedido.notaMaximaComentario;
  const a = store.novaAvaliacao({
    chatId, telefone: c.telefone, nome: c.nome || '', nota,
    origem: c.origem || '', atendente: c.atendente || '',
    status: baixa ? 'pendente' : null, resolucao: '', resolvidoEm: null,
  });
  log(`⭐ Nota ${nota} de ${c.nome || ''} (${c.telefone})`);

  const vars = varsMensagem(c, { nota });
  if (baixa) {
    Object.assign(c, { status: 'aguardandoComentario', avaliacaoId: a.id, pedidoEm: Date.now() });
    await enviar(chatId, preencher(cfg.mensagens.pedirComentario, vars));
  } else {
    c.status = 'livre';
    const google = cfg.google.ativo && cfg.google.link && nota >= cfg.google.notaMinima;
    await enviar(chatId, preencher(google ? cfg.mensagens.agradecimentoGoogle : cfg.mensagens.agradecimento, vars));
  }
  c.atendente = '';
  store.salvarEstado();
  eventos.emit('avaliacao', a);
}

const TIPOS_IGNORADOS = new Set([
  'e2e_notification', 'notification', 'notification_template', 'gp2', 'call_log',
  'protocol', 'revoked', 'ciphertext', 'broadcast_notification',
]);

async function tratarMensagem(msg) {
  if (msg.timestamp * 1000 < INICIO - MIN) return; // histórico antigo
  if (TIPOS_IGNORADOS.has(msg.type)) return;
  if (msg.fromMe) await mensagemDaFarmacia(msg);
  else await mensagemDoCliente(msg);
}

async function mensagemDaFarmacia(msg) {
  const chatId = msg.to;
  if (!chatValido(chatId) || foiOBot(msg.body)) return;
  const texto = (msg.body || '').trim().toLowerCase();
  const c = conversa(chatId);
  const cfg = store.config();

  const m = texto.match(/^#(\S+)(?:\s+(\S+))?$/);
  const ehAtendente = (cod) => cfg.atendentes.some((a) => a.codigo === cod);

  if (m && (m[1] === 'fim' || m[1] === 'semnota' || (ehAtendente(m[1]) && !m[2]))) {
    try { await msg.delete(true); } catch { /* sem problema se não apagar */ }

    if (m[1] === 'semnota') {
      Object.assign(c, { status: 'livre', ultimoPedido: Date.now(), atendente: '' });
      log(`#semnota: não será pedida avaliação para ${chatId}`);
    } else if (m[1] === 'fim') {
      if (m[2]) {
        if (ehAtendente(m[2])) c.atendente = m[2];
        else log(`Código de atendente desconhecido: "${m[2]}" (cadastre no painel)`);
      }
      if (c.status === 'aguardandoNota') log(`#fim ignorado: já estamos aguardando a nota de ${chatId}`);
      else await pedirAvaliacao(chatId, 'manual');
    } else {
      c.atendente = m[1];
      log(`Atendente ${m[1]} marcada na conversa ${chatId}`);
    }
    store.salvarEstado();
    return;
  }

  c.ultimaEquipe = msg.timestamp * 1000;
  store.salvarEstado();
}

async function mensagemDoCliente(msg) {
  const chatId = msg.from;
  if (!chatValido(chatId)) return;
  const c = conversa(chatId);
  const texto = (msg.body || '').trim();

  if (!c.telefone) await dadosContato(chatId, c);
  if (ehFarmaceutico(c.telefone)) return;

  if (c.status === 'aguardandoNota') {
    const nota = extrairNota(texto);
    if (nota !== null) {
      await registrarNota(chatId, c, nota);
      return;
    }
    if (!c.avisouInvalido && msg.type === 'chat' && texto.length <= 40) {
      c.avisouInvalido = true;
      store.salvarEstado();
      await enviar(chatId, store.config().mensagens.notaInvalida);
      return;
    }
    c.status = 'livre'; // o cliente seguiu para outro assunto: nova conversa
  } else if (c.status === 'aguardandoComentario') {
    const comentario = texto || `[${msg.type}]`;
    const a = store.avaliacoes.find((x) => x.id === c.avaliacaoId);
    if (a) {
      a.comentario = comentario;
      store.salvarAvaliacoes();
    }
    c.status = 'livre';
    store.salvarEstado();
    log(`💬 Comentário de ${c.nome || ''} (${c.telefone}): ${comentario}`);
    await enviar(chatId, store.config().mensagens.agradecimentoComentario);
    if (a) eventos.emit('comentario', a);
    return;
  }

  c.ultimaCliente = msg.timestamp * 1000;
  store.salvarEstado();
}

// ---------------------------------------------------------------- pedido automático

async function verificarConversas() {
  if (!conectado()) return;
  const cfg = store.config().pedido;
  const agora = Date.now();
  for (const [chatId, c] of Object.entries(store.estado)) {
    if (c.status === 'aguardandoNota' && agora - c.pedidoEm > 24 * HORA) c.status = 'livre';
    if (c.status === 'aguardandoComentario' && agora - c.pedidoEm > 3 * HORA) c.status = 'livre';
    if (c.status !== 'livre') continue;

    const aberto =
      c.ultimaCliente && c.ultimaEquipe &&
      c.ultimaEquipe > c.ultimaCliente &&
      (!c.ultimoPedido || c.ultimaCliente > c.ultimoPedido);
    if (!aberto) continue;

    const parado = agora - c.ultimaEquipe;
    if (parado < cfg.minutosAutomatico * MIN) continue;
    if (parado > cfg.horasMaximas * HORA) continue;
    if (c.ultimoPedido && agora - c.ultimoPedido < cfg.horasEntrePedidos * HORA) continue;
    if (!dentroDoHorario()) continue;

    await pedirAvaliacao(chatId, 'automático');
  }
  store.salvarEstado();
}

setInterval(() => verificarConversas().catch((e) => log(`Erro na verificação: ${e.message}`)), MIN);

// Conversas aguardando resposta do cliente (para o painel)
function aguardando() {
  return Object.entries(store.estado)
    .filter(([, c]) => c.status === 'aguardandoNota' || c.status === 'aguardandoComentario')
    .map(([chatId, c]) => ({
      chatId, nome: c.nome || '', telefone: c.telefone || '', status: c.status,
      desde: c.pedidoEm, atendente: store.nomeAtendente(c.atendente),
    }))
    .sort((a, b) => b.desde - a.desde);
}

async function encerrar() {
  store.salvarEstadoAgora();
  if (client) await client.destroy().catch(() => {});
}

module.exports = {
  eventos, status, iniciar, reiniciar, novaSessao, desconectar, conectado,
  enviarParaNumero, enviarAoFarmaceutico, aguardando, extrairNota, dentroDoHorario, encerrar,
};
