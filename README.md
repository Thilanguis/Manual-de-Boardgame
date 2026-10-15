# Acervo — Manual de Boardgames

Biblioteca pessoal em HTML, CSS e JavaScript puro, publicada no [GitHub Pages](https://thilanguis.github.io/Manual-de-Boardgame/). Catálogo real, reconhecimento de PDFs com evidências, capas, filtros, favoritos locais, leitor PDF.js e PWA. Não há catálogo fictício nem framework de interface. O Buraco permanece independente.

## Arquitetura

- Frontend: GitHub Pages.
- Identidade: Firebase Authentication, login/cadastro por e-mail e senha, recuperação e Google opcional.
- Dados e autorização: Firestore no Firebase Spark.
- PDFs/capas: pasta privada [PDFs](https://drive.google.com/drive/folders/1XUgXOYRigMaYuNMbFVcjDp6obEp4r7wR) do proprietário, por Cloudflare Workers Free e OAuth drive.file.

Não há dependência de Firebase Hosting, Storage ou Functions, nem token privado GitHub no JavaScript. A API não usa o Drive do subadministrador. Refresh token e client secret ficam em secrets do Worker.

O Drive central está configurado no Worker e em `config/app-config.js`. Consulte [a configuração e reconexão do Drive](docs/GOOGLE-DRIVE-CLOUDFLARE.md) para manutenção das credenciais privadas.

## Contas e cadastro em etapas

Login por e-mail/senha com cadastro e recuperação visíveis, Google opcional e perfil com nome, e-mail e acesso. O cadastro de jogos separa identificação, informações e publicação, preservando o rascunho. Duração aceita mínimo/máximo e continua lendo `durationMinutes` de jogos antigos. Títulos técnicos exigem revisão explícita. [Alterações, compatibilidade e testes da versão 1.6.0](docs/REFINAMENTO-1.6.md).

## Guias e consulta rápida

Cada jogo oferece **Aprender a jogar**, **Consulta rápida** e **Manual completo**. Administradores com `editGames` podem analisar todas as páginas, organizar sugestões extraídas, editar seções com imagens e publicar após revisão. Rascunhos ficam privados; texto de índices completos é comprimido no Drive, com busca em Web Worker no navegador. A versão não usa IA nem OCR pago. [Uso, arquitetura, limites e testes](docs/BIBLIOTECA-INTELIGENTE.md).

## Reconhecimento com múltiplas fontes

[Refinamento 1.7: revisão manual, preenchimento confirmado, página inicial e testes de Sina da Sociedade](docs/UX-PESQUISA-1.7.md).

O PDF continua como fonte principal. A pesquisa automática usa conectores independentes, resultados progressivos e prazos curtos, com idioma preferido PT-BR, cancelamento e opção **Ampliar pesquisa**. Cada campo externo exige revisão antes de aplicar; identidades, aliases, conflitos e atribuições são preservados. Wikidata e Wikipédia estão ativos sem chave; descrições Wikipédia preservam atribuição e licença CC BY-SA. PDFs sem texto podem ser lidos por OCR no dispositivo, com confirmação dos campos. Ludopedia tem prioridade brasileira e conector preparado, aguardando token da aplicação autorizada. BGG aguarda aplicação aprovada, token e logo oficial. Editoras/lojas brasileiras, francesas e canadenses permanecem referências manuais enquanto não houver integração autorizada. [Investigação, fontes, condições e ativação segura](docs/FONTES-RECONHECIMENTO.md). [Resultados reais com três PDFs e limites da versão 1.5.0](docs/RELATORIO-RECONHECIMENTO-1.5.md).

## Pessoas e permissões

Visitantes leem conteúdo público sem conta. Novas contas recebem pending/user, sem privilégios. Aprovação as torna usuários comuns. O proprietário pode promover a subadmin, configurar approveUsers/addGames/editGames, rebaixar ou bloquear. Exclusão definitiva é exclusiva do superadmin; subadmins não gerenciam cargos ou configurações. Seu UID está fixado e protegido contra alterações pelo cliente.

O painel Gerenciar oferece contador e avisos de solicitações em tempo real, aprovação/recusa, pessoas, permissões e histórico. Regras Firestore e Worker aplicam as permissões; ocultar botões não concede segurança. Mudanças de pessoas/configuração são transações vinculadas a auditoria imutável. Bloqueios revogam autorização administrativa para sessões já existentes.

A biblioteca começa pública na migração. O proprietário pode alterar a política global; jogos publicados individualmente continuam disponíveis quando ela está desligada. PDFs continuam privados no Drive e são entregues pelo proxy autorizado.

## Executar e testar

Para desenvolvimento e testes: Node 24.12+; Java 21 para emuladores.

```powershell
npm ci
npm start
```

Abra http://localhost:4173. O modo real local `?local=1` continua disponível: usa IndexedDB neste navegador, sem sincronização nem migração automática para Drive. Limpar dados do site pode apagar essa biblioteca.

```powershell
npm run check
npm test
npm run test:rules
npm run build
npm --prefix worker ci
npm --prefix worker run check
npm --prefix worker test
npm --prefix worker run build
```

O build copia apenas recursos públicos para public/. Scripts locais, JSON OAuth, dependências Node e testes não são publicados. O build Worker é dry-run. O workflow Pages executa testes unitários, testes reais de regras em demo-acervo e build; publica somente public/.

Testes cobrem reconhecimento, PWA/cache, retomada, JWT, tickets, acesso/folder, exclusão concorrente, CSRF e isolamento do assistente OAuth. Emuladores verificam cadastro pending, leitura pública, hierarquia, auditoria, flags e bloqueio da sessão existente. QA de navegador usa dados descartáveis: importação/substituição/leitura de PDF e gerenciamento entre contas distintas em tempo real, inclusive celular/tablet. A integração Drive real e CPU do Workers Free só podem ser validadas após conectar as contas.

Ferramentas de desenvolvimento têm overrides de correção para dependências transitivas, sem alterar os SDKs CDN do frontend; validá-las pelos emuladores faz parte do workflow.

## Ativação

Para o catálogo brasileiro, siga o [cadastro oficial da API Ludopedia e configuração privada do token](docs/LUDOPEDIA.md). A fonte permanece opcional; PDF e Wikidata não dependem dessa autorização.

O [guia Firebase](docs/FIREBASE.md) explica bootstrap seguro do UID proprietário, regras, estados, painel e cotas. O [guia Google Drive/Cloudflare](docs/GOOGLE-DRIVE-CLOUDFLARE.md) contém Console Google Cloud, OAuth Web, escopo mínimo, Picker local autorizado, secrets e teste de envio real à pasta existente. Nenhuma nova pasta é criada automaticamente.

BGG é opcional, via Worker com token secreto aprovado; vem desativado. PDFs escaneados recebem OCR local opcional/automático na importação sem texto, limitado às três primeiras páginas e com revisão; campos sem evidência continuam desconhecidos. Favoritos e progresso continuam locais. Manuais interativos e consulta rápida já estão disponíveis.

## Organização

js/: interface, pessoas/permissões, reconhecimento, leitor e repositórios. worker/: API. scripts/: servidor, build, bootstrap IAM e OAuth local. firestore.rules: autorização e auditoria. security/: testes em emulador. tests/: unidades e QA. vendor/pdfjs/: PDF.js 5.6.205 e licenças. docs/ANALISE-BURACO.md: decisões de reaproveitamento.

Firebase Spark, Workers Free, GitHub Pages e Drive API têm cotas. A arquitetura não exige faturamento adicional dentro dessas cotas; Google One não remove limites da API. Não há quota individual nem limpeza automática de arquivos completos abandonados antes de vincular ao catálogo.
