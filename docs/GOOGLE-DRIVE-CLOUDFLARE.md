# Pasta PDFs existente — Google Drive e Cloudflare Free

Frontend: [GitHub Pages](https://thilanguis.github.io/Manual-de-Boardgame/). Login e permissões: Firebase Authentication/Firestore no Spark. Arquivos: a pasta privada [PDFs](https://drive.google.com/drive/folders/1XUgXOYRigMaYuNMbFVcjDp6obEp4r7wR), ID `1XUgXOYRigMaYuNMbFVcjDp6obEp4r7wR`. Backend: Cloudflare Workers Free.

O proprietário concluiu a autorização OAuth local desta pasta existente. O assistente validou ID, propriedade e permissões e gravou os secrets diretamente no Worker, sem criar outra pasta. A API publicada é `https://acervo-drive-api.acervo-boardgames.workers.dev`, configurada em `fileStorage.apiBase`; o endpoint `/health` confirmou os bindings de conexão. Isso ainda **não** comprova um upload real ou leitura em outro dispositivo: a validação da seção 5 permanece obrigatória.

## 1. Google Cloud

No [Google Cloud Console](https://console.cloud.google.com/), selecione `manual-de-boardgame` ou um projeto dedicado, sem conta de faturamento.

1. Habilite **Google Drive API** e **Google Picker API** em APIs & Services → Library. Ambas são necessárias: consentimento OAuth e Picker habilitado não substituem a Drive API. Ela foi habilitada neste projeto sem ativar faturamento. Uma Drive API desativada pode retornar 403 após o consentimento.
2. Em Google Auth platform → Branding, defina nome Acervo, e-mail de suporte e contato.
3. Audience: **External**. Adicione o proprietário como test user durante a preparação; antes da autorização definitiva, mude para **Production**. Testing com Drive emite refresh tokens que expiram em sete dias.
4. Data Access: somente `https://www.googleapis.com/auth/drive.file` para Drive. Não conceda `drive`, `drive.readonly` ou outros escopos mais amplos.
5. Clients: OAuth de tipo **Web application**, Authorized redirect URI `http://localhost:4180/oauth/callback`. Cadastre também `http://localhost:4180` como Authorized JavaScript origin para o Picker local.
6. Baixe o JSON privado do cliente e guarde fora do repositório. Não cole seu conteúdo no chat.
7. Crie uma **API key pública de navegador** para o Picker, no mesmo projeto do cliente OAuth. Restrinja aplicações a Websites/HTTP referrers `http://localhost:4180/*` e `https://docs.google.com/*`, pois o Picker é renderizado num iframe desse domínio. Restrinja APIs a **Google Picker API**; as chamadas à Drive API são feitas pelo servidor local, sem essa chave. Essa chave não é o client secret. Não reutilize uma chave restrita que não autorize Picker. [Configuração oficial do Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker).

A chave Picker é separada da chave Firebase em `config/app-config.js`. As restrições exclusivas do Picker não devem substituir os endereços autorizados da chave Firebase.

[Escopos recomendados](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample), [OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server), [expiração de tokens](https://developers.google.com/identity/protocols/oauth2).

## 2. Cloudflare Workers Free

Crie/use sua conta Cloudflare com **Workers Free**, sem contratar plano adicional. Na raiz do projeto:

```powershell
npm --prefix worker ci
node worker/node_modules/wrangler/bin/wrangler.js login --scopes account:read user:read workers:write workers_scripts:write workers_routes:write
npm --prefix worker run check
npm --prefix worker test
npm --prefix worker run build
npm --prefix worker run deploy
```

O build é um dry-run; a última linha publica a versão inicial. Ela não acessa Drive sem os secrets. Confira `worker/wrangler.jsonc`: projeto `manual-de-boardgame`, proprietário `7TitBObtb8a0W8GisSstSM1RHiX2`, origens localhost e `https://thilanguis.github.io`. A origem não inclui `/Manual-de-Boardgame/`. O Worker não depende de R2, KV, D1 ou Firebase Functions.

## 3. Autorização local da pasta existente

Execute com seu caminho privado, e-mail proprietário e chave pública Picker:

```powershell
node scripts/connect-drive.mjs --client-file "C:\CAMINHO-PRIVADO\client_secret.json" --owner-email "PROPRIETARIO@gmail.com" --picker-key "CHAVE_PUBLICA_PICKER" --worker-config worker/wrangler.jsonc
```

O helper usa state, PKCE e callback local. Abra o link informado e autentique somente a conta Google que possui o espaço Google One. Ele confirma o e-mail pelo Drive. Não cria nenhuma pasta.

Se `drive.file` já permite consultar a pasta PDFs, o helper valida diretamente. Caso contrário, apresenta Google Picker na página **local** `http://localhost:4180/picker`; selecione a pasta PDFs com o ID exato. O Picker é limitado a esse ID e o servidor rejeita qualquer outro alvo. Essa seleção concede acesso explícito ao cliente da aplicação.

Foi autorizada pelo proprietário uma exceção exclusiva para o Picker local: o assistente entrega um **access token temporário** ao Picker, apenas durante essa configuração. Refresh token e client secret nunca vão ao navegador. Nenhum token Google vai ao site público, aos subadministradores, à PWA ou ao GitHub. A tela local não persiste tokens; endpoints exigem origem local e nonce, sem CORS público. O código de autorização sai da URL por redirecionamento antes da seleção.

Depois da seleção, o helper confere proprietário, ID, tipo, situação, permissão para adicionar e ausência de compartilhamento público. Preserva nome, organização, compartilhamento e appProperties anteriores; adiciona apenas a marca do projeto à pasta. Arquivos existentes sem vínculo ao catálogo não são importados automaticamente.

O script envia por stdin ao Wrangler os secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `DRIVE_FOLDER_ID`, `DRIVE_OWNER_EMAIL` e `TICKET_KEY`, sem imprimir valores privados ou gravá-los no repositório. O Worker recusa outro Folder ID, mesmo se alguém configurar esse binding incorretamente. [Secrets Cloudflare](https://developers.cloudflare.com/workers/configuration/secrets/).

Revogação, expiração ou troca do cliente podem exigir nova autorização; não há ampliação silenciosa do escopo. Reconectar gera nova chave de tickets e invalida sessões de upload pendentes; cadastros e arquivos já vinculados permanecem.

## 4. Conectar o site

```powershell
npm --prefix worker run deploy
```

Use a URL HTTPS real informada pelo Wrangler em `config/app-config.js`:

```js
fileStorage: { provider: 'drive', apiBase: 'https://acervo-drive-api.SEU-SUBDOMINIO.workers.dev' },
```

Faça build e publique pelo workflow GitHub Pages. Não coloque secrets no objeto público. O Worker valida assinatura/projeto/prazo do token Firebase e consulta `users/{uid}` no Firestore a cada operação. `pending`, `rejected`, `blocked` e perfil comum não autorizam uploads. Subadmins precisam de addGames/editGames; exclusão definitiva exige superadmin com o UID fixado.

Todos os uploads usam OAuth do proprietário, não o Drive do subadministrador. PDFs e capas são criados na mesma pasta e pertencem à conta proprietária, usando seu armazenamento Google One. A API confere pasta, proprietário, projeto, jogo e tipo antes de leitura, substituição ou exclusão.

O limite local para novos uploads é de 50 MiB (52.428.800 bytes) por PDF, tanto no cadastro quanto na substituição e nos documentos adicionais. A leitura de registros antigos maiores permanece disponível. Frontend, Worker e regras Firestore devem ser publicados juntos, após autorização. [Testes e limites de memória](UPLOAD-200-MIB.md).

Uploads são retomáveis em blocos de 8 MiB; a URL da sessão Google fica em ticket criptografado. Reabrir e selecionar o mesmo PDF pode retomar a sessão pendente dentro da validade. O catálogo é salvo antes de remover arquivos substituídos. Exclusões usam marcação e controle de versão antes de apagar arquivos. Falhas podem ser retomadas.

Visitantes leem arquivos públicos pelo proxy, com Range para PDF.js e sem login Google. Não compartilhe a pasta como “qualquer pessoa com o link”. A PWA não armazena todos os PDFs em lote.

Se o PDF for removido diretamente no Drive, a biblioteca o oculta após verificar a disponibilidade ao abrir, voltar ao site ou clicar em **Atualizar biblioteca**. O Drive não envia uma notificação instantânea para esta página. A verificação é somente de leitura, em lotes de até 20 jogos, respeitando a autorização real do Firestore; falhas temporárias não são tratadas como exclusões. Não há consulta contínua em segundo plano. Cada conferência consome leituras do Firestore e requisições das APIs dentro das cotas gratuitas.

Administradores com edição ou exclusão encontram esses registros em **Cadastros que precisam de atenção**, para substituir o PDF ou excluir o cadastro. Restaurar o mesmo PDF no Drive o disponibiliza na próxima conferência. Remover somente a capa mantém o jogo legível com uma imagem substituta. O estado de disponibilidade é derivado e não modifica documentos no Firestore.

A exclusão pelo proprietário conclui mesmo quando o PDF já está na lixeira ou foi removido definitivamente. Arquivos já na lixeira não são apagados definitivamente por essa limpeza; referências que não pertencem à pasta, ao proprietário e ao jogo são preservadas, com aviso. O cadastro só é removido com as permissões efetivas do superadmin, e erros temporários permitem tentar novamente.

## 5. Validação real obrigatória

A conexão não está concluída somente porque o build ou testes simulados passaram. Após autorizar e publicar:

1. Entre no Pages como proprietário; adicione um PDF real e confirme cadastro.
2. Confira no Drive que PDF e capa chegaram à pasta **PDFs** exata e pertencem à conta Google One.
3. Abra o manual em outro navegador/celular sem login.
4. Teste substituição, retomada e exclusão pelo proprietário.
5. Teste subadmin com flags restritas e bloqueio durante uma sessão; usuário comum/sem cargo não pode enviar pela API.

Os testes automatizados existentes verificam tickets, identidade, autorização, pasta, concorrência, simulação do helper local e regras. Eles não comprovam envio real para essa pasta. Sem OAuth/Cloudflare disponíveis, esse teste deve ser reportado como pendente.

## 6. Custos e limites

A arquitetura usa Firebase Spark, GitHub Pages público e Workers Free, com o Google One já contratado. Não ativa Blaze nem cadastra faturamento. Todos têm cotas; não há capacidade ilimitada.

Workers Free: 100.000 requisições/dia, 10 ms de CPU/requisição e 128 MB. O upload é encaminhado em streaming; blocos de 8 MiB ficam abaixo do limite de body. Verificação JWT e criptografia precisam ser medidas no Worker publicado para confirmar o consumo real. [Limites](https://developers.cloudflare.com/workers/platform/limits/).

O uso padrão da Drive API não tem custo adicional dentro das quotas. A documentação atual anuncia cobrança por excessos mais tarde em 2026, com aviso prévio; mantenha o projeto sem billing e confira suas quotas. Google One amplia armazenamento, não remove limites da API. [Quotas Drive](https://developers.google.com/workspace/drive/api/guides/limits).

Não há quota individual nem limpeza automática de arquivos completos abandonados antes de vincular ao catálogo. Esses arquivos podem ocupar espaço na pasta central. Pessoas autorizadas podem consumir o espaço central; rebaixar/bloquear impede novas operações.

## 7. BGG opcional

BGG permanece desativado até aprovação da aplicação e instalação de `BGG_TOKEN` como secret do Worker. Não requer Firebase Functions. Extração do texto do PDF, revisão e capa da primeira página funcionam sem BGG. [Guia oficial BGG](https://boardgamegeek.com/using_the_xml_api).
