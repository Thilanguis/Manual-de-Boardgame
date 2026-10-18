# Pesquisa unificada — 17/10/2026

## Correções

- `/v1/research/sources` passou a receber o JWT Firebase, assim como as consultas. O Worker privado já exige autenticação nesse endpoint; omitir o token impedia descobrir as fontes mesmo com uma sessão válida.
- Resultados com identificadores compartilhados e edição compatível formam uma sugestão. O tipo desconhecido pode complementar um jogo base; expansões e edições diferentes permanecem separadas. Títulos parecidos não comprovam identidade.
- Categorias e mecânicas são reunidas sem duplicatas. Valores numéricos divergentes permanecem como alternativas para revisão, sem criar médias ou intervalos artificiais. Fontes, licenças e originais continuam preservados.
- Ao aplicar uma sugestão reunida, todos os seus membros são marcados como utilizados. O aviso de sugestões pendentes não reaparece por contar uma fonte já aceita.
- A pesquisa de um jogo cadastrado consulta em paralelo o conhecimento Gemini já salvo. Apenas sugestões ligadas ao hash atual do manual entram na revisão. Essa leitura tem orçamento de 1,5 segundo e não dispara geração. Sugestões de IA exigem conferência; não substituem alterações manuais silenciosamente.

## Limites explícitos

O Gemini não é um novo catálogo nem faz pesquisa na internet nesse fluxo. No cadastro inicial ainda não há conhecimento de IA salvo para aquele jogo: a geração existente acontece depois do cadastro e da preparação do manual. Esta mudança permite reaproveitá-lo na edição, sem outra geração. Não implementa uma chamada nova ao Gemini para arbitrar resultados de catálogos.

`Gerenciar jogo → Guia` edita o guia que será exibido em `Como jogar`, depois de revisão e publicação. `Gerenciar jogo → PDFs → Adicionar PDFs` acrescenta documentos ao mesmo jogo, até o limite existente de 12. Esses caminhos foram preservados.

## Validação local

- `npm test`: autenticação da lista de fontes, combinação, divergências, isolamento entre PDFs/edições e demais regressões.
- `tests/research-transfer-browser.mjs`: duas fontes simuladas fornecem campos complementares para um único cartão; confere inputs, duração fixa/faixa, confirmação, salvamento e recarga no computador e celular.
- `tests/research-ai-browser.mjs`: painel real reúne texto extraído e conhecimento IA salvo do mesmo PDF, transfere os valores após revisão, não gera novamente e rejeita conhecimento de outro hash.

Testes isolados, sem consultas ao Firebase, Drive ou Gemini de produção. Sem commit, push ou deploy nesta alteração.
