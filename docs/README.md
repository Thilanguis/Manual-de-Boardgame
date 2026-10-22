# Documentação do Acervo

Este índice organiza os documentos sem movê-los ou apagar versões anteriores. Os guias e relatórios podem descrever estados diferentes: confira a data, o código atual e os registros de publicação antes de repetir uma instrução antiga.

## Por onde começar

Para usar o Acervo no computador, veja o README da raiz. Para desenvolver e testar, comece por DESENVOLVIMENTO. A recuperação do Drive de 22/10/2026 está registrada em RECONEXAO-DRIVE-PRODUCAO; os planos anteriores permanecem como histórico.

- [DESENVOLVIMENTO](DESENVOLVIMENTO.md) — Executar o Acervo, usar emuladores e testar sem afetar dados reais.
- [GOOGLE-DRIVE-CLOUDFLARE](GOOGLE-DRIVE-CLOUDFLARE.md) — Manutenção da integração Drive e Worker.
- [RECONEXAO-DRIVE-PRODUCAO](RECONEXAO-DRIVE-PRODUCAO.md) — Recuperação OAuth executada e validação real de 22/10/2026.
- [FIREBASE](FIREBASE.md) — Configuração e autorização do Firebase.
- [PERMISSOES-2026-10-20](PERMISSOES-2026-10-20.md) — Modelo de permissões e histórico da correção.
- [CONSULTAR-REGRAS-ASSISTENTE-2026-10-20](CONSULTAR-REGRAS-ASSISTENTE-2026-10-20.md) — Implementação da consulta de regras e do assistente.
- [FONTES-RECONHECIMENTO](FONTES-RECONHECIMENTO.md) — Fontes de pesquisa e requisitos dos conectores.
- [LUDOPEDIA](LUDOPEDIA.md) — Configuração opcional da Ludopedia.
- [PUBLICACAO-ISOLADA-BRANDING-OAUTH](PUBLICACAO-ISOLADA-BRANDING-OAUTH.md) — Publicação isolada das páginas públicas de Branding.

## Organização e manutenção local

- [Revisão anterior de 16/10/2026](LIMPEZA-LOCAL-2026-10-16.md).

Revisão de **22/10/2026**: a estrutura de fontes, testes, dependências e ferramentas foi mantida. Os 63 documentos existentes permaneceram nos caminhos originais, sem alteração de conteúdo. Este índice foi acrescentado para facilitar a consulta. No VS Code, pastas de dependências, credenciais e resultados temporários ficam ocultas no explorador e fora da busca cotidiana; os arquivos continuam no computador.

Foram arquivados **851 arquivos gerados**: a cópia de build em `public/`, logs da raiz e capturas/logs/textos de testes. O ZIP local `.secrets/project-cleanup-2026-10-22/generated-history.zip` preserva os caminhos originais e inclui manifesto SHA-256. Cada entrada foi lida e comparada com o original antes da remoção. A redução medida foi de aproximadamente **12,1 MiB**, incluindo os registros locais desta revisão. O arquivo é ignorado pelo Git e não é servido pelo servidor local do Acervo.

Os relatórios JSON, PDFs usados em testes, scripts auxiliares, dados locais dos emuladores, manuais reais, dependências, credenciais e evidências da recuperação do Drive foram preservados. A pasta antiga `functions/` estava vazia e foi removida; o projeto não utiliza Firebase Functions. O pequeno `.build/README.md` já versionado foi mantido, e novas saídas dessa pasta passaram a ser ignoradas.

Foram conferidos por SHA-256 **2.532 arquivos protegidos**. As únicas mudanças em arquivos preexistentes nesta organização foram o link no README da raiz, as preferências visuais do VS Code e a regra de ignore para `.build/`; o índice Git permaneceu idêntico. O servidor do Acervo continuou na porta **5500**, com a página inicial e os três módulos do leitor respondendo HTTP 200 com os bytes corretos. Nenhum processo do editor foi encerrado. Não houve acesso a serviços de produção, chamada Gemini, commit, push ou deploy.

Para recuperar o material arquivado sem sobrescrever o projeto, execute na raiz:

```powershell
Expand-Archive -LiteralPath '.secrets/project-cleanup-2026-10-22/generated-history.zip' -DestinationPath '.secrets/project-cleanup-2026-10-22/restaurado'
```

O build `public/` também pode ser recriado com `npm run build`. Não apague `.secrets/` como se fosse cache: ela contém credenciais locais e evidências que precisam ser preservadas. Os inventários e as verificações completas desta revisão estão na subpasta local `project-cleanup-2026-10-22`.

## Demais implementações, decisões e relatórios

Os caminhos originais continuam válidos. Estes registros preservam causas, testes, decisões e limitações de cada etapa; não constituem, isoladamente, confirmação de que aquela versão está publicada.

- [Do Buraco ao Acervo](ANALISE-BURACO.md).
- [Ativação dos serviços e conhecimento pelos manuais — 17/10/2026](ATIVACAO-CONHECIMENTO-2026-10-17.md).
- [Ficha Gemini, qualidade do PDF e interface — correções locais](AUDITORIA-FICHA-QUALIDADE-2026-10-18.md).
- [Auditoria do fluxo único — correções e evidências](AUDITORIA-FLUXO-INFORMACOES-2026-10-18.md).
- [Biblioteca inteligente — versão 1.3.0](BIBLIOTECA-INTELIGENTE.md).
- [Cache da análise com rótulo em Sobre o jogo — 19/10/2026](CACHE-RESUMO-ROTULO-2026-10-19.md).
- [Vários PDFs no cadastro inicial](CADASTRO-MULTIPLOS-PDFS-2026-10-17.md).
- [Complemento da ficha pelo conhecimento Gemini — 19/10/2026](COMPLEMENTO-GEMINI-MODELO-2026-10-19.md).
- [Consulta unificada e conhecimento automático — 17/10/2026](CONSULTA-UNIFICADA-2026-10-17.md).
- [Revisão da apresentação em Consultar regras](CORRECAO-LEITURA-SUBTITULOS.md).
- [Resposta incompleta e HTTP 413 — correção local](CORRECAO-RESPOSTA-INCOMPLETA-2026-10-18.md).
- [Resumo Sobre o jogo — 19/10/2026](CORRECAO-RESUMO-FICHA-2026-10-19.md).
- [Prazo da ficha e integração real das fontes — 19/10/2026](CORRECAO-TEMPO-GERACAO-2026-10-19.md).
- [Correções de sessão, arquivos e documentos — 16/10/2026](CORRECOES-ACESSO-1.10.md).
- [Busca de regras e guias — 17/10/2026](CORRECOES-BUSCA-GUIAS-2026-10-17.md).
- [Edição e limites de geração — 17/10/2026](CORRECOES-EDICAO-IA-2026-10-17.md).
- [Correções de upload e avisos — 1.10.1](CORRECOES-UPLOAD-1.10.1.md).
- [Worker publicado — ficha consolidada](DEPLOY-WORKER-FICHA-2026-10-18.md).
- [Publicação da correção de resposta incompleta](DEPLOY-WORKER-RESPOSTA-2026-10-19.md).
- [Ficha Gemini: nome corrigido, cache e limites da busca](DIAGNOSTICO-FICHA-CACHE-E-BUSCA-2026-10-18.md).
- [Etapa 2 — Conferir informações: acabamento e validação](ETAPA-2-FRONTEND-2026-10-18.md).
- [Tentativa Gemini falha com conhecimento anterior preservado](FALHA-PROVEDOR-E-LEGADO-2026-10-19.md).
- [Ficha completa e duração — 18/10/2026](FICHA-COMPLETA-DURACAO-2026-10-18.md).
- [Ficha consolidada do cadastro](FICHA-CONSOLIDADA-2026-10-17.md).
- [Ficha única: Gemini e catálogos autorizados](FICHA-FONTES-AUTORIZADAS-2026-10-18.md).
- [Ficha Gemini e consenso — implementação local](FICHA-GEMINI-CONSENSO-2026-10-18.md).
- [Cadastro e edição — fluxo consolidado](FLUXO-CADASTRO-EDICAO-2026-10-18.md).
- [Cadastro, ficha e regras na mesma preparação](FLUXO-FICHA-REGRAS-2026-10-18.md).
- [Proposta — Aprender a jogar](GUIAS-INTERATIVOS.md).
- [Acervo 1.10 — biblioteca privada e documentos automáticos](IMPLEMENTACAO-1.10.md).
- [Acervo 1.11 — ficha, conhecimento e regressões](IMPLEMENTACAO-1.11.md).
- [Acervo 1.8.0 — implementação local para revisão](IMPLEMENTACAO-1.8.md).
- [Acervo 1.9 — OCR contínuo, consulta e tradução local](IMPLEMENTACAO-1.9.md).
- [Limpeza dos bloqueios internos legados](LIMPEZA-BLOQUEIOS-LEGADOS-2026-10-19.md).
- [Manuais separados por jogo](MANUAIS-SEPARADOS-2026-10-17.md).
- [Pesquisa da ficha e resumo — correções locais de 19/10/2026](PESQUISA-FICHA-RESUMO-2026-10-19.md).
- [Pesquisa real de Descent — diagnóstico e correções locais](PESQUISA-REAL-DESCENT-2026-10-18.md).
- [Pesquisa unificada — 17/10/2026](PESQUISA-UNIFICADA-2026-10-17.md).
- [Proposta — pesquisa multilíngue e conhecimento por edição](PROPOSTA-PESQUISA-CONHECIMENTO.md).
- [Publicação autorizada dos ajustes — 19/10/2026](PUBLICACAO-AJUSTES-2026-10-19.md).
- [Publicação do complemento Gemini — 19/10/2026](PUBLICACAO-COMPLEMENTO-GEMINI-2026-10-19.md).
- [Preparação de publicação — Acervo 1.11.0](PUBLICACAO-FRONTEND-WORKER-2026-10-18.md).
- [Consultar regras: relevância, passagens e leitura](QUALIDADE-CONSULTA-REGRAS-2026-10-17.md).
- [Recuperação do Google Drive — 21/10/2026](RECUPERACAO-DRIVE-OAUTH.md).
- [Aproveitamento do resumo já salvo — 19/10/2026](RECUPERACAO-RESUMO-SALVO-2026-10-19.md).
- [Redução de consultas Firestore — validação local](REDUCAO-LEITURAS-FIRESTORE-2026-10-17.md).
- [Acervo 1.6.0 — contas, cadastro e biblioteca](REFINAMENTO-1.6.md).
- [Reconhecimento 1.5.0 — resultados reais e limites](RELATORIO-RECONHECIMENTO-1.5.md).
- [Relatório — usuários, permissões e pasta PDFs](RELATORIO-USUARIOS.md).
- [PDFs de até 200 MiB](UPLOAD-200-MIB.md).
- [Pesquisa, conferência e página inicial — 1.7.0](UX-PESQUISA-1.7.md).
- [Sushi Go Party — uma análise real autorizada](VALIDACAO-REAL-SUSHI-2026-10-19.md).
- [PDFs enviados e vínculos no cadastro — 17/10/2026](VINCULO-PDFS-2026-10-17.md).
