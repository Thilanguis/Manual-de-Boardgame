> Registro histórico. Na implementação local 1.11, novos uploads e substituições voltaram a **50 MiB**. Arquivos antigos maiores permanecem legíveis. Consulte [DESENVOLVIMENTO.md](DESENVOLVIMENTO.md).

# Correções de upload e avisos — 1.10.1

Alterações locais, sem commit, push, deploy ou alteração de dados/regras de produção.

## O que causava a falha

O frontend já aceitava 200 MiB, mas isso não demonstrava que o servidor conectado ou as regras publicadas aceitavam o mesmo limite. O `/health` público consultado retornou `apiVersion: 1.7.5`, sem `maxPdfBytes` nem os protocolos novos. A configuração antiga do repositório usava 50 MiB; não foi feita leitura da variável privada do Worker de produção para confirmar seu valor atual.

O teste completo também revelou uma inconsistência no Worker local: o cliente envia o SHA-256 como `sourceHash` do manual principal, mas o Worker só registrava esse campo no Drive quando existia `documentId`. Na conclusão, exigia o hash ausente e rejeitava o arquivo. Agora o hash acompanha o arquivo principal e continua sendo conferido. Um teste de regressão verifica tanto a conclusão válida quanto a rejeição de hash adulterado.

## Comportamento corrigido

- Antes de enviar um PDF, o aplicativo consulta novamente o limite do servidor. Um limite menor ou uma versão antiga sem confirmação de suporte bloqueia arquivos acima da capacidade conhecida antes de enviar os blocos. A mensagem explica a atualização necessária, preservando o formulário.
- O aplicativo e o Worker mantêm o teto de **209.715.200 bytes**, com blocos de **8 MiB**. Os limites de capas e índices permanecem próprios.
- O Worker diferencia tamanho inválido, formato inválido e excesso do limite. O excesso retorna HTTP 413 com o limite efetivo.
- Se o envio grande termina, mas a gravação no Firestore é recusada, o erro contextual é preservado. Os arquivos enviados são descartados e os dados revisados continuam preenchidos. Eventual falha de limpeza continua sendo informada.
- O aviso permanente de preparação saiu do centro da biblioteca. Diagnóstico e tentativa de recuperação ficam recolhidos em **Minha conta → Conexão dos documentos**. A indisponibilidade continua explicada no recurso afetado; não foi criada preparação fictícia nem ignorada a necessidade de uma chave privada.
- Uma falha opcional do cache não é mais apresentada como falha fatal da biblioteca online.
- A limpeza de imagens privadas no encerramento da sessão preserva o ícone estático do cabeçalho.
- O botão Adicionar jogo só aparece para contas com permissão de cadastro. As validações do repositório, Worker e regras continuam obrigatórias.
- O texto da opção de leitura esclarece que ela atende contas aprovadas, sem chamar a biblioteca privada de pública.
- O cache do aplicativo passa a `acervo-v1.10.1`, para a instalação PWA receber o JavaScript corrigido, preservando edições em andamento.

## Testes executados

**92 testes do aplicativo, 58 do Worker e 26 das regras Firestore**, além dos fluxos de navegador abaixo.

### Cadastro completo, com código real do Worker

Chrome, Firebase Auth/Firestore emulados no projeto `demo-acervo`, código real do Worker via HTTP e Drive/OAuth simulados. Nenhum PDF foi enviado ao Drive real. Reconhecimento externo e preparação concorrente foram isolados neste teste para conferir especificamente o cadastro.

| Caso                                                                     | Verificação                                                                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Dead by Daylight real, 164.934.956 bytes (157,3 MiB), servidor de 50 MiB | Rejeição antes do upload; nenhum cadastro ou arquivo criado; formulário preservado.                                    |
| Mesmo PDF, servidor antigo sem informar limite                           | Rejeição antes do upload, explicando a atualização necessária.                                                         |
| Worker de 200 MiB e regras Firestore de 50 MiB                           | Upload concluído, gravação recusada, PDF e capa descartados; título, descrição e confirmação preservados.              |
| Mesmo formulário, Worker e regras de 200 MiB                             | Nova tentativa salva o PDF real e a descrição revisada; tamanho conferido no Firestore e no arquivo do Drive simulado. |
| PDF válido de exatamente 209.715.200 bytes                               | Cadastro completo, tamanho correto no Firestore e no Drive simulado.                                                   |
| Recarregar após os dois cadastros                                        | Dois jogos persistidos, sem aviso central, ícone do cabeçalho carregado e nenhum erro JavaScript.                      |

`tests/full-upload-browser.mjs` exige emuladores e o caminho do PDF real em `ACERVO_LARGE_PDF`. A fixture de 200 MiB é gerada em `test-output/full-upload/`, ignorada pelo Git. Evidência: `test-output/full-upload-report.json` e `full-upload-browser.log`.

As verificações de próximo de 50 MiB, 50, 100, 150, 200 MiB e excesso de um byte, blocos e retomada continuam na suíte. Os testes anteriores de abertura e análise de PDFs grandes estão documentados em [UPLOAD-200-MIB.md](UPLOAD-200-MIB.md). Viewports emulados não medem o consumo real de memória de um celular ou tablet físico.

### Acesso, recuperação e PWA

- Sessão restaurada sem abrir login ou Minha conta; capas e leitura autenticada preservadas.
- Erro 403 da chave privada não cria aviso no meio da biblioteca. O diagnóstico aparece em Minha conta e Tentar novamente recupera a preparação após a conexão ser restabelecida.
- Visitante e pendente bloqueados; proprietário aprova conta; usuário comum lê sem botão de cadastro e sem autorização de upload; bloqueio ao vivo encerra leitura e limpa o cache.
- Consulta rápida, PDF complementar, guia publicado, remoção recuperável, logout e layouts desktop/tablet/celular verificados novamente.
- PWA atualiza HTML/JavaScript mesmo com cache HTTP antigo, aguarda a edição terminar e remove somente o cache antigo do aplicativo.
- Sintaxe, build estático e build do Worker em `--dry-run`, sem publicação.

Evidências: `test-output/upload-fix-unit.log`, `upload-fix-worker.log`, `upload-fix-access.log`, `access-regression-report.json`, `upload-fix-pwa.log` e capturas `details-regression-*.png`.

## O que falta no site publicado

O servidor remoto permanece inalterado. Para salvar os PDFs grandes no ambiente publicado, é necessário publicar de forma coordenada o Worker com `MAX_PDF_BYTES=209715200`, as regras Firestore correspondentes e o frontend. As demais funções de documentos privados da versão 1.10 também dependem dessa compatibilidade.

Essa publicação exige autorização do proprietário, conforme sua instrução de não fazer deploy nem modificar regras de produção. Os testes locais não equivalem a um upload validado no Drive de produção. Não foi ativado faturamento nem adicionado serviço pago.
