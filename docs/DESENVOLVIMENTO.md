# Acervo 1.11 — desenvolvimento isolado

Este guia descreve o ambiente local isolado. Ele não usa contas, documentos, credenciais ou cotas dos serviços de produção.

**Para usar sua biblioteca real manualmente:** execute `npm start` e abra **http://127.0.0.1:4174**. Não exige emuladores nem parâmetros. O servidor não faz recarga automática. Não abra uma sessão real enquanto a cota estiver bloqueada; os testes abaixo não a utilizam.

## Iniciar e encerrar

Requisitos: Node compatível com o projeto, Java 21 e Google Chrome para os testes. O comando reconhece também o Java portátil já instalado em `.test-tools`. As dependências existentes do aplicativo e do Worker devem estar instaladas.

Na raiz do projeto:

```bash
npm run dev
```

Abra **http://localhost:4173** ou execute `npm run dev:open` em outro terminal. Não é necessário iniciar serviços separadamente. `npm start` é reservado ao uso manual com dados reais.

| Conta fictícia | Senha | Acesso |
| --- | --- | --- |
| proprietario@acervo.test | Acervo-teste-123 | Proprietário |
| editor@acervo.test | Acervo-teste-123 | Subadministrador |
| leitor@acervo.test | Acervo-teste-123 | Leitura aprovada |
| pendente@acervo.test | Acervo-teste-123 | Aguardando aprovação |
| bloqueado@acervo.test | Acervo-teste-123 | Bloqueado |

Todos os jogos, textos, PDFs e capas do seed são fictícios. Catan e Azul aparecem somente para exercitar o provedor simulado; seus metadados e regras demonstrativas não são informação editorial real. O proprietário local tem UID `dev-acervo-owner`. As regras são copiadas do código atual, substituindo apenas o UID fixo pelo proprietário fictício; as condições de autorização permanecem iguais.

```bash
npm run dev:reset   # restaura somente os dados fictícios; encerre suas edições antes
npm run dev:stop    # salva os dados locais e encerra os processos iniciados pelo comando
```

Ctrl+C também encerra e salva. Para restaurar o seed com sessões abertas, saia da conta e recarregue. Arquivos, exportações e SQLite ficam em `test-output/development`, ignorado pelo Git. O início seguinte importa as contas e documentos locais e reutiliza o SQLite. Não são copiados dados nem credenciais de produção. O reset intencionalmente remove os resultados fictícios anteriores.

Se uma porta estiver ocupada, o início recusa continuar. Não reutiliza um processo desconhecido nem procura serviços remotos.

## Serviços e proteção contra produção

| Serviço | Endereço | Implementação |
| --- | --- | --- |
| Frontend | localhost:4173 | HTML/CSS/JS existentes |
| Auth | 127.0.0.1:9099 | Firebase Authentication Emulator |
| Firestore | 127.0.0.1:8080 | Firestore Emulator, projeto `demo-acervo` |
| API | 127.0.0.1:8787 | Worker existente no workerd/Miniflare |
| Conhecimento | armazenamento local | Durable Object com SQLite real |
| Drive e Gemini | transporte interno | Simulados, sem chamadas Google |
| Métricas | 127.0.0.1:8788/metrics | Diagnóstico local em JSON |

O bundle do Worker é preparado com `wrangler.dev.jsonc` e **`--dry-run`**. Nenhum recurso Cloudflare é criado. O gateway converte a sessão do Auth Emulator em um JWT de teste assinado com uma chave RSA fictícia; o Worker continua executando sua verificação de assinatura, perfil atual e regras. As consultas REST do Worker são encaminhadas exclusivamente ao Firestore Emulator. A pasta simulada tem ID fictício; o bloqueio da pasta real em produção permanece.

Todas as saídas do workerd passam pelo transporte simulado. URLs desconhecidas são recusadas; não existe fallback para fetch externo. Os endpoints de controle/seed escutam somente em loopback e recusam solicitações com Origin. Não são publicados no build estático nem fazem parte do Worker de produção.

A configuração normal do frontend usa os serviços reais, inclusive no localhost. O servidor iniciado por `npm run dev` substitui explicitamente a configuração por `DEV_CONFIG`, marca o HTML como isolado e aplica CSP local. A inicialização desse modo valida projeto, Auth, Firestore e API **antes** de carregar o SDK. Mesmo uma configuração real injetada por engano é recusada nesse HTML de teste.

O servidor de desenvolvimento entrega o SDK Firebase instalado por URLs locais e usa CSP para impedir conexões externas. `cacheKeys/{uid}` usa a porta 8080. Se os serviços estiverem desligados, aparece “Ambiente local desconectado”, os controles de entrada ficam indisponíveis e nenhuma conexão real é tentada. Abrir somente o servidor estático não inicia nem seleciona produção.

Para conferir, abra Rede no DevTools: os serviços devem usar somente as portas acima. No console, `window.__ACERVO_METRICS__` mostra contadores do cliente. A API de métricas mostra o projeto, as consultas REST, chamadas ao Gemini simulado e tentativas externas bloqueadas. Não registra tokens.

Os comandos de teste recusam projetos/hosts externos. O preload do Node bloqueia fetch para fora do loopback; os testes de navegador bloqueiam e registram qualquer tentativa externa. Bibliotecas e modelos de OCR são servidos pelo próprio projeto.

## Auditoria de leituras e listeners

Os gráficos informados não identificam por si só quem gerou as 27 mil leituras ou as 8,2 mil negativas. Não atribuímos o histórico inteiro aos testes. O código anterior, entretanto, tinha caminhos concretos que ampliavam o consumo:

| Operação encontrada | Correção aplicada | Evidência local |
| --- | --- | --- |
| Um listener `games/{id}/indexes` para **cada** jogo ao carregar a biblioteca | Observar somente o jogo aberto; encerrar ao trocar/fechar | Biblioteca simulada com 80 jogos: **0** listeners de índice; abrir/trocar jogo: **1** no máximo; encerrar: **0** |
| `prepareCache` repetia GET de `cacheKeys` em novas emissões de perfil | Uma tentativa por sessão, deduplicação em andamento e reutilização da chave; repetir somente por ação explícita | Contador `rest` separado; login inicial faz um GET, com POST apenas quando a chave ainda não existe |
| Configurações eram consultadas de novo em cada atualização de perfil | Uma leitura inicial por sessão, seguida pelo listener existente | Contador por caminho, sem nova leitura inicial a cada emissão |
| Pessoas e histórico assinados ao abrir qualquer aba administrativa | Carregar pessoas apenas em Usuários/Histórico e auditoria apenas em Histórico | Contadores de listeners por caminho e encerramento ao sair da aba/painel |
| Renderizações simultâneas podiam baixar a mesma capa duas vezes | Compartilhar a Promise da requisição; guardar falhas permanentes até tentativa explícita ou nova sessão | Testes de renderização/foco após 403 e 429: **0** novas requisições |
| Foco da janela e mudanças do catálogo podiam repetir verificação após falha | Intervalo mínimo no foco, suspensão após 401/403/429; aviso real na tentativa manual | Fault injection no Worker local, sem repetir consultas |
| Cota do Firestore virava erro genérico 503 e entrava em retry | Preservar 429 e tratar permissão/cota como falha permanente da tarefa | Testes de falha, sem retry automático para 403/429; falhas transitórias mantêm tentativas limitadas |
| Testes não podem selecionar serviços reais por engano | Configuração fictícia explícita no servidor isolado, marcador no HTML, CSP e validação sem fallback | Teste injeta configuração real no ambiente isolado: inicialização bloqueada antes do SDK; uso manual permanece real |

Na biblioteca fictícia, o proprietário mantém **4 listeners**: perfil, solicitações pendentes, jogos e configuração. Um usuário comum não assina solicitações. Três ciclos de login/logout mantiveram quatro ao voltar e zero ao sair. Recarregar não multiplicou assinaturas. O processamento continua consultando os registros necessários para conferir hashes e permissões; isso é contabilizado, não escondido.

`reads`/`writes` são operações lógicas do SDK, incluindo leituras de transações e documentos entregues por snapshots. Tentativas de transação podem repetir. `rest` contabiliza o cache separadamente, e as métricas do Worker contabilizam suas próprias consultas. **Esses números não são um cálculo de cobrança**, nem incluem os acessos internos de avaliação das regras. Não devem ser somados e apresentados como leituras faturadas exatas.

## Limite e gerenciamento

Novos PDFs e substituições: **50 MiB = 52.428.800 bytes**, com blocos de **8 MiB**. Validação no formulário, inclusão/substituição, storage, Worker e regras. Sessões antigas de upload acima do novo limite também são recusadas. Capas e índices mantêm seus limites próprios.

O cadastro inicial permite selecionar vários arquivos e usar **Adicionar mais PDFs** na etapa Identificar jogo, até 12 documentos no mesmo jogo. Nome, tipo e idioma dos complementos podem ser conferidos antes do envio. Falhas parciais mantêm o cadastro aberto para tentar novamente sem reenviar arquivos concluídos. Veja [validação do cadastro múltiplo](CADASTRO-MULTIPLOS-PDFS-2026-10-17.md).

O limite de leitura continua separado, preservando documentos de até 200 MiB cadastrados anteriormente. As regras aceitam editar os metadados de arquivos antigos maiores e trocar o principal por um documento já existente. Não aceitam aproveitar essa exceção para inserir ou substituir um PDF novo maior. Nenhum arquivo antigo é removido ou comprimido.

Na tela do jogo, os manuais ficam disponíveis para leitura. “Gerenciar jogo” abre uma janela com abas **PDFs / Informações**. Adicionar e substituir PDFs ficam visíveis. Editar dados do PDF usa um único painel de campos. Tornar principal e remover um complemento são ações explícitas; excluir o jogo fica separado ao final, somente para o proprietário. Não há duas listas administrativas dentro da ficha nem acordeões aninhados. A consulta unificada substitui o editor de guias, preservando dados antigos; veja [validação de 17/10/2026](CONSULTA-UNIFICADA-2026-10-17.md).

A exclusão fica numa faixa fixa da janela, sem depender de rolar a lista. A remoção final do cadastro usa `documents:commit`, com `currentDocument.updateTime` no corpo JSON, mantendo a verificação de versão. O emulador recusava a mesma condição como parâmetro da URL do DELETE; o teste completo revelou e corrigiu essa incompatibilidade sem enfraquecer as regras. O teste verifica também que os novos arquivos são removidos e os anteriores preservados.

## Testes reproduzíveis

Em um terminal mantenha `npm run dev`. Em outro:

```bash
npm run test:install   # instala somente Playwright e pdf-lib no pacote de testes
npm run test:dev       # restaura o seed; executa os fluxos locais abaixo
```

O pacote de navegador é separado para não re-resolver dependências do Firebase. Foi instalado com sucesso neste computador. A tentativa de adicioná-lo ao pacote principal encontrou uma dependência transitiva existente sem versão disponível (`@opentelemetry/api@~1.10.0`); a inspeção comparou o lockfile com os metadados dos pacotes instalados e encontrou versões trocadas de 1.9.0 para 1.10.0, inclusive URLs cujo integrity continuava sendo o da versão antiga. Esses registros foram corrigidos para os metadados reais, preservando as versões instaladas do Firebase. A instalação limpa do pacote principal não foi validada nesta tarefa. Reiniciar os serviços com as dependências já instaladas foi validado.

Fluxos automatizados:

- `development-browser`: acesso privado, cadastro pendente, aprovação, leitura, capas, complemento pesquisável, guia, CRUD inicial, bloqueio, gestão em 1440/820/390 px, reload e login/logout.
- `development-ocr-browser`: PDF fictício com duas páginas escaneadas, OCR local automático até concluir, índice persistente, busca e reutilização após reload.
- `limit-50-browser`: rejeição de 50 MiB + 1 byte, envio/salvamento de exatamente 50 MiB, leitura de registro antigo fictício de 100 MiB em telas de computador/tablet/celular e edição dos seus metadados.
- `development-failures-browser`: serviços indisponíveis, configuração real bloqueada, 403/429 sem loops, biblioteca com 80 jogos e limite de um listener de índice.
- Ao final, reinicia o Worker real do ambiente, recupera o conhecimento do SQLite e verifica zero novas gerações.

São dimensões de tela em Chrome; não equivalem a medir memória em aparelhos físicos. As amostras grandes usam PDF válido com padding, somente para teste. Não foi usado um documento privado de produção.

Relatórios: `test-output/development-*-report.json` e `test-output/limit-50-browser-report.json`; capturas: `test-output/dev-management-*.png`.

Suítes e builds adicionais:

```bash
npm test
npm test --prefix worker
npm run check
npm run build
npm run build --prefix worker  # somente dry-run
```

Para testar as regras com a suíte independente, encerre primeiro `npm run dev:stop` e execute `npm run test:rules`. Ela usa o projeto demo e o UID provisionado nos fixtures da suíte, sem alterar produção. Depois, `npm run dev` restaura a configuração do proprietário fictício do ambiente.

## Uso manual real, sem recarga automática

Na pasta do projeto, execute somente:

```powershell
npm start
```

Abra **http://127.0.0.1:4174**. Use seu e-mail e senha habituais. O comando seleciona os serviços reais existentes e ignora variáveis antigas do ambiente fictício. Não é necessário informar PORT, liberar produção ou recriar jogos/PDFs. Authentication e Firestore mantêm as contas e dados do mesmo projeto; Drive, Worker e Gemini mantêm os endpoints e configurações existentes. Os limites e as permissões atuais continuam valendo.

Mantenha o terminal aberto. Atualize pelo navegador quando quiser e encerre com Ctrl+C. O servidor não tem watcher, WebSocket de reload ou navegador aberto automaticamente. Se a porta estiver ocupada, encerre apenas o servidor antigo do Acervo antes de repetir o comando; não encerre outro aplicativo.

O Live Server também recebe a configuração real. Neste workspace, `liveServer.settings.ignoreFiles` ignora todos os salvamentos para evitar recargas repetidas; reinicie o Live Server caso já estivesse ativo para aplicar a preferência. O servidor de `npm start` é a opção recomendada e independe dessa extensão.

Os testes mantêm `demo-acervo`, CSP e bloqueio de rede externa. O teste remoto legado `cloud-check.mjs` foi desativado antes de abrir navegador ou consultar serviços reais. Não execute testes automáticos contra o servidor manual. Nenhuma chamada real foi feita para validar esta restauração enquanto a cota estava bloqueada.

No localhost/127.0.0.1, a PWA não instala um cache do aplicativo. Um service worker antigo recebe uma atualização que o desregistra e remove somente os caches estáticos do Acervo. Login, IndexedDB e conteúdo da biblioteca não são apagados. Recarregue a página após essa atualização para usar os arquivos atuais. No site hospedado, a instalação e a atualização com proteção de edições continuam disponíveis.

## Integrações reais futuras

Este ambiente não possui modo automático de integração real. Deploy do frontend/Worker/regras, migração e configuração/uso da chave Gemini real continuam dependendo de autorização explícita. O acesso manual ao Drive/Firebase reais está disponível no servidor estático habitual descrito acima. Nenhum comando de teste habilita esses acessos.

## Resultado da validação local

- 97 testes do aplicativo, 70 do Worker e 27 das regras: **194 aprovados**.
- Fluxos de navegador, OCR, limites e falhas passaram sem requisições externas nem erros de JavaScript.
- Cache negado com HTTP 403: apenas **um GET**, mesmo após cinco atualizações reais do perfil no emulador.
- Gemini simulado e arquivos foram recuperados após reiniciar o Worker; nenhum novo pedido de geração foi necessário.
- Regressões adicionais de múltiplos PDFs, guia de 20 páginas, publicação, imagens, cancelamento/retomada e cache criptografado passaram.
- Build estático, sintaxe e Worker `--dry-run` passaram. Produção permanece inalterada.

As configurações são deduplicadas inclusive entre solicitações simultâneas. Ao destruir a sessão, as respostas pendentes são invalidadas para não reabrir o cache depois do encerramento.


## Ficha consolidada de informações

PDF, fontes públicas e Gemini salvo usam o mesmo modelo na etapa 2 e na administração. Critérios, persistência e testes: [Ficha consolidada](FICHA-CONSOLIDADA-2026-10-17.md).
