// Gera a pasta dist/BotFarmaciaPaes com o executável pronto para levar à farmácia.
// Uso: node build.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const SAIDA = path.join(__dirname, 'dist', 'BotFarmaciaPaes');
const TMP = path.join(__dirname, 'dist', 'tmp');
fs.rmSync(path.join(__dirname, 'dist'), { recursive: true, force: true });
fs.mkdirSync(SAIDA, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

console.log('1/3 Empacotando o código...');
(async () => {
await esbuild.build({
  entryPoints: [path.join(__dirname, 'app.js')],
  outfile: path.join(TMP, 'app.bundle.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  plugins: [modulosOpcionais()],
});

// Dependências opcionais que o bot não usa: viram módulos "vazios" dentro do .exe.
// fluent-ffmpeg é carregado sempre pelo whatsapp-web.js (só serve para figurinhas) -> objeto vazio.
// As outras são carregadas dentro de try/catch -> lançam erro, como se não estivessem instaladas.
function modulosOpcionais() {
  const vazios = ['fluent-ffmpeg'];
  const ausentes = ['bufferutil', 'utf-8-validate', 'sharp', 'canvas', 'archiver', 'unzipper', 'typescript'];
  const filtro = new RegExp(`^(${[...vazios, ...ausentes].join('|')})$`);
  return {
    name: 'modulos-opcionais',
    setup(build) {
      build.onResolve({ filter: filtro }, (a) => ({ path: a.path, namespace: 'opcional' }));
      build.onLoad({ filter: /.*/, namespace: 'opcional' }, (a) => ({
        contents: vazios.includes(a.path)
          ? 'const f = () => { throw new Error("ffmpeg indisponível"); }; f.setFfmpegPath = () => {}; module.exports = f;'
          : `throw new Error("Módulo opcional '${a.path}' não incluído");`,
        loader: 'js',
      }));
    },
  };
}

console.log('2/3 Gerando o executável...');
const seaConfig = path.join(TMP, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: path.join(TMP, 'app.bundle.js'),
  output: path.join(SAIDA, 'BotFarmaciaPaes.exe'),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  // Telas do painel embutidas no .exe
  assets: Object.fromEntries(['index.html', 'app.js', 'style.css', 'icone.svg']
    .map((n) => [n, path.join(__dirname, 'public', n)])),
}, null, 2));
execFileSync(process.execPath, ['--build-sea', seaConfig], { stdio: 'inherit' });

console.log('3/3 Copiando arquivos...');
fs.copyFileSync(path.join(__dirname, 'LEIA-ME.md'), path.join(SAIDA, 'LEIA-ME.md'));
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\nPronto! Pasta: ${SAIDA}`);
})().catch((e) => { console.error(e); process.exit(1); });
