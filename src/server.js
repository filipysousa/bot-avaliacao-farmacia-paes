// Servidor do painel (http://localhost:3210)
const fs = require('fs');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const store = require('./store');
const stats = require('./stats');
const wa = require('./whatsapp');
const tunnel = require('./tunnel');
const agenda = require('./agenda');
const notif = require('./notificacoes');
const auth = require('./auth');
const autostart = require('./autostart');
const atualizador = require('./atualizador');
const { log, registro, preencher, soDigitos, formatarTelefone } = require('./util');

// Arquivos do painel: dentro do .exe ficam embutidos; no desenvolvimento, na pasta "public"
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function arquivoPublico(nome) {
  try {
    const sea = require('node:sea');
    if (sea.isSea()) return Buffer.from(sea.getAsset(nome));
  } catch { /* fora do .exe */ }
  return fs.readFileSync(path.join(__dirname, '..', 'public', nome));
}

function criar() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  for (const nome of ['app.js', 'style.css', 'icone.svg']) {
    app.get(`/${nome}`, (req, res) => {
      res.type(TIPOS[path.extname(nome)]).setHeader('Cache-Control', 'no-cache');
      res.send(arquivoPublico(nome));
    });
  }
  app.get('/', (req, res) => res.type('text/html').setHeader('Cache-Control', 'no-cache').send(arquivoPublico('index.html')));

  auth.rotas(app); // login; daqui para baixo /api exige sessão

  // ------------------------------------------------------------ status geral
  app.get('/api/status', (req, res) => {
    res.json({
      whatsapp: wa.status,
      remoto: { ...tunnel.status, ativo: store.config().acessoRemoto.ativo },
      aguardando: wa.aguardando(),
      pendentes: store.avaliacoes.filter((a) => a.status === 'pendente').length,
      dentroDoHorario: wa.dentroDoHorario(),
      acessoAtualRemoto: auth.ehRemoto(req),
    });
  });

  app.post('/api/whatsapp/reiniciar', async (req, res) => {
    wa.reiniciar();
    res.json({ ok: true });
  });

  app.post('/api/whatsapp/novo-qr', async (req, res) => {
    log('Gerando QR code novo a pedido do painel...');
    wa.novaSessao('Sessão apagada pelo painel');
    res.json({ ok: true });
  });

  app.post('/api/whatsapp/desconectar', async (req, res) => {
    log('Desconectando o WhatsApp a pedido do painel...');
    wa.desconectar();
    res.json({ ok: true });
  });

  app.get('/api/registro', (req, res) => res.json(registro.slice(-200)));

  // ------------------------------------------------------------ computador
  app.get('/api/sistema', async (req, res) => {
    res.json({
      iniciarComWindows: await autostart.ativo(),
      perguntado: Boolean(store.agenda.perguntouIniciarComWindows),
      ehExe: autostart.ehExe,
    });
  });

  app.post('/api/sistema/iniciar-com-windows', async (req, res) => {
    try {
      await autostart.definir(Boolean(req.body.ativo));
      store.agenda.perguntouIniciarComWindows = true;
      store.salvarAgenda();
      res.json({ ok: true, iniciarComWindows: await autostart.ativo() });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  });

  app.post('/api/sistema/desligar', async (req, res) => {
    if (auth.ehRemoto(req)) return res.status(403).json({ erro: 'Por segurança, só dá para desligar o bot no computador da farmácia.' });
    log('Bot desligado pelo painel.');
    res.json({ ok: true });
    setTimeout(async () => {
      tunnel.desligar();
      await wa.encerrar();
      process.exit(0);
    }, 500);
  });

  // ------------------------------------------------------------ atualização
  app.get('/api/atualizacao', (req, res) => res.json(atualizador.status));

  app.post('/api/atualizacao/verificar', async (req, res) => {
    res.json(await atualizador.verificar());
  });

  app.post('/api/atualizacao/instalar', async (req, res) => {
    try {
      await atualizador.instalar();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  });

  // ------------------------------------------------------------ avaliações
  app.get('/api/resumo', (req, res) => res.json(stats.resumo(req.query)));

  app.get('/api/avaliacoes', (req, res) => {
    const lista = stats.filtrar(store.avaliacoes, req.query)
      .slice().reverse()
      .map((a) => ({ ...a, atendenteNome: store.nomeAtendente(a.atendente), telefoneFormatado: formatarTelefone(a.telefone) }));
    res.json(lista.slice(0, 1000));
  });

  app.get('/api/avaliacoes.csv', (req, res) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [['Data', 'Hora', 'Cliente', 'Telefone', 'Nota', 'Comentário', 'Atendente', 'Origem', 'Situação', 'O que foi feito']];
    for (const a of stats.filtrar(store.avaliacoes, req.query)) {
      const d = new Date(a.data);
      linhas.push([
        d.toLocaleDateString('pt-BR'), d.toLocaleTimeString('pt-BR').slice(0, 5), a.nome, formatarTelefone(a.telefone),
        a.nota, a.comentario, store.nomeAtendente(a.atendente), a.origem,
        a.status === 'pendente' ? 'A resolver' : a.status === 'resolvido' ? 'Resolvido' : '', a.resolucao,
      ]);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="avaliacoes-farmacia-paes.csv"`);
    res.send('﻿' + linhas.map((l) => l.map(esc).join(';')).join('\r\n'));
  });

  app.post('/api/avaliacoes/:id/resolver', (req, res) => {
    const a = store.avaliacoes.find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ erro: 'Avaliação não encontrada.' });
    a.status = 'resolvido';
    a.resolucao = String(req.body.resolucao || '').slice(0, 1000);
    a.resolvidoEm = new Date().toISOString();
    store.salvarAvaliacoes();
    res.json(a);
  });

  app.post('/api/avaliacoes/:id/reabrir', (req, res) => {
    const a = store.avaliacoes.find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ erro: 'Avaliação não encontrada.' });
    a.status = 'pendente';
    a.resolvidoEm = null;
    store.salvarAvaliacoes();
    res.json(a);
  });

  // ------------------------------------------------------------ configurações
  app.get('/api/config', (req, res) => {
    const c = structuredClone(store.config());
    if (c.telegram.token) c.telegram.token = `${c.telegram.token.slice(0, 6)}…`; // não expõe o token inteiro
    res.json({
      config: c, padrao: { mensagens: store.PADRAO.mensagens },
      pastaBackup: agenda.pastaBackup(), ultimoBackup: store.agenda.ultimoBackup || null,
    });
  });

  app.get('/api/qr', async (req, res) => {
    res.json({ img: await QRCode.toDataURL(String(req.query.texto || '').slice(0, 500), { margin: 1, width: 240 }) });
  });

  app.put('/api/config', (req, res) => {
    const atual = store.config();
    const novo = req.body && typeof req.body === 'object' ? req.body : {};
    if (novo.telegram && String(novo.telegram.token || '').endsWith('…')) novo.telegram.token = atual.telegram.token;

    // Normaliza os códigos dos atendentes: minúsculas, sem espaço e sem "#"
    if (Array.isArray(novo.atendentes)) {
      const reservados = new Set(['fim', 'semnota']);
      const vistos = new Set();
      novo.atendentes = novo.atendentes
        .map((a) => ({
          nome: String(a.nome || '').trim().slice(0, 40),
          codigo: String(a.codigo || a.nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 15),
        }))
        .filter((a) => a.nome && a.codigo && !reservados.has(a.codigo) && !vistos.has(a.codigo) && vistos.add(a.codigo));
    }
    if (Array.isArray(novo.numerosIgnorados)) {
      novo.numerosIgnorados = novo.numerosIgnorados.map(soDigitos).filter((n) => n.length >= 8);
    }
    delete novo.porta;

    const salvo = store.salvarConfig(novo);
    if (salvo.acessoRemoto.ativo !== atual.acessoRemoto.ativo) {
      if (salvo.acessoRemoto.ativo) tunnel.ligar(salvo.porta);
      else tunnel.desligar();
    }
    log('Configurações salvas pelo painel.');
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ testes e ações
  app.post('/api/teste/mensagem', async (req, res) => {
    const cfg = store.config();
    const modelo = cfg.mensagens[req.body.tipo];
    if (!modelo) return res.status(400).json({ erro: 'Tipo de mensagem inválido.' });
    const texto = preencher(modelo, {
      nome: ', Cliente', farmacia: cfg.nomeFarmacia, cidade: cfg.cidade, nota: 9, link: cfg.google.link || '(link do Google)',
    });
    try {
      await wa.enviarParaNumero(req.body.numero, `🧪 *TESTE*\n\n${texto}`);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  });

  app.post('/api/teste/farmaceutico', async (req, res) => {
    const r = await notif.avisar('🧪 *Teste do bot de avaliação*\nSe você recebeu esta mensagem, os avisos estão funcionando.');
    if (!r.enviou) return res.status(400).json({ erro: r.erros.join(' | ') || 'Nenhum canal configurado (número do farmacêutico ou Telegram).' });
    res.json({ ok: true, erros: r.erros });
  });

  app.post('/api/teste/resumo', async (req, res) => {
    const r = await (req.body.tipo === 'diario' ? agenda.resumoDiario() : agenda.resumoSemanal());
    if (!r.enviou) return res.status(400).json({ erro: r.erros.join(' | ') || 'Nenhum canal configurado.' });
    res.json({ ok: true });
  });

  app.post('/api/telegram/descobrir', async (req, res) => {
    try {
      let token = String(req.body.token || '');
      if (token.endsWith('…')) token = store.config().telegram.token;
      res.json(await notif.descobrirChatTelegram(token));
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  });

  app.post('/api/backup', (req, res) => {
    try {
      res.json({ ok: true, pasta: agenda.fazerBackup() });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  });

  // Erros inesperados
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    log(`Erro no painel: ${err.stack || err.message}`);
    res.status(500).json({ erro: 'Erro interno. Veja o registro.' });
  });

  return app;
}

module.exports = { criar };
