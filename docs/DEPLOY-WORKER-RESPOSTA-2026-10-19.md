# Publicação da correção de resposta incompleta

Publicação autorizada pelo usuário em 19/10/2026, America/New_York. Somente Worker, sem commit ou push.

- Worker existente: `acervo-drive-api`.
- Nova versão imutável: `26b76f32-9892-4d31-9868-f56517ef28bb`.
- Tag: `knowledge-response-fix`.
- API: `1.11.0`, com protocolos existentes preservados.
- Bundle: 348785 bytes; SHA-256 `9e6f9333b8b0f799c53c987892f5f47df34db59234547370d1e9ba0223e0e52e`.
- Manifesto: 70 entradas de runtime, 31 fontes locais. Comparado ao deploy anterior, apenas seis fontes mudaram: `knowledge-limits.js`, `knowledge-response.js`, `manual-knowledge.js`, `draft-knowledge.js`, `game-knowledge.js` e `index.js`, todas em `worker/src/`. Nenhum teste, PDF, log ou arquivo privado entrou no bundle.

Os 121 testes isolados do Worker e a verificação de sintaxe passaram antes do deploy. O preflight por Wrangler confirmou as mesmas seis variáveis, os nomes dos sete segredos, a classe e o namespace existentes de `GAME_KNOWLEDGE`, runtime e migration. Nenhum valor de segredo foi lido. Deploy com `--keep-vars --strict`; nenhuma configuração ou regra Firebase alterada.

Depois do deploy, a única requisição à aplicação publicada foi `GET /health`: HTTP 200; `profileMetadataProtocol=2`, `profileDiscoveryProtocol=1`, `knowledgeReuseProtocol=1`, `informationIdentityProtocol=1`, `knowledgeConfigured=true`, `manualAiEnabled=true`. CORS de `http://127.0.0.1:5500` conferido. O checksum do bundle após publicar continuou igual ao manifesto.

Não houve teste Gemini real, operação contra Firebase/Drive, geração automática ou atualização do GitHub Pages. O frontend local já contém as mudanças; recarregar manualmente e clicar em **Completar informações** permite testar a correção. Uma nova tentativa explícita continua sujeita às cotas existentes. Não é garantia de que o provedor nunca interrompa uma resposta.

## Rollback

Versão ativa confirmada imediatamente antes do deploy: `d0814582-24c6-4c9b-9eb3-8fa3076be844`, deployment `5688c542-53b1-42a2-94ab-f72c50b3da7e`, 100% do tráfego. Rollback não executado.

```powershell
node worker/node_modules/wrangler/bin/wrangler.js rollback d0814582-24c6-4c9b-9eb3-8fa3076be844 --config worker/wrangler.jsonc --message "Rollback da correção de resposta incompleta"
```

Evidências locais ignoradas pelo Git: `test-output/worker-deploy-2026-10-19/` (`before.json`, `manifest.json`, `worker-tests.log`, `build.log`, `deploy.log`, `health-after.json`).
