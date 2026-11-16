// Liga tudo: painel, WhatsApp, agenda e acesso remoto
const { spawn } = require('child_process');
const store = require('./store');
const wa = require('./whatsapp');
const tunnel = require('./tunnel');
const agenda = require('./agenda');
const notif = require('./notificacoes');
const server = require('./server');
const { log } = require('./util');

const cfg = store.config();
const porta = Number(process.env.PORTA) || cfg.porta;
const endereco = `http://localhost:${porta}`;

function abrirNavegador() {
  spawn('cmd', ['/c', 'start', '', endereco], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// O bot já está rodando (invisível)? Pergunta ao próprio painel.
async function jaRodando() {
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/api/sessao`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

function ligarTudo() {
  server.criar().listen({ port: porta, host: '127.0.0.1', exclusive: true }, () => {
    log(`Painel aberto em ${endereco}`);
    if (!process.env.BOT_REINICIO && !process.env.SEM_NAVEGADOR) abrirNavegador();
    agenda.iniciar();
    wa.iniciar();
    if (cfg.acessoRemoto.ativo) tunnel.ligar(porta);
  }).on('error', (e) => {
    log(`Não foi possível abrir o painel na porta ${porta}: ${e.message}`);
    process.exit(e.code === 'EADDRINUSE' ? 0 : 1);
  });
}

jaRodando().then((sim) => {
  if (sim) {
    // Só abre o painel do bot que já está ligado e sai, sem criar um segundo bot
    if (!process.env.SEM_NAVEGADOR) abrirNavegador();
    setTimeout(() => process.exit(0), 1500);
  } else {
    ligarTudo();
  }
});

// Novo endereço do acesso pelo celular: avisa o farmacêutico quando o WhatsApp estiver pronto
tunnel.eventos.on('url', (url) => {
  if (!store.config().farmaceutico.linkRemoto) return;
  const enviar = () => notif.avisar(`🌐 *Painel de avaliações*\nNovo endereço para abrir pelo celular:\n${url}`);
  if (wa.conectado()) return enviar();
  const esperar = (s) => {
    if (s.estado !== 'conectado') return;
    wa.eventos.off('estado', esperar);
    if (tunnel.status.url === url) enviar();
  };
  wa.eventos.on('estado', esperar);
});

async function sair() {
  log('Encerrando...');
  tunnel.desligar();
  await wa.encerrar();
  process.exit(0);
}
process.on('SIGINT', sair);
process.on('SIGTERM', sair);
process.on('unhandledRejection', (e) => log(`Erro não tratado: ${e?.stack || e}`));
