# Consultar regras: relevância, passagens e leitura

Implementação local. Sem commit, push, deploy ou alteração de dados/regras de produção.

## Correções

- A pesquisa compara o assunto de cada passagem, em vez de unir todos os títulos da página e exibir o primeiro.
- Cabeçalhos, subseções, listas de componentes e blocos extensos são separados em passagens, mantendo documento, página e hash.
- Sumários, exemplos impressos dentro de cartas e menções ocasionais não ganham prioridade como respostas diretas. “Peças” deixou de transformar custos em componentes; fim de capítulo não é condição de vitória.
- Perguntas em português, inglês e francês usam famílias de termos. Ações e assuntos centrais pesam mais que uma menção ao personagem. Um tópico Gemini incorreto não basta para tornar uma explicação relevante.
- Correções e explicações armazenadas têm prioridade entre resultados relevantes; uma explicação genérica não supera uma seção diretamente correspondente do PDF.
- Cópias exatas ou quase idênticas são reunidas, preservando referências. Quantidades, negações, ordem das instruções e hashes diferentes impedem deduplicações arriscadas.
- São exibidos até três resultados inicialmente. Os demais e os trechos relacionados ficam recolhidos. Sem correspondência direta, a tela informa isso explicitamente.
- Prévias usam frases/parágrafos completos e uma janela contextual, com expansão do trecho. Não há corte fixo em 800 caracteres nem corte de palavras.
- Linhas artificiais são unidas; listas, etapas e parágrafos são preservados. Conteúdo é renderizado como texto, sem HTML recebido das fontes.
- Respostas antigas são descartadas imediatamente quando o usuário muda a pesquisa, inclusive antes do debounce. Isso corrige a corrida que podia apresentar resultados da pergunta anterior com o rótulo da atual.

## PDFs em colunas e índices existentes

Resident Evil e Dead by Daylight continham textos de duas colunas intercalados nos índices exportados. Limpar espaços não resolveria essa mistura.

A leitura usa uma projeção baseada nas posições dos textos do próprio PDF. Novas análises já guardam essa projeção junto ao índice, sem modificar `page.text`, citações ou hashes. Índices antigos permanecem intactos: a projeção é preparada sob autenticação e guardada no cache privado por usuário, documento e versão. Não é escrita no Firestore ou Drive durante a consulta.

Essa preparação pode precisar ler o PDF uma vez no primeiro acesso a um índice antigo. Utiliza a leitura autenticada existente, processa um documento e uma página por vez e não renderiza imagens para extrair texto. O cache evita repetir esse processamento em cada pergunta. Fechar a consulta ou revogar a sessão interrompe a operação; um resultado tardio não é exibido nem gravado.

OCR já concluído é reutilizado. Não se repete OCR nem se aciona Gemini. Traduções previamente armazenadas continuam sendo usadas; o idioma confirmado do documento prevalece sobre um idioma antigo do índice. Sem tradução, a interface avisa e oferece original e página. Diagramas e tabelas complexas continuam disponíveis no PDF; não são convertidos em regras ou quantidades inventadas.

## Validação com arquivos reais no Chrome

Os hashes dos quatro PDFs foram conferidos contra seus índices exportados. Cada botão de referência abriu o PDF original no leitor e o número físico da página foi verificado.

| Jogo | Consulta | Primeiro resultado / página física |
| --- | --- | --- |
| Duelo pela Terra Média | Componentes | Componentes — 1 |
| Duelo pela Terra Média | Preparação | Preparação — 2 |
| Duelo pela Terra Média | Turnos | Visão geral do turno — 3 |
| Duelo pela Terra Média | Cartas | Custos de cartas / moedas — 4 |
| Duelo pela Terra Média | Custos | Custos de cartas / moedas — 4 |
| Duelo pela Terra Média | Condições de vitória | Fim da partida / Demanda do Anel — 8 |
| Resident Evil | Componentes | Componentes / personagens — 5 |
| Resident Evil | Como atacar um inimigo? | Atacar — 8 |
| Resident Evil | Como funciona um turno? | Turno dos jogadores — 8 |
| Resident Evil | Cartas de item | Cartas de item — 6 |
| Dead by Daylight | Componentes | Lista de componentes — 3 |
| Dead by Daylight | Preparação | Preparação — 6 |
| Dead by Daylight | Como atacar? | Atacar — 14 |
| Dead by Daylight | Como mover o sobrevivente? | Movimentação — 8 |
| Zombicide em inglês, com OCR salvo | Preparação | Setup — 6 |
| Zombicide em inglês, com OCR salvo | Como atacar? | Combat Actions — 21 |
| Zombicide em inglês, com OCR salvo | Turnos | Resumo de fases — 68 |

Também foram verificados:

- Inventário de peças efetivo em Dead by Daylight, evitando texto ilustrativo de cartas.
- Instrução de ataque em Resident Evil e movimentação em Dead by Daylight, sem intercalar a coluna vizinha.
- Resposta apenas relacionada para “Tabuleiro Central”, com aviso explícito.
- Conhecimento armazenado simulado com citações reais: correção relevante primeiro, PDF duplicado removido e explicação genérica recolhida. Nenhuma geração real.
- Computador (1440 px), tablet (768 px) e celular (390 px).
- Cache da projeção reutilizado e índice original inalterado.
- Entrega controlada de resposta antiga durante nova digitação.
- Revogação durante preparação, sem conteúdo residual nem gravação tardia.

## Suítes e artefatos

- `npm test`: **136 testes passaram**.
- Worker: **81 testes passaram**.
- Regras Firestore: **27 testes passaram** nos emuladores `demo-acervo`.
- Integração Auth/Firestore/Worker: cadastro com múltiplos PDFs, geração inicial deduplicada, consulta local sem gerar, correções e permissões preservadas.
- Regressão de documentos: PDFs separados de 13/60/8 páginas, referência, progresso, substituição e remoção nas três larguras de tela.
- Regressão de consulta: índices legados, fontes independentes, conhecimento salvo e controle de quota existentes.

Testes específicos: `tests/rule-quality-real-browser.mjs`, `tests/rule-query-race-browser.mjs`, `tests/rule-passages.test.mjs`, `tests/rule-layout.test.mjs`. Relatório e capturas descartáveis: `test-output/rule-quality/` (ignorado pelo Git).

**Chamadas Gemini nas 17 pesquisas reais: zero.** APIs de produção ficaram bloqueadas nos testes; Gemini/Drive foram simulados na integração com emuladores. Nenhuma cota de produção foi utilizada.
