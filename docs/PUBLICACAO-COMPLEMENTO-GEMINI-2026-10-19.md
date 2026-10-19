# Publicação do complemento Gemini — 19/10/2026

Publicação autorizada explicitamente pelo proprietário nesta conversa: Worker, commit e push do frontend. Escopo: complementar a ficha existente com PDF, catálogos autorizados e conhecimento do próprio modelo, preservando o fluxo de três etapas e as otimizações anteriores.

## Conteúdo

- Mesmo pedido principal Gemini para resumo, ficha e regras; complemento dos campos ausentes em contrato separado `modelProfile`, com origem explícita e sem citações inventadas.
- Dados documentados e correções manuais têm prioridade. Duração fixa preenche os dois limites; faixas inconsistentes e identidades obsoletas são recusadas.
- BGG/Ludopedia habilitados participam da coleta no servidor; persistência dos identificadores e supressão de pesquisas duplicadas. As integrações continuam dependendo de suas credenciais existentes.
- Adaptador factual Gamewright com identidade conferida, limites/cache e origem Editora. Nenhum token foi criado e nenhuma fonte privada foi habilitada.
- Regras continuam exigindo referências verificáveis; o conhecimento do modelo não cria regras sem evidências. PDF ilegível não impede complemento da ficha pelo nome.
- Cache de frontend `acervo-v1.11.0-profile-model-completion-14`; fichas parciais antigas podem ser atualizadas no clique explícito, sem geração ao abrir/recarregar.

Detalhes técnicos e limites: [Complemento Gemini](COMPLEMENTO-GEMINI-MODELO-2026-10-19.md) e [Coleta ampliada](PESQUISA-FICHA-RESUMO-2026-10-19.md).

## Validação e publicação

213 testes frontend/modelos, 143 Worker e 27 permissões em emuladores: 383 aprovados. Três cadastros completos com provedores simulados e validação responsiva em três larguras passaram. Sintaxe, build estático, bundle Worker e manifesto conferidos. Uma primeira execução restrita de quatro testes loopback falhou por EACCES do sandbox; a repetição com loopback autorizado passou, mantendo o bloqueio de serviços externos.

Worker `acervo-drive-api` publicado em 19/10/2026 às 21:02:40 UTC (17:02:40 America/New_York), versão imutável **`7bbd609b-1c70-4b1d-87bc-51d1e7b38df0`**, deployment `39dac627-0b2e-4d54-96cb-af149d26fa29`. Bundle: 372.670 bytes, SHA-256 `62e9199a5145ff2f48044f36329db3f7a73a5ef3430251147e1df0854a8573d9`.

Deploy com `--keep-vars --strict`; mesmas seis variáveis, sete nomes de segredos, namespace Durable Object, classe, runtime e migration. Não houve acesso aos valores dos segredos, migração nova, alteração de regras Firebase ou recriação de recursos. Verificação da aplicação publicada limitada a `GET /health`: HTTP 200, API 1.11.0, `profileMetadataProtocol=2`, `profileEvidenceProtocol=3`, `profileModelCompletionProtocol=1`, `knowledgeReuseProtocol=1`, `informationIdentityProtocol=1`; IA configurada/autorizada e ausência de limites internos preservadas.

O push para `origin main` aciona o workflow Pages, que testa e publica exclusivamente `public/`. Ele não publica o Worker. O proprietário confirmou anteriormente que não há repositório Git conectado ao Worker na Cloudflare. Não existem hooks locais adicionais ativos. Testes, logs, PDFs locais, documentação e arquivos privados ficam fora dos artefatos publicados.

O resultado final do Actions, commit e comparação dos hashes estáticos publicados são registrados em `test-output/release-model-profile-2026-10-19/receipt.json`, fora do Git, após o push. Não se cria um segundo commit apenas para incluir o hash do próprio commit.

## Rollback

Worker anterior confirmado imediatamente antes: **`40391248-6c9c-4625-a87c-14bd1080a6f6`**. Se necessário, usar o rollback do mesmo Worker, sem excluir recursos ou dados:

```powershell
node worker/node_modules/wrangler/bin/wrangler.js rollback 40391248-6c9c-4625-a87c-14bd1080a6f6 --config worker/wrangler.jsonc --message "Rollback do complemento Gemini"
```

Frontend anterior: **`0dc4f53c269e56af79f7dbf84bd53d34376f4629`**. Reverter somente o commit desta entrega e publicar pelo mesmo Pages, mediante autorização; não fazer reset destrutivo de dados. Não há migração de armazenamento para desfazer. Nenhum rollback foi executado.

Nenhuma geração Gemini real ou operação em dados Firebase/Drive integra esta validação. O próximo teste real será uma ação explícita do administrador em Completar informações e poderá consumir a cota do provedor. Os testes simulados não certificam a exatidão de todas as futuras sugestões do modelo.
