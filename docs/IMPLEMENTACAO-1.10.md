# Acervo 1.10 — biblioteca privada e documentos automáticos

Implementação local de 16/10/2026. **Sem commit, push, deploy, migração de dados ou alteração de regras em produção.** A versão publicada só ficará privada quando a transição abaixo for autorizada e executada.

## Acesso

- Visitantes recebem entrada, cadastro e recuperação de senha. Não são iniciadas consultas do catálogo.
- O cadastro continua criando `pending/user`. Somente o UID proprietário já existente pode aprovar ou recusar. A flag legada `approveUsers` não concede essa autorização a subadministradores.
- Leitores aprovados consultam jogos disponíveis às contas aprovadas (`isPublic`). Administradores conservam gestão e suas flags de adição/edição; exclusão definitiva continua exclusiva do proprietário.
- `settings/library.publicRead` não libera acesso anônimo, mesmo que seu valor antigo seja `true`. A disponibilidade global anterior é preservada apenas para contas aprovadas, evitando ocultar jogos antigos. Ao desativá-la, vale a disponibilidade individual. Não houve alteração remota.
- Firestore exige perfil aprovado. O Worker valida assinatura/projeto/prazo do JWT e consulta o perfil atual em cada requisição de conteúdo, inclusive imagens, índices, pesquisa e blocos de upload. IDs e CORS não substituem autorização.
- Cada arquivo exige proprietário, pasta, projeto, jogo e tipo; documentos novos também exigem documento e hash correspondentes. A leitura recebe o hash esperado para impedir que uma referência antiga abra a página de uma substituição.
- Compartilhamentos `anyone` e `domain` no Drive impedem a leitura privada. Restringi-los é uma operação separada do proprietário; o código não alterou permissões no Drive.
- O proprietário não pode ser rebaixado, bloqueado ou removido pelo cliente. O provisionamento inicial seguro já existente foi preservado.

## PDFs e preparo

O cadastro mantém as três etapas e aceita até 12 PDFs por jogo, com até 200 MiB por arquivo. O primeiro é principal; documentos adicionais recebem tipo e podem ser renomeados, classificados, substituídos, definidos como principal ou removidos individualmente conforme as permissões.

`game.manual` continua sendo o principal e permanece compatível com registros antigos. `documents` guarda cada identificação, nome, tipo, idioma, edição e referência de arquivo. `primaryDocumentId` seleciona o principal. `documentChanges` permite validar somente os documentos alterados, dentro dos limites das regras. A inclusão inicializa o documento legado sem copiar ou reenviar o PDF.

Depois do salvamento, a fila executa uma tarefa de cada vez: extração completa → OCR das páginas necessárias → tradução local disponível → persistência do índice. Há checkpoints por página no dispositivo, pausa, retomada, progresso e no máximo três tentativas de falhas transitórias. Uma trava entre abas evita duas filas simultâneas na mesma conta/dispositivo. Fechar o navegador interrompe a execução; a fila retoma ao reabrir com autorização e conexão. Não há processamento prometido com o navegador fechado.

Índices técnicos ficam separados dos guias em `games/{gameId}/indexes/{documentId}`; o texto comprimido fica no Drive. Os estados e contagens são compartilhados pelo Firestore, sem uma escrita por página. Outros dispositivos autorizados usam esse índice sem precisar de um guia publicado. Índices antigos já salvos como arquivos de guias também podem ser reaproveitados, conferindo jogo, documento, hash e páginas.

Substituir um documento cria outro trabalho para seu hash. Índices de outra versão não são usados. Uma análise menos completa ou uma gravação concorrente não substitui silenciosamente a versão compartilhada mais completa. O identificador de retomada do upload de um índice usa o conteúdo comprimido; o hash do PDF é separado, evitando reutilizar um gzip antigo depois de OCR ou tradução.

Uploads continuam retomáveis e com recibos. Falha antes de salvar tenta descartar o envio incompleto. A remoção do arquivo anterior acontece depois do vínculo confirmado; falhas de limpeza são informadas. Se a conexão impedir também a limpeza, o proprietário deve conferir a pasta exclusiva antes de considerar a remoção concluída. A exclusão de jogos é retomável em lotes pequenos para respeitar o Worker Free.

## Consulta e guias

Consulta rápida pesquisa os índices disponíveis, identifica o documento e abre a página correspondente. Um PDF pendente não impede consultar os demais. Resultados não são fundidos em uma regra única nem conciliam contradições automaticamente.

Cada seção do guia conserva documento, hash e página. Troca ou remoção de PDF invalida somente as referências dependentes. O editor permite escolher o documento da referência e adicionar trechos de um ou de todos os documentos. Trechos extraídos continuam sendo sugestões: precisam de edição e revisão antes da publicação. O processamento automático não cria nem publica explicações didáticas.

Português é apresentado quando há original ou tradução disponível. Originais, idioma verdadeiro do PDF e referências são preservados. A tradução usa a API local do navegador; o download do idioma exige a ação explícita já existente. Não há envio de manuais para uma API de tradução externa, IA paga ou serviço novo. Navegadores/idiomas sem motor disponível mantêm a tradução pendente e a edição manual. A saída genérica em português ainda exige revisão para PT-BR.

## Cache e sessões

O Firestore usa cache em memória. Índices, traduções, pesquisas e checkpoints persistentes são cifrados com AES-GCM. A chave individual é obtida por REST, sem cache HTTP, de `cacheKeys/{uid}`, legível somente pela própria conta aprovada; não é persistida no navegador.

Logout ou perda de aprovação interrompem tarefas, fecham leitores e guias, removem imagens/URLs temporárias, limpam o conteúdo da interface e apagam caches protegidos e preferências locais. Sem conexão, a chave é bloqueada e o conteúdo fica inacessível até nova confirmação do servidor. A restauração de uma página pelo histórico força uma nova verificação. A PWA guarda o shell e bibliotecas estáticas; não intercepta PDFs, requisições autenticadas, respostas da API ou imagens privadas.

Caches antigos de índices, traduções e pesquisa em texto claro são removidos na transição. A cópia já salva no Drive é reaproveitada; análises antigas que existiam exclusivamente nesse cache precisarão ser refeitas. Por isso, salve os rascunhos e índices da versão anterior antes da futura atualização. A antiga biblioteca independente do dispositivo não é migrada nem apagada. Seu sandbox exige localhost e `allowLocalDevelopment=true` explícito; `?local=1` sozinho não abre o Acervo.

Dados que alguém já exportou ou copiou enquanto tinha acesso não podem ser recolhidos pelo bloqueio posterior.

## Validação local

Suítes: **86 testes da aplicação, 50 do Worker e 24 de regras Firestore**, além dos fluxos reais no Chrome. Foram usados somente emuladores, serviços de arquivo simulados e PDFs locais; nenhum usuário, arquivo ou regra de produção foi modificado.

| Manual real             | Páginas | Legíveis | Falhas | Resultado                                                                                      |
| ----------------------- | ------: | -------: | -----: | ---------------------------------------------------------------------------------------------- |
| Resident Evil PT-BR     |      22 |       22 |      0 | Preparo automático, consulta, sugestões, revisão/publicação e recarga                          |
| Sina da Sociedade PT-BR |      24 |       24 |      0 | OCR automático completo, pausa/recarga/retomada sem repetir páginas concluídas                 |
| Resident Evil inglês    |      19 |       18 |      1 | Texto original preservado, falha explícita de leitura e tradução pendente sem motor disponível |

Os testes de navegador verificaram ainda:

- Cadastro de três PDFs, índices sem rascunho, busca unificada, abertura do PDF correto, persistência, substituição individual por hash, manutenção das outras referências, troca do principal e remoção individual.
- Visitante, tentativa de `?local=1`, conta pendente, aprovação pelo proprietário, leitor em outro navegador, ausência de comandos de escrita, bloqueio com leitor aberto, limpeza efetiva do IndexedDB, logout e perda/recuperação de conexão.
- Cache cifrado e inacessível sem chave, interrupção de uma tarefa pendente após revogação e limite de três tentativas.
- Pesquisa → revisão → seleção → etapa 2 → ida/volta → salvamento; intervalos de duração, títulos sem metadados, edições/hashes distintos e reutilização sem consultas extras.
- Computador, tablet e celular; destaque/último clique e atualização da PWA preservados.

Scripts principais: `tests/private-browser.mjs`, `tests/documents-browser.mjs`, `tests/automatic-real-browser.mjs` e `tests/preparation-failures-browser.mjs`. Relatórios detalhados e capturas locais ficam em `test-output/`, ignorado pelo Git.

Sintaxe, build estático, build Worker com `--dry-run` e verificação de espaços do diff também foram executados. A pasta de PDFs e credenciais não integram o build público. Limites de CPU/requisições e o tráfego real do Worker só poderão ser medidos depois de um deploy autorizado.

## Transição futura — somente com autorização

1. Salvar rascunhos/índices atuais; exportar um backup dos dados. Confirmar o perfil aprovado/superadmin do UID proprietário existente e manter uma sessão administrativa e o procedimento de recuperação por IAM disponíveis. Não recriar nem rebaixar esse perfil.
2. Conferir, sem alterar automaticamente, o compartilhamento da pasta e dos arquivos do projeto no Drive. Links públicos já existentes precisam ser restringidos pelo proprietário: proteger o proxy não remove uma permissão pública preexistente do Google Drive.
3. Publicar as regras privadas, conferir o acesso do proprietário e as negativas para visitante/pendente. Não usar regras temporariamente abertas para resolver falhas. Os documentos antigos permanecem válidos.
4. Publicar o Worker compatível e verificar leitura autenticada, recusa de JWT/perfil inválido, uploads e índices. Ainda com o proprietário conectado, verificar a criação/acesso à chave individual e a sessão de um leitor aprovado.
5. Publicar o frontend 1.10, atualizar a PWA e verificar os três tamanhos de tela. Fechar as abas da versão pública anterior. Nenhum documento de jogo precisa ser apagado ou reenviado por essa transição.
6. Confirmar negativamente os endpoints conhecidos sem login e após bloqueio. Se houver falha, manter os dados privados enquanto se corrige o acesso; não reabrir a biblioteca como solução de recuperação.

Não foi adicionado serviço com faturamento. Permanecem Firebase Spark, Workers Free, GitHub Pages e o armazenamento Drive já contratado. As cotas gratuitas continuam sendo limites de uso; não foram ativados Blaze, Functions, Storage ou APIs pagas.

Referências verificadas: [cache do Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline), [validação de campos e MapDiff](https://firebase.google.com/docs/firestore/security/rules-fields) e [limites do Workers](https://developers.cloudflare.com/workers/platform/limits/).
