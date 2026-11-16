// Funções compartilhadas
const fs = require('fs');
const path = require('path');

const DIR = process.env.BOT_DIR || path.join(__dirname, '..');
const DADOS = path.join(DIR, 'dados');
fs.mkdirSync(DADOS, { recursive: true });

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

function lerJson(arq, padrao) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}

// Grava num arquivo temporário e renomeia: evita corromper o arquivo se o PC desligar no meio
function salvarJson(arq, dados) {
  const tmp = `${arq}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
  fs.renameSync(tmp, arq);
}

const registro = []; // últimas linhas de log, exibidas no painel
const ARQ_LOG = path.join(DADOS, 'registro.log');
try { // mantém o arquivo de registro pequeno
  if (fs.statSync(ARQ_LOG).size > 2 * 1024 * 1024) fs.renameSync(ARQ_LOG, `${ARQ_LOG}.antigo`);
} catch { /* ainda não existe */ }
function log(texto) {
  const linha = `[${new Date().toLocaleString('pt-BR')}] ${texto}`;
  console.log(linha);
  registro.push(linha);
  if (registro.length > 300) registro.shift();
  try { fs.appendFileSync(ARQ_LOG, `${linha}\n`); } catch { /* sem problema */ }
}

function preencher(modelo, vars) {
  return String(modelo || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

function soDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

// "85 99999-8888" -> "5585999998888"
function telefoneBR(v) {
  const d = soDigitos(v);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

// Compara dois telefones ignorando DDI e o 9º dígito
function mesmoNumero(a, b) {
  const da = soDigitos(a);
  const db = soDigitos(b);
  return da.length >= 8 && db.length >= 8 && da.slice(-8) === db.slice(-8);
}

function formatarTelefone(v) {
  const d = soDigitos(v);
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : d;
}

function hojeISO(data = new Date()) {
  const d = new Date(data.getTime() - data.getTimezoneOffset() * MIN);
  return d.toISOString().slice(0, 10);
}

function numeroBR(n, casas = 1) {
  return Number(n || 0).toFixed(casas).replace('.', ',');
}

module.exports = {
  DIR, DADOS, MIN, HORA, DIA,
  lerJson, salvarJson, log, registro, preencher,
  soDigitos, telefoneBR, mesmoNumero, formatarTelefone, hojeISO, numeroBR,
};
