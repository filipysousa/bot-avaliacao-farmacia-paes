// Atualização automática do BotFarmaciaPaes.exe
//
// As versões ficam nas "Releases" do GitHub, com o arquivo BotFarmaciaPaes.exe anexado.
// O bot confere de tempos em tempos (e quando clicam em "Verificar atualização" no painel).
// Para instalar: baixa o .exe novo ao lado do atual, troca os arquivos (o Windows deixa
// renomear um .exe em uso) e reinicia. A pasta "dados" e a sessão do WhatsApp não são tocadas.

const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { log, MIN, HORA } = require('./util');
const { version: VERSAO } = require('../package.json');

const REPO = 'filipysousa/bot-avaliacao-farmacia-paes';
const ARQUIVO = 'BotFarmaciaPaes.exe';
// Código de saída que avisa o app.js para abrir o .exe novo
const CODIGO_ATUALIZAR = 75;

let ehExe = false;
try { ehExe = require('node:sea').isSea(); } catch { /* rodando com node */ }

const EXE = process.execPath;
const NOVO = `${EXE}.novo`;
const ANTIGO = `${EXE}.antigo`;

const status = {
  versao: VERSAO,
  podeInstalar: ehExe, // no modo de teste (node app.js) só verifica
  estado: 'ocioso',    // ocioso | verificando | baixando | instalando
  progresso: 0,        // 0 a 100, durante o download
  ultimaVerificacao: null,
  disponivel: null,    // { versao, notas, desde }
  erro: null,
};

// "1.0.10" > "1.0.9"
function maisNova(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

const CABECALHOS = { 'User-Agent': 'BotFarmaciaPaes-atualizador', Accept: 'application/vnd.github+json' };

let release = null; // última release encontrada (com o link do .exe)

async function verificar() {
  if (status.estado !== 'ocioso') return status;
  status.estado = 'verificando';
  status.erro = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: CABECALHOS, signal: AbortSignal.timeout(30000),
    });
    if (r.status === 404) throw new Error('Nenhuma versão publicada ainda.');
    if (!r.ok) throw new Error(`O servidor de atualizações respondeu ${r.status}.`);
    const dados = await r.json();
    const asset = (dados.assets || []).find((a) => a.name === ARQUIVO);
    status.ultimaVerificacao = Date.now();
    if (asset && maisNova(dados.tag_name, VERSAO)) {
      const versao = dados.tag_name.replace(/^v/, '');
      if (status.disponivel?.versao !== versao) {
        status.disponivel = { versao, notas: String(dados.body || '').slice(0, 2000), desde: Date.now() };
        log(`🔄 Nova versão disponível: ${versao} (instalada: ${VERSAO}).`);
      }
      release = { versao, url: asset.browser_download_url, tamanho: asset.size, digest: asset.digest || null };
    } else {
      status.disponivel = null;
      release = null;
    }
  } catch (e) {
    status.erro = e.name === 'TimeoutError' ? 'Sem resposta do servidor de atualizações.' : e.message;
  } finally {
    status.estado = 'ocioso';
  }
  return status;
}

async function baixar() {
  status.estado = 'baixando';
  status.progresso = 0;
  fs.rmSync(NOVO, { force: true });
  const r = await fetch(release.url, { headers: { 'User-Agent': CABECALHOS['User-Agent'] }, signal: AbortSignal.timeout(30 * MIN) });
  if (!r.ok || !r.body) throw new Error(`Falha ao baixar (${r.status}).`);

  const hash = crypto.createHash('sha256');
  let recebidos = 0;
  const corpo = Readable.fromWeb(r.body);
  corpo.on('data', (parte) => {
    hash.update(parte);
    recebidos += parte.length;
    if (release.tamanho) status.progresso = Math.floor((recebidos / release.tamanho) * 100);
  });
  await pipeline(corpo, fs.createWriteStream(NOVO));

  // Confere se o arquivo chegou inteiro e é exatamente o publicado
  if (release.tamanho && recebidos !== release.tamanho) throw new Error('O download veio incompleto.');
  if (release.digest?.startsWith('sha256:') && release.digest.slice(7) !== hash.digest('hex')) {
    throw new Error('O arquivo baixado não confere com o publicado.');
  }
}

function trocarArquivos() {
  fs.rmSync(ANTIGO, { force: true });
  fs.renameSync(EXE, ANTIGO);
  try {
    fs.renameSync(NOVO, EXE);
  } catch (e) {
    fs.renameSync(ANTIGO, EXE); // desfaz: volta o .exe que estava funcionando
    throw e;
  }
}

let aoReiniciar = null; // main.js informa como encerrar o bot com segurança

async function instalar() {
  if (!ehExe) throw new Error('A atualização automática só funciona no BotFarmaciaPaes.exe.');
  if (status.estado !== 'ocioso') throw new Error('Já existe uma verificação ou atualização em andamento.');
  if (!release) await verificar();
  if (!release) throw new Error(status.erro || 'O bot já está na versão mais recente.');
  const versao = release.versao;
  try {
    log(`Baixando a versão ${versao}...`);
    await baixar();
    status.estado = 'instalando';
    trocarArquivos();
  } catch (e) {
    fs.rmSync(NOVO, { force: true });
    status.estado = 'ocioso';
    status.erro = `Não foi possível atualizar: ${e.message}`;
    log(status.erro);
    throw new Error(status.erro);
  }
  log(`✅ Versão ${versao} instalada. Reiniciando o bot...`);
  setTimeout(async () => {
    try { if (aoReiniciar) await aoReiniciar(); } finally { process.exit(CODIGO_ATUALIZAR); }
  }, 1000);
}

// Instala sozinho fora do horário de atendimento, para não parar o bot no meio do expediente.
// Se ficar mais de 1 dia esperando (ex.: modo plantão), instala assim mesmo.
async function rotina(dentroDoHorario) {
  await verificar();
  if (!ehExe || !status.disponivel) return;
  const esperando = Date.now() - status.disponivel.desde;
  if (dentroDoHorario() && esperando < 24 * HORA) return;
  await instalar().catch(() => {});
}

function iniciar({ encerrar, dentroDoHorario }) {
  aoReiniciar = encerrar;
  // Apaga o .exe antigo da atualização anterior (espera o processo velho terminar de fechar)
  setTimeout(() => {
    for (const f of [ANTIGO, NOVO]) { try { fs.rmSync(f, { force: true }); } catch { /* em uso */ } }
  }, MIN);
  const rodar = () => rotina(dentroDoHorario).catch((e) => log(`Erro ao verificar atualização: ${e.message}`));
  setTimeout(rodar, 2 * MIN);
  setInterval(rodar, HORA);
}

module.exports = { status, verificar, instalar, iniciar, CODIGO_ATUALIZAR, VERSAO };
