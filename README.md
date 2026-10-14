# Acervo — Manual de Boardgames

Biblioteca pessoal de manuais, em HTML, CSS e JavaScript puro. Interface escura responsiva, catálogo real, reconhecimento com evidências e leitor PDF.js. Nenhum jogo fictício é carregado na biblioteca. O projeto Buraco foi somente consultado e permanece independente.

## Arquitetura

- **GitHub Pages:** frontend estático no repositório [Thilanguis/Manual-de-Boardgame](https://github.com/Thilanguis/Manual-de-Boardgame).
- **Firebase Spark:** Authentication e Firestore para catálogo e permissões. Não utiliza Firebase Storage nem Cloud Functions.
- **Cloudflare Workers Free:** API que verifica o ID token Firebase e as permissões atuais no Firestore antes das operações.
- **Google Drive pessoal:** PDFs e capas em pasta exclusiva, criados com o OAuth da conta proprietária. Todos os administradores usam esse mesmo armazenamento Google One.

O Worker conserva as credenciais OAuth em secrets. O frontend recebe somente tickets criptografados e referências aos arquivos; nunca recebe o refresh token, client secret ou access token Google. Uploads usam blocos de 8 MiB e sessões retomáveis; a leitura permite requisições Range. Os arquivos permanecem privados no Drive. Visitantes leem pelo site conforme a publicação de cada jogo ou da biblioteca inteira.

**A autorização externa ainda é necessária:** `fileStorage.apiBase` está vazia até publicar o Worker e conectar o Drive. O código e a configuração Firebase, isoladamente, não tornam os uploads centrais disponíveis. Siga o [guia completo do Google Cloud, OAuth e Cloudflare](docs/GOOGLE-DRIVE-CLOUDFLARE.md) e o [guia Firebase](docs/FIREBASE.md). Não anexe credenciais privadas ao chat ou ao repositório.

## Funcionalidades

- Pesquisa, filtros, categorias, favoritos e retomada de leitura.
- PDF até 50 MiB, texto de até 12 páginas, sugestões de título/jogadores/duração com fontes e revisão obrigatória. Dados ausentes ficam desconhecidos; PDFs escaneados não passam por OCR.
- Primeira página como capa, imagem própria e integração opcional BGG pelo Worker. O BGG exige aprovação e token próprio; vem desativado.
- Adicionar, consultar, editar, substituir PDF e excluir. Subadministradores recebem permissões independentes de adicionar/editar/excluir.
- Leitor com seleção de texto, páginas, zoom, teclado e gestos, disponível no computador, celular e tablet.
- PWA instalável e atualização mediante aviso. O cache não baixa a biblioteca inteira; manuais centrais exigem conexão.
- Exclusão com controle de versão e marcação prévia do registro para bloquear edições concorrentes. Falhas podem ser retomadas.
- Schema reservado para futuros manuais interativos; essa funcionalidade não foi desenvolvida.

Favoritos e progresso ficam no navegador, separados por modo e conta. Uploads completos abandonados podem ocupar espaço na pasta central; não há limpeza automática nem quota individual por administrador.

## Executar e verificar

Requer Node.js 22+. A interface usa dependências vendorizadas e não precisa de npm para executar:

```powershell
npm start
```

Abra `http://localhost:4173`. Para uma biblioteca real independente neste navegador, abra `http://localhost:4173/?local=1`. Esse modo usa IndexedDB, não sincroniza com outros dispositivos e não migra automaticamente arquivos para o Drive. Apagar dados do navegador pode apagar a biblioteca local.

```powershell
npm run check
npm test
npm run build
npm --prefix worker ci
npm --prefix worker run check
npm --prefix worker test
npm --prefix worker run build
```

O build estático copia somente os recursos públicos para `public/`. O build do Worker é um dry-run sem publicação. O workflow `.github/workflows/pages.yml` verifica os dois componentes e publica somente `public/` no Pages; selecione **GitHub Actions** em Settings → Pages.

Os testes automatizados cobrem reconhecimento, cache, verificação JWT, tickets, permissões, limites de upload, vínculo de arquivos e operações da API com serviços simulados. `tests/browser.mjs` verifica importação de um PDF gerado, persistência, substituição, leitor, edição e exclusão em contexto isolado; requer Playwright, pdf-lib e Chrome. Eles não substituem a validação final no Drive real após a conexão OAuth.

Para Prettier e VS Code, execute `npm ci`; as preferências de formatação e extensão recomendada estão no projeto.

## Organização e publicação

`js/`: interface, reconhecimento, leitor, repositório Firebase, armazenamento Drive e modo local. `worker/`: API segura. `backend/`: parser BGG. `scripts/`: servidor, build e conexão OAuth local. `firestore.rules` e `firestore.indexes.json`: autorização e consultas. `vendor/pdfjs/`: PDF.js 5.6.205, Apache-2.0. `docs/ANALISE-BURACO.md`: análise e decisões de reaproveitamento.

Publique regras e índices no projeto correto, sem ativar faturamento:

```powershell
firebase deploy --project manual-de-boardgame --only firestore
```

O host Firebase `https://manual-de-boardgame.web.app` pode servir para vincular o login Google à conta administrativa existente antes de usar Pages. O UID proprietário configurado é `7TitBObtb8a0W8GisSstSM1RHiX2`. No domínio `.github.io`, o login usa o popup Google; vincule esse provider à conta existente para preservar o UID, conforme o guia.

Os planos gratuitos têm cotas. A arquitetura não exige Blaze nem contratação de infraestrutura adicional; sua capacidade real depende das cotas Firebase, Workers e Drive API. Consulte as fontes e limitações no guia antes da ativação.
