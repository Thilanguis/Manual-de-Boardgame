> **Seu Acervo real no computador:** execute `npm start` e abra http://127.0.0.1:4174. Use sua conta habitual. Atualize a página manualmente; o servidor não recarrega ao salvar arquivos.
>
> **Testes isolados:** `npm run dev` usa emuladores em http://localhost:4173, sem serviços reais. Veja [DESENVOLVIMENTO.md](docs/DESENVOLVIMENTO.md).
>
> Novos PDFs: **50 MiB (52.428.800 bytes)**, com blocos retomáveis de 8 MiB. PDFs antigos maiores continuam legíveis. As alterações desta versão são locais, sem deploy.

# Acervo — Manual de Boardgames

Para localizar os guias de manutenção e os relatórios anteriores, comece pelo [índice da documentação](docs/README.md). O histórico foi preservado nos caminhos originais; os relatórios antigos descrevem o estado da época.

Biblioteca pessoal em HTML, CSS e JavaScript puro, publicada no [GitHub Pages](https://thilanguis.github.io/Manual-de-Boardgame/). Catálogo real, reconhecimento de PDFs com evidências, capas, filtros, favoritos locais, leitor PDF.js e PWA. Não há catálogo fictício nem framework de interface. O Buraco permanece independente.

**Implementação local 1.11.0, ainda não publicada:** ficha com Ler manual, Como jogar e Buscar regras; administração centralizada; conhecimento Gemini com revisão, persistência e controle de cota. [Implementação, testes e configuração da chave](docs/IMPLEMENTACAO-1.11.md). A versão em produção permanece inalterada até autorização.

Biblioteca privada, processamento automático e vários PDFs por jogo foram preservados. [Base da versão 1.10 e transição segura](docs/IMPLEMENTACAO-1.10.md).

Auditoria do fluxo único: legado, identidade completa, retirada de sugestões obsoletas e reaproveitamento do índice sem IA. [Reproduções antes/depois](docs/AUDITORIA-FLUXO-INFORMACOES-2026-10-18.md). Correções locais, sem publicação.

Fluxo atual: **Editar informações → Completar informações → Salvar alterações**, com manutenção separada em **Regras**. [Fluxo, segurança e testes](docs/FLUXO-CADASTRO-EDICAO-2026-10-18.md).

Ficha estruturada Gemini no cadastro inicial, reaproveitamento após salvar e revisão consolidada de divergências: [implementação e testes](docs/FICHA-GEMINI-CONSENSO-2026-10-18.md). Mudanças locais, sem deploy.

Correções locais adicionais: restauração de sessão sem alternar telas, compatibilidade de capas/manuais, preparo e remoção recuperável. [Causas, testes e dependências do backend](docs/CORRECOES-ACESSO-1.10.md).

**Correção local 1.10.1:** salvamento de PDFs grandes, conferência da capacidade do servidor e avisos de conexão em Minha conta. [Correções e teste completo com PDFs de 157,3 e 200 MiB](docs/CORRECOES-UPLOAD-1.10.1.md). Ainda sem publicação.

## Arquitetura

- Frontend: GitHub Pages.
- Identidade: Firebase Authentication, login/cadastro por e-mail e senha, recuperação e Google opcional.
- Dados e autorização: Firestore no Firebase Spark.
- PDFs/capas: pasta privada [PDFs](https://drive.google.com/drive/folders/1XUgXOYRigMaYuNMbFVcjDp6obEp4r7wR) do proprietário, por Cloudflare Workers Free e OAuth drive.file.

Não há dependência de Firebase Hosting, Storage ou Functions, nem token privado GitHub no JavaScript. A API não usa o Drive do subadministrador. Refresh token e client secret ficam em secrets do Worker.

O Drive central está configurado no Worker e em `config/app-config.js`. Consulte [a configuração e reconexão do Drive](docs/GOOGLE-DRIVE-CLOUDFLARE.md) para manutenção das credenciais privadas.

Novos PDFs e substituições aceitam até **50 MiB (52.428.800 bytes)** por arquivo, com blocos retomáveis de 8 MiB. Documentos antigos maiores continuam legíveis. [Ambiente isolado, limite e testes](docs/DESENVOLVIMENTO.md).

## Contas e cadastro em etapas

Login por e-mail/senha com cadastro e recuperação visíveis, Google opcional e perfil com nome, e-mail e acesso. O cadastro de jogos separa identificação, informações e publicação, preservando o rascunho. Duração aceita mínimo/máximo e continua lendo `durationMinutes` de jogos antigos. Títulos técnicos exigem revisão explícita. [Alterações, compatibilidade e testes da versão 1.6.0](docs/REFINAMENTO-1.6.md).

## Guias e consulta rápida

Cada jogo oferece **Aprender a jogar**, **Consulta rápida** e **Manual completo**. Administradores com `editGames` podem analisar todas as páginas, organizar sugestões extraídas, editar seções com imagens e publicar após revisão. Rascunhos ficam privados; texto de índices completos é comprimido no Drive, com busca em Web Worker no navegador. A versão não usa IA nem OCR pago. [Uso, arquitetura, limites e testes](docs/BIBLIOTECA-INTELIGENTE.md).

## Reconhecimento com múltiplas fontes

[Refinamento 1.7: revisão manual, preenchimento confirmado, página inicial e testes de Sina da Sociedade](docs/UX-PESQUISA-1.7.md).

O PDF continua como fonte principal. A pesquisa automática usa conectores independentes, resultados progressivos e prazos curtos, com idioma preferido PT-BR, cancelamento e opção **Ampliar pesquisa**. Cada campo externo exige revisão antes de aplicar; identidades, aliases, conflitos e atribuições são preservados. Wikidata e Wikipédia estão ativos sem chave; descrições Wikipédia preservam atribuição e licença CC BY-SA. PDFs sem texto podem ser lidos por OCR no dispositivo, com confirmação dos campos. Ludopedia tem prioridade brasileira e conector preparado, aguardando token da aplicação autorizada. BGG aguarda aplicação aprovada, token e logo oficial. Editoras/lojas brasileiras, francesas e canadenses permanecem referências manuais enquanto não houver integração autorizada. [Investigação, fontes, condições e ativação segura](docs/FONTES-RECONHECIMENTO.md). [Resultados reais com três PDFs e limites da versão 1.5.0](docs/RELATORIO-RECONHECIMENTO-1.5.md).

## Pessoas e permissões

Visitantes veem entrada, cadastro e recuperação de senha. Novas contas recebem pending/user, sem acesso ao conteúdo. Somente o proprietário aprova ou recusa solicitações. Após aprovação, usuários comuns leem documentos autorizados. O proprietário pode promover a subadmin, configurar addGames/editGames, rebaixar ou bloquear. A flag antiga approveUsers não concede aprovação. Exclusão definitiva é exclusiva do superadmin; subadmins não gerenciam cargos ou configurações. Seu UID está fixado e protegido contra alterações pelo cliente.

O painel Gerenciar oferece contador e avisos de solicitações em tempo real, aprovação/recusa, pessoas, permissões e histórico. Regras Firestore e Worker aplicam as permissões; ocultar botões não concede segurança. Mudanças de pessoas/configuração são transações vinculadas a auditoria imutável. Bloqueios revogam leitura e escrita para sessões já existentes.

A autenticação e a aprovação são obrigatórias. A configuração antiga publicRead não libera visitantes. A disponibilidade anterior, global ou por jogo (isPublic), é preservada somente entre contas aprovadas; administradores mantêm acesso de gestão. PDFs e capas são entregues pelo Worker, com verificação atual do perfil a cada solicitação, sem URLs públicas do Drive.

## Executar e testar

Para abrir o Acervo local: Node 24.12+. Java 21 é necessário somente nos testes com emuladores.

```powershell
npm ci
npm start
```

Abra http://127.0.0.1:4174 e entre com sua conta habitual. Authentication, Firestore, Drive, Worker e integrações usam os serviços reais existentes. O servidor não executa watcher nem recarrega páginas ao salvar arquivos. Encerre com Ctrl+C.

Para testes automáticos, use `npm run dev` e os comandos abaixo. O parâmetro `?local=1` sozinho não libera o sandbox IndexedDB; esse modo continua exclusivo das fixtures explícitas.

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

Testes cobrem reconhecimento, PWA/cache, retomada, JWT, tickets, acesso/folder, exclusão concorrente, CSRF e isolamento do assistente OAuth. Emuladores verificam cadastro pending, bloqueio de visitantes/pendentes, aprovação exclusiva do proprietário, índices privados, hierarquia, auditoria, flags e bloqueio da sessão existente. QA de navegador usa dados descartáveis: importação/substituição/leitura de PDF e gerenciamento entre contas distintas em tempo real, inclusive celular/tablet. A integração Drive real e CPU do Workers Free só podem ser validadas após conectar as contas.

Ferramentas de desenvolvimento têm overrides de correção para dependências transitivas, sem alterar os SDKs CDN do frontend; validá-las pelos emuladores faz parte do workflow.

## Ativação

Para o catálogo brasileiro, siga o [cadastro oficial da API Ludopedia e configuração privada do token](docs/LUDOPEDIA.md). A fonte permanece opcional; PDF e Wikidata não dependem dessa autorização.

O [guia Firebase](docs/FIREBASE.md) explica bootstrap seguro do UID proprietário, regras, estados, painel e cotas. O [guia Google Drive/Cloudflare](docs/GOOGLE-DRIVE-CLOUDFLARE.md) contém Console Google Cloud, OAuth Web, escopo mínimo, Picker local autorizado, secrets e teste de envio real à pasta existente. Nenhuma nova pasta é criada automaticamente.

BGG é opcional, via Worker com token secreto aprovado; vem desativado. PDFs escaneados recebem OCR local opcional/automático na importação sem texto, limitado no reconhecimento inicial, seguido de processamento automático do documento completo após salvar, com revisão das sugestões; campos sem evidência continuam desconhecidos. Favoritos e progresso continuam locais. Manuais interativos e consulta rápida já estão disponíveis.

A entrega local 1.8.0 acrescenta pesquisa multilíngue consolidada por campo, histórico privado reutilizável por edição e OCR progressivo do manual completo. Veja o [relatório de implementação, testes reais e sequência de publicação](docs/IMPLEMENTACAO-1.8.md). Commit, push e deploy são executados somente por solicitação explícita do proprietário; os comandos de commit são entregues para revisão.

A versão local 1.9.0 completa o OCR em uma execução, reutiliza o índice entre cadastro/guia/consulta e acrescenta tradução local de textos completos, preservando os originais e a revisão. Veja [o que mudou, testes com Resident Evil e Sina e os limites da tradução](docs/IMPLEMENTACAO-1.9.md).

## Organização

js/: interface, pessoas/permissões, reconhecimento, leitor e repositórios. worker/: API. scripts/: servidor, build, bootstrap IAM e OAuth local. firestore.rules: autorização e auditoria. security/: testes em emulador. tests/: unidades e QA. vendor/pdfjs/: PDF.js 5.6.205 e licenças. docs/ANALISE-BURACO.md: decisões de reaproveitamento.

Firebase Spark, Workers Free, GitHub Pages e Drive API têm cotas. A arquitetura não exige faturamento adicional dentro dessas cotas; Google One não remove limites da API. Não há quota individual nem limpeza automática de arquivos completos abandonados antes de vincular ao catálogo.
