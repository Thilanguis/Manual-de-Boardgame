# Edição e limites de geração — 17/10/2026

## Salvamento

Uma correspondência podia trazer o nome em `names` sem `fields.title`. A consolidação criava o título sem origem completa; ao aplicar as sugestões, `sources.title.url` recebia `undefined`, rejeitado por `Transaction.set()`.

O título agora mantém sua origem, identificador e campos opcionais normalizados. A aplicação de sugestões também usa strings vazias para URLs/licenças ausentes, inclusive nas correspondências salvas. Antes da gravação, o repositório remove propriedades opcionais `undefined` em objetos aninhados. Valores válidos e instâncias do SDK, incluindo `Timestamp` e `serverTimestamp()`, são preservados. Não foi ativado `ignoreUndefinedProperties` globalmente.

## IA e erro 429

O Worker já limitava novas gerações a duas por minuto e cinco por dia UTC, compartilhadas pelo Acervo. Esses limites foram mantidos. Uma recusa interna devolvia `message`, mas o cliente lia apenas `error` e trocava a explicação por um erro genérico de Drive.

O cliente passou a preservar mensagem e estado de limite; o painel mantém a explicação visível e preserva o conhecimento existente. O Worker identifica limite interno por minuto/dia e informa `retryAt`. Enquanto esse prazo não chega, o botão fica indisponível e reabre no horário, sem iniciar uma geração automaticamente. Repetir uma solicitação durante o prazo não baixa novamente os índices do Drive. Falhas de quota do provedor são identificadas separadamente, sem inventar um horário de liberação.

Somente os limites internos têm um horário de nova tentativa conhecido. O print com 429, sozinho, não informa qual limite foi atingido. Nenhuma cota foi zerada ou ampliada, nem foi habilitado faturamento.

## Testes

- `npm test`: 111 testes.
- `npm test --prefix worker`: 78 testes.
- `tests/edit-save-firestore-browser.mjs`: Chrome, SDK Firebase real, Authentication/Firestore emulados em `demo-acervo` e regras atuais. Edita o jogo, pesquisa uma correspondência sem URL e sem `fields.title`, confirma sugestões, salva, confere o documento e recarrega. Verifica também propriedades opcionais aninhadas, identidade do PDF, autor e timestamps preservados.
- `tests/knowledge-quota-browser.mjs`: simula limites por minuto, dia e provedor; confere mensagem persistente, disponibilidade do botão, uma única tentativa e preservação de texto revisado.

Sem chamadas de teste ao Gemini/Firebase/Drive reais. Sem commit, push ou deploy. As melhorias do diagnóstico do servidor exigem publicação do Worker quando autorizada; o tratamento da mensagem existente e o salvamento são correções do frontend.
