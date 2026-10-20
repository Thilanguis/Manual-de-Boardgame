# Limpeza dos bloqueios internos legados

## Resultado

O Acervo não aplica limites internos de cinco gerações diárias nem de duas por minuto. Os contadores já estavam desativados; esta correção remove o efeito residual dos registros históricos sem `reason`, que ainda guardavam a mensagem exata “O limite de geração foi atingido. Tente novamente mais tarde.”.

O reconhecimento exige status `quota`, ausência de `reason` e `provider` e a mensagem histórica exata. Cotas reais do provedor e registros de origem desconhecida permanecem intactos. A normalização preserva conhecimento, revisões e correções; abrir a ficha não inicia uma geração.

Autenticação, permissões de administrador/subadministrador, revogação, identidade dos documentos e proteção contra requisições duplicadas foram preservadas. O limite de uma chamada auxiliar de descoberta de nomes por análise evita duplicação dentro da mesma análise; não limita quantas análises o administrador pode solicitar.

## Verificação isolada

- Antes da correção, dois testes reproduziram o registro legado sem `reason` bloqueando o fluxo.
- Depois: 219 testes do frontend/modelo e 151 do Worker passaram.
- O teste do armazenamento confirmou 12 solicitações consecutivas sem cota interna, inclusive com contador legado 999, que permanece inerte.
- Teste de navegador com serviços simulados: registros antigos liberados, conhecimento salvo intacto, cota do provedor preservada e nenhuma geração ao abrir a ficha.
- Verificação estática, build frontend, bundle de publicação e `git diff --check` aprovados.
- Evidências locais ignoradas pelo Git: `test-output/legacy-untagged-quota/`.

## Publicação e reversão

Somente o Worker foi publicado em 19/10/2026, às 22:57 no fuso America/New_York (20/10/2026, 02:57 UTC).

- Worker: `acervo-drive-api`, API `1.11.0`.
- Versão publicada: `e4739b61-756c-4204-ab52-a094cf2d7f04`.
- Versão anterior para rollback: `4f308e7d-da6e-4cb8-ac8d-0a4652733ac5`.
- Reversão, se necessária: `node worker/node_modules/wrangler/bin/wrangler.js rollback 4f308e7d-da6e-4cb8-ac8d-0a4652733ac5 --config worker/wrangler.jsonc`.
- SHA-256 do bundle: `b9a1cacf85c2aaf02e8dfb6851dba5795789e1debd130de6be9d9ffc136ed065`.

A comparação antes/depois confirmou as seis variáveis existentes, os nomes dos sete segredos, o binding/namespace do armazenamento e o runtime. Nenhuma alteração de credenciais, regras Firestore ou dados foi realizada.

Após a publicação, somente `/health` e metadados de implantação foram consultados. `/health` retornou HTTP 200, `knowledgeInternalQuota: false`, protocolos compatíveis e ausência de limites internos diários ou por minuto. Nenhuma chamada real Gemini, Firebase ou Drive foi feita para validar esta alteração.

Não houve commit nem push. A alteração compartilhada também está disponível no frontend local; o cache local passa a `acervo-v1.11.0-legacy-quota-cleanup-16`. A publicação do frontend no GitHub Pages fica para o próximo commit/push solicitado.
