# Aproveitamento do resumo já salvo — 19/10/2026

O diagnóstico enviado pelo usuário registra STOP, 2.151 tokens de saída e uma rejeição `application` para Sobre o jogo. Essa rejeição é acrescentada no frontend quando a ficha estruturada passa em `inspectProfile`, mas o candidato utilizado pelo formulário não contém o campo. Ela não prova, isoladamente, qual filtro removeu o texto, nem confirma que ele era uma sinopse útil em vez de um rótulo genérico. Não se leu a resposta real do provedor ou o registro de produção.

Foi reproduzido um problema de aproveitamento: `verifiedKnowledgeFields` só percorria a projeção `knowledge.fields`, mesmo quando `knowledge.profile.description` já continha um resumo válido. Cache com projeção ausente, incompleta ou inválida perdia esse resumo. Agora o frontend recupera o campo estruturado validado quando a projeção não fornece uma descrição utilizável. Título, edição, documento, hash e elegibilidade continuam verificados; nenhuma evidência inválida é liberada. Correções manuais conservam prioridade na consolidação.

Também foi corrigida a perda do trecho de evidência de um resumo vindo de uma seção de visão geral: um fallback indefinido sobrescrevia a referência já encontrada. Rótulos como "jogo de cartas" continuam fora do campo Sobre o jogo, mas passam a ter diagnóstico específico em vez de uma mensagem vaga de identidade/aplicação.

Três regressões locais cobrem projeção ausente/obsoleta, identidade/edição/hash alterados, preservação manual e diagnóstico de rótulo genérico. Dois testes falhavam antes e passaram depois. Resultado final: 216 testes frontend/modelos e 150 Worker aprovados. Navegador com HTML/CSS e controladores reais, provedores simulados: resumo recuperado do registro salvo antes de solicitar análise, origem visível e layouts desktop/tablet/celular conferidos.

Build, sintaxe e `git diff --check` aprovados. Cache local atualizado para `acervo-v1.11.0-saved-profile-summary-15`. Logs: `test-output/saved-profile-summary/`.

**Alterações locais do frontend, sem commit, push ou publicação nesta etapa**, respeitando o acordo de deixar commits/push para o pedido do usuário. No servidor local, atualizar a página e reabrir a ficha permite testar o reaproveitamento sem nova IA. O site hospedado permanece no commit `c4300ee` até a próxima publicação do frontend.

Nenhuma geração Gemini real, consulta ou gravação em dados Firebase/Drive foi executada. O Worker publicado continua na versão `c4ff3808-1aef-459f-9f9f-384ea30cfc24`, com as correções de prazo e preparação do resumo já descritas nos documentos anteriores. O campo real só poderá ser recuperado sem nova IA se o conteúdo salvo for uma descrição utilizável; se for apenas rótulo, não se inventa outro texto em seu lugar.
