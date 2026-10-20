# Cache da análise com rótulo em Sobre o jogo — 19/10/2026

O diagnóstico atualizado do usuário informou `summary-label`: o texto em description era apenas um rótulo de catálogo, não uma sinopse aproveitável. Isso confirma a ausência de um resumo utilizável no resultado salvo; a recuperação de uma projeção incompleta não poderia transformar esse rótulo em apresentação do jogo.

Foi reproduzido outro bloqueio: `combinedProfileComplete` aceitava a descrição estruturada genericamente válida e reutilizava o cache, apesar de o formulário recusar o rótulo. O clique explícito podia devolver novamente a mesma análise sem iniciar a atualização necessária.

Agora, somente o cache legado que contém apenas rótulos em description deixa de ser considerado completo para a ação explícita. Uma análise nova recebe `profileAnalysis.summaryProtocol:1`, inclusive se não encontrar resumo, evitando ciclos. Sinopses utilizáveis já salvas permanecem em cache. Abrir a ficha continua sem gerar; o próximo clique explícito pode iniciar uma nova geração, consumindo a cota do provedor. Nenhuma geração real foi executada pelo agente.

Dois testes reproduziam o defeito antes e passaram depois: classificação do cache e integração do rascunho no Worker, incluindo leitura sem geração, atualização explícita e cache da tentativa nova. As correções manuais continuam prioritárias. Suítes: 217 frontend/modelos e 151 Worker aprovados; sintaxe, build estático, dry-run e diff --check aprovados. Evidências: `test-output/summary-cache/`.

Publicado somente Worker, pela autorização contínua, versão `4f308e7d-da6e-4cb8-ac8d-0a4652733ac5`, deployment `29c0605b-4255-4ffb-8691-baddf19e35e7`, em `2026-10-20T00:27:44Z` (19/10, 20:27:44 America/New_York). Bundle SHA-256 `dc8f9ff3240a427dfaeae4596339a687bf4f2d4346595466d5d7381d79ae9dba`. Rollback anterior: `c4ff3808-1aef-459f-9f9f-384ea30cfc24`. /health HTTP 200 e metadados de configuração conferidos; variáveis, nomes de segredos, namespace, runtime e migration preservados.

Sem commit, push ou operações reais Firebase/Drive. O frontend atualizado está disponível no diretório local; o GitHub Pages permanece no commit `c4300ee` até a próxima publicação solicitada. As mensagens novas recebidas do usuário demonstram que ele está utilizando o frontend com o diagnóstico local de rótulo. Para carregar também a mudança posterior do cache, é necessário atualizar a página local. Nenhuma publicação de código inicia automaticamente a nova análise ou modifica o jogo salvo.
