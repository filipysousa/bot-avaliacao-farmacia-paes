// Tarefas programadas: resumo diário, resumo semanal e backup
const fs = require('fs');
const path = require('path');
const store = require('./store');
const stats = require('./stats');
const { avisar, textoResumo } = require('./notificacoes');
const { DADOS, MIN, DIA, log, hojeISO } = require('./util');

function horaAtual(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function pastaBackup() {
  const p = store.config().backup.pasta;
  if (p) return p;
  if (process.env.OneDrive) return path.join(process.env.OneDrive, 'Backup Bot Farmacia Paes');
  return path.join(DADOS, 'backups');
}

function fazerBackup() {
  const cfg = store.config().backup;
  const raiz = pastaBackup();
  const destino = path.join(raiz, `backup-${hojeISO()}`);
  fs.mkdirSync(destino, { recursive: true });
  for (const arq of [store.ARQ.avaliacoes, store.ARQ.config]) {
    if (fs.existsSync(arq)) fs.copyFileSync(arq, path.join(destino, path.basename(arq)));
  }
  // Mantém só os últimos N backups
  const antigos = fs.readdirSync(raiz).filter((n) => n.startsWith('backup-')).sort().reverse().slice(cfg.manter);
  for (const n of antigos) fs.rmSync(path.join(raiz, n), { recursive: true, force: true });
  store.agenda.ultimoBackup = new Date().toISOString();
  store.salvarAgenda();
  log(`💾 Backup feito em ${destino}`);
  return destino;
}

async function resumoDiario() {
  const hoje = hojeISO();
  const r = stats.resumo({ de: hoje, ate: hoje });
  return avisar(textoResumo(`Resumo de hoje (${new Date().toLocaleDateString('pt-BR')})`, r));
}

async function resumoSemanal() {
  const ate = hojeISO(new Date(Date.now() - DIA));
  const de = hojeISO(new Date(Date.now() - 7 * DIA));
  const r = stats.resumo({ de, ate });
  const ant = stats.resumo({ de: hojeISO(new Date(Date.now() - 14 * DIA)), ate: hojeISO(new Date(Date.now() - 8 * DIA)) });
  let comparacao = '';
  if (r.total && ant.total) {
    const dif = r.media - ant.media;
    comparacao = `\n\nSemana anterior: média ${ant.media.toFixed(1).replace('.', ',')} ${dif >= 0 ? '📈' : '📉'}`;
  }
  return avisar(textoResumo('Resumo da semana (últimos 7 dias)', r, comparacao));
}

async function verificar() {
  const cfg = store.config();
  const f = cfg.farmaceutico;
  const agora = new Date();
  const hoje = hojeISO(agora);
  const hora = horaAtual(agora);
  const a = store.agenda;

  if (f.resumoDiario.ativo && hora >= f.resumoDiario.hora && a.resumoDiario !== hoje) {
    a.resumoDiario = hoje;
    store.salvarAgenda();
    await resumoDiario();
  }
  if (f.resumoSemanal.ativo && agora.getDay() === Number(f.resumoSemanal.dia) &&
      hora >= f.resumoSemanal.hora && a.resumoSemanal !== hoje) {
    a.resumoSemanal = hoje;
    store.salvarAgenda();
    await resumoSemanal();
  }
  if (cfg.backup.ativo && (!a.ultimoBackup || hojeISO(new Date(a.ultimoBackup)) !== hoje)) {
    try { fazerBackup(); } catch (e) { log(`Erro no backup: ${e.message}`); }
  }
}

function iniciar() {
  // Marca os resumos de hoje como já enviados se o horário já passou ao ligar o bot,
  // para não disparar resumo atrasado toda vez que o programa é aberto
  const a = store.agenda;
  const f = store.config().farmaceutico;
  const hoje = hojeISO();
  if (!a.resumoDiario && horaAtual() > f.resumoDiario.hora) a.resumoDiario = hoje;
  if (!a.resumoSemanal) a.resumoSemanal = hoje;
  store.salvarAgenda();
  setInterval(() => verificar().catch((e) => log(`Erro na agenda: ${e.message}`)), MIN);
}

module.exports = { iniciar, fazerBackup, pastaBackup, resumoDiario, resumoSemanal };
