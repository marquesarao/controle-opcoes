# Controle de Opções

App pessoal para acompanhar operações com opções (travas, compra de calls e puts), com controle de
capital, tamanho das operações, payoff e resultado por estratégia.

- **App:** página única (`index.html`, HTML + CSS + JS puro), publicada no GitHub Pages.
- **Dados:** numa planilha Google sua, lida e gravada por um Apps Script publicado como App da Web
  ([`apps-script/Code.gs`](apps-script/Code.gs)).

> **Segurança:** este repositório é público. Nenhum dado nem segredo fica no código. A URL do App
> da Web e o token ficam só no `localStorage` de cada aparelho; o token também fica nas
> Propriedades do script (no Google). Ordens, valores e o token da brapi ficam na planilha, que é
> privada.

## Como os dados ficam na planilha

| Aba | Para quê |
|---|---|
| `_dados` | Fonte da verdade: o documento JSON do app, em pedaços, com a versão em B1. **Não edite.** |
| `_backups` | Um backup por dia (como os dados estavam antes da primeira gravação do dia), últimos 60 dias. |
| `Ordens`, `Aportes`, `Travas` | Cópias legíveis, refeitas a cada gravação. Só para consulta: editar nelas não muda o app. |

Se dois aparelhos gravarem ao mesmo tempo, o segundo é avisado ("Os dados mudaram em outro
aparelho") e escolhe recarregar ou gravar por cima. Ao voltar para o app, ele confere se a planilha
mudou e se atualiza sozinho.

---

## 1. Criar a planilha e a API

1. No Google Drive, crie uma planilha nova chamada **Controle de Opções**.
2. Na planilha: **Extensões → Apps Script**. O script fica vinculado à planilha.
3. Em `Código.gs`, apague o conteúdo e cole **todo** o [`apps-script/Code.gs`](apps-script/Code.gs).
   Salve (Ctrl+S). Opcional: renomeie o projeto para "Controle de Opções API".

### 1.1 Rodar `setupSheets()`

No seletor de função (ao lado de **Depurar**), escolha `setupSheets` e clique em **Executar**.

Na primeira vez o Google pede autorização:

1. **Revisar permissões** → escolha a sua conta.
2. **"O Google não verificou este app"** → **Avançado** → **Acessar … (não seguro)**. É seguro: o
   "app" é o seu próprio script.
3. **Permitir**. O script declara `@OnlyCurrentDoc`: ele só enxerga esta planilha.

Devem aparecer as abas `_dados` e `_backups`.

### 1.2 Rodar `setupToken()`

Escolha `setupToken` e **Executar**. O **Registro de execução** mostra o token (64 caracteres).
Copie e guarde no gerenciador de senhas. Para ver de novo: **Configurações do projeto**
(engrenagem) → **Propriedades do script** → `TOKEN`. Se o token vazar, rode `trocarToken()`.

### 1.3 Testar: `testarApi()`

Escolha `testarApi` e **Executar**. Deve terminar em **"Todos os testes passaram"**.

### 1.4 Publicar como App da Web

1. **Implantar → Nova implantação** → tipo **App da Web**.
2. **Executar como:** Eu. **Quem pode acessar:** Qualquer pessoa.
   (Sem o token ninguém lê nem grava nada.)
3. **Implantar** e copie a **URL do App da Web** (termina em `/exec`).

Ao mudar o `Code.gs` depois: **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova
versão → Implantar**. Assim a URL continua a mesma.

## 2. Primeiro acesso no app

1. Abra o app (endereço do GitHub Pages deste repositório).
2. Cole a **URL do App da Web** e o **token** e clique em **Conectar**.
3. A planilha está vazia: clique em **Enviar opcoes.json** e escolha o arquivo que você usava no
   computador. Pronto: os dados passam a ficar na planilha.

Em cada aparelho novo (celular, outro computador), basta o passo 2. No celular, use **Adicionar à
tela inicial** para abrir como app.

## 3. Sem internet

O app guarda no aparelho uma cópia dos últimos dados. Sem internet ele abre com essa cópia
(o cabeçalho mostra **Offline · dados de …** com uma faixa laranja) e o que você alterar fica
guardado no aparelho e é enviado sozinho quando a conexão voltar. Se outro aparelho tiver gravado
nesse meio-tempo, o app avisa e você escolhe recarregar ou gravar por cima. Cotações dependem de
internet: offline, valem as últimas buscadas.

## 4. Backups

- Automáticos, na aba `_backups`: um por dia, últimos 60 dias.
- No app: **Configurações → Planilha e backups → Ver backups → Restaurar**.
- **Baixar cópia (.json)** guarda uma cópia completa no aparelho, no mesmo formato do antigo
  `opcoes.json`.
