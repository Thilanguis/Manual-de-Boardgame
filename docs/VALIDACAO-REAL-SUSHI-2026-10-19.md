# Sushi Go Party — uma análise real autorizada

## Limite exibido no print

Nota de atualização: este documento registra a investigação anterior. A publicação posterior autorizada, incluindo a remoção do bloqueio interno, é registrada em `PUBLICACAO-AJUSTES-2026-10-19.md`. Nenhuma nova geração real foi necessária para essa publicação.

“O limite diário do Acervo foi atingido (5 gerações)” é a cota **interna** do Durable Object, `app-rate-limit`, compartilhada pelo projeto: cinco inícios por dia UTC, dois por minuto. O contador aumenta antes da chamada ao modelo e inclui as tentativas que falham. O print não comprova esgotamento da cota Google.

Não alterei, zerei ou aumentei esse contador. Também não li o registro de produção para inspecioná-lo.

## Execução autorizada

O usuário autorizou uma tentativa real. A sessão Chrome das imagens não estava acessível pela ferramenta. Localizei o arquivo exato em `C:/Users/gabri/Downloads/Manuais de boardgame/sushi_go_party_folheto_de_regras_traduzido_po_63713.pdf` e executei a função atual de geração do Worker em processo local, usando a chave privada já configurada em `.secrets/gemini-api-key.txt`, sem exibi-la.

Isso foi uma validação manual separada da suíte automática, com autorização explícita e trava persistente contra uma segunda execução. Nenhum endpoint Firebase, Drive ou Cloudflare foi chamado. Foram acessadas somente APIs públicas Wikimedia e **uma** requisição `gemini-3.5-flash-lite:generateContent`. A descoberta adicional Gemini 2.5 não foi executada.

- PDF: 9 páginas, 24.677 caracteres inicialmente recuperados.
- Hash: `715ce3ddd0c2b9ee0d250fa818eb68659b522d81d4943b8ce9e379c76178f5d7`.
- Início da chamada: `2026-10-19T06:12:45.601Z` (02:12:45 em America/New_York).
- HTTP **200**, término **STOP**.
- Uso informado pelo provedor: 8.968 tokens de entrada, 2.123 de saída, total 11.091.
- Resultado: 11 assuntos de regras. A ficha retornou sete campos não nulos; cinco passaram na validação, e dois valores de jogadores foram rejeitados porque os excerpts não correspondiam ao passage citado. Não relaxei essa validação.
- Gemini válido: título, descrição, categorias, mecânicas e tipo. Duração, edição e idade não vieram do modelo.

O resultado comprova que a requisição atual pode concluir com o arquivo real e a chave configurada. Não identifica retroativamente o HTTP interno das falhas antigas. Em particular, não comprova a hipótese anterior de complexidade do schema.

## Defeitos comprovados com esses dados

1. **Capa descartada por média OCR.** A capa ilustrada tinha confiança média 40–43. Ao reconhecer faixas com contraste invertido, os rótulos “Idades: 8+” e “2–8 Jogadores” tiveram palavras com confiança 92,8–96,8. O sistema descartava tudo com base na média da página.
2. **Plural não reconhecido.** `extractMetadata` reconhecia `Idade`, mas não `Idades: 8+`.
3. **Faixas de regras invalidavam a capa.** A extração no documento inteiro misturava 2–8 da ficha com exemplos específicos de 6–8 e 2–5 do corpo; a faixa do jogo ficava vazia.
4. **Consulta explícita tratada como tarefa de fundo.** O preenchimento combinado enviava `maxlag=5` ao Wikidata. As respostas reais dessa execução continham erro `maxlag`. A mesma consulta interativa sem esse parâmetro encontrou a entidade correta, `Q85986014`.
5. **Falha de catálogo apresentada como zero resultados.** `collectPublicKnowledge` marcava a fonte como `ok` quando a promessa concluía, mesmo com `diagnostics.complete=false` e falhas internas.

## Correções locais

- Recuperação limitada à capa quando o OCR normal não produz texto utilizável: oito faixas locais; aceita somente linhas numéricas completas cujas palavras tenham confiança mínima 85. Não usa IA externa.
- Textos curtos de ficha podem ser legíveis; não se exigem 40 caracteres de uma capa que só informa idade/jogadores.
- Original, página e versão de OCR preservados. Capas antigas com falha podem ser recuperadas no clique explícito, sem repetir páginas legíveis; resultado com cache completo continua reutilizável sem nova geração.
- `Idades` reconhecido. Ficha numérica explícita e isolada na capa tem prioridade sobre exemplos de subgrupos nas regras, preservando referência à página 1. Sem essa evidência, a ambiguidade continua sem valor presumido.
- O preenchimento iniciado pelo usuário usa consultas interativas nos conectores existentes. Tarefas de fundo continuam respeitando `maxlag`; tratamento de 429, Retry-After e cache permanece.
- Diagnósticos incompletos dos catálogos são exibidos como falha, sem afirmar ausência de jogo.
- Cache frontend local: `information-ui-11`.

## Aplicação no formulário existente, sem outra IA

Reutilizei a resposta real salva e o PDF recuperado no HTML e no consolidador reais. Nenhuma requisição externa foi permitida nessa reprodução.

| Campo | Resultado | Origem |
| --- | --- | --- |
| Título | Sushi Go Party! | título conferido preservado |
| Descrição | preenchida | Gemini, manual, página 4 |
| Jogadores | 2 / 8 | PDF, página 1 |
| Idade | 8 | PDF, página 1 |
| Categorias | preenchidas | Gemini, manual, página 2 |
| Mecânicas | preenchidas | Gemini, manual, página 3 |
| Tipo | Jogo de cartas | Gemini, manual, página 2 |
| Duração mínima/máxima | vazias | nenhuma evidência confirmada |
| Edição | vazia | nenhuma evidência confirmada |

A alteração manual da idade para 9 permaneceu após reconstruir a consolidação. A classificação de tipo retornada pelo modelo ainda é genérica; não a converti em “competitivo” sem nova análise validada. As mecânicas também foram preservadas como retornadas; nenhum dado foi inventado para aparentar ficha completa.

## Cobertura e pendências

A entidade pública correta no Wikidata declara apenas 2 e 8 jogadores entre esses números de ficha; não fornece duração ou idade. Não há artigo vinculado nos idiomas PT/EN/FR dessa entidade. BGG e Ludopedia continuam sem tokens configurados no Worker. Uma ficha integral depende de evidências adicionais de fontes habilitadas; o nome correto e um modelo funcionando não garantem dados ausentes nas fontes fornecidas.

As correções descritas nesta rodada estão **locais**, sem commit, push ou deploy. A validação direta não gravou o resultado na biblioteca real nem no cache do Chrome do usuário. O limite interno de produção continua ativo; nenhuma nova tentativa real foi executada depois da autorizada.

## Evidências

Em `test-output/sushi-real/`: `attempt.json` (trava de chamada única), `provider-http.json`, `result.json`, `knowledge.json`, extração/OCR, consultas públicas, `replay.json`, `replay-desktop.png`, testes e build. Resposta bruta do provedor em `.secrets/manual-validation/<hash>-single-profile-provider.json`, ignorada pelo Git. Nenhum arquivo de evidência ou credencial deve ser publicado.

Regressões novas cobrem palavras OCR de confiança baixa, rótulos curtos, caracteres inválidos, recuperação/versionamento, plural de idade, exemplos de subgrupos, modo interativo e falhas de catálogo. Os 210 testes de frontend/modelos, 124 do Worker e 27 de permissões nos emuladores passaram (361). O navegador validou cache/identidade, cadastro completo simulado e a aplicação dos dados reais salvos. Build e `git diff --check` passaram.
