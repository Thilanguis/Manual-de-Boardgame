# Pesquisa real de Descent — diagnóstico e correções locais

Investigação de 18/10/2026. Nenhum deploy, commit, push, chamada Gemini ou acesso a dados reais do Firebase/Drive. A única chamada ao Worker publicado foi `GET /health`, expressamente autorizada. As demais consultas externas foram às APIs públicas Wikimedia e à documentação/páginas públicas citadas abaixo. O PDF de teste veio da distribuição pública da Asmodee Canada.

## 1. Causas comprovadas

1. **Busca multilíngue não equivalia a descoberta de tradução.** `queryVariants()` procurava o mesmo texto brasileiro em PT/EN/FR. As respostas reais de `wbsearchentities` foram vazias para “Descent: Lendas da Escuridão” nos três índices; o subtítulo e a busca textual pelo título inteiro também retornaram zero. Nenhuma tabela Descent foi adicionada.
2. **Cobertura limitada da fonte aberta.** Pelo título original, o Wikidata retornou `Q111669176` (jogo, BGG `322708`), `Q122373697` (aplicativo/videogame, descartado) e `Q124478346` (outra obra, BGG `382927`). A entidade correta contém jogadores 1–4 e gênero fantasia, mas não idade, duração, mecânicas nem sinopse. Não há alias PT-BR nessa entidade. Falta de valores não era uma falha de transferência desses campos.
3. **Contagem enganosa.** `research-panel.js` passava a consolidação inteira a `resultSummary()`, que contava também o membro extraído do PDF como “1 jogo encontrado”. Isso não demonstrava correspondência externa.
4. **Incompatibilidade publicada apresentada como indisponibilidade da IA.** O `/health` real respondeu HTTP 200, `apiVersion: 1.10.0`, `knowledgeConfigured: true` e `manualAiEnabled: true`, mas sem `profileMetadataProtocol`, `knowledgeReuseProtocol` e `informationIdentityProtocol`. O cadastro novo verifica o primeiro antes de enviar o rascunho. Sua ausência acionava a mensagem genérica “IA indisponível”, antes de qualquer chamada Gemini. A implementação local já possui esses protocolos. Não foi testada a validade da chave, disponibilidade do modelo ou cota Gemini; os flags não comprovam esses aspectos.
5. **Complemento de categorias bloqueado.** O navegador encontrou “Fantasia”, mas `metadataUpdates()` não complementava a lista “Cooperativo” que já tinha vindo automaticamente do PDF. Isso foi reproduzido no cadastro completo. A correção permite somente acrescentar termos a listas PDF não conferidas, preservando todos os termos existentes. Listas editadas ou confirmadas permanecem protegidas.

Registros originais: `test-output/research-descent/health.json`, `baseline.json`, `baseline-arnak.json` e `public-responses.json`. O último contém URL, horário UTC, status HTTP, corpo original e SHA-256 por resposta.

## 2. Respostas externas reais

| Entrada | Fonte | Antes | Agora, com o código local |
| --- | --- | --- | --- |
| Descent: Lendas da Escuridão | Wikidata | 0 candidatos | 5 obras distintas descobertas pelo prefixo; nenhuma escolhida automaticamente pela franquia |
| Descent: Legends of the Dark | Wikidata | 2 candidatos de jogos | 2 candidatos; seleção exata de Q111669176, sem absorver a outra obra |
| Ambos os títulos Descent | Wikipédia PT/EN/FR | 0 artigos correspondentes válidos | 0 artigos correspondentes válidos; resultados sobre outros assuntos não viram metadados |
| As Ruínas Perdidas de Arnak | Wikidata | 0 candidatos | Q107835072 encontrado por “Arnak”; confirmação necessária se não houver alias verificável |
| Lost Ruins of Arnak | Wikidata | Q107835072 | 1–4 jogadores, idade 12+, duração declarada de 60 minutos |
| Lost Ruins of Arnak | Wikipédia | Artigo inglês correspondente | Introdução licenciada disponível em inglês; fica pendente de tradução, não é exibida como uma sinopse PT-BR |

As contagens são de candidatos válidos após verificar tipo/identificadores; não são contagens de jogos confirmados nem de campos preenchidos. A fonte contém **60 minutos**, e não uma faixa 60–120 para Arnak; o teste conserva exatamente o valor recebido, sem importar números de outro catálogo.

Referências públicas de identidade e fatos:

- [Descent no Wikidata](https://www.wikidata.org/wiki/Q111669176): P2339 = 322708, P577 = 2021, P1872 = 1, P1873 = 4, P136 = Q132311. Não confirma, por si só, a impressão/edição do PDF brasileiro.
- [Edição brasileira no BoardGameGeek](https://boardgamegeek.com/boardgameversion/567195/portuguese-edition): relaciona o título brasileiro ao jogo original e à publicação de 2021. Consultada manualmente para a auditoria; **não implementada como scraping ou tabela de equivalências do aplicativo**.
- [Arnak no Wikidata](https://www.wikidata.org/wiki/Q107835072): BGG 312484, P1872/P1873 = 1/4, P2899 = 12 e P2047 = 60 minutos.
- [Arnak na Wikipédia](https://en.wikipedia.org/wiki/Lost_Ruins_of_Arnak), [autores/histórico](https://en.wikipedia.org/w/index.php?title=Lost_Ruins_of_Arnak&action=history), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Original preservado, sem tradução externa automática nesta investigação.

## 3. Correções no caminho dos dados

### PDF → identificação

- Mantida a extração existente; acrescentado reconhecimento contextual de faixas por extenso, como “one to four players”, “um a quatro jogadores” e “un à quatre joueurs”. A evidência conserva o texto original e a página.
- Um título original explicitamente extraído do PDF pode participar da correspondência exata. Agora essa pista recebe o hash do PDF e só confirma identidade para esse mesmo hash. Pista antiga ou pertencente a outro PDF não confirma a nova obra.
- Não se usa o nome de um aplicativo auxiliar como prova automática de equivalência com o jogo de tabuleiro.

### Consultas → identidade

- Depois de não encontrar correspondência exata, a busca Wikidata faz **uma descoberta adicional limitada**, pelo prefixo antes de dois-pontos ou por um termo final distintivo. Consulta somente itens que possuam identificador BGG e ainda verifica sua entidade/tipo. A consulta permanece sujeita ao prazo de 3,5 segundos por conector e ao limite global de 7 segundos do fluxo normal.
- O prefixo permite encontrar candidatos; **não autoriza aplicar seus dados**. Descent de 2005, segunda edição de 2012, expansões e Legends of the Dark continuam com IDs distintos. Se a fonte não registra a tradução, usa-se a escolha de identidade que já existia no fluxo, agora visível. Não foi criada tela ou ação principal adicional.
- Nomes de candidatos ambíguos não são repassados indiscriminadamente à segunda rodada de pesquisa. Só a identidade confirmada contribui para novas consultas de aliases.
- Wikipédia exige correspondência de nome exata e entidade de jogo vinculada; títulos de artigos vinculados ao mesmo QID passam a integrar os aliases, evitando rejeição posterior pela consolidação. Uma substring comum não confirma uma expansão ou homônimo.

### Consolidação → inputs → salvamento

- Números e listas recebidos continuam sujeitos à mesma edição, identidade, consistência de faixas e proteção de campos manuais.
- Listas automáticas do PDF podem ser complementadas, sem apagar termos nem substituir listas corrigidas. Proveniência de cada contribuição permanece em `sources.metadata`, além do vínculo do catálogo.
- Evidências dos números Wikidata registram a propriedade de origem. O ano de publicação aparece como pista de identificação, sem virar uma edição presumida.
- Resumo principal separa identificação pelo PDF, identidade externa confirmada e fontes com metadados aproveitáveis. Título isolado é informado como correspondência sem dados adicionais. A quantidade **efetivamente aplicada** permanece no resumo da ficha, calculada a partir dos valores atuais dos inputs, não do número de candidatos.
- Diagnóstico por fonte e motivos de ausência permanecem recolhidos. Erros reais continuam visíveis.
- Disponibilidade da ficha IA distingue configuração ausente, autorização desativada, comunicação não confirmada e protocolo incompatível. A cota continua sendo informada pelo resultado do servidor, sem chamada Gemini de diagnóstico.
- A versão da estratégia de pesquisa é registrada no cache. Ao clicar explicitamente em completar, um cache de estratégia antiga pode fornecer fatos já salvos, mas não impede uma busca com a estratégia nova. Não há repetição por abertura/reload.
- Novo módulo incluído no cache essencial; versão do service worker alterada. Configuração de produção, autenticação e políticas de cache privado não foram modificadas.

## 4. Cadastro real no navegador local

O PDF brasileiro da captura não foi disponibilizado. **Não se afirma ter reproduzido sua extração específica.** Foi usado o [manual inglês disponibilizado pela Asmodee Canada](https://cdn.svc.asmodee.net/production-asmodeeca/uploads/2023/10/84-descent-legends-of-the-dark-rulebook.pdf), 32 páginas e 9.762.134 bytes. SHA-256 e URL estão em `test-output/research-descent/manual-source.json`. O título nos metadados do arquivo inclui o sufixo “1jour 1jeu.com”; o teste informa explicitamente o título brasileiro ou original no campo do cadastro, como uma correção do administrador.

Fluxo executado com `app.js`, leitor/extrator e formulários reais: selecionar PDF → informar título → Conferir informações → Completar informações → confirmar identidade quando necessária → verificar inputs → alterar sinopse manualmente → repetir completar sem apagar a correção → avançar/voltar → salvar → ler registro IndexedDB → recarregar biblioteca. Teste em perfil descartável, sem Firebase/Drive real. O transporte de pesquisa reproduz respostas capturadas, passando pelos normalizadores e conectores locais do Worker; não fabrica metadados.

| Campo | Resultado salvo no teste Descent | Origem/limitação |
| --- | --- | --- |
| Título | Nome informado pelo administrador | Preservado após seleção da identidade inglesa |
| Jogadores | 1–4 | PDF, página física 2, “one to four players”; corroborado por P1872/P1873 |
| Tipo | Cooperativo | “cooperative game”, página física 2 |
| Categorias | Cooperativo, Fantasia | PDF + Wikidata P136, origens persistidas |
| Descrição | Sinopse digitada no teste, preservada | Antes da edição, texto inglês extraído ficava pendente de tradução; nenhuma sinopse PT-BR foi fabricada |
| Idade | Vazia | Não encontrada em forma explícita pelo extrator nem fornecida pela entidade consultada |
| Duração mínima/máxima | Vazias | Mesma limitação; não inferidas da duração de missões ou de outra edição |
| Mecânicas | Vazias | Não declaradas de modo aproveitável nessas respostas/extrator |
| Edição | Vazia | A identidade da obra e seu ano não provam a edição do documento |
| Idioma do manual | Inglês | Mantido, embora o título brasileiro possa ser informado |

Com o nome brasileiro sem alias público verificável, são necessárias a escolha **da obra** e a conferência da edição. Pelo nome original, a identidade exata é selecionada automaticamente. Depois de salvo, o vínculo QID/BGG permite reutilizar a identidade daquele cadastro. A consulta de regras não participa dessa busca e não chama Gemini.

Para Arnak, sem fingir possuir seu PDF, também foram testados os mesmos inputs do formulário com as respostas públicas: **1**, **4**, **60**, **60** e **12** entraram em jogadores mínimo/máximo, duração mínima/máxima e idade. Resumo: “5 informações preenchidas automaticamente”. Sinopse permaneceu vazia. Não foi criado jogo Arnak no banco real.

## 5. Cobertura e dependências externas

- **Wikidata:** API automática sem credencial, fatos CC0, cobertura real registrada. [Licença](https://www.wikidata.org/wiki/Wikidata:Licensing) e [uso da API](https://www.mediawiki.org/wiki/API:Etiquette). Cache e prazos existentes preservados. A cobertura não pode ser tratada como um catálogo completo.
- **Wikipédia:** API automática sem credencial; textos com autoria/licença e separação do idioma original. Não encontrou artigo Descent correspondente em PT/EN/FR nestas consultas. Não se presume que um artigo sobre a franquia descreve a edição específica.
- **Ludopedia:** conector existente depende de aplicação/token autorizado, que o usuário informou ainda não possuir. [Cadastro/termos](https://ludopedia.com.br/aplicativo), [documentação](https://ludopedia.com.br/api/documentacao.html): acesso não comercial gratuito com atribuição e link, sujeito à autorização/condições do serviço. É a alternativa mais direta para aliases e fatos brasileiros, após autorização; não há token fictício.
- **BGG:** [política oficial](https://boardgamegeek.com/using_the_xml_api) exige aplicação aprovada, token e atribuição/logo aplicável. O conector mantém esses requisitos e não foi exercitado ao vivo nesta investigação. O `/health` publicado antigo não informa esses flags; com a autorização restrita à saúde, **o estado atual de BGG/Ludopedia no Worker publicado não foi verificado por uma chamada autenticada a `/sources`**. Não se afirma que esses conectores funcionam em produção só porque os testes unitários passam.
- **Editoras:** as páginas oficiais confirmam identidade/contexto, mas não foi encontrada nesta investigação uma API/licença pública suficiente para copiar automaticamente suas fichas, textos ou capas. Nenhum conector de scraping foi criado. [FFG: informações legais](https://www.fantasyflightgames.com/en/more/legal-information/) e [termos](https://www.fantasyflightgames.com/en/more/terms-of-use/). A existência de uma página pública não foi tomada como autorização de reutilização.

**Solução sustentável para ampliar preenchimento:** atualizar o Worker autorizado para o protocolo da ficha já implementado e habilitar um catálogo autorizado com aliases brasileiros, principalmente Ludopedia. Enquanto isso, a pesquisa aberta localiza candidatos e aproveita seus fatos reais, pedindo confirmação apenas onde falta identidade verificável. O Gemini da ficha pelo manual permanece bloqueado no servidor publicado antigo; não foi contornado esse bloqueio nem iniciada geração para testar.

## 6. Validação e isolamento

- `npm test`: **172/172**.
- `npm test --prefix worker`: **87/87**.
- Integração completa com Auth/Firestore **demo-acervo**, Worker e transportes locais: cadastro, etapa 2, cache, legado, correções, recarga e permissões; **27/27** testes de regras de segurança.
- `tests/research-descent-browser.mjs`: dois cadastros completos com o PDF real inglês e títulos BR/original; registro salvo e recarga verificados; três larguras (1440/768/390); transferência de cinco inputs Arnak. Zero requisições externas no navegador automatizado. Arquivo `test-output/research-descent/browser.json`.
- `tests/research-descent.test.mjs`: replay com SHA-256; cinco identidades Descent separadas, aplicativo rejeitado, edição/expansão diferente bloqueada, alias de outro hash rejeitado, listas conferidas preservadas, ausências reais e estados da IA.
- Regressão do fluxo de informações: oito cenários, incluindo resposta inválida, mudança de identidade pendente, PDF sem fatos, quota e IA indisponível.
- Rascunho: uma única chamada simulada entre três consumidores e recarga; cache privado por UID/hash; zero Gemini real.
- Restauração da fila: 12 trabalhos preservados durante carregamento, zero leituras iniciais, nenhuma reanálise de documentos válidos, zero listeners após fechamento.
- Leitor Resident Evil: páginas 1/11/22, zoom/rolagem, três larguras, PDFs separados, cancelamento; um GET por abertura e zero requisições Range remotas.
- Consulta de regras: 17 pesquisas com Duelo, Resident Evil, Dead by Daylight e Zombicide inglês/OCR; páginas conferidas, zero Gemini. Nenhum módulo de qualidade das regras foi alterado.
- `npm run check` e bundle Worker `deploy --dry-run`: concluídos. O dry-run não publicou nada.

Capturas públicas comprimidas, de aproximadamente 175 KiB, ficam em `tests/fixtures/research-descent-public.json.gz`; o helper rejeita respostas ausentes/alteradas e não recorre à rede. O PDF de 9,3 MiB fica somente em `test-output`, ignorado pelo Git. Scripts de captura pública são opt-in e têm lista restrita de destinos Wikimedia; não integram `npm test` nem os testes de emuladores.

## 7. Limite da conclusão

As causas e correções locais acima foram verificadas. **A experiência publicada ainda não contém estas mudanças.** Não houve deploy, acesso a registros reais nem teste de geração Gemini real. Não é possível prometer uma ficha completa de Descent com as duas fontes abertas atuais: faltam dados e a equivalência brasileira na entidade. Isso agora aparece como limitação/decisão de identidade, e não como um sucesso completo de pesquisa ou uma falha genérica de IA.
