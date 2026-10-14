# Firebase Spark: catálogo, login e permissões

O Acervo usa o projeto `manual-de-boardgame` no plano **Spark** para Authentication e Firestore. A interface está publicada no [GitHub Pages](https://thilanguis.github.io/Manual-de-Boardgame/) e no [host Firebase de transição](https://manual-de-boardgame.web.app). As regras atuais compilaram e os índices foram publicados. A verificação em Chrome anônimo no Pages carregou SDK, PWA e catálogo sem erros, mostrou o botão Google e ocultou o formulário de senha; a consulta restrita a jogos `isPublic: true`/`deleting: false` foi permitida. Acesso irrestrito ao catálogo e à coleção `admins` foi negado na validação Firebase. A integração de arquivos depende do backend Drive descrito em [GOOGLE-DRIVE-CLOUDFLARE.md](GOOGLE-DRIVE-CLOUDFLARE.md).

A arquitetura atual publica a interface no GitHub Pages e guarda PDFs/capas no Google Drive pessoal do proprietário, por um Cloudflare Worker Free. Não se deve executar comandos antigos que provisionem armazenamento de arquivos no Firebase ou publiquem Cloud Functions. O projeto permanece Spark.

## Configuração já recebida

| Opção                  | Valor/finalidade                                                      |
| ---------------------- | --------------------------------------------------------------------- |
| `firebase.projectId`   | `manual-de-boardgame`                                                 |
| `firebase.authDomain`  | `manual-de-boardgame.firebaseapp.com`                                 |
| `fileStorage.provider` | `drive`                                                               |
| `fileStorage.apiBase`  | URL HTTPS real do Worker, a preencher após o deploy.                  |
| `enableBgg`            | `false`; opcional após preparar o backend/token.                      |
| `allowPasswordLogin`   | `true` para transição/local; a UI oculta senha em hosts `.github.io`. |
| `maxPdfBytes`          | 52.428.800 bytes (50 MiB).                                            |

O objeto Firebase web é público e identifica a aplicação; não deve receber client secret Google, refresh token, chave administrativa ou token BGG. O `measurementId` recebido não inicializa Analytics: o SDK Analytics não é carregado.

## Authentication e login Google

No [Console Firebase do projeto](https://console.firebase.google.com/project/manual-de-boardgame/overview), confirme Email/Password e habilite Google em Authentication → Sign-in method. A ativação do provider Google e a vinculação da conta proprietária ainda estão pendentes e não foram verificadas. O Pages usa o botão Google; o formulário de senha continua disponível em localhost e no host Firebase de transição.

A conta proprietária já usa o UID `7TitBObtb8a0W8GisSstSM1RHiX2`. Para preservar esse UID, entre com a conta existente no host Firebase ou em localhost, abra **Minha Conta → Vincular Google** e conclua a vinculação. Depois use Google no Pages. A vinculação de providers preserva a identidade Firebase; criar outra conta não transfere permissões. [Vinculação oficial](https://firebase.google.com/docs/auth/web/account-linking).

O domínio `thilanguis.github.io` já foi adicionado a Authorized domains, preservando os demais domínios existentes. O repositório público é [Thilanguis/Manual-de-Boardgame](https://github.com/Thilanguis/Manual-de-Boardgame), e a primeira publicação Pages foi concluída pelo [workflow 38611621664](https://github.com/Thilanguis/Manual-de-Boardgame/actions/runs/38611621664). O site foi verificado em `https://thilanguis.github.io/Manual-de-Boardgame/`. Novos domínios devem ser cadastrados sem protocolo/caminho. A autorização do Drive é feita uma vez pelo proprietário no script local; não é o login Firebase dos administradores.

## Administrador e subadministradores

Papéis ficam em `admins/{uid}`. O documento proprietário é protegido contra alterações pelo cliente. A configuração `OWNER_UID` do Worker deve usar o UID existente, não o e-mail nem um identificador de outra conta.

O documento `admins/7TitBObtb8a0W8GisSstSM1RHiX2` já foi atualizado com `enabled: true` e papel `admin`. O proprietário tem todas as operações. Para conceder acesso a outra conta, obtenha seu UID após o login e cadastre um documento próprio pelo Console ou pela administração autorizada; preserve campos existentes ao atualizar.

Exemplo de subadministrador:

```json
{
  "enabled": true,
  "role": "subadmin",
  "permissions": {
    "add": true,
    "edit": true,
    "delete": false
  }
}
```

`role` aceita `admin` ou `subadmin`; o subadministrador fica limitado às operações explicitamente concedidas. Uma conta autenticada sem função autorizada não administra a biblioteca. Para revogar acesso, desative `enabled`; não basta esconder botões. Firestore protege alterações do catálogo e o Worker verifica as permissões antes de acessar/modificar arquivos Drive. Nenhum subadministrador recebe as credenciais OAuth centrais.

## Biblioteca privada ou pública

O documento `settings/library` controla `publicRead`:

| Valor                      | Comportamento                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ausente ou boolean `false` | Jogos privados são lidos por administrador/subadministrador autorizado; jogos marcados individualmente `isPublic: true` permitem leitura anônima. |
| Boolean `true`             | Todos os jogos que não estão em exclusão permitem leitura anônima do catálogo, capas e PDFs pelo site/proxy. Escrita continua sujeita às funções. |

O checkbox de publicação individual começa desmarcado. `isPublic: true` publica esse jogo mesmo quando a publicação global está desligada. `publicRead: true` publica toda a biblioteca disponível; jogos em exclusão ficam ocultos dos visitantes. Mesmo quando o site oferece leitura pública, os arquivos continuam privados no Drive; o Worker consulta a política e entrega os arquivos permitidos. Não é necessário compartilhar a pasta como “qualquer pessoa com o link”.

## Dados

| Local                        | Conteúdo                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Firestore `games/{uuid}`     | Título, descrição, jogadores, duração, etiquetas, idioma, fontes, publicação individual `isPublic`, estado de exclusão e referências de PDFs/capas no Drive. |
| Firestore `admins/{uid}`     | `enabled`, `role` e permissões de administração.                                                                                                             |
| Firestore `settings/library` | Política de leitura pública.                                                                                                                                 |
| Pasta Drive central          | PDFs e capas criados pela aplicação sob a conta proprietária.                                                                                                |
| Firestore `manuals`          | Reserva para futuros manuais próprios ligados por `gameId`; acesso negado nesta versão.                                                                      |

O modo local por `?local=1` continua real, com IndexedDB neste navegador. A biblioteca local é independente da nuvem, não sincroniza dispositivos e não migra automaticamente ao configurar o Worker. Limpar os dados do site remove os arquivos locais.

## Regras e índices Firestore publicados

As regras e os índices atuais já foram publicados junto da interface no host Firebase. Para alterações futuras somente no Firestore, com a Firebase CLI autenticada, na raiz do Acervo:

```powershell
firebase deploy --project manual-de-boardgame --only firestore
```

O alvo `firestore` publica regras e índices referenciados no `firebase.json`. O deploy já concluído utilizou `--only 'hosting,firestore'`. Confirme o projeto explicitamente em futuras alterações. A interface GitHub Actions/Pages já está publicada; o Worker ainda depende da autenticação/publicação Cloudflare, conforme o guia da integração. O comando acima não publica arquivos Drive nem ativa faturamento.

Firestore Spark tem quotas próprias. A documentação lista 1 GiB armazenado, 50 mil leituras, 20 mil gravações e 20 mil exclusões por dia, além da saída de dados. A aplicação deve respeitar essas quotas; isso não é uma promessa de uso ilimitado. [Quotas Firestore](https://firebase.google.com/docs/firestore/quotas).

## Pendências da nova integração

- Habilitar Google como provider e vincular a conta existente, preservando o UID do proprietário.
- Autenticar Cloudflare, autorizar o Drive central, instalar os secrets, publicar o Worker e preencher `fileStorage.apiBase`.
- Opcionalmente, aprovar a aplicação BGG e guardar seu token como secret do Worker.

Não é necessário fornecer senha de conta ou chave privada no frontend. Pages, regras, índices, perfil proprietário e domínio autorizado estão concluídos; a conexão Drive/Worker e o login Google ainda precisam ser finalizados e verificados com as contas reais.
