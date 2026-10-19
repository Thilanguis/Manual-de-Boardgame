# Ficha Gemini: nome corrigido, cache e limites da busca

Diagnóstico e correções locais de 18/10/2026. Não houve commit, push, deploy, chamada Gemini real ou acesso ao Firebase/Drive reais. As limitações e contagens abaixo descrevem a etapa anterior. A solução adicional aprovada e os testes atuais estão em [FICHA-FONTES-AUTORIZADAS-2026-10-18.md](FICHA-FONTES-AUTORIZADAS-2026-10-18.md).

## Causa do preenchimento insuficiente

A chamada implementada usa `gemini-3.5-flash-lite:generateContent`. Ela recebe fontes já coletadas pelo Acervo e não contém `tools.google_search`. A primeira instrução diz explicitamente para não usar conhecimento próprio para completar lacunas. A geração é uma síntese com evidências; a pesquisa externa é realizada por conectores separados.

O fluxo local atual coleta Wikidata e Wikipédia antes da síntese quando `includePublic=true`. Os conectores autorizados restantes continuam entrando na consolidação. Se esses conectores não fornecerem idade/duração e o PDF também as omitir, a IA não dispõe de evidência para esses campos. O conector Wikipédia aproveita título e introdução; não importa a ficha técnica do artigo. Uma busca em três índices linguísticos não equivale a uma busca Google pelo Gemini, nem comprova que o nome inglês foi descoberto.

A captura do usuário comprova que uma análise salva forneceu poucos campos e que o Wikidata forneceu jogadores. Ela não comprova quais valores a resposta original do Gemini retornou: a própria captura informa que a contagem original não foi registrada. Não atribuí as lacunas somente a rejeições da validação, ao nome digitado ou ao CSS.

## O que a requisição envia e pede

`createDraftProfile.prepare()` envia ao Worker o título atual do formulário, edição, tipo informado, PDFs separados com hash, nome, tipo, idioma e texto por página, além das preferências de pesquisa. A identidade é verificada durante as operações assíncronas. O Worker envia ao Gemini:

```json
{
  "game": { "title": "<nome corrigido no formulário>", "edition": "<edição informada>" },
  "sources": ["<manuais por página/passagem e fontes públicas já confirmadas>"]
}
```

O contrato adicional de `metadata` exige todos estes campos. Cada campo encontrado tem `value`, `sourceId` e evidência; a ausência de informação é representada por `null`.

| Campo                            | Chave enviada no contrato                  |
| -------------------------------- | ------------------------------------------ |
| Título                           | `title`                                    |
| Edição                           | `edition`                                  |
| Resumo em português              | `description`                              |
| Jogadores mínimos/máximos        | `minPlayers`, `maxPlayers`                 |
| Duração mínima/máxima em minutos | `minDurationMinutes`, `maxDurationMinutes` |
| Idade recomendada                | `recommendedAge`                           |
| Categorias/temas                 | `tags`                                     |
| Mecânicas resumidas              | `mechanics`                                |
| Tipo de jogo                     | `gameType`                                 |

Uma duração fixa deve repetir o valor nos dois limites; uma faixa deve ser ordenada. O idioma do manual continua sendo identificado a partir do PDF. A ficha não inventa uma edição para preencher o campo.

Configuração atual da geração: temperatura `0.1`, saída JSON com schema, até `6500` tokens, raciocínio `minimal`. As instruções editoriais das seções de regras não foram modificadas nesta correção.

## Falhas reproduzidas e corrigidas

1. **Identidade corrigida presa ao cache:** o Worker rejeitava a análise antiga do mesmo hash e também impedia a renovação explícita. Agora abrir continua sem gerar; Completar informações pode renovar a identidade, passando pelo claim, concorrência e cota existentes. Uma análise completa compatível continua sendo reutilizada. Respostas pendentes da identidade antiga não são aplicadas.
2. **Compatibilidade silenciosa:** a complementação conjunta agora exige `profileMetadataProtocol >= 2`. Um servidor antigo é identificado na tela, sem tentar uma geração antiga e apresentá-la como a ficha nova. PDF/fontes e correções já disponíveis são preservados.
3. **Conclusão enganosa do legado:** análise sem cobertura dos campos atuais passa a ser identificada como antiga/incompleta. Ter uma descrição disponível não significa que idade, duração e os demais campos foram examinados.
4. **Mensagens contraditórias:** durante leitura/OCR/análise há um único status principal, sem declarar antecipadamente que a busca acabou sem correspondência. Resultados de cache não reaparecem como fontes ainda não consultadas. Ausência no cache não é rotulada como uma consulta nova concluída.
5. **Apresentação:** espaçamento positivo entre input e origem, resumo de preenchimento sem margens excessivas e motivos técnicos de campos ausentes agrupados em detalhes. Permanece um único botão principal.

O commit local HEAD continua sendo `4d34b45`, cujo Worker anuncia protocolo de ficha 1. O código novo local anuncia protocolo 2. A configuração habitual aponta para o Worker publicado; atualizar a página não publica alterações do Worker. Não consultei o `/health` publicado nesta etapa, portanto não afirmo ter conferido novamente a versão ativa.

## Evidências isoladas

- `tests/profile-feedback.test.mjs`: quatro casos falharam antes das correções e passaram depois — capacidade antiga, diagnóstico legado, estado da pesquisa salva e conclusão prematura durante progresso.
- `worker/test/draft-profile.test.mjs`: nome corrigido após cache legado retornava `identity_changed` no clique explícito; passou a retornar a ficha da identidade atual. Abrir e reutilizar resultado completo continuam sem nova geração.
- Aplicativo: **204/204** testes.
- Worker: **98/98** testes.
- Segurança: **27/27**, somente nos emuladores `demo-acervo`.
- `tests/profile-feedback-browser.mjs`: estados de progresso/cache/compatibilidade e layout em 1440, 820 e 390 pixels; sem transbordamento horizontal e com pelo menos 7 pixels entre input e origem. Todas as requisições externas bloqueadas.
- `tests/combined-profile-browser.mjs`: frontend e Worker locais com Auth/Firestore emulados; cache legado pré-carregado com nome técnico, seguido do nome corrigido. Uma geração simulada produziu ficha e regras; 11 inputs preenchidos, duração fixa nos dois limites e correção manual preservada. Registro, índices e conhecimento vinculados; consulta/reload sem nova geração ou pesquisa. Drive, catálogos e Gemini simulados.
- Regressões de navegador existentes: oito cenários da auditoria de informações e cache/respostas pendentes do rascunho passaram.

Logs e capturas: `test-output/profile-feedback/`, ignorado pelo Git. A ficha completa da fixture comprova o transporte/aplicação; não comprova que o Gemini real encontrou os dados do Sushi Go Party.

## Pendência: busca autônoma pelo Gemini

Não foi ativado Search/grounding nem removida a validação para preencher dados por memória sem evidência. A [tabela oficial](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite), consultada nesta etapa, informa que Google Search não está disponível na API gratuita do modelo 3.5 Flash-Lite. A mesma documentação descreve uma cota gratuita de busca para modelos 2.5 Flash/Flash-Lite. Essa alternativa precisa ser tratada separadamente: compatibilidade da resposta, referências, limite de chamadas e reaproveitamento, mantendo a geração das regras atual. A escolha foi apresentada ao usuário; nenhum modelo, segredo, faturamento ou configuração de produção foi alterado.

As correções locais de cache e apresentação estão prontas. O objetivo adicional de o Gemini pesquisar por conta própria continua pendente dessa escolha; não é considerado concluído por testes com respostas simuladas.
