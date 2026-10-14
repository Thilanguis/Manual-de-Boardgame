# Do Buraco ao Acervo

Análise de `D:\Sistemas DEV\Buraco`, feita em 14 de outubro de 2026, para orientar este projeto independente. A consulta ao Buraco foi somente de leitura. O reaproveitamento é de padrões úteis; lógica de cartas, imagens, vídeos, sons, dados e identidade do Buraco não fazem parte do Acervo.

## Padrões observados

| Tema        | Evidência no Buraco                                                                                                                                                 | Decisão no Acervo                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatação  | `.prettierrc`: `htmlWhitespaceSensitivity: "ignore"`, `bracketSameLine: true`, `printWidth: 250`, `tabWidth: 2`, `useTabs: false`, `singleQuote: true`.             | Reaproveitar o padrão e configurar Prettier no editor.                                                                                                  |
| VS Code     | Não havia pasta `.vscode` no projeto original.                                                                                                                      | Criar settings específicas do Acervo para formatação ao salvar; não atribuí-las ao Buraco.                                                              |
| Manifest    | `manifest.json` e `manifest.webmanifest` coexistem, com diferenças de nome/cores/purpose; o HTML usa `manifest.webmanifest`. Ambos têm standalone e ícones 192/512. | Usar um único manifest, standalone e ícones próprios.                                                                                                   |
| Atualização | Cache `buraco-v309`, mensagem `skipWaiting` e recarga depois de `controllerchange` real.                                                                            | Conservar a atualização coordenada, com cache próprio e sem interromper uma importação.                                                                 |
| Cache       | Lista extensa de código, imagens, temas e sons; código/navegação com rede e fallback, outros assets com cache. Mídia e Range ficam fora desse tratamento.           | Cachear somente interface/recursos essenciais. PDFs e arquivos remotos não entram no pré-cache.                                                         |
| Organização | HTML, `styles/`, módulos `js/`, recursos `assets/`; `js/bootstrap.js` resolve acesso antes de carregar a aplicação.                                                 | Manter HTML/CSS/JS separados e módulos pequenos para catálogo, persistência, PDF, reconhecimento e PWA.                                                 |
| Firebase    | SDK modular CDN 10.12.2 em Firestore e Auth; projeto e regras próprios do jogo.                                                                                     | SDK modular CDN 13.0.0 no projeto independente `manual-de-boardgame`, com Auth/Firestore no Spark. Não copiar configuração, contas ou regras do Buraco. |

## Arquitetura atual

O Acervo usa HTML, CSS e JavaScript puro. Scripts Node preparam o servidor local e `public/`; GitHub Actions publica essa pasta no GitHub Pages. PDF.js 5.6.205 legacy fica em `vendor/`, com worker compatível, e resolve extração de texto, capa da primeira página e leitor.

Firebase Spark fornece login, catálogo e papéis. PDFs/capas ficam no Google Drive pessoal do proprietário, usando o espaço Google One existente. Um Cloudflare Worker Free acessa apenas os arquivos da aplicação com OAuth `drive.file`, guarda credenciais em secrets e faz proxy autenticado. O site não recebe refresh token, client secret ou access token Google.

O login Firebase identifica cada administrador/subadministrador. A autorização OAuth do Drive é central, feita pelo proprietário; os uploads de todos usam essa mesma conta e quota. O proprietário já tem UID `7TitBObtb8a0W8GisSstSM1RHiX2`. Ao habilitar login Google, é necessário vincular esse provider à conta existente para preservar o UID.

A configuração web Firebase já está integrada. O frontend usa `fileStorage: { provider: 'drive', apiBase: '' }`; a URL real do Worker precisa ser preenchida após a publicação. `enableBgg` começa `false`; `measurementId` não inicializa Analytics. O limite de PDF da aplicação é 52.428.800 bytes (50 MiB).

O catálogo usa `games/{uuid}`, e `admins/{uid}` guarda `enabled`, papel `admin`/`subadmin` e permissões. O proprietário tem todas as operações; subadministradores recebem add/edit/delete conforme autorizado. Interface, regras Firestore e Worker aplicam essa autorização. O documento `settings/library.publicRead` ausente/`false` mantém os jogos privados, exceto os marcados individualmente `isPublic: true`; `true` permite leitura anônima de todos os jogos disponíveis pelo site/proxy. O checkbox individual começa desmarcado. Jogos em exclusão não são mostrados aos visitantes; os arquivos continuam privados no Drive. A coleção `manuals`, com futura referência `gameId`, permanece reservada e sem acesso nesta versão.

A versão anterior no host Firebase, Auth, Firestore e administrador foram preparados. Isso não significa que o backend Drive/Worker ou o GitHub Pages já estejam publicados.

## Identificação com origem e revisão

PDF.js extrai o texto que existe no documento. Heurísticas procuram título, limites de jogadores, duração e trecho de objetivo somente quando esses dados aparecem. O nome do arquivo fornece uma sugestão de título; a primeira página pode ser a capa. Antes de salvar, o usuário confirma/corrige informações e escolhe a imagem.

Não há OCR ou geração por IA. Campos ausentes ficam vazios. PDFs digitalizados sem texto podem fornecer capa, mas exigem preenchimento manual de metadados. Faixas de duração devem ser mostradas para revisão, sem fabricar uma média.

BGG é opcional, consultado pelo mesmo Worker com token secreto. O endpoint padrão é `${fileStorage.apiBase}/v1/bgg`, com override por `bggEndpoint`. Requer registro/aprovação da aplicação, respeito às regras de uso e crédito; não se pressupõe XML API anônimo. Dados do PDF, dados originais BGG e correções pessoais precisam ter origem identificável. Aplicações públicas devem mostrar o logo oficial “Powered by BGG” legível, com link ao BGG. [Guia oficial](https://boardgamegeek.com/using_the_xml_api), [termos](https://boardgamegeek.com/wiki/page/XML_API_Terms_of_Use).

## PWA e dispositivos

O manifest conserva standalone com ícones próprios. O Service Worker cacheia a interface e recursos essenciais; novas versões usam identificação de cache própria e removem somente caches do Acervo. A ativação espera `controllerchange` para concluir a atualização.

HTTPS é necessário em produção; localhost atende o desenvolvimento. Android oferece instalação pelo navegador; no iPhone/iPad, Safari → Compartilhar → Adicionar à Tela de Início. A apresentação varia conforme navegador/dispositivo. [Instalação PWA](https://web.dev/learn/pwa/installation).

PDFs não são baixados automaticamente em lote. Na nuvem, o proxy busca o manual quando aberto; cache da interface não garante PDF remoto offline. Auth, consultas remotas e reconhecimento BGG dependem da rede.

O modo `http://localhost:4173/?local=1` ou “Usar biblioteca deste dispositivo” mantém biblioteca real em IndexedDB. Jogos, capas e PDFs locais pertencem à origem/navegador, não sincronizam dispositivos e não migram automaticamente para o Drive. Limpar os dados do site os remove; no modo local, o PDF já importado permanece no navegador.

## Operação e limites

```powershell
npm start
npm test
npm run build
```

O servidor local atende `http://localhost:4173`. O frontend continua sem framework. O Worker tem instalação/build/testes/publicação próprios em `worker/`, descritos no guia.

A escolha usa os planos Spark e Workers Free, o espaço Google One existente e Pages conforme o plano GitHub do usuário. Há quotas de requests, CPU e armazenamento; a Drive API mudou limites em 2026 e anunciou cobrança futura para excessos. Não há promessa de uso ilimitado nem indicação para ativar billing.

[GOOGLE-DRIVE-CLOUDFLARE.md](GOOGLE-DRIVE-CLOUDFLARE.md) apresenta OAuth, secrets, backend, Pages e limites oficiais; [FIREBASE.md](FIREBASE.md) descreve login, papéis e regras. A documentação não certifica deployment da nova integração ou validação em todos os dispositivos.
