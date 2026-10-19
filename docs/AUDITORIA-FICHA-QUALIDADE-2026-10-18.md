# Ficha Gemini, qualidade do PDF e interface — correções locais

## Escopo e limite da conclusão

Esta entrega corrige o fluxo existente de três etapas e mantém **Completar informações** como única ação principal. Não publica nenhuma alteração. Não modifica regras de segurança, configuração do Firebase/Worker, credenciais, dados reais ou integrações de armazenamento.

O texto do PDF brasileiro usado nas imagens não estava disponível nas pastas locais verificadas. O usuário esclareceu que a validação não deve depender desse arquivo. Foi usado o manual inglês real já disponível em `test-output/research-descent/Descent - Legends of the Dark.pdf` (32 páginas), além de casos sintéticos de corrupção e respostas públicas gravadas. Nenhum PDF foi baixado nesta auditoria.

**Não houve chamada Gemini real.** O teste do provedor usa resposta explicitamente simulada e passa pelo sintetizador, schema e validadores reais do Worker. Os catálogos usam capturas públicas anteriores com verificação de integridade. Não se deve interpretar esse teste como comprovação da qualidade da resposta do Gemini em produção ou da disponibilidade atual de um catálogo.

Também não foram consultados caches privados ou registros de produção do teste fotografado. Portanto, não é possível afirmar retrospectivamente se aquele clique gerou IA, reutilizou um resultado vazio ou descartou campos específicos. Os defeitos de código abaixo foram reproduzidos; o diagnóstico novo permite distinguir esses casos na próxima execução autorizada.

## Problemas comprovados e correções

1. **Ficha opcional na resposta Gemini.** O schema exigia as regras, mas não `metadata`. Uma resposta sem ficha podia terminar em `ready` e exibir “Ficha analisada”. Agora `metadata` é exigido na mesma resposta; não há uma segunda chamada. A validação conserva contagens, campos válidos, ausentes e rejeições por fonte, edição, passagem, valor, contexto, corrupção ou faixa.
2. **Cache antigo vazio tratado como definitivo.** O marcador antigo aceitava um objeto vazio como ficha concluída. O contrato de análise da ficha passa para versão 2. Campos antigos realmente válidos continuam reutilizáveis; uma ficha vazia do contrato 1 pode ser atualizada apenas no clique explícito. Uma conclusão vazia legítima do contrato 2 é reutilizada. Testado também com correção manual das regras preservada.
3. **Cache e acompanhamento com identidades diferentes.** A coalescência de chamadas do rascunho usava somente o conjunto de hashes. Agora usa a identidade completa para trabalhos em andamento. O reaproveitamento das evidências por hash exige compatibilidade de título/edição, conjunto de documentos, principal e papel dos documentos. Pontuação e correção de título comprovada pelo próprio manual são aceitas; outra obra ou edição não recebe o conteúdo. Rejeição de identidade não inicia outra geração nem apaga o resultado válido anterior.
4. **Falta de diagnóstico entre validação e aplicação.** A interface distingue nova análise, cache local, cache do servidor e análise armazenada; informa campos utilizáveis e razões verificáveis dos descartes. Não inventa contagem original para um registro antigo sem esse histórico. Conhecimento sem ficha útil não é apresentado como preenchimento bem-sucedido.
5. **Origem PDF apresentada como Gemini.** Fatos apenas recuperados do índice/facts continuam com origem PDF. Campos efetivamente gerados e validados mostram `Origem: Gemini · manual, página X`. O manual explícito tem prioridade quando repete o mesmo dado gerado.
6. **Texto longo corrompido classificado como legível.** A qualidade agora considera substituições, quadrados, área de uso privado, controles inválidos, proporção e sequências de glifos defeituosos. Não usa uma lista de alfabetos latinos nem rejeita japonês, cirílico ou árabe. Símbolos isolados e os ícones esparsos do manual inglês real não acionam OCR de todo o documento.
7. **Recuperação local dirigida.** Páginas suspeitas entram no OCR existente, com lotes, cancelamento e checkpoints. Páginas já legíveis não são refeitas. A recuperação guarda `originalText`, substitui apenas a projeção utilizável e invalida layout/tradução da página recuperada. Falhas não são repetidas automaticamente. Um manual inteiramente ilegível é rejeitado antes do provedor e antes de consumir a cota local de geração.
8. **Corrupção em descrição/tradução.** A sinopse corrompida é recusada, mantendo fatos legíveis como jogadores. Não entra na fila de tradução nem no motor local. Passagens corrompidas não são enviadas ao Gemini; texto e referências originais permanecem armazenados no índice. O diagnóstico indica páginas com leitura insuficiente.
9. **Descoberta dependente de pontuação.** `Descent Lendas da Escuridão` agora oferece a pista de franquia `Descent`, sem uma tabela especial desse jogo. A Wikipédia passa a aproveitar o alias inglês em sua consulta inglesa, em vez de descartá-lo ao escolher apenas uma consulta por idioma. A busca continua em PT/EN/FR. Pistas literais extraídas pelo Gemini têm evidência e idioma, mas não confirmam equivalência sem outra fonte ou escolha do administrador.
10. **Apresentação.** Removida a margem negativa de `.metadata-origin`; wrappers mantêm input e origem no mesmo fluxo. Opções e detalhes são recolhíveis independentes, estados repetidos foram reduzidos e o BGG manual foi mantido. Textos estrangeiros legíveis têm prévia de até 260 caracteres e expansão opcional, sem o parágrafo inteiro por padrão. Indisponibilidade da tradução local é explicada brevemente.

As instruções editoriais e os tópicos das seções de regras não foram reformulados. Os acréscimos ao prompt/schema são da ficha e das pistas de identidade; a filtragem de qualidade protege as evidências.

## Evidências de antes e depois

Os primeiros cinco casos de `tests/profile-final-audit.test.mjs` foram executados antes da correção: **0/5 passaram**. Reproduziam sinopse corrompida aceita, OCR não acionado em página longa, texto ruim na tradução, descoberta vazia sem dois-pontos e ausência de diagnóstico. Todos passam após a correção.

Também foram adicionadas regressões para cache vazio do contrato antigo, troca de título/edição/documentos, alfabetos válidos, conservação do texto original, retomada sem reprocessamento, não envio de corrupção ao provedor, alias inglês e preservação das correções administrativas.

### Cadastro de Descent no navegador

| Origem                    | Evidência usada                                             | Resultado nos inputs e no registro                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF real                  | Página física 2 do manual inglês                            | Mínimo 1, máximo 4 e tipo Cooperativo preservados; idioma verdadeiro `en`                                                                                                                                       |
| Gemini **simulado**       | Passagem existente na página 2, processada pelo Worker real | 3 campos retornados: descrição PT-BR e tipo válidos; idade 99 rejeitada por ausência de prova. A descrição entrou no input e na origem salva; o tipo permaneceu atribuído ao PDF, que já o dizia explicitamente |
| Wikidata, captura pública | Item `Q111669176`, separado dos outros jogos da franquia    | “Fantasia” acrescentada após confirmação da obra. A pista de franquia não aplicou automaticamente uma edição                                                                                                    |
| Correção manual           | Digitação no campo da descrição                             | Sobreviveu à pesquisa seguinte, avanço/retorno, salvamento e reload; origem da correção preservada                                                                                                              |

O título digitado `Descent Lendas da Escuridão` permaneceu salvo. O replay usa as respostas gravadas do título pontuado no transporte; a descoberta sem pontuação e o plano multilíngue também têm regressões independentes no código dos conectores. Não houve nova consulta pública durante os testes.

Repetir Completar informações fez **uma geração simulada no total**, com diagnóstico de reutilização local na repetição. Não gerou novamente na recarga. Duração, idade, edição e mecânicas sem evidência suficiente permaneceram vazias; não foram preenchidas com conhecimento não citado do modelo.

### OCR real local

O índice da página 2 foi substituído por texto corrompido no teste, conservando o PDF inglês original como imagem de entrada. O Tesseract local recuperou essa página e os jogadores 1–4. As outras **31 páginas ficaram intactas**, houve checkpoint persistido e nenhuma página permaneceu pendente. Os cenários de falha/cancelamento/retomada usam ainda as regressões existentes e os testes unitários da fila OCR.

### Layout

Chrome em 1440, 768 e 390 px: sem rolagem horizontal; distância mínima medida de **7,1875 px** entre input e origem. Capturas do cadastro e dos campos foram inspecionadas. Mantidos tema, fluxo de três etapas, revisão na ficha e botão principal único.

## Verificações executadas

- Aplicativo: **183/183** testes.
- Worker: **91/91** testes.
- Segurança: **27/27**, somente Auth/Firestore Emulators `demo-acervo`.
- Navegador: cadastro real de Descent com Gemini simulado/catálogos gravados; OCR local real; oito casos de invalidação/quota/PDF sem IA; cache de rascunho; consenso e proteção de edição manual.
- Sintaxe, build estático, cache essencial e bundle local do Worker (`--dry-run`).
- Nenhuma operação de teste contra Firebase, Drive ou Gemini reais. Os emuladores foram encerrados após os testes.

Evidências descartáveis ficam em `test-output/profile-final-audit/`, `test-output/profile-audit-root-tests.log`, `test-output/profile-audit-worker-tests.log`, `test-output/profile-audit-security.log` e nos logs individuais de navegador. Não devem entrar no artefato publicado.

## Complemento posterior

A validação de cobertura parcial da ficha e a duração fixa receberam correções adicionais, com `profileAnalysis` versão 3. Consulte [Ficha completa e duração](FICHA-COMPLETA-DURACAO-2026-10-18.md) para o comportamento e os testes atuais. Os números acima registram esta primeira rodada da auditoria.

## O que continua limitado

- O Acervo não usa memória não citada do Gemini como fonte de fatos. Este trabalho não adiciona pesquisa Google/grounding, conectores sem autorização ou uma chamada Gemini por consulta. Gemini sintetiza as evidências autorizadas; os conectores existentes continuam responsáveis pela descoberta pública.
- Não existe garantia de preencher todos os campos de qualquer jogo. Se idade/duração não estiverem no manual ou nas fontes disponíveis, continuam vazias e o diagnóstico explica a ausência. Não se confundem nomes encontrados com uma ficha completa.
- A execução real do modelo com o PDF brasileiro fotografado não foi validada e não pode ser inferida dos testes simulados. Exige teste controlado autorizado posteriormente.
- Tradução completa de artigos externos continua dependendo do motor local do navegador ou de texto PT-BR gerado a partir de uma evidência já analisada; não foi ativado serviço externo adicional. Quando o motor local não existe, a ficha permite edição manual e informa a limitação.
- As correções são locais, em frontend e Worker. Precisam de publicação coordenada autorizada para afetar o site real; nenhum commit, push ou deploy foi executado nesta tarefa.
