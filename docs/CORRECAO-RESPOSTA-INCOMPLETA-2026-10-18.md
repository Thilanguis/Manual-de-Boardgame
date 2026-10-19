# Resposta incompleta e HTTP 413 — correção local

## O que o print comprova

A tela apresentou “A resposta da IA ficou incompleta” e o console registrou um HTTP 413 em uma rota de conhecimento. Esses sinais não identificam, sozinhos, a mesma requisição nem o motivo de término do Gemini. Não consultei registros, jogos ou manuais reais para completar essa informação.

No código publicado, todo `finishReason` diferente de `STOP` recebia a mesma mensagem genérica. Portanto, o histórico disponível não permite afirmar que a geração real terminou por `MAX_TOKENS`: também poderia ter sido bloqueio ou outra interrupção.

## Defeitos e limites reproduzidos

- A saída conjunta de regras, ficha e referências estava limitada a 6.500 tokens. Um provedor **simulado**, que exige mais espaço para completar 24 seções e ficha, reproduziu a mensagem. Isso verifica o contrato e o tratamento da falha, sem medir o tokenizer ou a qualidade do Gemini real.
- Interrupções simuladas por `MAX_TOKENS`, `SAFETY` e `RECITATION` eram indistinguíveis na aplicação.
- Um manual sintético completo com 250.000 caracteres era recusado com HTTP 413 pelo limite de 200.000 caracteres, antes da geração.
- A rota de conhecimento usava o limite genérico de 16 KB de JSON, insuficiente para revisões válidas de várias explicações. Esse defeito foi reproduzido na rota HTTP com autenticação e serviços simulados. Não é prova de que o usuário estava enviando uma revisão no print.

Os três primeiros testes novos falharam antes da correção; registro em `test-output/knowledge-incomplete/before.log`.

## Alterações

### Worker

- Saída máxima da mesma chamada Gemini: **16.384 tokens**, mantendo modelo, instruções editoriais, temas e exigência de evidência. `sections` da geração pelo manual tem teto de 24 e `identityHints`, 6, compatíveis com o pedido editorial existente.
- Sem continuação automática, segunda tentativa, mudança de modelo ou fallback pago. As cotas de tentativas continuam iguais. O teto de tokens por chamada aumentou; isso não significa consumo fixo de 16.384 tokens.
- Só uma resposta completa e validada é aplicada. JSON truncado, JSON inválido e referências inventadas continuam rejeitados. Partes identificadas como pensamento não entram no JSON da ficha.
- Motivos distintos para limite de saída, bloqueio, interrupção e JSON inválido. O registro salva apenas código de término, teto configurado e contadores numéricos de uso quando fornecidos. Não salva mensagens livres do provedor nem respostas parciais para diagnóstico.
- Texto por análise: **400.000 caracteres**, no cadastro e nos índices de jogos salvos, sem descartar páginas. Limites adicionais: 1.000.000 bytes de evidências serializadas e 1.800.000 bytes por registro. O último protege o armazenamento SQLite e preserva o conteúdo anterior se a nova versão não couber.
- Corpo JSON: até 3.000.000 bytes para rascunho e 1.200.000 bytes para análise/correção de conhecimento. As outras rotas mantêm o limite anterior. Limite de PDF, validação de conta, documento, hash e autorização permanecem iguais.
- HTTP 413 informa qual limite foi excedido e que os fatos existentes foram preservados. O tamanho máximo do índice comprimido/descomprimido permanece protegido.

### Frontend

- Detalhes da pesquisa exibem código de término e contagem de saída quando disponíveis.
- Uma falha nova não mantém o diagnóstico de uma tentativa anterior na tela.
- Falhas preservam correções manuais e fatos já preenchidos. O botão continua sendo **Completar informações**; não foi criado outro fluxo.
- Identificador do cache atualizado para `acervo-v1.11.0-information-ui-9`.

## Validação isolada

- **205 testes de frontend/modelos**, **121 testes do Worker**, **27 testes de segurança nos emuladores**: 353 aprovados.
- Novas regressões: resposta extensa completa; motivos de interrupção; nenhuma repetição automática; JSON vazio/inválido; evidência falsa; manual de 250 mil caracteres integral; excesso antes de gastar cota; bytes com escapes e alfabetos válidos; proteção de registro e correção anterior; diagnóstico persistido e retry somente explícito; rota de revisão maior que 16 KB.
- Navegador, HTML/CSS/controladores reais, provedores simulados: preenchimento de 11 campos, origens, três larguras (1440/820/390), falhas de saída e de tamanho, duração manual preservada e nenhuma ação principal duplicada. Um erro 413 posterior não mostra o diagnóstico antigo de `MAX_TOKENS`.
- Aplicativo completo com Worker real em processo local, Auth/Firestore emulados e Drive/Gemini simulados: cadastro, persistência, consulta e reload passaram. Uma geração principal e uma descoberta de nomes simuladas; consulta/reload sem novas chamadas aos modelos. Nenhuma requisição externa liberada.
- Runtime SQLite local: persistência, concorrência e reinício passaram.
- Sintaxe, build do frontend, bundle do Worker com `--dry-run` e `git diff --check` passaram.

Evidências: `test-output/knowledge-incomplete/`; imagens de três larguras em `test-output/information-stage2/`; resultado do aplicativo completo em `test-output/combined-profile/browser.json`.

## Limitações e publicação

Não executei Gemini real, não li nem alterei Firebase/Drive reais e não gerei custos de produção. Os testes usam manuais sintéticos e respostas controladas; não garantem que qualquer manual arbitrário caiba ou que o provedor nunca interrompa uma resposta. O motivo e o tamanho exatos da requisição do print continuam desconhecidos.

Na conclusão da implementação não houve commit, push ou deploy. Posteriormente, em 19/10/2026, o usuário autorizou a publicação desta correção do Worker, concluída na versão `26b76f32-9892-4d31-9868-f56517ef28bb`. O recibo e o rollback estão em [DEPLOY-WORKER-RESPOSTA-2026-10-19.md](DEPLOY-WORKER-RESPOSTA-2026-10-19.md). O frontend está pronto localmente; o GitHub Pages não foi atualizado por este deploy.

Referências técnicas consultadas: [modelo Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [códigos de término da API](https://ai.google.dev/api/generate-content#FinishReason) e [limites SQLite dos Durable Objects](https://developers.cloudflare.com/durable-objects/platform/limits/). O teto local de saída permanece abaixo do limite documentado do modelo, e o registro é limitado abaixo do teto documentado de 2 MB.
