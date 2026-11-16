// Configurações, avaliações e estado das conversas (arquivos na pasta "dados")
const path = require('path');
const crypto = require('crypto');
const { DIR, DADOS, lerJson, salvarJson } = require('./util');

const ARQ = {
  config: path.join(DADOS, 'config.json'),
  avaliacoes: path.join(DADOS, 'avaliacoes.json'),
  estado: path.join(DADOS, 'estado.json'),
  agenda: path.join(DADOS, 'agenda.json'),
};

const DIA_PADRAO = (inicio, fim, ativo = true) => ({ ativo, inicio, fim });

const PADRAO = {
  nomeFarmacia: 'Farmácia Paes',
  cidade: 'Beberibe',
  porta: 3210,

  pedido: {
    minutosAutomatico: 30,          // minutos de conversa parada para pedir sozinho
    horasEntrePedidos: 12,          // não pedir de novo ao mesmo cliente antes disso
    horasMaximas: 14,               // não pedir sobre conversas mais antigas que isso
    notaMaximaComentario: 6,        // até esta nota o bot pergunta o que melhorar
  },

  horarios: {
    plantao: false,                 // true = pode enviar a qualquer hora
    dias: {
      dom: DIA_PADRAO('08:00', '12:00', false),
      seg: DIA_PADRAO('07:00', '21:00'),
      ter: DIA_PADRAO('07:00', '21:00'),
      qua: DIA_PADRAO('07:00', '21:00'),
      qui: DIA_PADRAO('07:00', '21:00'),
      sex: DIA_PADRAO('07:00', '21:00'),
      sab: DIA_PADRAO('07:00', '18:00'),
    },
  },

  atendentes: [],                   // [{ codigo: 'ana', nome: 'Ana' }]

  google: { ativo: false, link: '', notaMinima: 9 },

  farmaceutico: {
    numero: '',
    apagarAposEnviar: true,         // apaga do WhatsApp da farmácia ("apagar para mim")
    notaBaixa: true,
    comentarios: true,
    notaDez: false,
    resumoDiario: { ativo: false, hora: '21:30' },
    resumoSemanal: { ativo: true, dia: 1, hora: '08:00' },
    linkRemoto: true,
  },

  telegram: { ativo: false, token: '', chatId: '' },

  numerosIgnorados: [],

  backup: { ativo: true, pasta: '', manter: 30 },

  acessoRemoto: { ativo: false },

  mensagens: {
    pedido: 'Olá{nome}! 😊 Aqui é da *{farmacia}*, em {cidade}.\n\nSeu atendimento foi encerrado. De *0 a 10*, que nota você dá para o atendimento que recebeu?\n\nResponda só com o número. Sua opinião ajuda muito a melhorar nosso atendimento! 💚',
    notaInvalida: 'Por favor, responda apenas com um número de *0 a 10*. 😊',
    agradecimento: 'Muito obrigado pela nota *{nota}*! 💚 A {farmacia} agradece a sua confiança. Estamos sempre à disposição!',
    agradecimentoGoogle: 'Muito obrigado pela nota *{nota}*! 💚\n\nSe puder, deixe também sua avaliação no Google. Leva só um minutinho e ajuda muito a {farmacia}:\n{link}',
    pedirComentario: 'Obrigado pela sinceridade. 🙏 Sentimos muito que o atendimento não tenha sido o ideal.\n\nPode nos contar, em poucas palavras, o que podemos melhorar?',
    agradecimentoComentario: 'Obrigado! Sua mensagem foi encaminhada ao farmacêutico responsável. Vamos trabalhar para melhorar. 💚',
  },
};

function ehObjeto(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Completa a configuração salva com os valores padrão (para campos novos)
function mesclar(padrao, atual) {
  if (!ehObjeto(atual)) return structuredClone(padrao);
  const r = {};
  for (const k of Object.keys(padrao)) {
    if (ehObjeto(padrao[k])) r[k] = mesclar(padrao[k], atual[k]);
    else r[k] = atual[k] !== undefined && typeof atual[k] === typeof padrao[k] ? atual[k] : structuredClone(padrao[k]);
  }
  return r;
}

let config = mesclar(PADRAO, lerJson(ARQ.config, {}));
salvarJson(ARQ.config, config);

const avaliacoes = lerJson(ARQ.avaliacoes, []);
for (const a of avaliacoes) if (!a.id) a.id = crypto.randomUUID();

const estado = lerJson(ARQ.estado, {});
const agenda = lerJson(ARQ.agenda, {});

let timerEstado = null;
function salvarEstado() {
  clearTimeout(timerEstado);
  timerEstado = setTimeout(() => salvarJson(ARQ.estado, estado), 1000);
}

module.exports = {
  ARQ, PADRAO, DIR,
  config: () => config,
  // Aplica as alterações por cima da configuração atual (campos ausentes não são apagados)
  salvarConfig(alteracoes) {
    const sobrepor = (base, novo) => {
      if (!ehObjeto(novo)) return base;
      const r = { ...base };
      for (const [k, v] of Object.entries(novo)) r[k] = ehObjeto(v) && ehObjeto(base[k]) ? sobrepor(base[k], v) : v;
      return r;
    };
    config = mesclar(PADRAO, sobrepor(config, alteracoes));
    salvarJson(ARQ.config, config);
    return config;
  },
  avaliacoes,
  salvarAvaliacoes: () => salvarJson(ARQ.avaliacoes, avaliacoes),
  novaAvaliacao(dados) {
    const a = { id: crypto.randomUUID(), data: new Date().toISOString(), comentario: '', ...dados };
    avaliacoes.push(a);
    salvarJson(ARQ.avaliacoes, avaliacoes);
    return a;
  },
  estado,
  salvarEstado,
  salvarEstadoAgora: () => salvarJson(ARQ.estado, estado),
  agenda,
  salvarAgenda: () => salvarJson(ARQ.agenda, agenda),
  nomeAtendente(codigo) {
    if (!codigo) return 'Não identificado';
    const a = config.atendentes.find((x) => x.codigo === codigo);
    return a ? a.nome : codigo;
  },
};
