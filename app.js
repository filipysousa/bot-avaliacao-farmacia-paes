// Ponto de entrada (node app.js ou BotFarmaciaPaes.exe)
// Mantém o bot sempre ligado: se ele cair, religa sozinho.
// No .exe o programa roda invisível (sem janela). Para abrir o painel, basta abrir o .exe de novo.
process.noDeprecation = true; // esconde avisos técnicos das bibliotecas
const path = require('path');
const { spawn } = require('child_process');

let ehExe = false;
try { ehExe = require('node:sea').isSea(); } catch { /* rodando com node */ }
process.env.BOT_DIR = ehExe ? path.dirname(process.execPath) : __dirname;
process.chdir(process.env.BOT_DIR);

// Sem janela, não há onde escrever: ignora erros de saída (o registro vai para dados\registro.log)
for (const s of [process.stdout, process.stderr]) s?.on?.('error', () => {});

// Aberto pelo Windows ao ligar o computador: não abre o navegador
if (process.argv.includes('--segundo-plano')) process.env.SEM_NAVEGADOR = '1';

if (process.argv.includes('--worker')) {
  require('./src/main.js');
} else {
  process.title = 'Bot de Avaliação - Farmácia Paes';
  if (!ehExe) {
    console.log('Bot de Avaliação - Farmácia Paes (modo de teste)');
    console.log('Mantenha esta janela aberta. Para desligar o bot, feche-a.\n');
  }
  const filho = ehExe ? [] : [path.join(__dirname, 'app.js')];
  let reinicios = 0;
  const ligar = () => {
    const env = { ...process.env, ...(reinicios ? { BOT_REINICIO: '1' } : {}) };
    const p = spawn(process.execPath, [...filho, '--worker'], {
      stdio: ehExe ? 'ignore' : 'inherit',
      env,
      windowsHide: true,
    });
    p.on('exit', (codigo) => {
      if (codigo === 0) process.exit(0); // desligado de propósito (ou já estava aberto)
      if (codigo === 75 && ehExe) {
        // Atualização instalada (src/atualizador.js): o .exe com este nome agora é a versão nova.
        // Abre a versão nova em segundo plano e este processo (versão velha) sai.
        spawn(process.execPath, ['--segundo-plano'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        setTimeout(() => process.exit(0), 500);
        return;
      }
      reinicios++;
      if (!ehExe) console.log('\nO bot parou. Religando em 10 segundos...\n');
      setTimeout(ligar, 10000);
    });
  };
  ligar();
}
