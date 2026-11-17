// Publica a versão gerada pelo build como uma Release do GitHub.
// Os bots instalados nas farmácias encontram a versão nova e se atualizam sozinhos.
//
// Uso:
//   1. Aumente a "version" no package.json (ex.: 1.0.3 -> 1.0.4)
//   2. npm run build
//   3. node publicar.js "O que mudou nesta versão"
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { version } = require('./package.json');

const notas = process.argv.slice(2).join(' ').trim();
if (!notas) {
  console.error('Diga o que mudou. Ex.: node publicar.js "Corrige o erro ao conectar o WhatsApp"');
  process.exit(1);
}

const pasta = path.join(__dirname, 'dist', 'BotFarmaciaPaes');
const exe = path.join(pasta, 'BotFarmaciaPaes.exe');
if (!fs.existsSync(exe)) {
  console.error('Não encontrei dist\\BotFarmaciaPaes\\BotFarmaciaPaes.exe. Rode "npm run build" antes.');
  process.exit(1);
}

// Zip para instalação manual (primeira instalação numa farmácia nova); sem a pasta "dados"
const zip = path.join(__dirname, 'dist', `BotFarmaciaPaes-v${version}.zip`);
fs.rmSync(zip, { force: true });
const itens = fs.readdirSync(pasta).filter((n) => n !== 'dados').map((n) => `'${path.join(pasta, n).replace(/'/g, "''")}'`);
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Compress-Archive -Path ${itens.join(',')} -DestinationPath '${zip.replace(/'/g, "''")}'`], { stdio: 'inherit' });

console.log(`Publicando a versão ${version}...`);
execFileSync('gh', ['release', 'create', `v${version}`, exe, zip,
  '--title', `Versão ${version}`, '--notes', notas], { stdio: 'inherit' });
console.log(`\nPronto! Os bots vão se atualizar para a versão ${version} sozinhos.`);
