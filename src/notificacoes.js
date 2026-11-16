// Avisos ao farmacêutico: pelo WhatsApp (apagando do lado da farmácia) e/ou pelo Telegram
const store = require('./store');
const wa = require('./whatsapp');
const { log, formatarTelefone, numeroBR } = require('./util');

async function telegram(texto, cfg = store.config().telegram) {
  if (!cfg.token || !cfg.chatId) throw new Error('Telegram não configurado.');
  const r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Converte o negrito do WhatsApp (*texto*) para o do Telegram (HTML)
    body: JSON.stringify({
      chat_id: cfg.chatId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*([^*\n]+)\*/g, '<b>$1</b>'),
    }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram: ${j.description}`);
}

// Procura o chat do farmacêutico: ele precisa ter mandado uma mensagem ao bot do Telegram antes
async function descobrirChatTelegram(token) {
  const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram: ${j.description}`);
  const ultimo = [...j.result].reverse().find((u) => u.message?.chat);
  if (!ultimo) throw new Error('Nenhuma mensagem encontrada. Mande um "oi" para o bot no Telegram e tente de novo.');
  const chat = ultimo.message.chat;
  return { chatId: String(chat.id), nome: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || '' };
}

// Envia por todos os canais configurados. "soTelegram" para quando o WhatsApp caiu.
async function avisar(texto, { soTelegram = false } = {}) {
  const cfg = store.config();
  const erros = [];
  let enviou = false;
  if (!soTelegram && cfg.farmaceutico.numero && wa.conectado()) {
    try { await wa.enviarAoFarmaceutico(texto); enviou = true; } catch (e) { erros.push(e.message); }
  }
  if (cfg.telegram.ativo) {
    try { await telegram(texto); enviou = true; } catch (e) { erros.push(e.message); }
  }
  if (erros.length) log(`Aviso ao farmacêutico com problema: ${erros.join(' | ')}`);
  return { enviou, erros };
}

function quem(a) {
  return `${a.nome || 'Cliente'} — ${formatarTelefone(a.telefone)}`;
}

wa.eventos.on('avaliacao', (a) => {
  const f = store.config().farmaceutico;
  const atendente = store.nomeAtendente(a.atendente);
  if (a.status === 'pendente' && f.notaBaixa) {
    avisar(`⚠️ *Avaliação baixa: nota ${a.nota}*\n${quem(a)}\nAtendente: ${atendente}\n\nVeja no painel em "A resolver".`);
  } else if (a.nota === 10 && f.notaDez) {
    avisar(`🌟 *Nota 10!*\n${quem(a)}\nAtendente: ${atendente}`);
  }
});

wa.eventos.on('comentario', (a) => {
  if (!store.config().farmaceutico.comentarios) return;
  avisar(`💬 *Comentário (nota ${a.nota})*\n${quem(a)}\n\n"${a.comentario}"`);
});

let avisoQueda = null;
wa.eventos.on('estado', (s) => {
  // Só avisa se continuar desconectado por 3 minutos (evita alarme falso em reinícios)
  clearTimeout(avisoQueda);
  if (s.estado === 'desconectado' || s.estado === 'qr') {
    avisoQueda = setTimeout(() => {
      if (wa.status.estado !== 'conectado') {
        avisar('🔴 *O bot de avaliação desconectou do WhatsApp.*\nAbra o painel e escaneie o QR code de novo.', { soTelegram: true });
      }
    }, 3 * 60 * 1000);
  }
});

function textoResumo(titulo, r, extras = '') {
  if (!r.total) return `📊 *${titulo}*\nNenhuma avaliação no período.${extras}`;
  const linhas = [
    `📊 *${titulo}*`,
    `Avaliações: *${r.total}*`,
    `Nota média: *${numeroBR(r.media)}*`,
    `NPS: *${r.nps}* (😀 ${r.promotores} · 😐 ${r.neutros} · 😞 ${r.detratores})`,
  ];
  const at = r.atendentes.filter((a) => a.codigo);
  if (at.length) {
    linhas.push('', '*Por atendente:*');
    for (const a of at) linhas.push(`• ${a.nome}: ${numeroBR(a.media)} (${a.total})`);
  }
  if (r.pendentes) linhas.push('', `⚠️ ${r.pendentes} nota(s) baixa(s) aguardando resolução.`);
  return linhas.join('\n') + extras;
}

module.exports = { avisar, telegram, descobrirChatTelegram, textoResumo };
