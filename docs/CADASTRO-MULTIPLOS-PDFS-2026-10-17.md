# Vários PDFs no cadastro inicial

O cadastro aceita selecionar vários PDFs de uma vez ou acrescentar arquivos depois pelo botão **Adicionar mais PDFs**, na etapa Identificar jogo. O primeiro arquivo selecionado é o manual principal; os demais ficam separados, vinculados ao mesmo jogo.

Antes de salvar, cada complemento pode receber nome, tipo e idioma próprios, ou ser retirado da seleção. Continuam valendo até 12 documentos por jogo, 50 MiB por arquivo e as permissões existentes de edição de documentos. A seleção não envia os arquivos ao Drive antes da confirmação.

Os PDFs são verificados individualmente e em sequência, sem abrir todos simultaneamente. Um arquivo inválido ou repetido não apaga os arquivos já selecionados. A interface informa o motivo; não descarta silenciosamente arquivos acima da quantidade permitida.

Correção adicional: um complemento inválido agora permanece na seleção com seu nome e motivo da falha. Ele bloqueia o avanço e o salvamento até ser retirado ou substituído por uma cópia válida. Antes, esse arquivo podia sair da lista e seu aviso desaparecer ao avançar de etapa, permitindo salvar somente os PDFs restantes. Duplicados são identificados explicitamente, sem incluir o mesmo conteúdo duas vezes.

A seleção inicial mostra a contagem de PDFs. A confirmação final lista a quantidade e os nomes dos documentos, e a mensagem de sucesso informa quantos PDFs foram salvos. A pesquisa automática do principal começa depois da conferência do lote, evitando operações concorrentes nessa seleção.

No salvamento, os arquivos mantêm identificadores, hashes, nomes, páginas e uploads separados. Se um complemento falhar, o cadastro permanece aberto, mostra os arquivos pendentes e permite tentar de novo. O principal e os complementos concluídos não são reenviados. O envio retomável existente e os blocos de 8 MiB foram preservados.

A preparação desse cadastro aguarda a conclusão do lote. O teste com três PDFs confirmou uma única geração automática para o conjunto final. Fechar um cadastro parcialmente salvo permite preparar os documentos que já foram concluídos.

Também foi corrigida a leitura da versão atual no Firestore ao converter um cadastro legado para a estrutura com documentos, evitando um conflito de versão no envio do primeiro complemento.

## Testes

- Navegador com armazenamento local: seleção inicial múltipla, seleção adicional, duplicado rejeitado, retirada e nova seleção, nome/tipo, cadastro de documentos com 13/60/8 páginas, leitura individual, progresso, recarga e gerenciamento posterior.
- Responsividade: formulário em 1440, 768 e 390 px, sem transbordamento horizontal e com ações de navegação visíveis; captura de celular inspecionada.
- Firebase Authentication e Firestore emulados, Worker real com Drive/Gemini simulados: cadastro de três PDFs, falha HTTP 503 no segundo complemento, nova tentativa, principal enviado uma única vez, metadados persistidos, uma geração automática e consultas posteriores sem novas gerações. Os testes de permissões e correções existentes nesse fluxo também passaram.
- Regressão `registration-batch-browser.mjs`: seleção inicial de três arquivos, dois deles inválidos; ambos permanecem visíveis, o avanço é bloqueado e nenhum cadastro incompleto é salvo. Após selecionar cópias válidas, o resumo informa três PDFs, o registro contém três documentos e a ficha e o seletor do leitor exibem os três, inclusive após reload.
- O fluxo Firebase emulado também seleciona agora os três arquivos juntos no seletor inicial e confere três documentos na ficha, sem passar pela edição.
- Suíte do aplicativo: 117 testes aprovados. Sintaxe, JSON, recursos do cache e `git diff --check` aprovados.

Nenhum teste usou Firebase, Drive ou Gemini de produção. Não houve commit, push ou deploy.
