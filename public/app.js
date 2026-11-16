// Painel de avaliações — Farmácia Paes
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const br = (n, casas = 1) => (n === null || n === undefined ? '–' : Number(n).toFixed(casas).replace('.', ','));
const DIAS_SEMANA = { dom: 'Domingo', seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado' };

const S = {
  sessao: null, status: null, cfg: null, padrao: null, extra: {},
  periodo: localStorage.getItem('periodo') || '30',
  filtro: { nota: '', atendente: '', busca: '' },
  resolverAba: 'pendente',
  numeroTeste: localStorage.getItem('numeroTeste') || '',
};

// ------------------------------------------------------------------ utilidades

async function api(url, opcoes = {}) {
  const r = await fetch(url, {
    method: opcoes.method || (opcoes.body ? 'POST' : 'GET'),
    headers: opcoes.body ? { 'Content-Type': 'application/json' } : {},
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    credentials: 'same-origin',
  });
  let dados = null;
  try { dados = await r.json(); } catch { /* sem corpo */ }
  if (r.status === 401 && !url.includes('/login') && !url.includes('/trocar-senha')) {
    iniciar();
    throw new Error('Sessão expirada.');
  }
  if (!r.ok) throw new Error((dados && dados.erro) || `Erro ${r.status}`);
  return dados;
}

let toastTimer;
function toast(texto, erro = false) {
  const t = $('#toast');
  t.textContent = texto;
  t.className = `mostrar${erro ? ' erro' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, erro ? 5000 : 2600);
}

async function acao(botao, fn, ok) {
  if (botao) botao.disabled = true;
  try {
    const r = await fn();
    if (ok) toast(ok);
    return r;
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (botao) botao.disabled = false;
  }
}

function hojeISO(d = new Date()) {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
}

function intervalo(p = S.periodo) {
  const hoje = new Date();
  const menos = (dias) => hojeISO(new Date(hoje.getTime() - dias * 86400000));
  switch (p) {
    case 'hoje': return { de: hojeISO(), ate: hojeISO() };
    case '7': return { de: menos(6), ate: hojeISO() };
    case '30': return { de: menos(29), ate: hojeISO() };
    case '90': return { de: menos(89), ate: hojeISO() };
    case 'mes': return { de: hojeISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate: hojeISO() };
    case 'ano': return { de: `${hoje.getFullYear()}-01-01`, ate: hojeISO() };
    default: return {};
  }
}

const PERIODOS = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['90', '90 dias'], ['ano', 'Este ano'], ['tudo', 'Tudo']];
function chipsPeriodo() {
  return `<div class="chips" id="periodos">${PERIODOS.map(([v, n]) => `<button class="chip${S.periodo === v ? ' ativo' : ''}" data-p="${v}">${n}</button>`).join('')}</div>`;
}
function ligarPeriodo(el, aoMudar) {
  $$('#periodos .chip', el).forEach((b) => b.addEventListener('click', () => {
    S.periodo = b.dataset.p;
    localStorage.setItem('periodo', S.periodo);
    aoMudar();
  }));
}

function query(obj) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v !== undefined && v !== null) q.set(k, v);
  return q.toString();
}

function classeNota(n) { return n >= 9 ? 'alta' : n >= 7 ? 'media' : 'baixa'; }
function dataHora(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR').slice(0, 5)}`;
}
function haQuanto(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}
function linkWhats(tel) { return `https://wa.me/${String(tel || '').replace(/\D/g, '')}`; }

// Lê/grava campos da configuração: <input data-c="pedido.minutosAutomatico">
function pegar(obj, caminho) { return caminho.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }
function por(obj, caminho, valor) {
  const ks = caminho.split('.');
  const ult = ks.pop();
  ks.reduce((o, k) => (o[k] ??= {}), obj)[ult] = valor;
}
function preencherCampos(el) {
  $$('[data-c]', el).forEach((i) => {
    const v = pegar(S.cfg, i.dataset.c);
    if (i.type === 'checkbox') i.checked = Boolean(v);
    else i.value = v ?? '';
  });
}
function coletarCampos(el) {
  $$('[data-c]', el).forEach((i) => {
    let v;
    if (i.type === 'checkbox') v = i.checked;
    else if (i.type === 'number' || i.dataset.numero !== undefined) v = Number(i.value);
    else v = i.value;
    por(S.cfg, i.dataset.c, v);
  });
}
async function carregarConfig() {
  const r = await api('/api/config');
  S.cfg = r.config;
  S.padrao = r.padrao;
  S.extra = r;
}
async function salvarConfig(botao, el) {
  if (el) coletarCampos(el);
  await acao(botao, () => api('/api/config', { method: 'PUT', body: S.cfg }), 'Salvo ✓');
  await carregarConfig();
}

function interruptor(caminho, titulo, desc = '') {
  return `<label class="interruptor"><input type="checkbox" data-c="${caminho}"><div><b>${titulo}</b>${desc ? `<small>${desc}</small>` : ''}</div></label>`;
}

// Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) para a prévia
function formatarWhats(t) {
  return esc(t)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

// ------------------------------------------------------------------ login

function telaLogin() {
  const s = S.sessao;
  const criar = !s.temSenha;
  let corpo;
  if (criar && s.remoto) {
    corpo = '<p>A senha do painel ainda não foi criada. Crie a senha no <b>computador da farmácia</b> e depois entre por aqui.</p>';
  } else {
    corpo = `
      <p>${criar ? 'Primeiro acesso: crie uma senha para proteger o painel.' : 'Digite a senha para entrar.'}</p>
      <form id="form-login">
        <label class="campo"><span>${criar ? 'Nova senha' : 'Senha'}</span>
          <input type="password" id="senha" autocomplete="${criar ? 'new-password' : 'current-password'}" required minlength="${criar ? 8 : 1}" autofocus></label>
        ${criar ? `<label class="campo"><span>Repita a senha</span><input type="password" id="senha2" autocomplete="new-password" required minlength="8">
          <small>Mínimo de 8 caracteres. Use uma senha forte, pois o painel pode ser aberto pelo celular.</small></label>` : ''}
        <p class="erro" id="erro"></p>
        <button class="btn primario" type="submit">${criar ? 'Criar senha e entrar' : 'Entrar'}</button>
      </form>`;
  }
  $('#app').innerHTML = `
    <div class="login"><div class="cartao">
      <img src="/icone.svg" alt="">
      <h1>Avaliações · Farmácia Paes</h1>
      ${corpo}
    </div></div>`;

  const f = $('#form-login');
  if (!f) return;
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const senha = $('#senha').value;
    if (criar && senha !== $('#senha2').value) { $('#erro').textContent = 'As senhas não são iguais.'; return; }
    const botao = $('button', f);
    botao.disabled = true;
    try {
      await api(criar ? '/api/criar-senha' : '/api/login', { body: { senha } });
      iniciar();
    } catch (e) {
      $('#erro').textContent = e.message;
      botao.disabled = false;
    }
  });
}

// ------------------------------------------------------------------ estrutura

const PAGINAS = {
  painel: { ic: '📊', nome: 'Painel', render: paginaPainel },
  avaliacoes: { ic: '⭐', nome: 'Avaliações', render: paginaAvaliacoes },
  resolver: { ic: '⚠️', nome: 'A resolver', render: paginaResolver },
  conexao: { ic: '📱', nome: 'Conexão', render: paginaConexao },
  mensagens: { ic: '💬', nome: 'Mensagens', render: paginaMensagens },
  atendentes: { ic: '👥', nome: 'Atendentes', render: paginaAtendentes },
  farmaceutico: { ic: '🔔', nome: 'Avisos ao farmacêutico', render: paginaFarmaceutico },
  configuracoes: { ic: '⚙️', nome: 'Configurações', render: paginaConfiguracoes },
  mais: { ic: '☰', nome: 'Mais', render: paginaMais, oculto: true },
};
const NAV_MOBILE = ['painel', 'avaliacoes', 'resolver', 'conexao', 'mais'];

function rotaAtual() {
  const r = location.hash.slice(1);
  return PAGINAS[r] ? r : 'painel';
}

function montarEstrutura() {
  $('#app').innerHTML = `
    <div class="barra-mobile"><img src="/icone.svg" alt=""><b>Farmácia Paes</b><span class="ponto" id="ponto-mobile"></span></div>
    <div class="layout">
      <nav class="menu">
        <div class="marca"><img src="/icone.svg" alt=""><div><b>Farmácia Paes</b><span>Avaliações do atendimento</span></div></div>
        ${Object.entries(PAGINAS).filter(([, p]) => !p.oculto).map(([k, p]) => `<a href="#${k}" data-r="${k}"><span class="ic">${p.ic}</span>${p.nome}${k === 'resolver' ? '<span class="contador" hidden></span>' : ''}</a>`).join('')}
        <div class="rodape"><a href="#" id="sair"><span class="ic">🚪</span>Sair</a></div>
      </nav>
      <main class="conteudo" id="pagina"></main>
    </div>
    <nav class="nav-mobile">
      ${NAV_MOBILE.map((k) => `<a href="#${k}" data-r="${k}"><span class="ic">${PAGINAS[k].ic}</span>${k === 'mais' ? 'Mais' : PAGINAS[k].nome}${k === 'resolver' ? '<span class="contador" hidden></span>' : ''}</a>`).join('')}
    </nav>`;
  $('#sair').addEventListener('click', sair);
}

async function sair(ev) {
  ev?.preventDefault();
  await api('/api/logout', { body: {} }).catch(() => {});
  iniciar();
}

let paginaVersao = 0;
async function mostrarPagina() {
  const r = rotaAtual();
  $$('[data-r]').forEach((a) => a.classList.toggle('ativo', a.dataset.r === r || (r !== 'painel' && !NAV_MOBILE.includes(r) && a.dataset.r === 'mais' && a.closest('.nav-mobile'))));
  const el = $('#pagina');
  const versao = ++paginaVersao;
  el.innerHTML = '<div class="carregando">Carregando…</div>';
  window.scrollTo(0, 0);
  try {
    await PAGINAS[r].render(el, () => versao === paginaVersao);
  } catch (e) {
    if (versao === paginaVersao) el.innerHTML = `<div class="aviso vermelho">Erro ao carregar: ${esc(e.message)}</div>`;
  }
}

function atualizarIndicadores() {
  const s = S.status;
  if (!s) return;
  $$('.contador').forEach((c) => { c.hidden = !s.pendentes; c.textContent = s.pendentes; });
  const p = $('#ponto-mobile');
  if (p) p.className = `ponto ${s.whatsapp.estado === 'conectado' ? 'verde' : ['iniciando', 'sincronizando'].includes(s.whatsapp.estado) ? 'amarelo' : 'vermelho'}`;
  document.title = `${s.pendentes ? `(${s.pendentes}) ` : ''}Avaliações · Farmácia Paes`;
}

let timerStatus;
async function atualizarStatus() {
  clearTimeout(timerStatus);
  try {
    S.status = await api('/api/status');
    atualizarIndicadores();
    window.dispatchEvent(new Event('status'));
  } catch { /* tenta de novo */ }
  timerStatus = setTimeout(atualizarStatus, document.hidden ? 15000 : 4000);
}

async function iniciar() {
  clearTimeout(timerStatus);
  window.onhashchange = null;
  try {
    S.sessao = await (await fetch('/api/sessao')).json();
  } catch {
    $('#app').innerHTML = '<div class="login"><div class="cartao"><h1>Sem conexão</h1><p>Não foi possível falar com o bot. Ele está ligado?</p></div></div>';
    return;
  }
  if (!S.sessao.logado) return telaLogin();
  montarEstrutura();
  window.onhashchange = mostrarPagina;
  await atualizarStatus();
  mostrarPagina();
}

function avisoConexao() {
  const s = S.status?.whatsapp;
  if (!s || s.estado === 'conectado') return '';
  const carregando = s.estado === 'iniciando' || s.estado === 'sincronizando';
  const txt = s.estado === 'qr' ? 'O WhatsApp não está conectado. Escaneie o QR code para o bot voltar a funcionar.'
    : s.estado === 'sincronizando' ? 'QR code aceito. Sincronizando as conversas…'
      : s.estado === 'iniciando' ? 'Conectando ao WhatsApp…' : 'O WhatsApp está desconectado.';
  return `<div class="aviso ${carregando ? 'amarelo' : 'vermelho'}"><span class="texto">${txt}</span><a class="btn pequeno" href="#conexao">${carregando ? 'Ver' : 'Conectar'}</a></div>`;
}

// ------------------------------------------------------------------ gráficos

function graficoSerie(serie) {
  const pts = serie.pontos;
  if (!pts.length) return '<div class="vazio">Sem dados no período.</div>';
  const W = 640, H = 230, L = 30, R = 34, T = 12, B = 28;
  const w = W - L - R, h = H - T - B;
  const maxQtd = Math.max(1, ...pts.map((p) => p.total));
  const passo = w / pts.length;
  const x = (i) => L + passo * i + passo / 2;
  const yMedia = (m) => T + h - (m / 10) * h;
  const yQtd = (q) => T + h - (q / maxQtd) * h;
  const rotulo = (p) => {
    if (serie.tipo === 'mes') { const [a, m] = p.periodo.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][m - 1]}/${a.slice(2)}`; }
    const [, m, d] = p.periodo.split('-'); return `${d}/${m}`;
  };
  const cada = Math.ceil(pts.length / 7);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução da nota média">`;
  for (const v of [0, 5, 10]) {
    svg += `<line class="eixo" x1="${L}" x2="${W - R}" y1="${yMedia(v)}" y2="${yMedia(v)}" stroke-dasharray="${v ? '3 4' : ''}"/>`;
    svg += `<text x="${L - 6}" y="${yMedia(v) + 4}" text-anchor="end">${v}</text>`;
  }
  svg += `<text x="${W - R + 6}" y="${T + 4}">${maxQtd}</text><text x="${W - R + 6}" y="${T + h + 4}">0</text>`;
  const bw = Math.max(2, Math.min(28, passo * 0.6));
  pts.forEach((p, i) => {
    if (p.total) svg += `<rect class="barra-qtd" x="${x(i) - bw / 2}" y="${yQtd(p.total)}" width="${bw}" height="${T + h - yQtd(p.total)}" rx="3"><title>${rotulo(p)}: ${p.total} avaliação(ões)</title></rect>`;
    if (i % cada === 0) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${rotulo(p)}</text>`;
  });
  // linha da média (liga só períodos com avaliações)
  const comMedia = pts.map((p, i) => [p, i]).filter(([p]) => p.media !== null);
  if (comMedia.length > 1) svg += `<polyline class="linha-media" points="${comMedia.map(([p, i]) => `${x(i)},${yMedia(p.media)}`).join(' ')}"/>`;
  for (const [p, i] of comMedia) {
    svg += `<circle class="ponto-media" cx="${x(i)}" cy="${yMedia(p.media)}" r="${pts.length > 40 ? 2.5 : 4}"><title>${rotulo(p)}: média ${br(p.media)} (${p.total})</title></circle>`;
  }
  svg += '</svg>';
  return `<div class="grafico">${svg}</div>
    <div class="legenda"><span><i style="background:var(--verde)"></i>Nota média (0–10)</span><span><i style="background:var(--verde-claro)"></i>Quantidade de avaliações</span></div>`;
}

function distribuicao(d) {
  const max = Math.max(1, ...d);
  const cor = (n) => (n >= 9 ? 'var(--verde)' : n >= 7 ? 'var(--amarelo)' : 'var(--vermelho)');
  let html = '<div class="dist">';
  for (let n = 10; n >= 0; n--) {
    html += `<div class="l"><b>${n}</b><div class="trilho"><div class="enchimento" style="width:${(d[n] / max) * 100}%;background:${cor(n)}"></div></div><span>${d[n]}</span></div>`;
  }
  return `${html}</div>`;
}

// ------------------------------------------------------------------ páginas

async function paginaPainel(el, valido) {
  const [r, sis] = await Promise.all([api(`/api/resumo?${query(intervalo())}`), api('/api/sistema')]);
  if (!valido()) return;
  const s = S.status;
  const perguntaWindows = sis.ehExe && !sis.perguntado && !S.status.acessoAtualRemoto ? `
    <div class="aviso verde" id="pergunta-windows"><span class="texto">🖥️ <b>Ligar o bot automaticamente quando o computador ligar?</b><br>
      <small>Assim ninguém precisa lembrar de abrir o programa. Ele roda escondido, sem janela.</small></span>
      <button class="btn pequeno primario" data-windows="1">Sim, ligar com o Windows</button>
      <button class="btn pequeno" data-windows="0">Agora não</button></div>` : '';
  el.innerHTML = `
    <div class="topo"><div><h1>Painel</h1><p>Como os clientes avaliam o atendimento no WhatsApp</p></div></div>
    <div style="margin-bottom:16px">${chipsPeriodo()}</div>
    ${perguntaWindows}
    ${avisoConexao()}
    ${r.pendentes ?`<div class="aviso vermelho"><span class="texto">⚠️ <b>${r.pendentes}</b> nota(s) baixa(s) aguardando resolução.</span><a class="btn pequeno" href="#resolver">Ver</a></div>` : ''}
    <div class="grade grade-kpi">
      <div class="cartao kpi"><div class="rotulo">Nota média</div><div class="valor">${br(r.media)}</div><div class="detalhe">de 0 a 10</div></div>
      <div class="cartao kpi"><div class="rotulo">NPS</div><div class="valor">${r.nps ?? '–'}</div><div class="detalhe">😀 ${r.promotores} · 😐 ${r.neutros} · 😞 ${r.detratores}</div></div>
      <div class="cartao kpi"><div class="rotulo">Avaliações</div><div class="valor">${r.total}</div><div class="detalhe">no período</div></div>
      <div class="cartao kpi ${r.pendentes ? 'alerta' : ''}"><div class="rotulo">A resolver</div><div class="valor">${r.pendentes}</div><div class="detalhe">notas baixas</div></div>
    </div>
    <div class="grade grade-2">
      <div class="cartao"><h2>Evolução</h2><p class="sub">Nota média e quantidade por ${r.serie.tipo === 'dia' ? 'dia' : r.serie.tipo === 'semana' ? 'semana' : 'mês'}</p>${graficoSerie(r.serie)}</div>
      <div class="cartao"><h2>Distribuição das notas</h2><p class="sub">Verde: promotores (9–10) · Amarelo: neutros (7–8) · Vermelho: detratores (0–6)</p>${distribuicao(r.distribuicao)}</div>
    </div>
    <div class="grade grade-2" style="margin-top:16px">
      <div class="cartao"><h2>Por atendente</h2><p class="sub">Use <span class="comando">#fim ana</span> para registrar quem atendeu</p>
        ${r.atendentes.length ? `<table class="tabela"><thead><tr><th>Atendente</th><th class="num">Avaliações</th><th class="num">Média</th><th class="num">NPS</th></tr></thead><tbody>
          ${r.atendentes.map((a) => `<tr><td>${esc(a.nome)}</td><td class="num">${a.total}</td><td class="num"><b>${br(a.media)}</b></td><td class="num">${a.nps}</td></tr>`).join('')}
        </tbody></table>` : '<div class="vazio">Sem avaliações no período.</div>'}
      </div>
      <div class="cartao"><h2>Aguardando resposta do cliente</h2><p class="sub">Pedidos de nota enviados que ainda não foram respondidos</p><div id="aguardando"></div></div>
    </div>`;
  ligarPeriodo(el, mostrarPagina);
  $$('[data-windows]', el).forEach((b) => b.addEventListener('click', async () => {
    const ligar = b.dataset.windows === '1';
    await acao(b, () => api('/api/sistema/iniciar-com-windows', { body: { ativo: ligar } }),
      ligar ? 'Pronto! O bot vai ligar sozinho com o Windows ✓' : 'Ok. Dá para ativar depois em Configurações.');
    $('#pergunta-windows', el)?.remove();
  }));
  const desenharAguardando = () => {
    const box = $('#aguardando', el);
    if (!box) return;
    const lista = S.status?.aguardando || [];
    box.innerHTML = lista.length ? `<div class="lista">${lista.slice(0, 12).map((c) => `
      <div class="item"><div class="meio"><b>${esc(c.nome || c.telefone)}</b><div class="meta">${c.status === 'aguardandoNota' ? 'Aguardando nota' : 'Aguardando comentário'} · ${haQuanto(c.desde)}${c.atendente !== 'Não identificado' ? ` · ${esc(c.atendente)}` : ''}</div></div></div>`).join('')}</div>`
      : '<div class="vazio">Nenhum pedido pendente.</div>';
  };
  desenharAguardando();
  const aoStatus = () => (valido() ? desenharAguardando() : window.removeEventListener('status', aoStatus));
  window.addEventListener('status', aoStatus);
  void s;
}

function itemAvaliacao(a, { resolver = false } = {}) {
  const sit = a.status === 'pendente' ? '<span class="etiqueta vermelho">A resolver</span>' : a.status === 'resolvido' ? '<span class="etiqueta verde">Resolvido</span>' : '';
  return `
    <div class="item" data-id="${a.id}">
      <div class="nota ${classeNota(a.nota)}">${a.nota}</div>
      <div class="meio">
        <b>${esc(a.nome || 'Cliente')} ${sit}</b>
        <div class="meta">${dataHora(a.data)} · ${esc(a.telefoneFormatado)} · ${esc(a.atendenteNome)}${a.origem ? ` · ${esc(a.origem)}` : ''}</div>
        ${a.comentario ? `<div class="comentario">💬 ${esc(a.comentario)}</div>` : ''}
        ${a.status === 'resolvido' && a.resolucao ? `<div class="comentario">✅ <b>O que foi feito:</b> ${esc(a.resolucao)}<br><small class="ajuda">${dataHora(a.resolvidoEm)}</small></div>` : ''}
        ${resolver ? (a.status === 'pendente' ? `
          <div style="margin-top:10px">
            <textarea placeholder="O que foi feito? (ex.: liguei para o cliente e pedi desculpas)" style="min-height:70px"></textarea>
            <div class="acoes" style="margin-top:8px">
              <a class="btn pequeno" href="${linkWhats(a.telefone)}" target="_blank" rel="noopener">💬 Abrir conversa</a>
              <button class="btn pequeno primario" data-acao="resolver">✓ Marcar como resolvido</button>
            </div>
          </div>` : `<div class="acoes" style="margin-top:8px"><button class="btn pequeno" data-acao="reabrir">Reabrir</button></div>`) : ''}
      </div>
    </div>`;
}

async function paginaAvaliacoes(el, valido) {
  if (!S.cfg) await carregarConfig();
  const f = S.filtro;
  const filtros = { ...intervalo(), ...f };
  const lista = await api(`/api/avaliacoes?${query(filtros)}`);
  if (!valido()) return;
  el.innerHTML = `
    <div class="topo"><div><h1>Avaliações</h1><p>${lista.length} avaliação(ões) encontradas</p></div>
      <a class="btn" href="/api/avaliacoes.csv?${query(filtros)}">⬇️ Exportar para Excel</a></div>
    <div class="cartao">
      <div style="margin-bottom:12px">${chipsPeriodo()}</div>
      <div class="linha">
        <label class="campo" style="margin:0"><span>Notas</span><select id="f-nota">
          <option value="">Todas</option><option value="altas">9 e 10 (promotores)</option><option value="neutras">7 e 8 (neutros)</option><option value="baixas">Baixas (detratores)</option></select></label>
        <label class="campo" style="margin:0"><span>Atendente</span><select id="f-atendente">
          <option value="">Todos</option>${S.cfg.atendentes.map((a) => `<option value="${esc(a.codigo)}">${esc(a.nome)}</option>`).join('')}<option value="-">Não identificado</option></select></label>
        <label class="campo" style="margin:0"><span>Buscar</span><input type="text" id="f-busca" placeholder="Nome, telefone ou comentário"></label>
      </div>
    </div>
    <div class="cartao"><div class="lista">${lista.length ? lista.map((a) => itemAvaliacao(a)).join('') : '<div class="vazio">Nenhuma avaliação encontrada.</div>'}</div></div>`;
  ligarPeriodo(el, mostrarPagina);
  $('#f-nota', el).value = f.nota;
  $('#f-atendente', el).value = f.atendente;
  $('#f-busca', el).value = f.busca;
  $('#f-nota', el).onchange = (e) => { f.nota = e.target.value; mostrarPagina(); };
  $('#f-atendente', el).onchange = (e) => { f.atendente = e.target.value; mostrarPagina(); };
  let t;
  $('#f-busca', el).oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      f.busca = e.target.value;
      await mostrarPagina();
      const b = $('#f-busca');
      if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
    }, 450);
  };
}

async function paginaResolver(el, valido) {
  const lista = await api(`/api/avaliacoes?${query({ status: S.resolverAba })}`);
  if (!valido()) return;
  el.innerHTML = `
    <div class="topo"><div><h1>A resolver</h1><p>Notas baixas: fale com o cliente e registre o que foi feito</p></div></div>
    <div class="chips" style="margin-bottom:16px">
      <button class="chip${S.resolverAba === 'pendente' ? ' ativo' : ''}" data-aba="pendente">Pendentes</button>
      <button class="chip${S.resolverAba === 'resolvido' ? ' ativo' : ''}" data-aba="resolvido">Resolvidas</button>
    </div>
    <div class="cartao"><div class="lista">${lista.length ? lista.map((a) => itemAvaliacao(a, { resolver: true })).join('')
      : `<div class="vazio">${S.resolverAba === 'pendente' ? '🎉 Nenhuma nota baixa pendente.' : 'Nenhuma resolvida ainda.'}</div>`}</div></div>`;
  $$('[data-aba]', el).forEach((b) => b.addEventListener('click', () => { S.resolverAba = b.dataset.aba; mostrarPagina(); }));
  $$('[data-acao]', el).forEach((b) => b.addEventListener('click', async () => {
    const item = b.closest('.item');
    const id = item.dataset.id;
    if (b.dataset.acao === 'resolver') {
      const resolucao = $('textarea', item).value.trim();
      await acao(b, () => api(`/api/avaliacoes/${id}/resolver`, { body: { resolucao } }), 'Marcado como resolvido ✓');
    } else {
      await acao(b, () => api(`/api/avaliacoes/${id}/reabrir`, { body: {} }), 'Reaberto');
    }
    await atualizarStatus();
    mostrarPagina();
  }));
}

async function paginaConexao(el, valido) {
  await carregarConfig();
  if (!valido()) return;
  el.innerHTML = `
    <div class="topo"><div><h1>Conexão</h1><p>WhatsApp da farmácia e acesso pelo celular</p></div></div>
    <div class="cartao"><h2>WhatsApp da farmácia</h2><p class="sub">Número que o bot usa para pedir as avaliações</p><div id="wa-box"></div></div>
    <div class="cartao"><h2>Acesso pelo celular</h2>
      <p class="sub">Abre este painel de qualquer lugar, pelo celular, com a mesma senha.</p>
      ${interruptor('acessoRemoto.ativo', 'Permitir acesso pela internet', 'Usa um túnel gratuito e seguro da Cloudflare. Não precisa mexer no roteador.')}
      <div id="remoto-box" style="margin-top:12px"></div>
    </div>
    <div class="cartao"><div class="topo" style="margin-bottom:8px"><h2>Registro de atividades</h2><button class="btn pequeno" id="atualizar-log">Atualizar</button></div>
      <div class="registro" id="registro">Carregando…</div></div>`;
  preencherCampos(el);

  const chk = $('[data-c="acessoRemoto.ativo"]', el);
  chk.addEventListener('change', async () => {
    if (!chk.checked && S.status.acessoAtualRemoto && !confirm('Você está acessando pela internet agora. Se desligar, perderá o acesso por este aparelho. Continuar?')) {
      chk.checked = true;
      return;
    }
    S.cfg.acessoRemoto.ativo = chk.checked;
    await salvarConfig(null);
    await atualizarStatus();
  });

  let qrUrl = null;
  let ultimoEstado = '';
  const desenhar = async () => {
    if (!valido()) { window.removeEventListener('status', desenhar); return; }
    const w = S.status.whatsapp;
    const chave = `${w.estado}|${w.qr}|${w.numero}`;
    if (chave !== ultimoEstado) {
      ultimoEstado = chave;
      const box = $('#wa-box', el);
      if (w.estado === 'conectado') {
        box.innerHTML = `
          <div class="status-grande"><span class="ponto verde"></span><div><b>Conectado</b><div class="ajuda">${esc(w.nome || '')} · +${esc(w.numero || '')} · ${haQuanto(w.desde)}</div></div></div>
          <div class="acoes" style="margin-top:14px">
            <button class="btn" id="reiniciar">🔄 Reiniciar conexão</button>
            <button class="btn perigo" id="desconectar">Desconectar / trocar número</button>
          </div>
          <p class="ajuda" style="margin-top:12px">O pedido automático ${S.status.dentroDoHorario ? '<b>está ativo</b> agora' : '<b>está pausado</b> agora (fora do horário configurado)'}.</p>`;
      } else if (w.estado === 'qr' && w.qr) {
        box.innerHTML = `
          <div class="qr-caixa"><img src="${w.qr}" alt="QR code do WhatsApp">
            <div><h3 style="margin-bottom:8px">Conecte o WhatsApp da farmácia</h3><ol>
              <li>Abra o WhatsApp no celular da farmácia</li>
              <li>Toque em <b>⋮</b> (ou Configurações) › <b>Aparelhos conectados</b></li>
              <li>Toque em <b>Conectar um aparelho</b></li>
              <li>Aponte a câmera para este código</li></ol>
              <p class="ajuda">O código muda sozinho a cada poucos segundos.</p></div></div>`;
      } else {
        const titulo = { iniciando: 'Conectando…', sincronizando: 'QR code aceito. Sincronizando as conversas…' }[w.estado] || 'Desconectado';
        const ajuda = w.estado === 'sincronizando' ? 'Na primeira vez pode levar alguns minutos. Mantenha o celular da farmácia com internet.'
          : w.estado === 'iniciando' ? `Isso pode levar até um minuto.${w.ultimoErro ? ` (Último problema: ${esc(w.ultimoErro)})` : ''}` : esc(w.ultimoErro || '');
        box.innerHTML = `
          <div class="status-grande"><span class="ponto ${w.estado === 'desconectado' ? 'vermelho' : 'amarelo'}"></span><div><b>${titulo}</b>
          <div class="ajuda">${ajuda}</div></div></div>
          <div class="acoes" style="margin-top:14px">
            ${w.estado === 'desconectado' ? '<button class="btn" id="reiniciar">Tentar conectar de novo</button>' : ''}
            <button class="btn primario" id="novo-qr">🔄 Gerar QR code novo</button>
          </div>
          <p class="ajuda" style="margin-top:10px">Se o celular mostrou erro ao escanear ou a conexão travou, use <b>Gerar QR code novo</b>: apaga a conexão antiga e mostra um código novo em alguns segundos.</p>`;
      }
      $('#reiniciar', box)?.addEventListener('click', (e) => acao(e.target, () => api('/api/whatsapp/reiniciar', { body: {} }), 'Reiniciando…'));
      $('#novo-qr', box)?.addEventListener('click', (e) => acao(e.target, () => api('/api/whatsapp/novo-qr', { body: {} }), 'Gerando QR code novo…'));
      $('#desconectar', box)?.addEventListener('click', (e) => {
        if (!confirm('Desconectar o WhatsApp? O bot para de pedir avaliações até alguém escanear o QR code de novo.')) return;
        acao(e.target, () => api('/api/whatsapp/desconectar', { body: {} }), 'Desconectando…');
      });
    }

    const r = S.status.remoto;
    const rb = $('#remoto-box', el);
    if (!r.ativo) {
      rb.innerHTML = '';
    } else if (r.estado === 'online' && r.url) {
      if (qrUrl?.url !== r.url) qrUrl = { url: r.url, img: (await api(`/api/qr?${query({ texto: r.url })}`)).img };
      rb.innerHTML = `
        <div class="qr-caixa"><img src="${qrUrl.img}" alt="QR code do endereço" style="width:180px">
          <div style="flex:1;min-width:220px">
            <div class="status-grande" style="margin-bottom:8px"><span class="ponto verde"></span><b>Disponível pela internet</b></div>
            <div class="url-remota">${esc(r.url)}</div>
            <div class="acoes" style="margin-top:8px"><button class="btn pequeno" id="copiar">📋 Copiar endereço</button></div>
            <p class="ajuda">Aponte a câmera do celular para o QR code. <b>O endereço muda toda vez que o programa reinicia</b>; ${S.cfg.farmaceutico.linkRemoto ? 'o novo endereço é enviado automaticamente ao farmacêutico.' : 'ative o envio automático em "Avisos ao farmacêutico".'}</p>
          </div></div>`;
      $('#copiar', rb).onclick = () => navigator.clipboard.writeText(r.url).then(() => toast('Endereço copiado'));
    } else {
      const txt = { baixando: 'Baixando o programa de acesso (só na primeira vez)…', conectando: 'Conectando…', erro: r.erro || 'Erro', desligado: 'Iniciando…' }[r.estado];
      rb.innerHTML = `<div class="status-grande"><span class="ponto ${r.estado === 'erro' ? 'vermelho' : 'amarelo'}"></span><span>${esc(txt)}</span></div>`;
    }
  };
  await desenhar();
  window.addEventListener('status', desenhar);

  const carregarLog = async () => {
    const linhas = await api('/api/registro');
    const box = $('#registro', el);
    if (box) box.textContent = linhas.slice().reverse().join('\n') || 'Sem atividades ainda.';
  };
  $('#atualizar-log', el).onclick = carregarLog;
  carregarLog();
}

const MENSAGENS = [
  ['pedido', 'Pedido de avaliação', 'Enviada quando o atendimento termina (#fim ou automático).'],
  ['agradecimento', 'Agradecimento (nota boa)', 'Resposta para notas acima do limite de nota baixa.'],
  ['agradecimentoGoogle', 'Agradecimento + avaliação no Google', 'Usada no lugar da anterior quando o convite do Google está ligado e a nota é alta.'],
  ['pedirComentario', 'Pedido de comentário (nota baixa)', 'Pergunta o que pode melhorar.'],
  ['agradecimentoComentario', 'Agradecimento pelo comentário', 'Resposta depois que o cliente explica a nota baixa.'],
  ['notaInvalida', 'Resposta inválida', 'Quando o cliente responde algo que não é uma nota.'],
];
const VARIAVEIS = {
  pedido: ['{nome}', '{farmacia}', '{cidade}'],
  agradecimento: ['{nota}', '{farmacia}', '{nome}'],
  agradecimentoGoogle: ['{nota}', '{link}', '{farmacia}', '{nome}'],
  pedirComentario: ['{nota}', '{farmacia}', '{nome}'],
  agradecimentoComentario: ['{farmacia}', '{nome}'],
  notaInvalida: ['{farmacia}'],
};

async function paginaMensagens(el, valido) {
  await carregarConfig();
  if (!valido()) return;
  const exemplo = (t) => t.replace(/\{nome\}/g, ', Maria').replace(/\{farmacia\}/g, S.cfg.nomeFarmacia).replace(/\{cidade\}/g, S.cfg.cidade)
    .replace(/\{nota\}/g, '9').replace(/\{link\}/g, S.cfg.google.link || 'https://g.page/r/...');
  el.innerHTML = `
    <div class="topo"><div><h1>Mensagens</h1><p>Textos que o cliente recebe. Use *asteriscos* para <b>negrito</b> e _sublinhados_ para <i>itálico</i>.</p></div></div>
    <div class="cartao"><h2>Número para testes</h2><p class="sub">Os botões "Enviar teste" mandam a mensagem para este número.</p>
      <input type="tel" id="num-teste" placeholder="Ex.: 85 99999-8888" value="${esc(S.numeroTeste)}"></div>
    <div class="cartao"><h2>⭐ Avaliação no Google</h2>
      <p class="sub">Depois de uma nota alta, convida o cliente a avaliar a farmácia no Google Maps. Isso ajuda a farmácia a aparecer nas buscas.</p>
      ${interruptor('google.ativo', 'Convidar para avaliar no Google', 'Só para quem deu nota alta.')}
      <div class="linha" style="margin-top:10px">
        <label class="campo"><span>Link de avaliação do Google</span><input type="text" data-c="google.link" placeholder="https://g.page/r/.../review">
          <small>No Perfil da Empresa no Google (pesquise "Farmácia Paes" logado na conta da farmácia), clique em <b>Pedir avaliações</b> e copie o link.</small></label>
        <label class="campo fixo" style="width:170px"><span>A partir da nota</span><select data-c="google.notaMinima" data-numero>
          <option value="8">8</option><option value="9">9</option><option value="10">10</option></select></label>
      </div>
    </div>
    ${MENSAGENS.map(([k, titulo, desc]) => `
      <div class="cartao" data-msg="${k}"><h2>${titulo}</h2><p class="sub">${desc}</p>
        <div class="msg-editor">
          <div>
            <textarea data-c="mensagens.${k}" rows="7"></textarea>
            <div class="variaveis">${VARIAVEIS[k].map((v) => `<button type="button" data-var="${v}" title="Inserir">${v}</button>`).join('')}</div>
            <div class="acoes" style="margin-top:10px">
              <button class="btn pequeno" data-teste="${k}">📤 Enviar teste</button>
              <button class="btn pequeno" data-padrao="${k}">↩️ Restaurar texto original</button>
            </div>
          </div>
          <div class="wa"><div class="balao"><span class="txt"></span><span class="hora">10:42</span></div></div>
        </div>
      </div>`).join('')}
    <div class="salvar-fixo"><button class="btn primario" id="salvar">💾 Salvar mensagens</button></div>`;
  preencherCampos(el);

  const previa = (card) => { $('.txt', card).innerHTML = formatarWhats(exemplo($('textarea', card).value)); };
  $$('[data-msg]', el).forEach((card) => {
    const ta = $('textarea', card);
    ta.addEventListener('input', () => previa(card));
    previa(card);
    $$('[data-var]', card).forEach((b) => b.addEventListener('click', () => {
      const ini = ta.selectionStart;
      ta.setRangeText(b.dataset.var, ini, ta.selectionEnd, 'end');
      ta.focus();
      previa(card);
    }));
    $('[data-padrao]', card).addEventListener('click', () => {
      ta.value = S.padrao.mensagens[card.dataset.msg];
      previa(card);
      toast('Texto original restaurado. Clique em Salvar para manter.');
    });
    $('[data-teste]', card).addEventListener('click', async (e) => {
      const numero = $('#num-teste', el).value.trim();
      if (!numero) { toast('Informe o número para testes no topo da página.', true); return; }
      S.numeroTeste = numero;
      localStorage.setItem('numeroTeste', numero);
      coletarCampos(el);
      await acao(e.target, async () => {
        await api('/api/config', { method: 'PUT', body: S.cfg });
        await api('/api/teste/mensagem', { body: { numero, tipo: card.dataset.msg } });
      }, 'Teste enviado ✓');
    });
  });
  $('#salvar', el).onclick = (e) => salvarConfig(e.target, el);
}

async function paginaAtendentes(el, valido) {
  await carregarConfig();
  if (!valido()) return;
  const codigoDe = (nome) => nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 15);
  const desenhar = () => {
    const lista = S.cfg.atendentes;
    $('#lista-at', el).innerHTML = lista.length ? lista.map((a, i) => `
      <div class="linha" style="margin-bottom:10px" data-i="${i}">
        <label class="campo" style="margin:0"><span>Nome</span><input type="text" data-k="nome" value="${esc(a.nome)}" placeholder="Ex.: Ana Paula"></label>
        <label class="campo" style="margin:0"><span>Código</span><input type="text" data-k="codigo" value="${esc(a.codigo)}" placeholder="ana"></label>
        <div class="fixo" style="padding-bottom:2px"><span class="comando">#fim ${esc(a.codigo || '?')}</span></div>
        <button class="btn perigo fixo" data-remover="${i}" title="Remover">✕</button>
      </div>`).join('') : '<div class="vazio">Nenhum atendente cadastrado.</div>';
    $$('[data-i]', el).forEach((linha) => {
      const a = S.cfg.atendentes[linha.dataset.i];
      $$('input', linha).forEach((inp) => inp.addEventListener('input', () => {
        if (inp.dataset.k === 'nome') {
          const auto = !a.codigo || a.codigo === codigoDe(a.nome);
          a.nome = inp.value;
          if (auto) { a.codigo = codigoDe(inp.value.split(' ')[0]); $('[data-k=codigo]', linha).value = a.codigo; }
        } else {
          a.codigo = codigoDe(inp.value);
        }
        $('.comando', linha).textContent = `#fim ${a.codigo || '?'}`;
      }));
    });
    $$('[data-remover]', el).forEach((b) => b.addEventListener('click', () => { S.cfg.atendentes.splice(b.dataset.remover, 1); desenhar(); }));
  };
  el.innerHTML = `
    <div class="topo"><div><h1>Atendentes</h1><p>Cadastre quem atende para ver a nota de cada um</p></div></div>
    <div class="cartao"><h2>Como usar no WhatsApp</h2><p class="sub">O atendente digita o comando na conversa do cliente. O bot apaga o comando na hora, e o cliente não vê.</p>
      <table class="tabela">
        <tr><td><span class="comando">#fim ana</span></td><td>Encerra o atendimento, pede a nota agora e registra que foi a Ana.</td></tr>
        <tr><td><span class="comando">#ana</span></td><td>Só marca que a Ana está atendendo. Vale para o pedido automático.</td></tr>
        <tr><td><span class="comando">#fim</span></td><td>Encerra sem identificar o atendente.</td></tr>
        <tr><td><span class="comando">#semnota</span></td><td>Não pedir avaliação nesta conversa (fornecedor, parente…).</td></tr>
      </table></div>
    <div class="cartao"><h2>Equipe</h2><p class="sub">O código é o que vai depois do # (sem espaços nem acentos).</p>
      <div id="lista-at"></div>
      <button class="btn" id="add">＋ Adicionar atendente</button></div>
    <div class="salvar-fixo"><button class="btn primario" id="salvar">💾 Salvar atendentes</button></div>`;
  desenhar();
  $('#add', el).onclick = () => { S.cfg.atendentes.push({ nome: '', codigo: '' }); desenhar(); $$('[data-k=nome]', el).pop()?.focus(); };
  $('#salvar', el).onclick = async (e) => { await salvarConfig(e.target); desenhar(); };
}

async function paginaFarmaceutico(el, valido) {
  await carregarConfig();
  if (!valido()) return;
  const horas = (c) => `<input type="time" data-c="${c}">`;
  el.innerHTML = `
    <div class="topo"><div><h1>Avisos ao farmacêutico</h1><p>Alertas e resumos enviados direto ao celular do farmacêutico</p></div></div>
    <div class="cartao"><h2>📱 WhatsApp do farmacêutico</h2>
      <p class="sub">Os avisos saem do WhatsApp da farmácia e são <b>apagados de lá logo depois</b>: a equipe não vê, e o farmacêutico continua com a mensagem.</p>
      <label class="campo"><span>Número do farmacêutico</span><input type="tel" data-c="farmaceutico.numero" placeholder="Ex.: 85 99999-8888">
        <small>Deve ser diferente do número da farmácia. Este número nunca recebe pedido de avaliação.</small></label>
      ${interruptor('farmaceutico.apagarAposEnviar', 'Apagar o aviso do WhatsApp da farmácia', 'Apaga só a mensagem enviada (não a conversa). Ela pode aparecer por 1 a 3 segundos antes de sumir.')}
      <div class="aviso amarelo" style="margin:10px 0 0"><span class="texto">💡 <b>Não responda</b> aos avisos pelo WhatsApp. A resposta apareceria no celular da farmácia.</span></div>
    </div>
    <div class="cartao"><h2>Quais avisos enviar</h2>
      ${interruptor('farmaceutico.notaBaixa', '⚠️ Nota baixa', 'Na hora em que um cliente dá nota baixa.')}
      ${interruptor('farmaceutico.comentarios', '💬 Comentários', 'Quando o cliente explica o que pode melhorar.')}
      ${interruptor('farmaceutico.notaDez', '🌟 Cada nota 10', 'Pode gerar muitos avisos.')}
      ${interruptor('farmaceutico.linkRemoto', '🌐 Novo endereço do painel', 'Quando o endereço de acesso pelo celular muda.')}
    </div>
    <div class="cartao"><h2>📊 Resumos</h2>
      ${interruptor('farmaceutico.resumoDiario.ativo', 'Resumo diário', 'Avaliações do dia, média, NPS e ranking dos atendentes.')}
      <div class="linha" style="margin:4px 0 10px 56px"><label class="campo" style="margin:0;max-width:160px"><span>Horário</span>${horas('farmaceutico.resumoDiario.hora')}</label></div>
      ${interruptor('farmaceutico.resumoSemanal.ativo', 'Resumo semanal', 'Últimos 7 dias, comparando com a semana anterior.')}
      <div class="linha" style="margin:4px 0 0 56px">
        <label class="campo" style="margin:0"><span>Dia</span><select data-c="farmaceutico.resumoSemanal.dia" data-numero>
          ${['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></label>
        <label class="campo" style="margin:0"><span>Horário</span>${horas('farmaceutico.resumoSemanal.hora')}</label>
      </div>
      <p class="ajuda" style="margin-top:12px">Dica: resumos fora do expediente (ex.: 21:30) diminuem a chance de a equipe ver o aviso antes de ele ser apagado.</p>
    </div>
    <div class="cartao"><h2>✈️ Telegram (opcional, recomendado)</h2>
      <p class="sub">Canal extra, fora do WhatsApp da farmácia: a equipe nunca vê, o farmacêutico pode responder à vontade, e é o único jeito de avisar quando <b>o bot desconecta do WhatsApp</b>.</p>
      ${interruptor('telegram.ativo', 'Enviar os avisos também pelo Telegram')}
      <ol class="ajuda" style="padding-left:18px;margin:10px 0 14px">
        <li>No Telegram, procure <b>@BotFather</b>, envie <b>/newbot</b> e siga os passos. Ele vai mostrar um <b>token</b>.</li>
        <li>Cole o token abaixo.</li>
        <li>No celular do farmacêutico, abra o bot criado e envie um <b>oi</b>.</li>
        <li>Clique em <b>Encontrar conversa</b> e depois em <b>Salvar</b>.</li>
      </ol>
      <label class="campo"><span>Token do bot</span><input type="text" data-c="telegram.token" placeholder="123456789:ABC..." autocomplete="off"></label>
      <div class="linha">
        <label class="campo" style="margin:0"><span>Conversa (chat ID)</span><input type="text" data-c="telegram.chatId" placeholder="Preenchido automaticamente"></label>
        <button class="btn fixo" id="descobrir">🔎 Encontrar conversa</button>
      </div>
    </div>
    <div class="cartao"><h2>Testar</h2><p class="sub">Salva as configurações e envia agora.</p>
      <div class="acoes">
        <button class="btn" data-teste="farmaceutico">🧪 Enviar aviso de teste</button>
        <button class="btn" data-teste="diario">📊 Enviar resumo de hoje</button>
        <button class="btn" data-teste="semanal">📊 Enviar resumo da semana</button>
      </div></div>
    <div class="salvar-fixo"><button class="btn primario" id="salvar">💾 Salvar</button></div>`;
  preencherCampos(el);
  $('#salvar', el).onclick = (e) => salvarConfig(e.target, el);
  $('#descobrir', el).onclick = (e) => acao(e.target, async () => {
    const r = await api('/api/telegram/descobrir', { body: { token: $('[data-c="telegram.token"]', el).value.trim() } });
    $('[data-c="telegram.chatId"]', el).value = r.chatId;
    toast(`Conversa encontrada${r.nome ? `: ${r.nome}` : ''}. Clique em Salvar.`);
  });
  $$('[data-teste]', el).forEach((b) => b.addEventListener('click', async () => {
    coletarCampos(el);
    await acao(b, async () => {
      await api('/api/config', { method: 'PUT', body: S.cfg });
      if (b.dataset.teste === 'farmaceutico') await api('/api/teste/farmaceutico', { body: {} });
      else await api('/api/teste/resumo', { body: { tipo: b.dataset.teste } });
    }, 'Enviado ✓');
    await carregarConfig();
  }));
}

async function paginaConfiguracoes(el, valido) {
  await carregarConfig();
  if (!valido()) return;
  el.innerHTML = `
    <div class="topo"><div><h1>Configurações</h1></div></div>
    <div class="cartao"><h2>Farmácia</h2>
      <div class="linha">
        <label class="campo"><span>Nome</span><input type="text" data-c="nomeFarmacia"></label>
        <label class="campo"><span>Cidade</span><input type="text" data-c="cidade"></label>
      </div></div>
    <div class="cartao"><h2>Pedido de avaliação</h2>
      <div class="linha">
        <label class="campo"><span>Pedir sozinho depois de</span><input type="number" min="5" max="600" data-c="pedido.minutosAutomatico"><small>minutos de conversa parada (com a farmácia respondendo por último)</small></label>
        <label class="campo"><span>Não pedir ao mesmo cliente por</span><input type="number" min="1" max="720" data-c="pedido.horasEntrePedidos"><small>horas</small></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Nota baixa é até</span><select data-c="pedido.notaMaximaComentario" data-numero>${[4, 5, 6, 7, 8].map((n) => `<option value="${n}">${n}</option>`).join('')}</select>
          <small>Até esta nota o bot pergunta o que melhorar, e a avaliação vai para "A resolver"</small></label>
        <label class="campo"><span>Ignorar conversas paradas há mais de</span><input type="number" min="1" max="72" data-c="pedido.horasMaximas"><small>horas (evita pedir nota de conversa antiga)</small></label>
      </div></div>
    <div class="cartao"><h2>Horário do pedido automático</h2>
      <p class="sub">Fora destes horários o bot espera para pedir. O <span class="comando">#fim</span> funciona a qualquer hora.</p>
      ${interruptor('horarios.plantao', '🌙 Modo plantão', 'Ignora os horários abaixo e pede a qualquer hora.')}
      <div class="dias" style="margin-top:10px">
        ${Object.entries(DIAS_SEMANA).map(([k, n]) => `
          <div class="dia"><label><input type="checkbox" data-c="horarios.dias.${k}.ativo">${n}</label>
            <input type="time" data-c="horarios.dias.${k}.inicio"><input type="time" data-c="horarios.dias.${k}.fim"></div>`).join('')}
      </div></div>
    <div class="cartao"><h2>Números ignorados</h2><p class="sub">Nunca recebem pedido de avaliação (fornecedores, família…). Um por linha.</p>
      <textarea id="ignorados" placeholder="85 99999-8888" style="min-height:90px"></textarea></div>
    <div class="cartao"><h2>💾 Backup</h2>
      ${interruptor('backup.ativo', 'Backup automático diário', 'Copia as avaliações e configurações uma vez por dia.')}
      <div class="linha" style="margin-top:10px">
        <label class="campo"><span>Pasta do backup</span><input type="text" data-c="backup.pasta" placeholder="${esc(S.extra.pastaBackup)}">
          <small>Use uma pasta do OneDrive ou Google Drive para ter cópia fora do computador. Em branco: ${esc(S.extra.pastaBackup)}</small></label>
        <label class="campo fixo" style="width:150px"><span>Manter</span><input type="number" min="3" max="365" data-c="backup.manter"><small>últimos backups</small></label>
      </div>
      <div class="acoes"><button class="btn" id="backup">Fazer backup agora</button>
        <span class="ajuda">Último: ${S.extra.ultimoBackup ? dataHora(S.extra.ultimoBackup) : 'nenhum'}</span></div></div>
    <div class="salvar-fixo"><button class="btn primario" id="salvar">💾 Salvar configurações</button></div>
    <div class="cartao" style="margin-top:16px"><h2>🖥️ Computador</h2>
      <p class="sub">O bot roda escondido, sem janela. Para abrir este painel, dê dois cliques no <b>BotFarmaciaPaes.exe</b> (ou acesse <b>localhost:3210</b> no navegador).</p>
      <label class="interruptor"><input type="checkbox" id="iniciar-windows"><div><b>Iniciar junto com o Windows</b>
        <small>Liga o bot sozinho quando o computador é ligado, sem abrir o navegador.</small></div></label>
      ${S.status.acessoAtualRemoto ? '' : `<div class="acoes" style="margin-top:10px"><button class="btn perigo" id="desligar">⏻ Desligar o bot</button>
        <span class="ajuda">Para ligar de novo, abra o BotFarmaciaPaes.exe.</span></div>`}
    </div>
    <div class="cartao" style="margin-top:16px"><h2>🔒 Segurança</h2>
      <form id="form-senha" class="linha">
        <label class="campo"><span>Senha atual</span><input type="password" id="s-atual" autocomplete="current-password" required></label>
        <label class="campo"><span>Nova senha</span><input type="password" id="s-nova" autocomplete="new-password" minlength="8" required></label>
        <button class="btn fixo" type="submit" style="margin-bottom:14px">Trocar senha</button>
      </form>
      <div class="acoes"><button class="btn perigo" id="sair-todos">Desconectar todos os outros aparelhos</button><button class="btn" id="sair2">Sair</button></div>
    </div>`;
  preencherCampos(el);
  $('#ignorados', el).value = S.cfg.numerosIgnorados.join('\n');
  $('#salvar', el).onclick = (e) => {
    S.cfg.numerosIgnorados = $('#ignorados', el).value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    salvarConfig(e.target, el);
  };
  $('#backup', el).onclick = (e) => acao(e.target, async () => {
    coletarCampos(el);
    await api('/api/config', { method: 'PUT', body: S.cfg });
    const r = await api('/api/backup', { body: {} });
    toast(`Backup feito em ${r.pasta}`);
  });
  $('#form-senha', el).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await acao($('button', ev.target), () => api('/api/trocar-senha', { body: { atual: $('#s-atual').value, nova: $('#s-nova').value } }), 'Senha alterada ✓');
    ev.target.reset();
  });
  const chkWin = $('#iniciar-windows', el);
  api('/api/sistema').then((sis) => { chkWin.checked = sis.iniciarComWindows; });
  chkWin.addEventListener('change', () => acao(null, async () => {
    const r = await api('/api/sistema/iniciar-com-windows', { body: { ativo: chkWin.checked } });
    chkWin.checked = r.iniciarComWindows;
  }, chkWin.checked ? 'Vai ligar junto com o Windows ✓' : 'Início automático desligado'));
  $('#desligar', el)?.addEventListener('click', async (e) => {
    if (!confirm('Desligar o bot? Ele para de pedir avaliações até alguém abrir o BotFarmaciaPaes.exe de novo.')) return;
    await acao(e.target, () => api('/api/sistema/desligar', { body: {} }));
    clearTimeout(timerStatus);
    $('#app').innerHTML = '<div class="login"><div class="cartao"><img src="/icone.svg" alt=""><h1>Bot desligado</h1><p>Para ligar de novo, dê dois cliques no <b>BotFarmaciaPaes.exe</b>.</p></div></div>';
  });
  $('#sair-todos', el).onclick =(e) => acao(e.target, () => api('/api/sair-de-todos', { body: {} }), 'Outros aparelhos desconectados ✓');
  $('#sair2', el).onclick = sair;
}

async function paginaMais(el) {
  el.innerHTML = `
    <div class="topo"><h1>Mais</h1></div>
    <div class="cartao"><div class="lista">
      ${['mensagens', 'atendentes', 'farmaceutico', 'configuracoes'].map((k) => `<a class="item" href="#${k}" style="text-decoration:none;color:inherit;align-items:center"><span style="font-size:22px">${PAGINAS[k].ic}</span><div class="meio"><b>${PAGINAS[k].nome}</b></div><span>›</span></a>`).join('')}
      <a class="item" href="#" id="sair3" style="text-decoration:none;color:var(--vermelho);align-items:center"><span style="font-size:22px">🚪</span><div class="meio"><b>Sair</b></div></a>
    </div></div>`;
  $('#sair3', el).onclick = sair;
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && S.sessao?.logado) atualizarStatus(); });
iniciar();
