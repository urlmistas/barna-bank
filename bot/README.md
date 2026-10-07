# Bot do Telegram + nuvem do BarnaBank

Com o bot, você manda mensagens como estas e elas entram no app:

| Mensagem | O que acontece |
|---|---|
| `Vini me deve 50` | nova dívida: Vini te deve R$ 50 |
| `emprestei 300 pra Larissa em 3x` | empréstimo de R$ 300 em 3 parcelas |
| `devo 80 pro Carlos` | você deve R$ 80 ao Carlos |
| `recebi 20 do Vini` ou `Vini pagou 20` | pagamento do Vini (abate o mais antigo) |
| `paguei 40 pro Carlos` | pagamento do que você deve ao Carlos |
| `gastei 35 mercado no nubank` | gasto de R$ 35 em Mercado, na carteira Nubank |
| `ganhei 150 freela` | entrada de R$ 150 |

| 📎 foto do PIX com a legenda `recebi 50 do Vini` | pagamento com o comprovante anexado |

Toda confirmação tem o botão **Desfazer**: se a mensagem ainda não entrou no app, ela some da fila; se já entrou, sai do app na próxima vez que você abrir.

Comandos:
- `/cobrar` (ou `cobrar Larissa`): mensagem de cobrança pronta para encaminhar, com botão do WhatsApp e o link de cobrança
- `/resumo`, `/atrasados`, `/semana` (próximos 7 dias), `/semanal` (resumo da semana), `/saldo`, `/pendentes`, `/ajuda`
- `/lembretes`: liga ou desliga os avisos

Lembretes: todo dia às 9h o bot avisa o que vence hoje, o que vence amanhã e o que está atrasado. No domingo manda também o resumo da semana (quanto entrou e saiu, onde mais gastou, quem pagou).

### Links de cobrança
Na página de uma pessoa (**Link de cobrança**) ou num grupo (**Link do grupo**), o app cria uma página só de leitura no seu bot: a pessoa vê só o que deve a você (ou o grupo vê quem já pagou), com o seu PIX. Também dá pra gerar o link de **uma dívida só** (botão **Link** dentro da dívida). Os links não expiram: ficam no ar até você desativar, e atualizam sozinhos.

Na página do link a pessoa tem:
- **PIX com o valor certo**: QR Code e "copia e cola" já com o valor (dá pra mudar o valor). Para isso, preencha em Configurações a chave PIX, o tipo da chave, seu nome e sua cidade.
- **Já paguei**: ela informa o valor e manda o print do comprovante. Você recebe no Telegram com os botões **Recebi** / **Não recebi** (ou confirma no app, no aviso do Início). Ao confirmar, o pagamento entra no app com o comprovante. Para evitar spam, cada link aceita até 5 envios por hora.

Você também fica sabendo quando a pessoa abre o link (o bot avisa, no máximo de 6 em 6 horas, e a janela do link no app mostra quantas vezes foi aberto). Pré-visualização do WhatsApp/Telegram não conta.

### Perguntas e áudio
- Pergunte do seu jeito: `quanto gastei com ifood esse mês?`, `quem me deve mais?`, `quanto o Vini já me pagou?`, `quanto eu devo?`, `qual meu saldo?`, `como tá meu orçamento?`.
- Mande **áudio** ("gastei 30 no mercado") e o bot transcreve e lança.
- Perguntas que o bot não reconhece vão para uma IA que responde só com os seus dados (marcada com 🤖; confira no app).

Áudio e IA usam o **Workers AI** da Cloudflare (tem uma cota grátis por dia). Se o resumo da publicação disser que ficou desligado, crie de novo o token da Cloudflare incluindo a permissão **Account → Workers AI → Edit** e rode a publicação de novo.

### Gastos fora do padrão
Se uma categoria passar muito da sua média dos últimos meses (ex.: Lazer 3x maior), aparece um aviso no Início e o bot avisa uma vez no mês.

As mensagens ficam numa fila e entram no BarnaBank quando você abre o app.
O app também guarda uma cópia dos dados na nuvem, então dá para usar em outro aparelho.

## Instalação (uma vez só, dá para fazer pelo celular)

São três contas grátis: Telegram, Cloudflare e o GitHub que você já usa.

### 1. Criar o bot no Telegram
1. Abra o **@BotFather** no Telegram e mande `/newbot`.
2. Escolha um nome (ex.: *BarnaBank do João*) e um usuário terminado em `bot`.
3. Ele responde com um **token** (algo como `123456:ABC...`). Guarde.

### 2. Pegar as chaves da Cloudflare
1. Entre em [dash.cloudflare.com](https://dash.cloudflare.com) (crie a conta se não tiver).
2. Abra **Workers & Pages** pelo menos uma vez (isso cria seu endereço `*.workers.dev`).
3. **Account ID**: aparece na página inicial da conta, na lateral ("Account ID"). Copie.
4. **Token**: clique no seu perfil → **My Profile** → **API Tokens** → **Create Token** →
   modelo **Edit Cloudflare Workers** → *Continue to summary* → *Create Token*. Copie.

### 3. Colocar os segredos no GitHub
No repositório `barna-bank`: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Crie estes 4:

| Nome | Valor |
|---|---|
| `TELEGRAM_TOKEN` | o token do BotFather |
| `CLOUDFLARE_API_TOKEN` | o token da Cloudflare |
| `CLOUDFLARE_ACCOUNT_ID` | o Account ID |
| `SYNC_KEY` | uma senha longa que você inventa (16 caracteres ou mais). Ela protege seus dados. |

### 4. Publicar
1. No repositório: **Actions** → **Publicar bot do Telegram** → **Run workflow**.
2. Quando ficar verde, abra a execução: o resumo mostra o **endereço do bot**
   (ex.: `https://barnabank-bot.seu-nome.workers.dev`).

Depois disso, toda mudança na pasta `bot/` publica sozinha.

### 5. Ligar
1. No Telegram, abra seu bot e mande **/start**. Quem mandar primeiro vira o dono; o bot ignora qualquer outra pessoa.
2. No BarnaBank: **Configurações** → **Nuvem e bot do Telegram** → cole o endereço e a `SYNC_KEY` → **Salvar e sincronizar**.

Pronto. Em outro aparelho, faça só o passo 5.2: o app oferece puxar os dados da nuvem.

## Como funciona e privacidade
- Os dados ficam no **seu** Cloudflare (KV `barnabank-data`), não em servidor de terceiros.
- O app só lê e grava com a `SYNC_KEY`; o webhook do Telegram só aceita chamadas com uma assinatura secreta.
- As fotos de comprovante ficam no aparelho (e no backup .json). As que você manda pelo Telegram passam pela nuvem só até o app pegar, e aí são apagadas de lá.
- Se dois aparelhos mexerem ao mesmo tempo, vale o último que salvar. As mensagens do bot nunca se perdem: ficam na fila até um app aplicar.
- Para trocar o dono do bot, apague a chave `owner` no KV `barnabank-data` (Cloudflare → Storage → KV).

## O bot não responde?
No BarnaBank: **Configurações** → **Nuvem e bot do Telegram** → **Testar bot**. Ele mostra, item por item:
- se o app está falando com a nuvem (e se a `SYNC_KEY` bate);
- se o `TELEGRAM_TOKEN` é válido (e o nome do seu bot);
- se o Telegram está entregando as mensagens (e, se não, o motivo);
- se você já mandou `/start`.

Se a ligação com o Telegram estiver falhando, toque em **Religar bot**. O bot também tenta se religar sozinho toda vez que o app sincroniza e todo dia às 9h.

O caso mais comum: o endereço `*.workers.dev` era novo e levou alguns minutos para entrar no ar, e o Telegram recusou ligar nesse meio-tempo.
