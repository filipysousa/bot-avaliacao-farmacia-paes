// Iniciar junto com o Windows (registro do usuário: HKCU\...\Run). Não precisa de administrador.
const path = require('path');
const { execFile } = require('child_process');
const { DIR, log } = require('./util');

const CHAVE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const NOME = 'BotFarmaciaPaes';

let ehExe = false;
try { ehExe = require('node:sea').isSea(); } catch { /* rodando com node */ }

// Comando gravado no registro: abre o bot em segundo plano, sem abrir o navegador
function comando() {
  return ehExe
    ? `"${process.execPath}" --segundo-plano`
    : `"${process.execPath}" "${path.join(DIR, 'app.js')}" --segundo-plano`;
}

function reg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true }, (erro, saida) => resolve({ ok: !erro, saida: String(saida || '') }));
  });
}

async function ativo() {
  const r = await reg(['query', CHAVE, '/v', NOME]);
  // Considera ativo só se apontar para ESTE programa (a pasta pode ter mudado)
  return r.ok && r.saida.toLowerCase().includes(process.execPath.toLowerCase());
}

async function definir(ligar) {
  const r = ligar
    ? await reg(['add', CHAVE, '/v', NOME, '/t', 'REG_SZ', '/d', comando(), '/f'])
    : await reg(['delete', CHAVE, '/v', NOME, '/f']);
  if (!r.ok && ligar) throw new Error('Não foi possível ativar o início automático.');
  log(ligar ? 'Início automático com o Windows ATIVADO.' : 'Início automático com o Windows desativado.');
}

module.exports = { ativo, definir, ehExe };
