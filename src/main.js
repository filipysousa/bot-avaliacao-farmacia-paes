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

server.criar().listen(porta, '127.0.0.1', () => {
  log(`Painel aberto em ${endereco}`);
  if (!process.env.BOT_REINICIO && !process.env.SEM_NAVEGADOR) {
    spawn('cmd', ['/c', 'start', '', endereco], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`O painel já está aberto em outra janela (porta ${porta}). Feche a outra antes de abrir de novo.`);
    process.exit(0);
  }
  throw e;
});

agenda.iniciar();
wa.iniciar();
if (cfg.acessoRemoto.ativo) tunnel.ligar(porta);

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
