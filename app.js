// Ponto de entrada (node app.js ou BotFarmaciaPaes.exe)
// Mantém o bot sempre ligado: se ele cair, religa sozinho.
process.noDeprecation = true; // esconde avisos técnicos das bibliotecas
const path = require('path');
const { spawn } = require('child_process');

let ehExe = false;
try { ehExe = require('node:sea').isSea(); } catch { /* rodando com node */ }
process.env.BOT_DIR = ehExe ? path.dirname(process.execPath) : __dirname;
process.chdir(process.env.BOT_DIR);

if (process.argv.includes('--worker')) {
  require('./src/main.js');
} else {
  process.title = 'Bot de Avaliação - Farmácia Paes';
  console.log('Bot de Avaliação - Farmácia Paes');
  console.log('Mantenha esta janela aberta (pode minimizar). Para desligar o bot, feche-a.\n');
  const filho = ehExe ? [] : [path.join(__dirname, 'app.js')];
  let reinicios = 0;
  const ligar = () => {
    const env = { ...process.env, ...(reinicios ? { BOT_REINICIO: '1' } : {}) };
    const p = spawn(process.execPath, [...filho, '--worker'], { stdio: 'inherit', env });
    p.on('exit', (codigo) => {
      if (codigo === 0) process.exit(0);
      reinicios++;
      console.log('\nO bot parou. Religando em 10 segundos...\n');
      setTimeout(ligar, 10000);
    });
  };
  ligar();
}
