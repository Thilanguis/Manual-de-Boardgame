# Reconexão do Drive após In production — 22/10/2026

## Estado e limites desta preparação

O proprietário confirmou **Em produção** no Google Cloud. O Acervo ainda não teve o Drive reconectado. Nenhuma chave foi desativada/excluída/criada, nenhum secret foi atualizado e nenhum deploy foi feito nesta etapa. Sem Gemini e sem escrita em Firebase ou Google Drive.

O cliente existente é **Acervo - Google Drive**, projeto **Manual de Boardgame** (`manual-de-boardgame`). O diagnóstico anterior confirmou **Aho5** como a chave usada no Worker. A outra chave é **DarE**.

**Atualização: o proprietário encontrou o JSON original.** O caminho indicado `D:\Acervo oauth-client.json` é uma pasta, com um único JSON dentro. A leitura local confirmou cliente Web, projeto correto, segredo com final **Aho5**, callback `http://localhost:4180/oauth/callback` e origem Picker local cadastrados. `--check-config` passou sem autenticação externa. O caminho completo foi registrado somente em `.secrets/drive-reconnect-2026-10-22/local-input.json`; o JSON original e seu segredo não foram copiados para o repositório. **Não é necessário substituir DarE nem criar ou desativar qualquer chave.**

Google não volta a exibir um client secret já criado; Cloudflare oculta seu valor no dashboard e no Wrangler. O Worker consegue usar a chave pelo binding `env`, mas não há um recurso normal de download do secret.

## Caminho preparado: JSON original e somente refresh token novo

1. Resolver a base de versões do Cloudflare, somente após autorização específica, usando a cópia local idêntica da versão ativa descrita abaixo. Não publicar os arquivos modificados do checkout principal.
2. Usar o JSON original com **Aho5** no assistente local para obter um refresh token novo, com `drive.file`, acesso offline e novo consentimento **após a mudança para Em produção**. O script verifica cliente, conta proprietária e pasta existente sem alterar metadados.
3. **Com autorização para produção**, atualizar somente `GOOGLE_REFRESH_TOKEN`. Usar `--reconnect`, **sem** `--rotate-client-secret` e **sem** `--initialize`. O binding `GOOGLE_CLIENT_SECRET` continua com **Aho5**. Também permanecem intocados `GOOGLE_CLIENT_ID`, `DRIVE_FOLDER_ID`, `DRIVE_OWNER_EMAIL`, `TICKET_KEY` e quaisquer outros secrets, inclusive a chave Gemini.
4. Conferir as leituras existentes e a preservação dos 18 registros, conforme a seção de validação. Não executar geração IA, uploads ou correções automáticas para fazer os testes passarem.

O plano anterior de substituição de DarE foi descartado antes de qualquer ação. A prova operacional será uma leitura pelo Worker após a atualização autorizada; não declaramos essa recuperação concluída com base em simulações.

Referências: [Google — duas chaves habilitadas e rotação](https://support.google.com/cloud/answer/15549257?hl=en), [Google — renovação offline](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [OAuth — vínculo do refresh token ao cliente](https://www.rfc-editor.org/rfc/rfc6749#section-6), [Cloudflare — valores ocultos e alterações de secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Fluxo temporário no servidor: desnecessário agora

O JSON original permite o fluxo local padrão. Não é necessário implementar endpoint OAuth temporário no Worker nem voltar a publicar o diagnóstico de comparação de chaves.

## Impedimento Cloudflare identificado antes da gravação

Consulta somente de leitura confirmou:

- Versão ativa a 100%: `a23cbf02-6a36-4525-894f-3c10e4279aac`.
- Upload mais recente: `dac80b4a-fe87-4aed-8c55-feb68a102881`, diagnóstico antigo **inativo**.

O Wrangler pode bloquear a alteração direta de secrets se a última versão enviada não estiver ativa. Não usar `versions secret` indiscriminadamente: ele deriva sua nova versão do upload mais recente. Não ativar o diagnóstico antigo, nem publicar o Worker modificado do checkout principal.

O script local agora consulta as versões antes de iniciar OAuth com `--apply` e novamente antes de gravar. Interrompe se houver divergência. Para esse estado, preparar mediante autorização específica uma cópia **idêntica ao código e à configuração efetivamente ativos**, sem o diagnóstico, para que a atualização de credencial use essa base correta. A atualização de secrets também cria uma versão/deployment; não pode ser tratada como operação sem impacto de publicação. Nenhum desses passos foi executado agora.

### Cópia local já preparada e conferida

Diretório: `.secrets/drive-reconnect-2026-10-22/worker-copy/`. Fonte SHA-256 `2a2695957c3d81a1b090ec91f1714feca25c24547f976f14adbf7fbc12101ccb`, correspondente ao snapshot original da versão ativa imutável. Não contém o marcador do diagnóstico. Os valores das variáveis não secretas, a data de compatibilidade e a definição do Durable Object foram comparados com os metadados atuais da versão ativa. Os secrets são herdados pelo Cloudflare, sem extrair ou regravar seus valores.

O comando `wrangler versions upload --dry-run` com essa cópia passou. **Não enviou versão real, não fez deploy e não atualizou secrets.** Manifesto local: `.secrets/drive-reconnect-2026-10-22/preparation.json`.

### Operações de produção que aguardam autorização

1. Reconfirmar a versão ativa e sua configuração; interromper se divergirem.
2. Enviar a cópia idêntica com `versions upload --no-bundle --upload-source-maps=false --keep-vars`. Isso cria uma versão inativa e preserva os secrets. Inspecionar seus metadados para conferir variáveis, runtime, namespace do Durable Object e bindings antes de ativar.
3. Ativar **essa cópia conferida** a 100%, sem ativar `dac80b4a…`. O comportamento do código fica igual ao da versão original; o efeito é torná-la a base mais recente para a gravação controlada.
4. Executar o assistente local com o JSON original e o novo ID ativo. O proprietário concede novamente `drive.file` na conta correta. Conta, pasta, marca privada, escopo e validade são verificados antes de qualquer gravação.
5. O assistente envia **somente `GOOGLE_REFRESH_TOKEN`** ao `wrangler secret put` por stdin, sem arquivo de token. O Cloudflare cria e ativa uma nova versão com essa credencial; os outros bindings permanecem preservados.
6. Confirmar versão final, ausência do diagnóstico e leituras autenticadas. Uma eventual reversão do código ou da conexão deve considerar que a versão antiga ainda contém o token antigo; não prometer que rollback do código recupera um refresh token inválido.

Não foi iniciada autenticação Google real. A autorização solicitada deve cobrir explicitamente o upload/ativação da cópia idêntica e a posterior atualização de um único secret; não cobre publicação das alterações locais pendentes.

## Revisão do assistente local

Arquivo: `scripts/connect-drive.mjs`. A versão publicada antiga não deve ser executada para recuperação: ela grava seis secrets e marca a pasta. O modo local revisado possui ações distintas:

- `--check-config`: leitura local do JSON; sem OAuth/Drive/Cloudflare. Não permite `--apply`.
- `--reconnect`: exige confirmação do operador de Em produção e o client ID existente; sem escrita no Drive. Sem `--apply`, descarta o token ao terminar e não recupera produção.
- `--reconnect --apply`: somente `GOOGLE_REFRESH_TOKEN`, com verificação da versão do Worker.
- `--rotate-client-secret`: opt-in separado para atualizar dois secrets; **não faz parte do caminho recomendado acima**.
- `--initialize`: configuração inicial que pode marcar a pasta e gravar os seis secrets; **não usar nesta recuperação**.

O assistente solicita somente `drive.file`, usa state/PKCE e confere a conta proprietária. Recusa token sem acesso offline, escopo adicional, conta divergente, pasta incorreta, marca privada ausente e pasta compartilhada publicamente. Não corrige esses casos com escrita ou revogação automática.

Se o Google informar `refresh_token_expires_in` de sete dias ou menos, a reconexão é bloqueada antes da gravação. Se esse campo estiver ausente, o script informa que isso **não prova duração ilimitada**. `expires_in` de cerca de uma hora corresponde ao access token e não deve ser confundido com o refresh token. A confirmação `--production-confirmed` é declarada pelo operador; não constitui inspeção automatizada do Console.

## Comandos preparados — não executados com credenciais reais

Usar somente o JSON privado do cliente existente. Os comandos utilizam o caminho já encontrado localmente e pedem somente o e-mail real; não usam caminhos/e-mails fictícios:

```powershell
$oauthLocalInput = Get-Content -LiteralPath '.secrets/drive-reconnect-2026-10-22/local-input.json' -Raw | ConvertFrom-Json
$oauthClientPath = $oauthLocalInput.clientFile
$driveOwnerEmail = Read-Host 'E-mail da conta proprietária da pasta existente'
$existingClientId = $oauthLocalInput.expectedClientId
node scripts/connect-drive.mjs --client-file "$oauthClientPath" --check-config
```

Validação real sem gravação, somente após autorizar a nova concessão Google:

```powershell
node scripts/connect-drive.mjs --client-file "$oauthClientPath" --owner-email "$driveOwnerEmail" --reconnect --expected-client-id "$existingClientId" --production-confirmed
```

Aplicação real, somente após autorizar a alteração do refresh token e resolver a base de versão do Worker:

```powershell
$activeWorkerVersion = Read-Host 'ID da versão ativa e mais recente, conferido antes da aplicação'
node scripts/connect-drive.mjs --client-file "$oauthClientPath" --owner-email "$driveOwnerEmail" --reconnect --expected-client-id "$existingClientId" --production-confirmed --expected-worker-version "$activeWorkerVersion" --apply
```

O teste sem gravação termina descartando o token; o comando posterior com `--apply` pede outro consentimento. Para o menor número de autorizações, é possível executar diretamente a aplicação controlada quando todas as suas autorizações e verificações prévias estiverem concluídas; os checks de conta/pasta/escopo sempre ocorrem antes de salvar.

Se o mesmo cliente deixou de ver a pasta com `drive.file`, parar e investigar. O assistente existente oferece Google Picker para uma seleção explícita da pasta, se necessário; a seleção da pasta isoladamente não comprova acesso aos filhos. Não ampliar para `drive`, não criar pasta e não regravar `appProperties` para contornar a validação.

## Validação real após autorização e execução

1. Pela conta proprietária aprovada, registrar antes/depois a quantidade e um resumo criptográfico dos IDs/conteúdo dos **18 jogos**, sem expor seus dados privados no chat. Se a contagem real diferir, informar e interromper alterações adicionais; não criar/remover registros para forçar o número.
2. Verificar a pasta existente com o token novo: ID esperado, proprietário, tipo e marca privada. Leitura de metadados somente.
3. Ler pelo **Worker existente** uma capa e um índice já cadastrados: HTTP **200** e conteúdo correto, não HTML de erro. Conferir assinatura/tipo da imagem e o formato/conteúdo esperado do índice (incluindo descompressão quando aplicável).
4. Conferir disponibilidade dos PDFs referenciados pelos 18 jogos e uma leitura real do PDF, verificando bytes `%PDF-`. Quando for usada requisição Range, HTTP 206 pode ser o resultado correto; capa e índice seguem exigindo 200.
5. Conferir que o Worker usa Aho5 preservada e o refresh novo. A leitura real através dele deve provocar a renovação com esse par; `/health` sozinho não comprova OAuth válido.
6. Registrar que o consentimento foi emitido depois de Em produção e examinar apenas a informação não secreta de validade retornada. A regra de sete dias de Testing deixa de se aplicar, mas revogação, inatividade e políticas Google ainda podem invalidar tokens. Uma leitura imediata não prova duração futura nem token eterno.
7. Confirmar bloqueio a visitantes/contas sem aprovação, ausência de escrita no catálogo, ausência de alterações no Drive e nenhuma chamada Gemini. Não modificar permissões para fazer os testes passarem.

Os dez testes locais simulados do assistente passaram. Eles cobrem reconexão limitada ao refresh token, ausência de escrita em validação, CSRF, pasta indevida, API desativada, escopos/conta incorretos, validade curta e divergência de versões. Isso não comprova recuperação real; ela aguarda autorização e consentimento.

## Recuperação executada e validada em 22/10/2026

Esta seção atualiza o estado preparado e pendente descrito acima. Após autorização explícita do proprietário, foi enviada e ativada uma cópia idêntica da versão original, sem o diagnóstico antigo. O consentimento foi concluído com o JSON original Aho5, depois da confirmação de **Em produção**, solicitando exclusivamente `drive.file`. Conta, pasta existente, marca privada e permissões foram validadas por leitura. Somente `GOOGLE_REFRESH_TOKEN` foi enviado ao Wrangler, por stdin e sem arquivo de token.

A versão final ativa `c5579f2b-7bfe-4458-9f90-5dd9d360ff90` foi baixada e comparada com a fonte original: SHA-256 `2a2695957c3d81a1b090ec91f1714feca25c24547f976f14adbf7fbc12101ccb`. Código, runtime e bindings conferem. Os demais secrets foram herdados, sem leitura de seus valores nem regravação. Aho5, DarE e TICKET_KEY foram preservados. Nenhuma alteração local pendente foi publicada.

Validação autenticada real pelo Worker, com a conta proprietária aprovada:

- Capa: HTTP 200, imagem válida de 324 × 459 pixels.
- Índice: HTTP 200, JSON descomprimido válido com 12 páginas, identificação e hash correspondentes ao PDF cadastrado.
- PDF: HTTP 200, assinatura PDF e SHA-256 idêntico ao cadastro.
- Catálogo atual: **19 jogos**, tanto antes quanto depois das leituras; resumo criptográfico de todo o conteúdo inalterado durante o teste. A quantidade atual é diferente dos 18 informados na preparação; nenhum cadastro foi criado ou removido pela recuperação. Não houve snapshot autenticado imediatamente anterior à atualização do secret.
- Perfil do proprietário: conteúdo e permissões inalterados durante o teste. Leitura de capa sem autenticação: HTTP 401.
- Nenhuma escrita em arquivos, metadados ou permissões do Drive; nenhuma escrita no Firebase; nenhuma chamada Gemini.

O Google não retornou `refresh_token_expires_in`; não houve indicação de validade curta na emissão. Com a nova concessão feita após a saída de Testing, a regra específica de sete dias desse modo deixa de se aplicar. Isso não comprova duração ilimitada nem impede revogação futura. Referência: https://developers.google.com/identity/protocols/oauth2/#expiration.

Evidências sanitizadas permanecem no diretório local ignorado `.secrets/drive-reconnect-2026-10-22/`: `oauth-result.json`, `final-version-verification.json` e `real-read-validation.json`. Elas não contêm credenciais. Não foi feito commit ou push desta recuperação.
