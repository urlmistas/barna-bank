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

Comandos: `/resumo`, `/atrasados`, `/semana`, `/saldo`, `/pendentes`, `/ajuda`.
Todo dia às 9h o bot avisa o que vence no dia e o que está atrasado.

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
- As fotos de comprovante **não** vão para a nuvem; ficam só no aparelho (e no backup .json).
- Se dois aparelhos mexerem ao mesmo tempo, vale o último que salvar. As mensagens do bot nunca se perdem: ficam na fila até um app aplicar.
- Para trocar o dono do bot, apague a chave `owner` no KV `barnabank-data` (Cloudflare → Storage → KV).
