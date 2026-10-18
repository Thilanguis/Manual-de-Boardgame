# Preparação de publicação — Acervo 1.11.0

**Estado: builds e testes locais aprovados; nenhuma publicação autorizada ou executada nesta etapa.**

Este documento separa três ações: commit local, publicação do Worker e push para publicar o frontend. O push não é tratado como publicação do Worker. A integração Git externa da Cloudflare não foi confirmada e, por orientação do proprietário, permanece como pendência. O Worker exige autorização específica.

## 1. Versões observadas em produção

Consultas de 18/10/2026, somente leitura. Horários abaixo em America/New_York, UTC−04:00 nesta data. Respostas originais, hashes e timestamps UTC em `test-output/release-preflight-2026-10-18/`.

| Componente | Estado observado | Alvo preparado |
| --- | --- | --- |
| GitHub Pages | Commit `c6f72f475551777fdb167ebfc9b918745625c130`; workflow [39154508808](https://github.com/Thilanguis/Manual-de-Boardgame/actions/runs/39154508808) concluído com sucesso, iniciado em 18/10 às 14:31:02 | Alterações locais auditadas, sobre esse commit |
| Cache do frontend | `acervo-v1.11.0-firestore-lifecycle-1` | `acervo-v1.11.0-research-real-2` |
| Contrato de pesquisa do frontend | `RESEARCH_VERSION=1.10.0`, protocolo 2 | Versão 1.11.0, protocolo 2, estratégia de consultas 2 |
| Cloudflare Worker | `/health`: API 1.10.0, fileProtocol 2, researchProtocol 2; sem os três protocolos da ficha | API 1.11.0; fileProtocol/researchProtocol preservados em 2 |
| Versão imutável ativa do Worker | `1f2eb25e-6398-4b0e-a036-4183669fe6fa`, 100%; deployment `ecb18589-a2f5-4a71-958f-30fa8dfb3160`, em 17/10 às 14:32:16 | Nova versão, sem substituir recursos ou migração |

O `/health` publicado informa IA configurada e envio autorizado, Drive conectado e projeto `manual-de-boardgame`. Não foram consultados perfis, biblioteca, PDFs, registros Firestore ou Gemini reais nesta preparação.

Os metadados da versão ativa confirmam os nomes dos sete segredos existentes, sem fornecer seus valores. Não há `BGG_TOKEN` nem `LUDOPEDIA_TOKEN` nessa versão: atualizar o código não habilita automaticamente esses catálogos. Wikidata/Wikipédia continuam sendo as fontes públicas sem credenciais. Nenhuma credencial adicional será criada ou alterada neste pacote.

## 2. Escopo local auditado

Existem alterações staged, unstaged e arquivos novos. **Um `git commit` apenas do índice atual deixaria parte das correções de fora.** Após autorização, o staging deve usar a lista explícita do manifesto, reunindo as versões finais desses arquivos; não usar `git add .` indiscriminadamente.

- 29 arquivos de runtime frontend alterados/novos.
- 7 módulos do Worker alterados/novos, além das dependências compartilhadas que o bundler inclui.
- 20 arquivos de testes/fixtures de regressão destinados ao repositório/CI, fora dos artefatos de produção.
- README, cinco relatórios técnicos (incluindo este) e uma ferramenta opt-in de captura pública destinados ao repositório, fora do site/bundle.
- Total com este documento: 63 arquivos locais no manifesto. Nenhum arquivo de credencial/configuração de produção integra as alterações.

### Frontend: arquivos de runtime com mudanças

```text
index.html
service-worker.js
styles/app.css
styles/interface.css
js/app.js
js/draft-profile.js
js/drive-storage.js
js/firebase-repository.js
js/game-identities.js
js/game-steps.js
js/information-flow.js
js/information-identity.js
js/knowledge-model.js
js/knowledge-panel.js
js/metadata-consensus.js
js/metadata-consolidation.js
js/metadata-form.js
js/pdf-profile.js
js/pdf.js
js/preparation-queue.js
js/profile-availability.js
js/profile-facts.js
js/reader.js
js/recognition.js
js/research-contract.js
js/research-enrichment.js
js/research-knowledge.js
js/research-panel.js
js/research-presentation.js
```

O pacote contém ficha Gemini estruturada, rascunho privado antes do cadastro definitivo, reutilização por versão, consolidação de fatos/conflitos, fluxo único, preservação das edições manuais e as correções da pesquisa real de Descent. Inclui também os ajustes anteriores solicitados de ajuste inicial da página PDF e remoção de um item do histórico “Continuar de onde parou”. Não foram acrescentadas funcionalidades nesta preparação; esses dois ajustes são declarados para não entrarem silenciosamente em uma publicação descrita somente como pesquisa/ficha.

### Worker: módulos com mudanças

```text
worker/src/index.js
worker/src/draft-knowledge.js
worker/src/game-knowledge.js
worker/src/manual-knowledge.js
worker/src/catalog/index.js
worker/src/catalog/wikidata.js
worker/src/catalog/wikipedia.js
```

O Worker deve ser publicado a partir da raiz do repositório com o bundler do Wrangler. Ele inclui 62 entradas de dependências, entre elas módulos compartilhados em `js/` e o parser de `backend/`; **não basta copiar os sete arquivos isoladamente para o painel**.

### O que fica fora da publicação

O build frontend contém somente `index.html`, `service-worker.js`, `manifest.webmanifest`, `.nojekyll`, `styles/`, `js/`, `assets/`, `vendor/` e a configuração web pública. São 285 arquivos, 18.606.417 bytes, comparados por SHA-256 com as origens. Não contém testes, fixtures, documentação, scripts de servidor, `worker/`, logs, `node_modules`, PDFs locais ou `.secrets`.

O bundle Worker preparado é `index.js`, 305.936 bytes; seu sourcemap e README ficam como artefatos locais de build. Não contém PDFs ou fixtures de testes. Segredos são referenciados por bindings de runtime, nunca incorporados como valores ao código.

Testes e documentação versionados no Git não são publicados no site pelo workflow. PDFs locais, credenciais, caches, logs e `test-output/` permanecem ignorados e fora do commit proposto. O scanner de fontes/artefatos não encontrou os padrões de chave privada, conta de serviço ou segredo OAuth verificados; os paths de publicação também foram validados por lista de destinos.

## 3. Preservação e protocolos

Comparados com HEAD e/ou metadados ativos, continuam inalterados:

- `config/app-config.js`: Firebase real e endpoint real do mesmo Worker; build sem emuladores, modo fictício ou permissão de bypass local.
- `worker/wrangler.jsonc`: variáveis iguais às ativas, mesma data de compatibilidade, binding `GAME_KNOWLEDGE`, classe `KnowledgeStore` e tag de migração `v1-knowledge`.
- `firestore.rules`, índices, `firebase.json`, `.firebaserc` e usuários existentes. Nenhum `firebase deploy` faz parte do procedimento.
- Segredos Gemini/Drive/OAuth/tickets existentes. Não usar `secret put`, `secret bulk` ou `--secrets-file` nesta publicação.
- Dependências e lockfiles; nenhuma atualização de pacote. Upload continua em 50 MiB, blocos de 8 MiB; o pacote não muda esse limite.
- Validação JWT/perfil/permissões e proteção de mídia, além das otimizações recentes de download, fila e listeners.

| Protocolo | Implementação e validação |
| --- | --- |
| `profileMetadataProtocol: 1` | `/health` anuncia; cliente habilita `/v1/research/draft-knowledge`; endpoint privado exige permissões e mantém a chave no servidor |
| `knowledgeReuseProtocol: 1` | Cliente envia `reuseOnly`; servidor pode recuperar/adotar resultado válido e não inicia Gemini quando o pedido é somente reutilização |
| `informationIdentityProtocol: 1` | Cliente envia título, edição e hashes esperados; servidor rejeita identidade divergente antes de gerar |

O bundle compilado foi importado localmente e respondeu `/health` com os três valores em 1. O cliente passou pelos guardas de versão, selecionou os endpoints corretos com transporte simulado e recusou gerar quando simulada a saúde antiga sem protocolos. A ausência do aviso genérico não demonstra disponibilidade/cota real do Gemini: esse teste permanece controlado e posterior, como solicitado.

Os protocolos de mídia e pesquisa permanecem em 2. O frontend anterior pode continuar usando as rotas anteriores do Worker novo; campos estruturados são aditivos, e não há migração destrutiva. O frontend novo diante de um Worker antigo informa a atualização necessária, em vez de enviar um pedido incompatível. Não se promete renovação instantânea de abas antigas: a atualização normal da PWA/recarregamento deve ser verificada, sem apagar IndexedDB ou dados privados.

## 4. Automações: frontend e Worker são independentes

`.github/workflows/pages.yml` é o único workflow encontrado. Ele:

1. Executa em push para `main` ou `workflow_dispatch`.
2. Instala dependências, executa checks/testes com emuladores `demo-acervo`, prepara `public/` e testa a API.
3. Publica **somente `public/`** via `actions/deploy-pages`.

Não há `wrangler deploy` nesse workflow. Commit local não o dispara; push para `main` o dispara e pode cancelar uma execução Pages anterior em andamento. Não foram encontrados hooks Git locais ativos nem `core.hooksPath` configurado.

**Cloudflare Builds conectado ao Git: não confirmado.** O histórico mostra versões publicadas por Wrangler, o que não prova ausência de integração Git. Uma tentativa de consulta dos gatilhos por leitura direta do token local foi rejeitada pela revisão automática de segurança; o script não foi executado e o token não foi lido por ele. Não se contornou esse bloqueio. O proprietário orientou deixar essa confirmação pendente antes do push e manter a publicação do Worker sob autorização separada. Não desativar nem criar gatilhos automaticamente.

Antes do push, verificar no painel autenticado da Cloudflare se há repositório conectado, branch monitorada e comando de deploy. Se houver, coordenar esse segundo gatilho para evitar publicação duplicada/inesperada; qualquer alteração dele precisa de autorização própria. Se não for possível confirmar, manter o push pendente e informar a limitação, sem presumir que o Worker acompanhará o Pages.

## 5. Sequência proposta — executar somente após autorização

### A. Congelar a revisão

Revalidar que HEAD, arquivos e hashes ainda correspondem ao manifesto. Se houver novas edições, repetir os checks afetados antes de publicar. Após autorização de commit, adicionar somente os paths auditados e criar um commit local revisável. Nenhum push nessa etapa. A lista está em `test-output/release-preflight-2026-10-18/paths-to-stage.txt`.

### B. Publicar o Worker — autorização específica

Conferir que a versão ativa ainda é o alvo registrado abaixo; se mudou, atualizar o rollback. Usar o Worker existente `acervo-drive-api`, sem novo projeto ou recurso. Comando proposto, **não executado**:

```bash
node worker/node_modules/wrangler/bin/wrangler.js deploy --config worker/wrangler.jsonc --keep-vars --tag release-1-11-0 --message "Acervo 1.11.0: ficha e pesquisa compatíveis"
```

`--keep-vars` evita remover variáveis que eventualmente existam apenas no painel; as variáveis locais atuais já foram comparadas com as remotas e são iguais. Deploy não apaga os segredos existentes, e não será enviada nova migração. Referências: [Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/) e ajuda da versão instalada.

Registrar a nova Version ID e consultar uma vez `/health`. Exigir API 1.11.0, os três protocolos em 1, pesquisa/mídia em 2, projeto correto, IA configurada/autorizada e Drive conectado. Parar antes do push se houver divergência.

Publicar código, por si só, não chama Gemini. Pedidos de usuários/abas antigas continuam possíveis durante a transição; por isso reduzir o intervalo entre as publicações. Nossos testes pós-publicação não enviarão POST de geração Gemini e não abrirão uma sessão real com preparação/gravação automática liberada.

### C. Publicar frontend — autorização de commit/push e pendência de gatilhos resolvida

Com Worker verificado e automação externa esclarecida, fazer o push autorizado para `origin main`. Acompanhar o workflow Pages até o deployment, sem disparar workflow adicional desnecessário. Se falhar, o frontend anterior continua no ar e o Worker novo conserva compatibilidade com ele.

Conferir os arquivos estáticos efetivamente servidos: contrato 1.11.0, estratégia 2 e service worker `acervo-v1.11.0-research-real-2`. Verificar uma atualização normal da PWA; não limpar logins, banco local, progresso ou PDFs para forçar atualização.

### D. Validação real controlada posterior

Esta etapa também depende da autorização de publicação e usa poucas leituras intencionais, nunca a suíte automatizada contra produção. Não foi executada agora.

- Saúde e arquivos estáticos primeiro, sem Firestore/Drive.
- Em sessão administradora controlada: login, carregar biblioteca uma vez, abrir/fechar um jogo, Gerenciar jogo, ler uma página de um PDF existente e navegar. Preservar o mesmo download durante a leitura.
- Conferir capacidades/fontes e fazer uma busca externa de um título conhecido, sem criar ou editar jogo.
- Para **Completar informações**, observar a seleção da rota correta e os protocolos com interceptação local que bloqueie os POSTs de geração durante a validação. Não tomar a ausência de “IA indisponível” como teste de geração real.
- Bloquear no navegador de validação uploads, gravações de preparação e POSTs Gemini (`/v1/research/draft-knowledge` e `/v1/games/*/knowledge`, exceto leituras explicitamente controladas). Não clicar em atualizar conhecimento, não cadastrar PDF ou usuário, não modificar contas ou registros para testar.
- Encerrar a sessão de teste ao concluir; não deixar polling/testes/reloads contínuos em produção. A geração Gemini real fica para o teste controlado que o proprietário solicitar depois.

Se a verificação de acesso exigir interação de login do proprietário, fazê-la na interface normal; não solicitar senha, copiar tokens nem extrair credenciais de arquivos do sistema.

## 6. Rollback preparado

### Worker

Alvo confirmado: **`1f2eb25e-6398-4b0e-a036-4183669fe6fa`**. Comando de recuperação, somente se necessário e autorizado:

```bash
node worker/node_modules/wrangler/bin/wrangler.js rollback 1f2eb25e-6398-4b0e-a036-4183669fe6fa --config worker/wrangler.jsonc --message "Rollback Acervo: restaurar versão anterior"
```

Conferir a saúde depois. Não usar exclusão de Worker, recriação de Durable Object, reset de Firestore ou limpeza de Drive. Rollback de código não restaura dados: os recursos conectados continuam existindo. Os acréscimos de perfil/rascunho são aditivos, sem nova migração ou mudança de classe nesta entrega. Ver [rollback Cloudflare](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

### Frontend

Alvo anterior: **`c6f72f475551777fdb167ebfc9b918745625c130`**. Registrar o SHA do commit desta publicação assim que criado. Com árvore de trabalho protegida/limpa, reverter somente esse commit e fazer o push de recuperação autorizado:

```bash
git revert <SHA_DO_COMMIT_DESTA_PUBLICACAO>
git push origin main
```

Isso executa o workflow Pages e restaura os arquivos anteriores sem force-push. Não executar `reset --hard` ou apagar alterações locais. Reverter frontend por Git **não reverte o Worker**.

Se falhar apenas o frontend, preferir reverter frontend e conservar o Worker novo compatível. Se o Worker falhar antes do push, reverter Worker e interromper a sequência. Se a falha for após ambas as publicações, decidir a recuperação de cada componente explicitamente; o frontend novo trata a falta dos protocolos antigos sem gerar. Confirmar versão e atualização PWA após o rollback.

Nenhum desses comandos foi executado nesta preparação. Revalidar os alvos imediatamente antes de usar, porque outro deployment ou commit posterior pode mudar o estado.

## 7. Testes e evidências desta preparação

- Aplicativo: **172/172** testes.
- Worker: **87/87** testes.
- Auth/Firestore `demo-acervo`: integração de cadastro, gestão, conhecimento, cache, recarga e permissões, mais **27/27** testes de segurança. Emuladores encerrados ao terminar.
- Navegador: Descent BR/original com PDF inglês real local e respostas públicas gravadas; inputs, fontes, salvamento IndexedDB e recarga conferidos. Arnak: cinco inputs com fatos reais; sem chamadas externas.
- Navegador: oito regressões de identidade, resultados inválidos, dados manuais, IA indisponível e quota.
- Leitor Resident Evil: páginas 1/11/22, desktop/tablet/celular, zoom, troca de documento e cancelamento; um GET por abertura, zero Range remoto.
- Fila: 12 trabalhos preservados durante inicialização; zero leituras iniciais, zero reanálises válidas e zero listeners após fechar.
- Compatibilidade: `/health` do código-fonte e do bundle compilado, três protocolos em 1, cliente novo com servidor compatível/antigo e rotas/payloads corretos, com transporte simulado e nenhuma geração real.
- Build frontend, `npm run check`, bundle Wrangler `--dry-run`, verificação de origens/hashes e exclusões do artefato aprovados.

As suítes npm usam `scripts/test-guard.mjs`; browsers bloqueiam destinos externos; SDKs de integração usam explicitamente o projeto `demo-acervo` e portas loopback. A ferramenta de captura pública é opt-in e não integra a suíte/CI. O antigo `scripts/deployment-preflight.mjs` **não foi executado**, porque consulta perfil/regras do Firebase real e não pertence a esta validação isolada.

Logs, manifesto de cada arquivo, hashes dos artefatos, metadados publicados, compatibilidade e preservação estão em `test-output/release-preflight-2026-10-18/`, ignorado pelo Git. A preparação consultou somente saúde/estáticos e metadados de deploy; **zero leituras de documentos reais do Firestore/Drive e zero chamadas Gemini reais**.

## 8. Autorizações necessárias

1. **Commit local do pacote auditado**, incluindo fontes, documentação e testes de regressão necessários ao CI; testes e documentação ficam fora do artefato publicado.
2. **Deploy separado do Cloudflare Worker `acervo-drive-api`**, preservando recursos, variáveis e segredos, seguido de verificação somente de saúde/protocolos.
3. **Push para `origin main` e publicação automática do GitHub Pages**, depois de o Worker estar compatível e de a pendência de automação externa da Cloudflare ser esclarecida; verificações reais limitadas, sem geração Gemini nem alterações de dados para teste.

Autorizar somente o Pages não autoriza o Worker. Autorizar o Worker não autoriza push. A publicação permanece suspensa até essas confirmações; a existência de uma versão antiga incompatível não será usada como permissão implícita para publicá-la.
