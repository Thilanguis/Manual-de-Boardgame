# Tentativa Gemini falha com conhecimento anterior preservado

## Evidência do print

O texto “O serviço de IA não concluiu a geração” identifica o ramo de resposta HTTP não bem-sucedida do provedor, excluídos 401/403/404/429, que têm mensagens próprias. Portanto, não é o mesmo ramo `MAX_TOKENS` tratado anteriormente. O código anterior não guardava o status HTTP interno nem a causa; não é possível recuperar essa informação apenas do registro salvo ou do print.

O registro em `attention` conserva intencionalmente `knowledge` anterior. A interface usava `analysisOrigin=generation` da tentativa falha junto da cobertura e dos campos desse conhecimento antigo. Daí “nova análise”, dois campos aproveitáveis e “Ainda sem análise Gemini completa” juntos. Isso não comprovava uma nova análise bem-sucedida.

## Ajustes

- Retirados os `maxItems` de seções e pistas no schema enviado ao Gemini. Essas duas restrições foram introduzidas na publicação anterior; a documentação admite rejeições por complexidade de schema. Esta é uma hipótese de regressão, **não uma causa comprovada da resposta real**. O formato das listas volta ao anterior, mantendo 16.384 tokens de saída, validação das evidências, limite de 32 seções no servidor e até seis pistas aproveitadas. Não houve alteração editorial das regras nem fallback pago.
- Falhas HTTP preservam somente `httpStatus`, código padronizado e categoria segura. Respostas de erro e mensagens livres do provedor não são armazenadas/expostas. Casos de schema, configuração inválida, falta de autorização, modelo ausente, cota e indisponibilidade são diferenciados.
- O registro durável guarda o diagnóstico da tentativa e mantém o conhecimento anterior. Uma nova execução limpa o diagnóstico anterior; abrir novamente não inicia IA.
- A interface identifica “Última tentativa não concluída” e os campos **da análise anterior** preservados. Não atribui a essa falha campos examinados, rejeições ou descoberta de nomes de uma análise antiga. Limitações de leitura antigas são identificadas como anteriores.
- Cache do frontend local atualizado para `information-ui-10`. Continua havendo somente **Completar informações**.

## Verificação

206 testes de frontend/modelos, 123 do Worker e 27 de regras em emuladores passaram. Navegador real com serviços simulados reproduziu falha HTTP 400 com conhecimento anterior, sem rótulo de análise nova e sem apagar duração corrigida. Cadastro completo, consulta e reload passaram com Worker local, Auth/Firestore emulados e Gemini/Drive simulados. Esses testes não comprovam preenchimento real pelo provedor.

Reproduções anteriores às mudanças estão em `test-output/provider-rejection/before.log`. Demais evidências nessa pasta: testes, navegador, emuladores e bundle.

## Aplicação no Worker existente

Aplicado o ajuste da correção solicitada, sem commit/push, na versão imutável `92922af5-5072-485a-ac04-dce4d401d7d7`, tag `knowledge-schema-fix`. Somente três fontes runtime mudaram em relação à publicação anterior: `game-knowledge.js`, `draft-knowledge.js`, `knowledge-response.js`.

Bundle: 350296 bytes; SHA-256 `349dd196fdd668e7ab09865ae27ea2b9a07930fb0f27c9a4489375cae9902f8d`. Configuração, sete segredos, runtime, migration e namespace existentes conferidos e preservados com `--keep-vars --strict`. Não foi feita chamada à aplicação publicada além de `/health`, que respondeu 200 e manteve os protocolos da ficha 2, identidade 1 e reutilização 1. Nenhuma chamada real a Gemini ou dados Firebase/Drive.

Rollback imediatamente anterior: `26b76f32-9892-4d31-9868-f56517ef28bb`, deployment `bec53998-21f5-4af5-9678-6684ccca2304`. Evidências: `test-output/worker-schema-fix-2026-10-19/`.

## Pendências reais

Foi solicitada autorização para **uma** tentativa Gemini real. Ela ainda não foi recebida nesta etapa. A causa HTTP real e o resultado do preenchimento real permanecem não confirmados; `health=200` não valida a geração.

O inventário de automação de navegador retornou somente o navegador interno, sem abas, e MCP Apps; a sessão Chrome das imagens não está acessível atualmente. Não houve reload nem clique no Chrome do usuário. A execução controlada exigirá acesso autorizado ao serviço/sessão ou uma execução do usuário com o diagnóstico novo; não se deve prometer controle de uma aba indisponível.

BGG e Ludopedia continuam sem tokens no Worker. Os catálogos automáticos configurados são Wikidata e Wikipédia; ausência de fatos neles não deve ser ocultada nem tratada como preenchimento garantido. Nada foi preenchido com números ou classificações inventados para eliminar campos vazios.

Referências: [formatos estruturados e limites de complexidade](https://ai.google.dev/gemini-api/docs/structured-output) e [configuração de geração](https://ai.google.dev/api/generate-content).
