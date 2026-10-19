# Publicação autorizada dos ajustes — 19/10/2026

## Escopo

Autorização excepcional do proprietário: publicar os ajustes locais no Worker, retirar os limites internos do Acervo e fazer commit/push para publicar o frontend. A publicação preserva a arquitetura e as integrações existentes.

- Ficha consolidada PDF + Gemini + catálogos, com título corrigido, identidade/edição/hash, referências verificáveis, proteção de alterações manuais e reutilização de análises.
- Diagnóstico de análise incompleta, campos válidos/ausentes/rejeitados e falhas do provedor; limites técnicos de tamanho e armazenamento preservados.
- OCR direcionado para texto corrompido e rótulos numéricos da capa; plural de idade e prioridade da ficha da capa sobre exemplos de subgrupos.
- Consultas explícitas dos catálogos em modo interativo; falhas parciais não são anunciadas como ausência definitiva de jogo.
- Espaçamento e origens na etapa 2, pesquisa multilíngue, formulário existente e único botão principal.
- Retirada dos dois contadores globais internos, tanto de síntese quanto de descoberta: sem limite diário ou por minuto imposto pelo Acervo.
- Registros antigos `app-rate-limit`/`profile-rate-limit` deixam de bloquear a próxima ação explícita, preservando conhecimento, correções, referências e revisão. Nenhuma geração é iniciada ao ler esses registros. Contadores antigos não são apagados nem redefinidos; deixam de ser consultados.
- Cache estático `acervo-v1.11.0-information-ui-12`, incluindo os novos módulos para abertura offline.

## Proteções preservadas

Geração e edição continuam restritas ao proprietário ou subadministrador aprovado com a permissão correspondente. Usuários comuns aprovados permanecem somente com leitura. A revalidação de autorização e identidade, leases, deduplicação de requestId, cache por evidência e uma descoberta complementar por análise continuam ativos. Cotas/429 reais do Gemini e limites de transporte dos catálogos não foram removidos.

Nenhuma mudança de regras Firestore, projeto, credenciais, segredos, bindings, migração ou dados de jogos foi incluída. Os ajustes anteriores de consumo do Firestore continuam presentes. Não houve nova geração Gemini real durante esta publicação.

## Validação isolada

Testes de modelos/frontend e Worker, segurança em `demo-acervo`, cadastro completo no navegador com provedores simulados e verificação visual em três larguras. A reprodução prova integração e preservação de dados, não cobertura de catálogos nem resultados de uma geração real futura. BGG/Ludopedia ainda dependem das credenciais autorizadas descritas na documentação; não foram habilitados por esta publicação.

Resultado: 213 testes frontend/modelos, 127 do Worker e 27 de permissões passaram (367), além dos três cenários de navegador: cadastro completo, bloqueios legados/cota do provedor e etapa 2 responsiva. Build estático, dry-run do Worker, manifesto e `git diff --check` passaram.

São verificados especialmente: mais de cinco análises e mais de duas por minuto sem bloqueio interno; contadores legados inertes; caches antigos liberados; cotas do provedor preservadas; ausência de geração automática; usuário leitor recusado; chamadas duplicadas contidas; correções manuais preservadas.

Evidências, logs e manifesto com hashes ficam em `test-output/release-internal-quota-2026-10-19/`, ignorado pelo Git. O build público inclui somente o aplicativo estático. Testes, documentação, PDFs, evidências e arquivos privados não entram no artefato Pages nem no bundle Worker.

## Ordem e rollback

1. Wrangler publica o Worker com `--keep-vars --strict`, após comparar variáveis/bindings com a versão ativa.
2. Validação somente em `/health`: protocolos de ficha 2, descoberta 1, reutilização 1 e identidade 1; `knowledgeInternalQuota:false`; limites de descoberta diário/minuto nulos.
3. Commit dos arquivos auditados e push em `main`, que aciona apenas o workflow Pages. O Worker não tem repositório Git conectado, conforme confirmação do proprietário.
4. Acompanhar o Actions e comparar arquivos estáticos publicados. Não abrir o aplicativo autenticado ou executar geração para validar a publicação.

Versão Worker anterior para rollback: `92922af5-5072-485a-ac04-dce4d401d7d7`, restaurável pelo Wrangler rollback (não executar automaticamente). O rollback reativa os limites antigos. Frontend anterior: commit `4d34b451ca461c6ad6cdad2803bef7595552930e`; reverter o commit desta publicação e publicar pelo mesmo workflow, somente mediante autorização. Não há migração destrutiva de armazenamento para reverter.

Worker publicado em `2026-10-19T19:39:06.955136Z` (15:39 em America/New_York): versão imutável `40391248-6c9c-4625-a87c-14bd1080a6f6`. `/health` confirmou os protocolos e a ausência dos limites internos. Comparação posterior confirmou as mesmas seis variáveis, sete nomes de segredos, namespace Durable Object, runtime e migração. Bundle: 350.120 bytes; SHA-256 `51ccc645e4c3c3a40147afdfcdf4b79be12cdc9bbb08fa1aa4fc3f3c87bb4446`. A confirmação final do Actions/Pages é registrada no recibo local de publicação, sem novo commit apenas para incluir o próprio hash do commit.
