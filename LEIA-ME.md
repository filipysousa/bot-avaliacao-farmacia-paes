# Bot de Avaliação do Atendimento: Farmácia Paes (Beberibe)

Quando um atendimento no WhatsApp **(85) 99806-1180** termina, o bot pede ao cliente uma **nota de 0 a 10**.
Tudo é controlado por um **painel** que abre no navegador do computador ou no celular.

## Primeiro uso

1. Abra o programa. O painel abre sozinho no navegador (endereço `http://localhost:3210`).
2. **Crie a senha do painel**, com pelo menos 8 caracteres. Isso só pode ser feito no computador da farmácia.
3. Vá em **📱 Conexão** e escaneie o QR code com o celular da farmácia
   (WhatsApp › ⋮ › **Aparelhos conectados** › **Conectar um aparelho**).
4. Em **👥 Atendentes**, cadastre a equipe.
5. Em **🔔 Avisos ao farmacêutico**, coloque o número do farmacêutico e escolha os avisos.

> Deixe a janela preta do programa aberta (pode minimizar). O computador precisa ficar ligado e com internet.
> A equipe continua atendendo normalmente pelo celular.

## Comandos para os atendentes (na conversa do cliente)

| Comando | O que faz |
|---|---|
| `#fim ana` | Encerra, pede a nota na hora e registra que foi a Ana |
| `#ana` | Só marca que a Ana está atendendo (vale para o pedido automático) |
| `#fim` | Encerra sem identificar o atendente |
| `#semnota` | Não pede avaliação nesta conversa (fornecedor, parente…) |

O bot apaga o comando na hora, e o cliente não vê. Se ninguém digitar `#fim`, o bot pede a nota sozinho depois
de **30 minutos** de conversa parada (com a farmácia respondendo por último), dentro do horário configurado.

## Telas do painel

- **📊 Painel**: nota média, NPS, gráfico da evolução, distribuição das notas, ranking por atendente e pedidos aguardando resposta.
- **⭐ Avaliações**: lista com filtros e botão **Exportar para Excel**.
- **⚠️ A resolver**: notas baixas, com botão para abrir a conversa e campo para registrar o que foi feito.
- **📱 Conexão**: QR code do WhatsApp, acesso pelo celular e registro de atividades.
- **💬 Mensagens**: textos enviados ao cliente, com prévia e envio de teste, e o convite para avaliar no Google.
- **👥 Atendentes**, **🔔 Avisos ao farmacêutico** e **⚙️ Configurações**: horários por dia, modo plantão, números ignorados, backup e senha.

## Acesso pelo celular

Em **Conexão**, ligue **Permitir acesso pela internet**. Aparece um endereço `https://….trycloudflare.com` com
um QR code; abra pelo celular e entre com a mesma senha.
**O endereço muda toda vez que o programa reinicia.** Se o aviso "Novo endereço do painel" estiver ligado, o
farmacêutico recebe o novo endereço automaticamente.

## Avisos ao farmacêutico

- Saem do WhatsApp da farmácia e **são apagados de lá logo depois** ("apagar para mim"). Só a mensagem do aviso
  é apagada; o resto da conversa fica como estava. Ela pode aparecer na tela por 1 a 3 segundos.
- **O farmacêutico não deve responder** aos avisos pelo WhatsApp, porque a resposta aparece no celular da farmácia.
- O **Telegram** (opcional) é um canal extra que a equipe nunca vê. É também o único jeito de avisar quando o bot desconecta.

## Problemas comuns

- **WhatsApp desconectou:** vá em Conexão e escaneie o QR code de novo.
- **Esqueci a senha:** feche o programa, apague o arquivo `dados\acesso.json` e abra de novo para criar outra senha.
- **Ligar junto com o computador:** aperte `Win + R`, digite `shell:startup` e coloque ali um atalho do programa.
- **Cuidado:** a conexão com o WhatsApp não é oficial (funciona igual ao WhatsApp Web). Use o bot só para avaliações,
  nunca para disparo em massa, para não arriscar bloqueio do número.

## Para o desenvolvedor

- Rodar em teste: `iniciar.bat` (ou `npm start`). Os dados ficam na pasta `dados`.
- Gerar o executável: `npm run build`, que cria `dist\BotFarmaciaPaes\BotFarmaciaPaes.exe`.
