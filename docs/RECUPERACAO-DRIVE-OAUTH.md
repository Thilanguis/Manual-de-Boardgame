# Recuperação do Google Drive — 21/10/2026

## Situação real

**A conexão ainda não foi restaurada.** Nenhuma chave Google, secret de produção, arquivo Drive, cadastro ou permissão foi alterado nesta tarefa. Nenhum commit, push, deploy ou chamada Gemini. Simulações não comprovam recuperação real.

O proprietário confirmou o cliente Web **Acervo - Google Drive**, no projeto **Manual de Boardgame** (`manual-de-boardgame`), External/Testing, duas chaves habilitadas criadas em 14/10/2026 e Branding incompleto.

Uma consulta somente de leitura `wrangler secret list` confirmou os nomes `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `DRIVE_FOLDER_ID`, `DRIVE_OWNER_EMAIL` e `TICKET_KEY`. Seus valores não foram lidos. A presença dos nomes não comprova validade.

A busca local examinou 262 arquivos JSON/env no workspace, demais projetos de `D:\Sistemas DEV`, Downloads e pastas pessoais, incluindo os caminhos reais Documentos/Área de Trabalho redirecionados para `F:\OneDrive`. Também procurou nomes de arquivos compatíveis em temporários e anexos locais. Não foi localizada uma cópia utilizável. Não foram extraídos segredos do navegador ou de cofres de senhas. Não é uma prova de que não exista backup em outro dispositivo/cofre.

O Worker anterior anuncia expiração/revogação para **qualquer resposta OAuth não bem-sucedida**, inclusive falhas temporárias. Não observamos o código OAuth real desta tentativa, portanto **não está confirmado que o token expirou**. A data de criação do client secret não é a data de emissão do refresh token.

Testing com `drive.file` emite refresh tokens com prazo de sete dias. A expiração é compatível com o cenário relatado, mas `invalid_grant` também pode indicar revogação. Fontes: [expiração OAuth](https://developers.google.com/identity/protocols/oauth2#expiration), [segredos Google](https://support.google.com/cloud/answer/15549257?hl=en), [secrets Cloudflare](https://developers.cloudflare.com/workers/configuration/secrets/).

## 1. Recuperação imediata

### Se a cópia original for recuperada

Use o JSON do **mesmo cliente Web**, com secret ainda habilitado. Callback existente: `http://localhost:4180/oauth/callback`. Origem Picker, se necessária: `http://localhost:4180`. Único escopo Drive: `https://www.googleapis.com/auth/drive.file`.

Esta conferência é local e não altera serviços:

```powershell
$oauthClientPath = (Get-Item -LiteralPath (Read-Host 'Caminho real do JSON OAuth Web') -ErrorAction Stop).FullName
node scripts/connect-drive.mjs --client-file "$oauthClientPath" --check-config
```

**Somente após autorização explícita para reconectar e atualizar o refresh token de produção:**

```powershell
$driveOwnerEmail = Read-Host 'E-mail real da conta proprietária da pasta'
node scripts/connect-drive.mjs --client-file "$oauthClientPath" --owner-email "$driveOwnerEmail" --reconnect --apply
```

O assistente existente utiliza state/PKCE, confirma a conta, a pasta fixa, a marca privada do projeto e as permissões, e grava somente `GOOGLE_REFRESH_TOKEN`. Não troca `TICKET_KEY`, não cria pasta, não altera metadados, arquivos ou compartilhamento. Sem `--apply`, valida o consentimento e descarta o token da memória sem salvar; isso **não** recupera produção. Se precisar do Picker, informa a necessidade de chave pública restrita; não substitua a chave Firebase.

### Sem cópia: rotação do segredo no mesmo cliente

O Google não permite recuperar os valores antigos após a criação. O Worker pode usar seus secrets, mas o Wrangler e o dashboard não permitem baixá-los.

**Não escolha uma chave para excluir por ser a mais antiga, primeira ou segunda. Ainda não identificamos qual o Worker usa.**

1. No Google Cloud, continue em **Manual de Boardgame → Google Auth Platform → Clients → Acervo - Google Drive**. Não exclua o cliente, revogue a autorização da conta, crie outro projeto/cliente ou altere a pasta.
2. Identifique a chave em uso por backup/cofre/configuração original ou diagnóstico administrativo seguro do servidor. O Google mostra os quatro últimos caracteres para identificação; compare-os em ambiente privado, sem publicar capturas com credenciais. A lista de nomes do Wrangler não identifica qual das duas chaves está em uso.
3. **Diagnóstico autorizado concluído em 21/10/2026:** a conta proprietária autenticada e aprovada confirmou que o Worker usa a chave terminada em **Aho5**. A chave **DarE** não corresponde à configuração deste Worker; isso não comprova que nenhum outro serviço a utiliza. O diagnóstico temporário foi removido, a versão de produção anterior foi restaurada em 100% do tráfego e uma consulta autenticada confirmou HTTP 404 na rota removida. Nenhum secret, chave Google ou arquivo foi alterado. A recuperação do OAuth continua pendente e exige autorização separada; não excluir nem desativar chaves por este registro.
4. Comparar identifica a chave do Worker, mas não prova que a outra esteja sem uso em qualquer outro consumidor. Confira backups e outras integrações desse mesmo cliente. Com a chave dispensável identificada e a ação autorizada, desative somente essa chave. Disable é reversível por Enable; Delete é irreversível. Confirme que a chave usada na conexão existente permanece habilitada antes de excluir a outra.
5. Exclua a chave desativada somente depois dessa confirmação e autorização. O limite é de duas chaves cadastradas; apenas desativar não libera um terceiro lugar.
6. Clique **Add secret** no mesmo cliente. Guarde o valor ou JSON em local privado/cofre **imediatamente na criação**. Não envie ao chat nem ao Git. Preserve o client ID, os callbacks e o escopo.
7. Valide o novo JSON localmente. Depois de autorizar a atualização de **ambos** os bindings, o assistente pode atualizar `GOOGLE_CLIENT_SECRET` e `GOOGLE_REFRESH_TOKEN` juntos, por stdin ao `wrangler secret bulk`, preservando os demais secrets:

```powershell
$oauthClientPath = (Get-Item -LiteralPath (Read-Host 'Caminho do JSON privado com o novo segredo do mesmo cliente') -ErrorAction Stop).FullName
$driveOwnerEmail = Read-Host 'E-mail real da conta proprietária da pasta'
node scripts/connect-drive.mjs --client-file "$oauthClientPath" --check-config
node scripts/connect-drive.mjs --client-file "$oauthClientPath" --owner-email "$driveOwnerEmail" --reconnect --rotate-client-secret --apply
```

8. Valide uma leitura autenticada de capa e índice existentes. Não faça uploads, substituições ou exclusões. Só após confirmar que o segredo novo está em uso, o proprietário poderá autorizar desativar a chave antiga restante. Não excluir durante a investigação.

**Rotacionar client secret não elimina o prazo de Testing.** Recuperar agora em Testing é uma solução provisória. Não há garantia de transição sem interrupção quando a conexão já caiu e nenhuma chave atual está identificada.

Fonte oficial: [rotação, limite de duas chaves e reversão de desativação](https://support.google.com/googleapi/answer/6158849?hl=en#rotating-secrets).

## 2. Prevenção: preparar In production

Publicar o **app OAuth** em Audience não publica o conteúdo privado da biblioteca nem amplia permissões Firebase/Drive. Publicação do app, publicação do Branding e verificação são processos distintos. `drive.file` é não sensível, sem avaliação de segurança de escopo restrito. Verificação de marca/domínio é uma exigência separada. [Escopos](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [estados OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

Passos pelo proprietário, sem execução automática:

1. Em **Branding**, conferir nome Acervo, e-mail real de suporte selecionado e monitorado e contato do desenvolvedor. Não é necessário criar chave para preencher Branding.
2. Conferir os campos que ainda impedem Publish app e os avisos do Verification Center. O estado e o botão desabilitado foram informados pelo proprietário; não houve inspeção autenticada do Console nesta sessão.
3. Páginas locais preparadas: `sobre.html`, `privacidade.html`, `termos.html`, sem SDK Firebase ou acesso a catálogo/Drive. O build as inclui. **Ainda não publicadas nesta tarefa.** O contato orienta procurar o responsável pelo acesso; antes da submissão, o proprietário deve confirmar o texto e seu canal público de suporte.
4. URLs planejadas, derivadas do Pages existente, **não validadas como publicadas**: `https://thilanguis.github.io/Manual-de-Boardgame/sobre.html`, `https://thilanguis.github.io/Manual-de-Boardgame/privacidade.html`, `https://thilanguis.github.io/Manual-de-Boardgame/termos.html`. Usar no Console só depois de publicação autorizada e verificação anônima. O catálogo privado não deve ser a única apresentação pública.
5. A política distingue uso pessoal, inclusive menos de 100 pessoas conhecidas pessoalmente, de distribuição pública e admite exceções de verificação. Ser privado não comprova automaticamente todas as condições. Confirmar o enquadramento real antes de assumir dispensa ou revisão obrigatória. [Políticas](https://developers.google.com/identity/protocols/oauth2/policies), [marca e exceções](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).
6. **Domínio:** a orientação atual para verificação formal exige propriedade **Domain** no Search Console por DNS, usando a conta proprietária do projeto. Uma propriedade URL-prefix via arquivo/meta tag não satisfaz essa orientação. Ter um repositório Pages não concede controle DNS de `github.io`. Não declarar esse domínio como próprio nem prometer aceitação de `thilanguis.github.io`. Se exigida verificação formal por DNS e a exceção não se aplicar, será preciso domínio próprio controlado pelo proprietário ou orientação específica do Google. Pages suporta domínio próprio; não é necessário recriar o projeto OAuth. Nenhum domínio foi comprado/configurado. [Verificação de domínio](https://support.google.com/cloud/answer/13804266?hl=en), [Branding](https://support.google.com/cloud/answer/15549049?hl=en), [domínio próprio no Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).
7. Com as exigências reais resolvidas, o proprietário autoriza/executa Audience → **Publish app / In production**. Reautorizar depois da mudança para emitir um refresh token novo, sem depender do prazo de um token emitido em Testing. Não ampliar escopo ou compartilhar publicamente o Drive.

In production remove a regra específica dos sete dias. Revogação, inatividade, políticas da conta e limites de tokens ainda podem invalidar autorizações. Não existe garantia de token eterno.

## 3. Diagnóstico preparado localmente

- `invalid_grant`: autorização inutilizável; renovar. Não determina individualmente expiração/revogação.
- `invalid_client`/configuração: conferir cliente/segredo, sem chamar isso de refresh expirado.
- Rede/Google indisponível: erro temporário; quota: pausa; permissão de arquivo: mensagem específica, sem bloquear outros arquivos.
- 404 Drive pode indicar ausência **ou** arquivo não acessível ao app; a mensagem não assegura exclusão definitiva. Lixeira continua distinguida quando os metadados estão acessíveis.
- Cache de acesso/falhas pertence às credenciais atuais. Reconectar não herda falha antiga; renovações concorrentes são deduplicadas. Falha tem pausa de 60 segundos por instância, sem repetição automática. Não é um bloqueio global persistente entre instâncias Cloudflare.
- Frontend interrompe a rajada inicial de capas, preserva o catálogo e apresenta aviso administrativo com verificação explícita. Não altera autenticação ou permissões para recuperar a leitura.
- `/health` não consulta Google e anuncia `driveOAuth.verified: false`, `check: configuration-only`. `driveConnected` permanece apenas por compatibilidade de configuração.

## 4. Validação e limites

Testes locais simulam falha OAuth, indisponibilidade, configuração incorreta, Worker 503, pausa e retomada, permissões e preservação de catálogo/arquivos. O helper simulado testa reconexão sem PATCH de pasta, sem criação de pasta e sem alteração de tickets. Esses testes não autenticam nenhuma conta Google real.

Resultado desta preparação: 256 testes do aplicativo e 180 testes do Worker aprovados; teste Chrome com SDK/HTTP simulados aprovado (aviso, catálogo, uma sonda 503, comparação, recuperação, bloqueio de perfil e páginas públicas em 390/768/1440 px). A leitura simulada do índice usa gzip válido e confere seu conteúdo original após a recuperação. Build estático e sintaxe aprovados. Evidências descartáveis em `test-output/drive-recovery/`; não contêm dados ou tokens reais. A simulação não mede quotas, propagação de secrets ou aceitação do Branding pelo Google.

**Pendente após autorização:** concluir consentimento como proprietário; aplicar somente o binding/par autorizado; abrir capa e índice existentes com conta aprovada; conferir 200 e formato esperado, sem registrar corpo privado ou tokens. Confirmar visitante/bloqueado sem acesso. Nenhuma escrita de arquivo ou chamada Gemini. Validar Audience e observar a conexão após o antigo prazo de sete dias antes de considerar a prevenção comprovada.

Atualizar secrets via Wrangler cria/publica versão do Worker. `--apply` é mudança de produção e exige autorização; não foi executado. Os comandos de gravação neste documento são instruções condicionais.
