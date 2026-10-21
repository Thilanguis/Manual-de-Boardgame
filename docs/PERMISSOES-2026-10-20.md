# Permissões explícitas e persistentes

Implementação local, sem commit, push, deploy ou alterações em contas reais.

## Correções

- Conta comum aprovada continua leitora, independentemente de flags antigas inconsistentes. O formulário não mostra suas opções administrativas.
- Promoção altera o papel sem conceder aprovação/adicionar/editar automaticamente. As três permissões começam desmarcadas; concessões explícitas existentes continuam preservadas.
- Apenas o proprietário administra pessoas e altera cargos/permissões. Conforme a orientação posterior do usuário, pode delegar a terceira opção independente **Aprovar ou recusar cadastros**. Não há editor de permissões do próprio proprietário.
- O subadministrador com `approveUsers` vê somente solicitações pendentes e pode aprová-las ou recusá-las. Não acessa a lista completa de pessoas nem o histórico; não promove, bloqueia, administra permissões ou exclui definitivamente. A aprovação de uma conta continua sem conceder privilégios administrativos.
- Salvar permissões aguarda a transação Firestore, informa confirmação ou erro e atualiza a lista e o diálogo. O botão fica desabilitado quando não há mudanças ou durante o envio.
- Alterações pendentes são identificadas. Fechar pelo X, Escape ou clique fora pede confirmação de descarte no próprio Acervo. Rebaixar/bloquear também não descarta edições silenciosamente.
- O salvamento usa a versão lida do perfil para impedir que um rascunho antigo sobrescreva mudanças feitas em outra sessão.
- A confirmação de salvamento permanece visível quando chega a atualização em tempo real da mesma versão.

## Bloquear e desbloquear

O campo opcional `blockedFrom` guarda o status anterior ao bloqueio. Desbloquear restaura esse status: uma conta pendente continua pendente e uma conta recusada continua recusada. Esse marcador é validado pelas regras e acompanha a auditoria atômica existente.

Perfis antigos sem o campo não precisam de migração nem de atualização em massa. Para bloqueios antigos, o fluxo consulta o último evento de auditoria somente quando necessário: exige evento de bloqueio correspondente ao UID, papel e versão atuais. Se esse histórico estiver disponível, a aprovação anterior é preservada, inclusive ao editar permissões antes de desbloquear. Sem marcador/histórico verificável, o retorno é pendente e exige revisão do proprietário.

Não há consultas adicionais de perfil na leitura de PDFs. A autorização do Worker já busca o perfil atual em cada operação; os novos testes confirmam revogação de flags, bloqueio e rebaixamento com o mesmo JWT.

## Evidências isoladas

- 227 testes do frontend/modelos: `test-output/reviewer-root.log`.
- 154 testes do Worker: `test-output/reviewer-worker.log`, incluindo requisições HTTP diretas que tentam enviar/substituir PDF ou excluir jogo como leitor com flags antigas.
- 33 testes das regras no Firestore emulado: `test-output/reviewer-rules.log`, incluindo aprovação/recusa delegada somente a pendentes, negação de acesso a usuários aprovados/histórico, concessões independentes, revogação imediata, eventos forjados, proteção do proprietário, recuperação de bloqueios legados e compatibilidade com as regras anteriores.
- Navegador com HTML/CSS/controladores reais, Auth/Firestore emulados e API de arquivos simulada: `tests/permissions-browser.mjs`. Evidências e imagens em `test-output/permissions/`.
- O teste de navegador cobre aprovação sem privilégios, promoção sem flags, adicionar/editar/ambas/nenhuma, salvamento e erro de backend, reabertura, reload e novo login, descarte por X/Escape/backdrop, concorrência entre proprietários, concessões existentes, rebaixamento, bloqueio/desbloqueio e desktop/celular. Também concede apenas aprovação, aprova e recusa contas como subadministrador e revoga essa flag com a sessão aberta. Evidência atual: `test-output/reviewer-browser.log`.

Os testes usam exclusivamente `demo-acervo` nos emuladores locais. O navegador bloqueia requisições externas. Firebase, Drive e Gemini de produção não foram utilizados.

## Compatibilidade com as regras anteriores

A primeira implementação incluía `blockedFrom: ''` mesmo em aprovações e promoções de perfis sem bloqueio. As regras anteriores rejeitam campos adicionais no perfil e exigem o formato exato do resumo de auditoria. Isso foi reproduzido no emulador com as regras do commit publicado `92e6c6d`: o teste falhou antes e passou após a correção.

O resumo e as transições agora omitem esse campo quando ele não existe e não é necessário. Aprovar, promover, rebaixar e salvar permissões continuam usando o formato anterior nesses perfis. Quando o marcador já existe, ele é preservado ou limpo explicitamente. As novas regras aceitam os dois formatos; nenhuma proteção de autorização foi removida.

O teste de navegador executa aprovação, promoção sem flags e as quatro combinações de permissões primeiro com as regras anteriores; depois verifica os demais fluxos com as novas regras. Evidência: `test-output/permissions-compat-browser.log`.

## Publicação futura

Para ativar integralmente o novo bloqueio/desbloqueio e a aprovação delegada, frontend e regras Firestore devem ser publicados de forma coordenada quando houver autorização. Aprovação pelo proprietário e promoção de perfis sem o marcador já são compatíveis com as regras anteriores; isso não exige publicar regras apenas para o proprietário promover. A autorização efetiva do subadministrador para revisar cadastros e as garantias novas de status anterior de bloqueio dependem das regras correspondentes. Nenhuma regra foi publicada nesta tarefa.

Gemini, pesquisa de fontes, cadastro de jogos, manuais e Aprender a jogar não tiveram suas implementações alteradas. O cache do frontend foi atualizado para `acervo-v1.11.0-reviewer-permission-22`.
