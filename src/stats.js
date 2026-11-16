// Cálculo de médias, NPS, séries e ranking de atendentes
const store = require('./store');
const { DIA, hojeISO } = require('./util');

function filtrar(lista, f = {}) {
  const busca = (f.busca || '').toLowerCase().trim();
  return lista.filter((a) => {
    const dia = hojeISO(new Date(a.data));
    if (f.de && dia < f.de) return false;
    if (f.ate && dia > f.ate) return false;
    if (f.nota === 'baixas' && a.nota > store.config().pedido.notaMaximaComentario) return false;
    if (f.nota === 'neutras' && (a.nota < 7 || a.nota > 8)) return false;
    if (f.nota === 'altas' && a.nota < 9) return false;
    if (f.atendente && (a.atendente || '') !== (f.atendente === '-' ? '' : f.atendente)) return false;
    if (f.status && a.status !== f.status) return false;
    if (busca && !`${a.nome} ${a.telefone} ${a.comentario}`.toLowerCase().includes(busca)) return false;
    return true;
  });
}

function basico(notas) {
  const total = notas.length;
  const promotores = notas.filter((n) => n >= 9).length;
  const detratores = notas.filter((n) => n <= 6).length;
  return {
    total,
    media: total ? notas.reduce((s, n) => s + n, 0) / total : null,
    nps: total ? Math.round(((promotores - detratores) / total) * 100) : null,
    promotores,
    neutros: total - promotores - detratores,
    detratores,
  };
}

function inicioSemana(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // segunda-feira
  return x;
}

function serie(lista, de, ate) {
  const ini = de ? new Date(`${de}T00:00:00`) : (lista[0] ? new Date(lista[0].data) : new Date());
  const fim = ate ? new Date(`${ate}T23:59:59`) : new Date();
  const dias = (fim - ini) / DIA;
  const tipo = dias <= 35 ? 'dia' : dias <= 200 ? 'semana' : 'mes';

  const chave = (d) => {
    if (tipo === 'dia') return hojeISO(d);
    if (tipo === 'semana') return hojeISO(inicioSemana(d));
    return hojeISO(d).slice(0, 7);
  };

  // Cria todos os períodos (inclusive os vazios) para o gráfico ficar contínuo
  const grupos = new Map();
  const cursor = tipo === 'semana' ? inicioSemana(ini) : new Date(ini);
  cursor.setHours(12, 0, 0, 0);
  if (tipo === 'mes') cursor.setDate(1);
  for (let i = 0; cursor <= fim && i < 400; i++) {
    grupos.set(chave(cursor), []);
    if (tipo === 'dia') cursor.setDate(cursor.getDate() + 1);
    else if (tipo === 'semana') cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const a of lista) {
    const k = chave(new Date(a.data));
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a.nota);
  }
  return {
    tipo,
    pontos: [...grupos.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([periodo, notas]) => ({
      periodo, ...basico(notas),
    })),
  };
}

function porAtendente(lista) {
  const grupos = new Map();
  for (const a of lista) {
    const k = a.atendente || '';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a.nota);
  }
  return [...grupos.entries()]
    .map(([codigo, notas]) => ({ codigo, nome: store.nomeAtendente(codigo), ...basico(notas) }))
    .sort((a, b) => (b.media ?? 0) - (a.media ?? 0));
}

function resumo(f = {}) {
  const lista = filtrar(store.avaliacoes, f);
  const distribuicao = Array.from({ length: 11 }, (_, n) => lista.filter((a) => a.nota === n).length);
  return {
    ...basico(lista.map((a) => a.nota)),
    distribuicao,
    serie: serie(lista, f.de, f.ate),
    atendentes: porAtendente(lista),
    pendentes: store.avaliacoes.filter((a) => a.status === 'pendente').length,
  };
}

module.exports = { filtrar, resumo, basico, porAtendente };
