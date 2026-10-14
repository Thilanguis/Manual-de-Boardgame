# Firebase Spark — autenticação, pessoas e permissões

O frontend usa exclusivamente [GitHub Pages](https://thilanguis.github.io/Manual-de-Boardgame/). Firebase `manual-de-boardgame` permanece Spark, com Authentication e Firestore. PDFs e capas usam a pasta Drive do proprietário por uma API Cloudflare Free. Não há dependência de Firebase Hosting, Cloud Storage ou Functions nesta arquitetura; `firebase.json` configura somente Firestore e emuladores locais.

## Identidades e estados

O perfil é `users/{UID}`, com nome, e-mail, `role`, `status`, `permissions`, datas do servidor, versão e último evento. Novas contas recebem exclusivamente `role: user`, `status: pending` e todas as permissões falsas. Login Google de uma nova pessoa também cria esse pedido. Contas Authentication anteriores passam a ter uma solicitação no primeiro acesso à nova versão, exceto o proprietário provisionado explicitamente.

| Perfil                           | Acesso                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| Visitante                        | Consulta catálogo e lê PDFs públicos sem conta.                         |
| Usuário pending/rejected/blocked | Continua lendo conteúdo público; não administra.                        |
| Usuário approved                 | Usuário comum, sem escrita administrativa.                              |
| Subadmin approved                | Operações concedidas em approveUsers, addGames e editGames.             |
| Superadmin                       | Aprova, promove, rebaixa, bloqueia, configura e exclui definitivamente. |

`deleteGames` é sempre falso para subadministradores. A exclusão definitiva é exclusiva do proprietário, conforme a restrição da solicitação principal. Nem uma flag adulterada concede essa operação no Worker ou nas regras. Permissões iniciais de subadmin: aprovar cadastros, adicionar e editar; o proprietário pode retirar cada uma.

O bloqueio é um estado no Firestore: revoga imediatamente a autorização administrativa, inclusive para tokens Firebase ainda válidos. Não apaga a identidade Authentication nem impede a leitura pública. Aprovação, recusa e mudanças de estado aparecem em tempo real na conta da pessoa.

## Authentication

Em [Firebase Authentication](https://console.firebase.google.com/project/manual-de-boardgame/authentication/providers), habilite Email/Password. A interface oferece entrar, criar conta, recuperar senha e sair. As senhas são enviadas pelo SDK diretamente ao Firebase via HTTPS; não são armazenadas no Firestore, no GitHub ou no Worker.

Google é opcional. Para preservar o UID da conta existente, entre com e-mail/senha e use **Minha conta → Vincular Google**. Não crie outra conta esperando herdar os privilégios. O domínio `thilanguis.github.io` já foi autorizado; confira os domínios em Authentication → Settings. [Cadastro por senha](https://firebase.google.com/docs/auth/web/password-auth), [vinculação de providers](https://firebase.google.com/docs/auth/web/account-linking).

Authentication e o documento Firestore são operações distintas. Se o registro do pedido falhar por falta de conexão, o próximo login tenta novamente; Minha conta oferece concluir a solicitação quando não há perfil. Esse retry não aprova nem muda permissões.

## Provisionar o proprietário com segurança

O único UID proprietário é `7TitBObtb8a0W8GisSstSM1RHiX2`, fixado nas regras, no frontend e no Worker. O cliente não pode criar, alterar, apagar ou assumir esse perfil. Não há cadastro aberto de superadmin.

Com a Firebase CLI autenticada em uma conta com permissão IAM neste projeto, na raiz:

```powershell
npm ci
npm exec -- firebase login
node scripts/firebase-setup.mjs 7TitBObtb8a0W8GisSstSM1RHiX2 --pages-domain
npm exec -- firebase deploy --project manual-de-boardgame --only firestore
```

O script aceita somente esse UID, confere sua existência e situação no Authentication e cria `users/{UID}` como `superadmin/approved` usando a sessão CLI em memória. Preserva um perfil proprietário já provisionado; documentos incompatíveis exigem revisão explícita. A migração inicial de `settings/library` torna o catálogo público; execuções seguintes preservam a política vigente. As gravações usam precondições e commit atômico, sem credenciais administrativas no navegador. Não são usados tokens GitHub para gerenciar pessoas.

Documentos antigos `admins` não autorizam mais o aplicativo. Não são apagados automaticamente. Outras pessoas são aprovadas e recebem cargos pela nova área de gerenciamento.

## Painel e notificações

**Gerenciar** mostra contador persistente de pedidos pendentes. Novos pedidos geram aviso visual para revisores conectados. O painel mostra solicitações, contas, cargos, estados e histórico. Usa listeners `onSnapshot`; não depende de recarregar a página ou de Functions. Solicitações feitas enquanto um administrador estava offline permanecem no Firestore.

O listener de pendências fica ativo somente para contas com aprovação. Pessoas e histórico são assinados somente enquanto o painel está aberto. Histórico mostra as últimas 50 mudanças. Para revogar um subadmin, o proprietário pode bloquear a conta, rebaixá-la ou retirar suas flags.

Cada mudança de pessoa ou configuração gera um `auditEvents/{id}` com responsável, alvo, estado anterior/posterior e horário do servidor, no mesmo commit. As regras exigem esse vínculo via `getAfter`; não permitem autoaprovação, edição de cargo próprio, histórico forjado nem apagar/editar eventos. [Transações e getAfter](https://firebase.google.com/docs/firestore/security/rules-conditions).

## Leitura pública

`settings/library.publicRead: true` libera todos os jogos fora de exclusão. É o padrão da migração solicitada. O proprietário pode mudar essa política no painel; se desligar, jogos marcados `isPublic: true` continuam públicos. Escrita permanece restrita em ambas as situações. Arquivos Drive continuam privados; o Worker valida a leitura pelas regras reais do Firestore antes de entregá-los.

## Testes e cotas

Para desenvolvimento, use Node 24.12+ e Java 21, apenas para os testes locais:

```powershell
npm run check
npm test
npm run test:rules
npm --prefix worker test
npm run build
```

`test:rules` usa exclusivamente o projeto fictício `demo-acervo`, sem dados de produção. Os testes cobrem cadastro pendente, ausência de autoaprovação, hierarquia, auditoria, flags, bloqueio de sessão existente e leitura anônima. A QA em navegadores isolados verifica cadastro, aprovação, promoção, aprovação por subadmin, bloqueio, notificações e layouts desktop/celular/tablet. `tests/admin-browser.mjs` requer Playwright disponível no runtime de teste.

Firebase Spark tem quotas: a documentação inclui 1 GiB, 50 mil leituras/dia e 20 mil gravações e exclusões/dia. Listeners consomem leituras; não há promessa de capacidade ilimitada. [Cotas oficiais](https://firebase.google.com/docs/firestore/quotas).

A conexão Drive e o teste de upload real dependem do OAuth proprietário e do Worker. Consulte [GOOGLE-DRIVE-CLOUDFLARE.md](GOOGLE-DRIVE-CLOUDFLARE.md). Nenhum token privado deve ser compartilhado pelo chat.
