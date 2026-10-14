# Google Drive central, Cloudflare Worker e GitHub Pages

O Acervo usa o espaço do Google Drive pessoal do proprietário, incluindo a capacidade já contratada no Google One. O frontend está publicado no [GitHub Pages](https://thilanguis.github.io/Manual-de-Boardgame/); Firebase Spark mantém login, catálogo e permissões; um Cloudflare Worker Free faz a ponte com o Drive quando a conexão OAuth estiver configurada. PDFs e capas ficam privados no Drive e são lidos pelo proxy conforme a política da biblioteca.

A interface também está publicada no [host Firebase de transição](https://manual-de-boardgame.web.app), com regras Firestore compiladas e índices publicados. O perfil proprietário já tem `enabled: true`/`role: 'admin'`, e `thilanguis.github.io` foi autorizado no Firebase. Pages foi publicado pelo [workflow 38611621664](https://github.com/Thilanguis/Manual-de-Boardgame/actions/runs/38611621664), concluído com sucesso. Chrome anônimo no Pages carregou SDK, PWA e catálogo sem erros, exibiu o botão Google, ocultou senha e permitiu a consulta pública restrita. A validação Firebase negou catálogo irrestrito/coleção `admins`. Provider Google/vinculação ainda não foram verificados; Cloudflare e OAuth Drive ainda não foram autenticados. A integração de arquivos depende desses passos, dos secrets no Worker, do deploy e da URL no frontend.

## 1. Preparar o Google Cloud

Use o [Console Google Cloud](https://console.cloud.google.com/) e selecione o projeto `manual-de-boardgame`, ou um projeto dedicado à integração Drive. Para essa integração, habilite **Google Drive API** em APIs & Services → Library. Mantenha o projeto sem conta de faturamento; não habilite produtos pagos. Os serviços Firebase já usados pela aplicação continuam independentes dessa autorização.

Em Google Auth platform:

1. **Branding:** informe nome “Acervo”, e-mail de suporte e contato do responsável.
2. **Audience:** escolha **External** para uma conta Google pessoal. Durante os testes, adicione o e-mail proprietário em Test users. Antes da autorização definitiva, altere o publishing status para **Production / In production**.
3. **Data Access:** adicione somente `https://www.googleapis.com/auth/drive.file` para acesso ao Drive. É um escopo não sensível, restrito aos arquivos criados ou autorizados para essa aplicação. Siga as exigências básicas de Branding/verification apresentadas pelo Console; não amplie para acesso a todo o Drive.
4. **Clients:** crie um OAuth client de tipo **Web application**, com Authorized redirect URI exatamente `http://localhost:4180/oauth/callback`. Esse callback pertence ao script local de conexão, não ao site no GitHub Pages.
5. Baixe o JSON do client quando for criado. Guarde-o fora do repositório e de `public/`, em um local privado do computador. Ele contém `client_secret`; não deve ser anexado a commits nem publicado no frontend.

Guias oficiais: [configurar consentimento OAuth](https://developers.google.com/workspace/guides/configure-oauth-consent), [escopos do Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) e [client web, callback local e proteção do JSON](https://developers.google.com/identity/protocols/oauth2/web-server).

**Por que Production:** OAuth External em Testing, com escopo Drive, emite refresh tokens que expiram em sete dias. Mudar para Production evita essa expiração específica; não torna o token permanente. Revogação do consentimento, políticas da conta e outras condições podem exigir reconexão. [Ciclo de vida dos tokens Google](https://developers.google.com/identity/protocols/oauth2).

## 2. Preparar o Worker Free

Crie uma conta Cloudflare e mantenha **Workers Free**. Use Node.js 22 ou superior. Na raiz do Acervo:

```powershell
npm --prefix worker install
node worker/node_modules/wrangler/bin/wrangler.js login
npm --prefix worker run check
npm --prefix worker test
npm --prefix worker run build
```

O build do Worker é um dry-run do Wrangler; prepara `.build/` sem publicar. Revise `worker/wrangler.jsonc`:

```json
{
  "name": "acervo-drive-api",
  "main": "src/index.js",
  "compatibility_date": "2026-10-14",
  "workers_dev": true,
  "vars": {
    "FIREBASE_PROJECT_ID": "manual-de-boardgame",
    "OWNER_UID": "7TitBObtb8a0W8GisSstSM1RHiX2",
    "ALLOWED_ORIGINS": "http://localhost:4173,http://localhost:4174,https://thilanguis.github.io,https://manual-de-boardgame.web.app,https://manual-de-boardgame.firebaseapp.com",
    "MAX_PDF_BYTES": "52428800"
  }
}
```

A origem `https://thilanguis.github.io` já está preparada em `ALLOWED_ORIGINS`. O frontend publicado está em `https://thilanguis.github.io/Manual-de-Boardgame/`; a origem CORS não inclui o caminho `/Manual-de-Boardgame/`. O host Firebase temporário continua autorizado durante a transição. CORS limita chamadas de navegadores; a autorização dos dados depende da validação de tokens e das permissões no servidor.

Não coloque refresh token, client secret ou token BGG em `vars`. Eles ficam em bindings secretos do Worker. [Secrets do Cloudflare](https://developers.cloudflare.com/workers/configuration/secrets/).

Depois de conferir a configuração, publique uma versão inicial para criar o Worker antes de instalar os secrets:

```powershell
npm --prefix worker run deploy
```

As operações Drive ficam indisponíveis enquanto faltarem os bindings. Essa primeira publicação evita um prompt de criação do Worker durante o envio dos secrets por stdin. Após a conexão do próximo passo, faça a publicação final indicada no passo 4.

## 3. Autorizar o Drive do proprietário

Na raiz do projeto, execute o script com o caminho real do JSON privado e o e-mail da conta que possui o espaço Google One:

```powershell
node scripts/connect-drive.mjs --client-file "C:\CAMINHO-PRIVADO\client_secret.json" --owner-email "PROPRIETARIO@gmail.com" --worker-config worker/wrangler.jsonc
```

O script prepara um callback local em `localhost:4180`, gera o endereço de autorização com state e PKCE, solicita consentimento/acesso offline e troca o código pelos tokens. Abra o endereço informado e confira que a conta selecionada é a proprietária do Drive. A senha é digitada na página do Google. O script confirma o e-mail pelo serviço Drive, cria a pasta da aplicação com esse mesmo client OAuth e instala os bindings pelo Wrangler, enviando os valores por stdin. Código/tokens ficam em memória durante a conexão; o helper não imprime os valores secretos nem grava credenciais no repositório.

| Binding                | Conteúdo/finalidade                              |
| ---------------------- | ------------------------------------------------ |
| `GOOGLE_REFRESH_TOKEN` | Renova o acesso ao Drive do proprietário.        |
| `GOOGLE_CLIENT_ID`     | Identifica o client OAuth autorizado.            |
| `GOOGLE_CLIENT_SECRET` | Credencial confidencial do client web.           |
| `TICKET_KEY`           | Chave aleatória para proteger tickets de upload. |
| `DRIVE_FOLDER_ID`      | Pasta central criada pela aplicação.             |
| `DRIVE_OWNER_EMAIL`    | Conta Google dona da biblioteca de arquivos.     |

Folder ID e owner email são identificadores, não credenciais de acesso; ficam no backend para manter a configuração central. Nenhum desses bindings precisa estar no frontend. Wrangler pode publicar uma nova versão ao instalar um secret; conclua a publicação do código depois que todos forem configurados.

`drive.file` não dá acesso automático a uma pasta qualquer já existente no Drive. Use a pasta criada pela aplicação com esse client. Trocar o client OAuth pode exigir nova autorização dos arquivos; reconectar não migra automaticamente uma biblioteca de outro client.

Todos os uploads usam o OAuth do proprietário, inclusive quando um subadministrador os envia pelo Acervo. Portanto os arquivos usam o espaço dessa conta. Subadministradores não autorizam o próprio Drive nem recebem o refresh token central. Não há quota individual nem limpeza automática de uploads completos abandonados antes de salvar o cadastro; esses arquivos podem continuar na pasta do Acervo sem referência no catálogo. A conta Google do Drive e a conta Firebase que identifica o administrador têm funções diferentes.

## 4. Publicar o backend e conectar o frontend

```powershell
npm --prefix worker run deploy
```

O Wrangler informa a URL HTTPS, por exemplo `https://acervo-drive-api.SEU-SUBDOMINIO.workers.dev`. Em `config/app-config.js`, preencha:

```js
fileStorage: {
  provider: 'drive',
  apiBase: 'https://acervo-drive-api.SEU-SUBDOMINIO.workers.dev',
},
enableBgg: false,
```

Use a URL real da sua conta, sem o exemplo literalmente. `apiBase` vazia significa backend Drive ainda não conectado; os dados de configuração, isoladamente, não autorizam uploads. Depois da alteração, reconstrua/publice o frontend.

O navegador envia o ID token Firebase nas operações privadas. O Worker verifica assinatura RS256, issuer/audience do projeto, validade e UID, e consulta `admins/{uid}` no Firestore para conferir `enabled`, papel e permissão da operação. Requisições de upload são divididas em blocos de 8 MiB e encaminhadas em streaming para sessões resumíveis do Drive. Tickets criptografados com AES são vinculados ao UID, jogo e validade; eles não substituem o login nem a autorização da operação. Não há motivo para entregar o access token Google ou a URL de sessão Drive ao frontend. Veja o [protocolo resumível do Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads) e a [validação de ID tokens Firebase](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

Os PDFs não são copiados para o GitHub ou para o cache da PWA em lote. O catálogo guarda as referências dos arquivos no Drive; o proxy só entrega os arquivos permitidos pela biblioteca. O guia [FIREBASE.md](FIREBASE.md) detalha administradores, subadministradores e leitura pública.

## 5. Preservar o administrador ao habilitar login Google

No Firebase Authentication → Sign-in method, habilite Google. A ativação desse provider e a vinculação ainda estão pendentes e não foram verificadas. O domínio `thilanguis.github.io` já foi adicionado aos Authorized domains, preservando os existentes. A conta administrativa usa o UID `7TitBObtb8a0W8GisSstSM1RHiX2`, com perfil `enabled: true`/`role: 'admin'`; esse identificador precisa continuar associado ao proprietário.

Para vincular Google, acesse `https://manual-de-boardgame.web.app` ou localhost com uma versão que ofereça a vinculação. Entre com o e-mail/senha da conta existente, abra **Minha Conta → Vincular Google** e conclua o popup Google. A vinculação com `linkWithPopup` preserva o UID Firebase. Depois, use o botão Google no GitHub Pages. Não crie uma segunda conta esperando que ela herde os privilégios da primeira. [Vincular providers Firebase](https://firebase.google.com/docs/auth/web/account-linking).

O frontend mantém `allowPasswordLogin: true` para o acesso local/host Firebase de transição, mas oculta o formulário de senha em hosts `.github.io`. Assim, no Pages o login Google abre o provider; não se digita senha no formulário do site. O consentimento Drive do passo 3 é separado desse login Firebase.

## 6. GitHub Pages publicado e atualizações

O repositório público é [Thilanguis/Manual-de-Boardgame](https://github.com/Thilanguis/Manual-de-Boardgame), com branch padrão `main`. Pages usa source **GitHub Actions** (`build_type: workflow`), e a primeira publicação foi concluída e verificada em [thilanguis.github.io/Manual-de-Boardgame](https://thilanguis.github.io/Manual-de-Boardgame/). O [workflow 38611621664](https://github.com/Thilanguis/Manual-de-Boardgame/actions/runs/38611621664) terminou com sucesso. Nas atualizações, mantenha JSON OAuth, tokens, arquivos `.env`/`.dev.vars` e manuais fora dos commits.

O workflow da aplicação usa Node.js 22, executa os testes do frontend, gera `public/` e publica um artifact Pages. O frontend continua HTML/CSS/JS puro; as dependências de desenvolvimento e do Worker não precisam ser incluídas no artifact. O Worker é publicado separadamente, pela conta Cloudflare. [Workflows Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

O repositório confirmado é público, modalidade em que GitHub Pages está disponível no GitHub Free. [Disponibilidade do Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages).

`thilanguis.github.io` já está autorizado no Firebase Authentication. A origem `https://thilanguis.github.io` já está configurada no Worker; ela será aplicada ao publicar o backend. A URL completa do app inclui `/Manual-de-Boardgame/`; a origem CORS não inclui esse caminho. A publicação da interface não publica os PDFs privados. O login via provider também evita usar Pages para um formulário que envia senhas, conforme os [limites de uso do Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## 7. Custos, limites e verificação

Mantenha Firebase Spark e Cloudflare Workers Free, sem habilitar faturamento Google Cloud ou contratar novos produtos. O Google One existente fornece a capacidade de armazenamento; arquivos do Acervo competem com os demais dados dessa conta. [Uso do espaço no Drive](https://support.google.com/drive/answer/6374270).

Workers Free oferece 100.000 requisições por dia, 10 ms de CPU por requisição e 128 MB de memória. No plano Cloudflare Free, cada request body aceita até 100 MB; os blocos de 8 MiB ficam abaixo disso. Espera de rede não conta como CPU, mas verificação de tokens, criptografia e processamento precisam caber no limite. O fluxo deve ser medido no Worker publicado; não há garantia de capacidade ilimitada. [Limites oficiais](https://developers.cloudflare.com/workers/platform/limits/).

A Drive API alterou quotas em maio de 2026. Para projetos novos, a documentação apresenta limites por minuto, saída diária de 1 TB e threshold diário de 400 milhões de quota units. O uso padrão não tem custo adicional hoje; cobrança por excessos é anunciada para mais tarde em 2026, com aviso prévio. Confira as quotas reais do seu projeto e mantenha-o sem billing. Google One não remove as quotas da API. [Quotas e cobrança anunciada do Drive](https://developers.google.com/workspace/drive/api/guides/limits).

Depois de conectar, valide um PDF real: upload, capa, gravação do catálogo e leitura em outro dispositivo; subadministrador com add/edit e sem delete; bloqueio de usuário sem função; leitura anônima somente dos jogos `isPublic: true` quando a publicação global está desligada e de todos os disponíveis quando `settings/library.publicRead: true`; cancelamento e retomada de upload; instalação PWA. Jogos em exclusão devem ficar ocultos dos visitantes. Os comandos deste guia não comprovam que essa validação externa já ocorreu.

## 8. BoardGameGeek opcional

O mesmo Worker pode consultar BGG; não há Firebase Cloud Function para isso. Após aprovação da aplicação BGG, instale `BGG_TOKEN` como secret por prompt:

```powershell
node worker/node_modules/wrangler/bin/wrangler.js secret put BGG_TOKEN --config worker/wrangler.jsonc
```

Ative `enableBgg` somente após configurar o token/backend. O endpoint padrão é `${fileStorage.apiBase}/v1/bgg`, com possibilidade de override por `bggEndpoint`. O token nunca vai ao frontend. Registro/aprovação, limites e crédito BGG continuam obrigatórios. Consulte o [guia de acesso BGG](https://boardgamegeek.com/using_the_xml_api) e os [termos do XML API](https://boardgamegeek.com/wiki/page/XML_API_Terms_of_Use).

Sem BGG, a importação usa o texto presente no PDF e a primeira página como capa. Campos sem informação ficam vazios para revisão; não há OCR nem geração por IA.
