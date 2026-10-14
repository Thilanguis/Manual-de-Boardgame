# Relatório — usuários, permissões e pasta PDFs

## Implementado

- Login, cadastro por e-mail/senha, recuperação e encerramento de sessão. Novos perfis ficam pending/user, sem privilégios. Google continua opcional.
- Leitura pública sem cadastro; aprovação/recusa e estado mostrado à pessoa em tempo real.
- Painel responsivo com contador, avisos de novos pedidos, aprovação/recusa, pessoas, cargos, flags e últimas 50 ações.
- Superadmin fixado no UID proprietário existente; somente ele promove/rebaixa, bloqueia/desbloqueia, configura e exclui definitivamente.
- Subadmin aprovado usa approveUsers/addGames/editGames concedidas pelo proprietário. Exclusão definitiva permanece proibida, prevalecendo a restrição da mensagem principal sobre a flag sugerida no anexo.
- Regras Firestore e Worker verificam privilégios atuais. Alterações de pessoas/configuração exigem histórico consistente na mesma transação; autoaprovação, escalada e alteração/remoção do proprietário são negadas.
- Migração real do proprietário e da política pública executada por sessão IAM da Firebase CLI, preservando o UID. Novas regras compilaram e foram publicadas com os índices.
- Pasta Drive existente fixada em 1XUgXOYRigMaYuNMbFVcjDp6obEp4r7wR. O helper não cria outra pasta; usa OAuth drive.file e seleção explícita no Picker local quando necessário. O uso do access token temporário somente nessa tela local foi autorizado pelo proprietário; refresh/client secret continuam fora do navegador.
- Firebase Hosting removido da configuração de publicação. Frontend continua GitHub Pages; Firebase usa apenas Authentication/Firestore no Spark. PDFs/capas seguem a arquitetura Drive/Cloudflare Free.

## Efetivamente testado

46 testes automatizados disponíveis: 16 no aplicativo/assistente local, 17 na API com Google/Firestore simulados e 13 nas regras reais do emulador Firestore. A atualização 1.2.1 acrescenta o diagnóstico de Drive API desativada sem expor a resposta privada. Os 16 testes do aplicativo passaram na atualização; as suítes de API e regras passaram na etapa anterior e são novamente executadas pelo workflow de publicação. Cobrem leitura anônima, cadastro pending, ausência de autoaprovação, hierarquia, flags, auditoria, bloqueio da mesma sessão, JWT/tickets, SSRF/pasta, Range, retomada e exclusão concorrente.

QA administrativa com três contextos Chrome isolados e Auth/Firestore emulados: cadastro, aviso/contador sem reload, aprovação, promoção, aprovação por subadmin, bloqueio imediato, histórico e desktop/celular/tablet. QA de regressão com PDF gerado: importação, identificação, persistência, substituição, texto, páginas, zoom, favoritos, busca, edição/exclusão e shell offline.

O assistente OAuth foi executado com serviços simulados: state inválido e origem/nonce indevidos rejeitados; refresh/client secret não retornaram à tela local; pasta errada foi recusada; a pasta correta foi reutilizada, com propriedades anteriores preservadas. Esses testes não usaram credenciais reais nem publicaram secrets.

API compilada em dry-run. Auditoria npm do projeto corrigida, sem vulnerabilidades reportadas. O build estático exclui scripts locais, JSON OAuth, dependências de teste, runtimes portáteis e secrets.

O conector Google Drive confirmou a existência da pasta PDFs e sua condição privada. Isso não valida a autorização OAuth do cliente do aplicativo.

Publicação GitHub Pages concluída com workflow aprovado. Verificação anônima no endereço real confirmou carregamento da interface, Firebase e PWA, formulários de login/cadastro/recuperação e leitura do catálogo público; listagem de pessoas, perfil do proprietário e admins legados retornaram acesso negado.

## Conexão realizada e validações pendentes

- **Google Cloud/Drive:** autorização local concluída com o JSON atualizado e escopo drive.file; pasta PDFs existente validada e nenhuma outra pasta criada. Drive API e Picker API habilitadas. Tokens privados enviados somente aos secrets do Worker.
- **Cloudflare:** Wrangler autenticado, Worker publicado em `https://acervo-drive-api.acervo-boardgames.workers.dev` e endereço configurado no frontend. `/health` retornou driveConnected true, com CORS permitido para o site e desenvolvimento local. Nenhum plano ou faturamento foi alterado.
- **Firebase:** corrigido o bloqueio de referenciador causado por restrições do Picker aplicadas à chave Firebase. Chamadas de configuração Authentication retornaram 200 com 127.0.0.1:5500, localhost:5500 e GitHub Pages; um domínio externo retornou 403. Domínios autorizados anteriores e restrições de APIs preservados.
- **Teste Drive real:** enviar PDF e capa pelo site, conferir proprietário e pasta exata e abrir em outro dispositivo. Esse teste permanece pendente; a conexão não é considerada concluída.
- **Google login opcional:** habilitar provider/vincular à identidade existente se desejado. Email/Password já está habilitado. Nenhuma senha do proprietário foi usada pela QA.

Os guias [Firebase](FIREBASE.md) e [Drive/Cloudflare](GOOGLE-DRIVE-CLOUDFLARE.md) contêm os procedimentos. Nenhum plano pago foi ativado; capacidade depende das cotas gratuitas e o consumo de CPU do Worker deverá ser medido após sua publicação.
