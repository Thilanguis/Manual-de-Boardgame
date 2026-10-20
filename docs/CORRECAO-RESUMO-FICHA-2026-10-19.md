# Resumo Sobre o jogo — 19/10/2026

Após a correção do prazo, o usuário confirmou preenchimento dos demais campos de Sushi Go Party, restando Sobre o jogo. Não foi executada outra geração real nem lido o registro de produção. O motivo exato dessa resposta continua dependente do diagnóstico da tentativa; não se atribui a captura a uma causa não verificada.

Dois defeitos foram reproduzidos localmente: rótulos brutos de catálogo podiam ocupar description antes de existir uma sinopse utilizável; qualquer seção de visão geral bloqueava o resumo complementar, mesmo quando excedia os 2.000 caracteres aceitos pela ficha ou era apenas "Jogo de cartas".

Agora somente um resumo validado ou uma visão geral utilizável pode ocupar description. Rótulos brutos deixam a síntese livre para produzir a sinopse em PT-BR. O pedido da ficha explicita 1–3 frases, até 2.000 caracteres; a geração e o formato editorial das regras permanecem iguais. Os textos das regras não são cortados. Resumo válido e correções manuais continuam prioritários.

Os dois casos falhavam antes e passaram após a correção. Um terceiro teste confirma a preservação das prioridades. Suíte Worker: 150 testes aprovados. Cadastro completo no navegador, com PDF sintético, Gemini simulado e emuladores: visão geral longa preservada; resumo separado preenchido, persistido com origem do modelo e preservado no reload, sem geração extra. Logs e evidências: `test-output/profile-summary/`.

Publicado somente Worker pela autorização contínua: versão `c4ff3808-1aef-459f-9f9f-384ea30cfc24`, deployment `d576bd67-1597-40c6-93ce-8039910f3774`, 19/10/2026 às 21:23:45 UTC (17:23:45 America/New_York). Bundle SHA-256 `dd1278524d76a416cefc468cce02844171bfd5a86314bb971a18a6dc6acc087b`. Configurações, segredos, namespace, runtime e migration preservados; /health HTTP 200 e protocolos existentes conferidos. Rollback anterior: `2db476df-01f3-4305-b75f-559c6de03b90`.

Sem commit, push, alteração do frontend ou operação Firebase/Drive real. As correções de timeout anteriores permanecem. O resultado real já obtido pelo usuário não foi modificado; esta publicação não inicia nova análise nem preenche retroativamente o campo ausente. Não se recomenda repetir uma geração apenas para diagnosticar esse resultado.
