> Registro histórico. Na implementação local 1.11, novos uploads e substituições voltaram a **50 MiB**. Arquivos antigos maiores permanecem legíveis. Consulte [DESENVOLVIMENTO.md](DESENVOLVIMENTO.md).

# PDFs de até 200 MiB

Alteração local de 16/10/2026. Nenhum commit, push, deploy ou alteração em produção.

O limite por arquivo é **209.715.200 bytes (200 MiB)**, inclusive. Um arquivo de 209.715.201 bytes é recusado. Não confundir com 200.000.000 bytes.

## Pontos atualizados

- `js/pdf-limits.js` centraliza o limite compartilhado por frontend e fallback do Worker.
- `config/app-config.js`: `maxPdfBytes`; `worker/wrangler.jsonc`: `MAX_PDF_BYTES`.
- Cadastro, edição, adição/substituição de documentos, leitura pelo repositório e mensagens em `index.html`/`js/app.js`.
- Regras Firestore: validação do manual principal e dos documentos adicionais.
- Worker: validação antes da criação da sessão Drive; tamanho integral preservado no ticket e em `X-Upload-Content-Length`.
- Upload direto pelo adaptador também recusa PDFs acima do limite antes do hash ou da solicitação de upload.

Os blocos continuam em **8 MiB**, alinhados a 256 KiB, com último bloco menor quando necessário. Retomada, autenticação, permissões e pasta existente do Drive foram preservadas. Capas, imagens de guias e índices gzip continuam com seu limite de 8 MiB; os limites de texto do índice não foram aumentados.

## Leitura e memória

`loadPdf()` usa `PDFDataRangeTransport`: o PDF.js pede trechos do Blob, sem uma cópia integral prévia no JavaScript principal. A leitura remota continua usando Range autenticado, com carregamento antecipado desativado. O tamanho-base de leitura é 256 KiB; o PDF.js pode agrupar trechos adjacentes.

A inspeção calcula o SHA-256 antes de abrir o documento, liberando a referência ao buffer de entrada antes da decodificação das páginas. As páginas extraídas são limpas; a capa é limitada a dois milhões de pixels e seu canvas é liberado. O leitor mantém o limite existente de 16 milhões de pixels por canvas.

**Limitação real:** Web Crypto ainda exige um ArrayBuffer integral para SHA-256, de até 200 MiB, e pode criar cópias internas temporárias. O PDF.js também mantém buffers próprios; imagens complexas e fontes consomem memória adicional. Os testes em telas menores são emulação de viewport no Chrome do computador, não medição de RAM em celulares/tablets físicos. Aceitar 200 MiB não garante que qualquer PDF caiba em qualquer aparelho. Não há alegação de memória constante nem de validação física nesses dispositivos.

## Testes

| Tamanho                             | Frontend / upload / Worker / Firestore | Navegador                                                                           |
| ----------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| 52.428.799 bytes, próximo de 50 MiB | Aceito                                 | Inspeção, índice e leitura                                                          |
| 50 MiB                              | Aceito                                 | Inspeção, índice e leitura                                                          |
| 100 MiB                             | Aceito                                 | Inspeção, índice e leitura                                                          |
| 150 MiB                             | Aceito                                 | Inspeção, índice e leitura                                                          |
| 200 MiB exatos                      | Aceito                                 | Inspeção, índice e leitura em três viewports; cadastro e reabertura após recarregar |
| 200 MiB + 1 byte                    | Recusado                               | Recusa antes de abrir/analisar                                                      |

Fixtures grandes são cópias válidas de Resident Evil (22 páginas com texto) e Sina da Sociedade (24 páginas escaneadas), regravadas com um stream não utilizado para obter tamanhos exatos. Preservam texto, imagens e páginas, mas não simulam 200 MiB de imagens únicas ou o pior caso de decodificação. Todos os tamanhos aceitos tiveram todas as páginas percorridas e as páginas 1 e 2 renderizadas no leitor. Sina escaneado não gera texto pela extração nativa; o OCR existente não foi alterado por esta mudança.

O teste de retomada interrompe o upload de 200 MiB após 104 MiB; uma nova instância continua do ponto confirmado, com uma única sessão, 25 blocos aceitos e progresso final de 100%. Os demais tamanhos também verificam a quantidade, sequência e tamanho dos blocos. Os testes da API verificam a autorização e a solicitação de sessão Drive com o tamanho correto; o Drive é simulado, sem gravar arquivos de teste na conta real.

Suítes: 89 testes do aplicativo, 51 do Worker e 25 de regras Firestore no emulador. Regressão no navegador para múltiplos documentos: cadastro, preparo, Consulta rápida, substituição, principal, remoção e persistência. Verificação de sintaxe, build estático e build do Worker em **dry-run**, sem publicação.

Relatórios locais em `test-output/limits-*.log` e `test-output/large-pdf-report.json` (ignorados pelo Git). As fixtures em `test-output/large-pdfs/` também não entram no repositório ou no build.

## Reproduzir

```powershell
npm test
npm --prefix worker test
npm run test:rules
npm start
# Em outro terminal, com Playwright e pdf-lib disponíveis:
$env:ACERVO_TEST_MODULES='CAMINHO/node_modules'
$env:ACERVO_TEST_URL='http://localhost:4173'
$env:ACERVO_RESIDENT_PDF='CAMINHO/resident_evil pt-BR.pdf'
$env:ACERVO_SINA_PDF='CAMINHO/o_senhor_dos_aneis_regras_em_pt_br_305303.pdf'
node tests/large-pdf-browser.mjs
node tests/documents-browser.mjs
```

Antes de ativar em produção, publicar de forma coordenada as regras, o Worker e o frontend e medir o comportamento real no Worker Free e nos aparelhos desejados. A versão publicada não foi modificada nesta tarefa.
