// Acesso pelo celular de qualquer lugar: túnel gratuito da Cloudflare (sem abrir portas no roteador)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { DADOS, log } = require('./util');

const BIN = path.join(DADOS, 'bin', 'cloudflared.exe');
const URL_DOWNLOAD = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

const eventos = new EventEmitter();
const status = { estado: 'desligado', url: null, erro: null }; // desligado | baixando | conectando | online | erro
let processo = null;
let querLigado = false;
let porta = null;

async function baixar() {
  if (fs.existsSync(BIN)) return;
  status.estado = 'baixando';
  log('Baixando o programa de acesso remoto (Cloudflare)...');
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  const r = await fetch(URL_DOWNLOAD);
  if (!r.ok) throw new Error(`Falha no download (${r.status})`);
  const tmp = `${BIN}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  fs.renameSync(tmp, BIN);
}

async function ligar(p) {
  porta = p;
  querLigado = true;
  if (processo) return;
  status.erro = null;
  try {
    await baixar();
  } catch (e) {
    Object.assign(status, { estado: 'erro', erro: e.message });
    log(`Acesso remoto: ${e.message}`);
    return;
  }
  if (!querLigado) return;
  status.estado = 'conectando';
  processo = spawn(BIN, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${porta}`], { windowsHide: true });
  const ler = (dados) => {
    const m = String(dados).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== status.url) {
      Object.assign(status, { estado: 'online', url: m[0] });
      log(`🌐 Acesso pelo celular: ${m[0]}`);
      eventos.emit('url', m[0]);
    }
  };
  processo.stdout.on('data', ler);
  processo.stderr.on('data', ler);
  processo.on('exit', (codigo) => {
    processo = null;
    Object.assign(status, { url: null });
    if (querLigado) {
      Object.assign(status, { estado: 'erro', erro: `O túnel fechou (código ${codigo}). Tentando de novo...` });
      setTimeout(() => querLigado && ligar(porta), 15000);
    } else {
      status.estado = 'desligado';
    }
  });
}

function desligar() {
  querLigado = false;
  if (processo) processo.kill();
  Object.assign(status, { estado: 'desligado', url: null, erro: null });
}

module.exports = { ligar, desligar, status, eventos };
