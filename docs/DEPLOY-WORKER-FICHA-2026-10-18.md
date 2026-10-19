# Worker publicado — ficha consolidada

Publicação autorizada pelo usuário em 18/10/2026 (America/New_York). Sem commit ou push. Frontend/GitHub Pages não publicados nesta etapa.

## Resultado

- Worker existente: `acervo-drive-api`.
- URL: `https://acervo-drive-api.acervo-boardgames.workers.dev`.
- Nova versão imutável: `d0814582-24c6-4c9b-9eb3-8fa3076be844`.
- Tag: `profile-metadata-2`.
- A versão da API permanece `1.11.0`; a capacidade da ficha agora anuncia protocolo **2**.
- Bundle: 343631 bytes, SHA-256 `ca3bf2c318b917a3e557764d7a0c1af4b38a4e7d0510bf46e8d42f8f74d2e731`.
- Manifesto: 68 entradas de runtime, incluindo 29 fontes locais. Sem testes, PDFs, configuração web, logs ou arquivos privados no artefato.

## Preservação

A consulta prévia por Wrangler confirmou correspondência das seis variáveis locais com as publicadas, o namespace existente de `GAME_KNOWLEDGE`, a classe `KnowledgeStore`, a migration `v1-knowledge` e o runtime `2026-10-14`. Foram consultados somente metadados e nomes dos segredos, sem seus valores. Nenhum segredo foi adicionado/alterado. Tokens adicionais de BGG/Ludopedia não foram configurados por este deploy.

Deploy executado com `--keep-vars --strict`. Não houve nova migração, novo recurso, mudança de credenciais, regras, projeto Firebase ou banco. Não foram executadas operações da aplicação contra Firebase/Drive/Gemini para validar a publicação.

## Validação

Os 112 testes isolados do Worker passaram novamente, seguidos de build local. Depois do deploy foi consultado **somente `/health`**:

| Verificação | Resultado |
| --- | --- |
| HTTP | 200 |
| `profileMetadataProtocol` | 2 |
| `profileDiscoveryProtocol` | 1 |
| `knowledgeReuseProtocol` | 1 |
| `informationIdentityProtocol` | 1 |
| `knowledgeConfigured` / `manualAiEnabled` | true / true |
| `driveConnected` | true (configuração presente; não houve leitura no Drive) |
| `fileProtocol` / `researchProtocol` | 2 / 2 |
| `googleSearchGrounding` | false |
| CORS testado | `http://127.0.0.1:5500` permitido |

Isso resolve a incompatibilidade de protocolo que bloqueava **Completar informações** no frontend local atualizado. Não é um teste de geração Gemini real, de validade das credenciais dos provedores ou de cobertura dos catálogos. Recarregar a página local faz a aplicação recuperar as capacidades novas.

Evidências ignoradas pelo Git: `test-output/worker-deploy-2026-10-18/before.json`, `manifest.json`, `build.log`, `deploy.log` e `health-after.json`.

## Rollback registrado

Versão anterior confirmada imediatamente antes da publicação: `82405a4c-59a9-4123-910f-7a5cff0bdc16`, deployment `88c09a8a-98b9-47bd-954b-1104d9d945dd`, 100% do tráfego.

Se necessário, restaurar essa versão com o mecanismo de rollback do Worker existente; não excluir/recriar Worker, namespace, banco, usuários ou arquivos. O rollback não foi executado.

```powershell
node worker/node_modules/wrangler/bin/wrangler.js rollback 82405a4c-59a9-4123-910f-7a5cff0bdc16 --config worker/wrangler.jsonc --message "Rollback da ficha consolidada"
```
