# Preferências e saúde do Acervo

## Logout e preferências locais

Favoritos, posição de leitura por documento e dispensas da seção de retomada
continuam neste navegador após sair da conta. As chaves incluem ambiente,
projeto e UID; outra conta não recebe essas preferências na interface. Não há
sincronização adicional com o Firebase e o diagnóstico não altera cadastros.

A limpeza permite somente essas três famílias de preferências. Os valores são
reduzidos a IDs, página, total de páginas, data de leitura e booleanos de
dispensa. Campos extras, texto de documentos e tickets não são preservados.
Esses metadados locais não substituem autenticação nem concedem acesso a PDFs.

O logout, bloqueio e perda de acesso continuam bloqueando a chave de cache,
revogando URLs, cancelando solicitações e esvaziando os bancos de índices,
traduções, pesquisas e cache criptografado. O leitor registra a página antes
de mudar o escopo da conta e remove as páginas/textos da interface. As
preferências já apagadas pela versão anterior não podem ser reconstruídas.

## Configuração versus funcionamento

`GET /health` é público e informa capacidades, sem acessar Google ou Firestore.
`driveOAuth.check = configuration-only` e `driveOperational = null` indicam
expressamente que esse endpoint não comprova funcionamento. O campo legado
`driveConnected` permanece apenas por compatibilidade e não é prova de OAuth.

`GET /v1/admin/health` exige login válido e perfil aprovado do administrador
principal, conferidos no backend. Reutiliza a leitura de autorização do perfil:

- **Firebase:** login validado e perfil lido no Firestore. Não testa todos os
  serviços ou operações do Firebase.
- **Drive:** realiza uma leitura autenticada dos metadados da pasta existente.
  Confere proprietário, projeto, tipo, lixeira e compartilhamento. Somente essa
  leitura bem-sucedida permite o estado operacional. Não enumera nem lê todos
  os PDFs/capas e não garante que cada arquivo esteja disponível.
- **Gemini:** mostra configuração/ativação, sempre sem declarar disponibilidade
  validada. Nenhuma chamada, geração, consulta de saldo ou alteração de cobrança.

O diagnóstico reutiliza o provedor OAuth, inclusive token de acesso válido,
deduplicação e espera após falhas. Não força renovação a cada abertura: uma
revogação do refresh token pode ser identificada somente quando houver nova
renovação. Um resultado operacional vale para a leitura feita naquele momento.

OAuth expirado/recusado, configuração incompleta, permissão negada, ausência ou
inacessibilidade da pasta, limite do Google e falha temporária têm códigos e
mensagens controlados. O 404 não prova exclusão: o recurso também pode estar
inacessível ao aplicativo. Respostas brutas do Google, tokens, emails e IDs da
pasta não são devolvidos pelo diagnóstico. A resposta usa `Cache-Control:
no-store`.

O painel fica em Gerenciar → Configurações → Conexão e diagnóstico. Verifica ao
abrir e permite atualização manual, sem polling. Impede solicitações duplicadas
durante a consulta, limpa estados antigos em erro e descarta respostas após
fechar ou trocar de conta. Se o perfil não puder ser autorizado, a API recusa a
operação; o painel não transforma isso em um diagnóstico operacional.

## Validação local

- Testes unitários de preferências, respostas Drive/OAuth e autorização HTTP.
- Navegador em desktop/tablet/celular, com IndexedDB real local: preferências
  mantidas e quatro bancos de caches esvaziados; painel sem falso verde.
- Auth/Firestore em `demo-acervo`: bloqueio/offline, logout, login em outra conta
  e retorno à conta original com favorito e página de leitura preservados.

Testes locais não substituem uma verificação autenticada da API publicada.
Esta alteração não autoriza deploy, alteração de secrets ou teste em produção.
