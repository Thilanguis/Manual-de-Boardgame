# Correções de sessão, arquivos e documentos — 16/10/2026

Implementação local. Sem commit, push, deploy, migração ou alteração de dados/regras de produção. Alterações anteriores do workspace foram preservadas.

## Causas e correções

**Entrada piscando no reload.** `start()` abria o modal de conta antes da restauração do Firebase Auth. A sessão publicava primeiro usuário nulo e depois usuário sem perfil, fazendo o modal alternar entre login e Minha conta. Agora `session.resolving` mantém uma tela neutra enquanto Auth e perfil são confirmados no servidor. Somente após essa confirmação aparece biblioteca, entrada ou situação da conta. Nenhum sinal local de login autoriza conteúdo. Falha de cache não converte uma conta já aprovada em conta pendente.

**Capas e manuais antigos.** `files.get()` enviava `X-Document-Hash` também para capas. Além disso, o repositório passava a abrir qualquer manual pela nova rota `/documents/main/pdf`, inclusive cadastros legados. A consulta pública ao Worker remoto confirmou `/health` com `apiVersion: 1.7.5`, sem declaração de protocolo de documentos, e CORS permitindo apenas `Authorization,Content-Type,Content-Range,X-Upload-Ticket`. O cabeçalho novo era bloqueado no preflight. `apiVersion` identifica a pesquisa; isoladamente não comprova a versão de todos os recursos do backend.

Capas usam JWT, sem hash de PDF. O frontend consulta capacidades explícitas (`fileProtocol`, `privateAccess`, `documentRemovalProtocol`, `maxPdfBytes`). Um manual principal legado pode usar a rota autenticada `/manual` no backend antigo. No backend atualizado, usa a rota por documento com hash. Documentos novos, índices e exclusão segura exigem protocolo compatível: não há tentativa anônima, URL pública do Drive ou fallback para outro PDF. O leitor fecha se o documento aberto for substituído/removido no catálogo. Mensagens distinguem 401, 403, 404, 409, 410, backend incompatível e rede. Falhas de imagens e índices não são ocultadas silenciosamente.

**Cache privado e preparação.** Uma falha ao obter/criar `cacheKeys/{uid}` deixava `cacheReady=false`, mas a interface mostrava simultaneamente fila e Pausar. O erro agora fica visível, com detalhes recolhidos e Tentar novamente. Há timeout para as requisições da chave. A conta aprovada conserva leitura online; a preparação não é iniciada sem chave e backend compatível. A chave continua privada, obtida com JWT e regras próprias, apenas na memória. Não foi criado fallback persistente em texto aberto. O teste força erro 403 na chave, verifica o aviso e recupera pelo botão, sem logout.

Não foi consultado `cacheKeys` de produção. A causa exata de um erro de chave no ambiente remoto deve ser lida no diagnóstico; regras ainda sem essa coleção podem retornar 403. As regras locais permitem leitura/criação apenas da chave da própria conta aprovada e proíbem listagem, alteração e exclusão pelo cliente.

**Estados coerentes.** Aguardando, Preparando, Pronto para pesquisa, Pausado e Precisa de atenção refletem o estado real. O motivo de bloqueio é separado de uma pausa solicitada pelo usuário. Pausar só aparece durante processamento ativo; Retomar exige condição válida. Progresso e controles continuam sendo atualizados mesmo com edição aberta, preservando os inputs. Perda de aprovação ou permissão interrompe tarefas. São mantidos checkpoints, reaproveitamento e limite de três tentativas.

**Detalhes do jogo.** Ações principais: Ler manual, Guia passo a passo e Pesquisar regras, com descrições curtas. A pesquisa documental funciona sem guia publicado; a ausência de guia é indicada. Um jogo com somente um PDF não duplica o botão de leitura. Edição, substituição, principal, pausa e remoção ficam recolhidos; Gerenciar jogo reúne os controles gerais. Layout escuro/vermelho e leitor existentes foram mantidos.

## Remoção recuperável

O frontend não apaga mais o PDF antes de salvar o cadastro. No modo Firebase, o Worker:

1. Confere proprietário, jogo, documento e referências dos arquivos.
2. Confirma atomicamente a retirada do documento do jogo e cria `games/{gameId}/removals/{documentId}`, com controle de versão do jogo.
3. Só então apaga os arquivos exatos do documento e do seu índice.
4. Remove a informação técnica e o registro de recuperação ao concluir.

Falhas de permissão, versão ou conexão antes do commit não excluem PDFs. Falhas posteriores mantêm a remoção pendente, retomável por Concluir remoções. A regra do registro exige proprietário, cópia exata do documento anterior e ausência desse documento no jogo após a mesma transação; o registro não pode ser editado. Recriar o documento interrompe a limpeza antiga. Outros PDFs, capa e guia são preservados. A exclusão do jogo exige concluir as remoções pendentes antes. No sandbox local, o cadastro é salvo antes de apagar o Blob.

## Verificação

- **91 testes do aplicativo, 57 do Worker e 26 de regras Firestore**, sem falhas.
- Chrome local com Firebase Auth/Firestore emulados e **código real do Worker**, servido por HTTP em loopback. O adaptador de teste autentica as contas no Auth Emulator e fornece JWTs RSA de teste para o verificador real do Worker; não existe bypass no código de produção. Drive/OAuth são simulados. CORS e Range atravessam a chamada HTTP real.
- Proprietário aprova conta; conta comum lê e não envia PDFs; visitante, pendente e bloqueado não têm acesso. Bloqueio com sessão aberta fecha leitor e limpa o cache. Offline bloqueia conteúdo e a recuperação online revalida o perfil.
- O teste intercepta todas as aberturas do modal: ao recarregar uma sessão aprovada, **nenhuma abertura de login ou Minha conta**. Isso também passa quando há falha na chave do cache.
- Miniatura, destaque e capa dos detalhes são decodificados no navegador, inclusive após recarregar. PDF principal e complementar abrem; PDF.js recebe respostas 206. Consulta encontra trechos em vários documentos; guia publicado e ausência de guia são verificados.
- Uma simulação do contrato antigo do Worker, com rotas legadas e CORS sem o cabeçalho novo, confirma capa e manual principal com JWT. Isso não equivale a um teste de arquivo privado em produção.
- Remoção: 403/409/503 antes do commit preservam arquivos; falha parcial persiste registro; retomada pelo botão limpa somente o documento e seu índice. O teste integrado confere as regras reais do emulador.
- Múltiplos PDFs: cadastro, índice, busca, substituição, principal, remoção e persistência. Capturas e checagem de largura em desktop, tablet e celular (viewports emulados).
- Limite de **200 MiB**, blocos de **8 MiB** e retomada preservados. A suíte de arquivos grandes foi repetida: próximo de 50 MiB, 50, 100, 150, 200 MiB e 200 MiB + 1 byte; análise, leitura e persistência confirmadas. [Limites de memória e natureza das fixtures](UPLOAD-200-MIB.md).
- Sintaxe, build estático e build do Worker em **dry-run**, sem publicação.

Evidências locais, ignoradas pelo Git: `test-output/access-regression-report.json`, `access-browser.log`, `access-security.log`, `regression-unit.log`, `regression-worker.log`, `access-preparation.log`, `access-documents.log`, `access-large-pdf.log`, `large-pdf-report.json` e capturas `details-regression-*.png`.

## Dependências do ambiente remoto

Não houve leitura de PDFs, usuários ou chaves de produção. Somente `/health` e OPTIONS públicos foram consultados para diagnóstico. Não foi possível validar, nem se afirma, que o backend antigo de produção já aplique o isolamento privado desta implementação.

A leitura autenticada dos manuais principais legados tem compatibilidade local. Para múltiplos documentos, índices técnicos, preparação automática, limite de upload do servidor e remoção recuperável funcionarem no ambiente real, **Worker e regras atualizados precisam ser publicados de forma coordenada, após autorização**. A privacidade integral dos endpoints também depende dessa atualização. A versão remota foi preservada.
