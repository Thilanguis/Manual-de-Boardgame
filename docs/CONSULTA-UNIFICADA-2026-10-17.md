# Consulta unificada e conhecimento automático — 17/10/2026

Implementação local. Sem commit, push, deploy, migração ou alteração em produção.

## O que foi reaproveitado

Extração de PDF, OCR progressivo, checkpoints, índices privados, cache criptografado, pesquisa textual em worker, conectores de catálogo, geração Gemini no servidor, referências de página e permissões existentes. O armazenamento de guias, rascunhos e imagens antigas foi preservado.

## Fluxo atual

- A ficha oferece **Ler manual** e **Consultar regras**, além do favorito. O leitor mantém a seleção individual dos documentos.
- Consultar regras reúne explicações armazenadas, PDF/OCR e guias publicados antigos. Mostra visão geral quando disponível, até 12 assuntos e busca local por palavras ou perguntas. Não faz chamadas Gemini.
- Cada resultado identifica sua origem. Referências de PDF conservam documento, página e hash; o botão abre a página correspondente. Informações gerais de catálogos não são apresentadas como regras oficiais da edição.
- Gerenciar jogo tem somente **PDFs** e **Informações**. Foram removidos os fluxos de criar, importar, aprovar e publicar guias. Isso não remove seus dados antigos. Rascunhos continuam privados; somente guias já publicados entram na consulta.
- Informações mostra um resumo do conhecimento, assuntos, documentos, data e limitações. Detalhes e correções ficam recolhidos. A única ação de geração é **Atualizar conhecimento com IA**, com confirmação explícita.

## Validação sem aprovação obrigatória

Conhecimento validado fica pesquisável imediatamente, inclusive registros com o antigo estado `unreviewed`. Não depende de aceitar ou publicar seções. Uma informação rejeitada anteriormente continua excluída; não é reativada silenciosamente.

A consulta confere fonte e evidência, documento atual, hash e página. Citações sem evidência não entram. Isso valida o vínculo da explicação, não prova automaticamente que toda interpretação da IA está correta; a interface identifica explicações por IA e oferece o manual original.

O administrador pode salvar uma correção diretamente. Regenerações preservam correções, aceitações e rejeições anteriores. Ao mudar o conjunto de PDFs, somente decisões ligadas a documentos com o mesmo ID e hash podem acompanhar o novo contexto. Páginas de outra edição não são herdadas.

## Geração e cadastro

A fila solicita análise depois que os índices autorizados dos documentos estão preparados. O contexto inclui título, edição, IDs e hashes. Solicitações concorrentes e recargas são deduplicadas; resultados e controles de cota continuam persistidos no servidor. Falhas e limites não provocam tentativas infinitas.

O servidor lê índices verificados; não aceita texto arbitrário do navegador como manual. Mantém o limite de entrada existente de 200 mil caracteres, sem cortar páginas silenciosamente. Documentos incompletos e limites são informados.

Em edição de um cadastro com conhecimento já disponível para o PDF atual, a etapa 2 pode receber sugestões verificadas nos campos vazios. Campos preenchidos ou esvaziados manualmente são preservados. O administrador confirma o cadastro antes de salvar. Para um PDF novo ainda não salvo, a análise completa ocorre **após salvar e preparar o índice**: não foram criados uploads temporários ou uma autorização mais fraca para antecipá-la. Depois, as sugestões ficam disponíveis em Informações.

As fontes públicas continuam independentes. Aliases PT/EN/FR e variações de edição ajudam a pesquisa, sem declarar equivalência entre expansões e jogos base. Pistas explícitas de editora e ano são preservadas. Valores coincidentes ou divergentes mantêm proveniência; Gemini derivado do mesmo manual não conta como uma segunda confirmação independente. Nenhum conector foi simulado como se estivesse autorizado em produção.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| Suíte do aplicativo | 117 aprovados |
| Suíte do Worker | 81 aprovados |
| Regras no Firestore emulado | 27 aprovados |
| Sintaxe, JSON, recursos do service worker e whitespace | Aprovados |
| Cadastro no navegador com Auth/Firestore emulados e Worker real sob fixtures de Drive/Gemini | Uma geração automática; metadados e descrição confirmados; correção preservada após atualização explícita |
| Consultas por ataque, preparação, movimento e objetivo; abertura/reload/outro leitor | Zero novas gerações; página correta; conhecimento persistente |
| Campo vazio no cadastro existente | Idade preenchida com sugestão verificada na etapa 2 e conferida no registro salvo; descrição corrigida preservada |
| Fonte Gemini indisponível | Pesquisa do PDF continuou funcionando e erro real permaneceu visível |
| Permissões | Proprietário e subadministrador mantêm funções próprias; leitor aprovado consulta, mas não gera; pendente e visitante recebem negação |
| Dados antigos | Guia publicado, rascunho e imagem preservados; imagem disponível na consulta |
| Responsividade | Chrome em 1440, 768 e 390 px; captura inspecionada |
| Resident Evil real | 22 páginas legíveis, nenhuma falha, 212 títulos internos sem despejá-los inicialmente na interface; 19 resultados para “cartas”; índice reutilizado após reload |
| Sina da Sociedade real | OCR das 24 páginas, todas legíveis, nenhuma falha; pausa/retomada sem repetir páginas concluídas; 7 resultados para “jogo”; índice reutilizado após reload |
| Múltiplos documentos | Fluxo de navegador de documentos passou, preservando leitura individual e dados antigos |

As suítes também cobrem 50 MiB, blocos retomáveis de 8 MiB, hashes, arquivos legados maiores, autorização, troca de documentos e isolamento. O teste de limite grande em navegador não foi repetido nesta alteração, pois upload e limite não foram modificados.

O teste integrado usa resposta Gemini simulada para verificar as operações reais do aplicativo e do Worker, sem consumir cota. Os PDFs reais foram processados localmente; não foram enviados novamente ao Gemini ou ao Drive. As dimensões de Chrome não equivalem a testes de memória em aparelhos físicos. Não foi verificada nova resposta do serviço Gemini em produção nesta tarefa.

Relatórios e capturas descartáveis ficam em `test-output/`. A repetição do teste real grava `automatic-real-report.json` com os PDFs selecionados naquela execução; Resident e Sina foram verificados em execuções separadas.

## Execução dos testes

`npm test`, `npm test --prefix worker`, `npm run check` e a suíte `security/*.test.mjs` no projeto `demo-acervo`.

O fluxo `tests/unified-validation.mjs` deve rodar dentro de `firebase emulators:exec`, com Auth em 9189, Firestore em 8189 e `ACERVO_TEST_URL` apontando para o servidor estático local. `ACERVO_TEST_MODULES` aponta para `tests/runtime`. Ele executa a integração e depois as regras; não altera produção.

O teste `tests/automatic-real-browser.mjs` recebe caminhos pelos ambientes `ACERVO_RESIDENT_PDF` e `ACERVO_SINA_PDF`, força configuração local e desativa tradução remota. Não informe credenciais nesses ambientes.

## Publicação pendente

As mudanças de frontend e Worker precisam ser publicadas juntas, mediante autorização. A versão do cache estático foi alterada para evitar misturar telas antigas e módulos novos. Não foi necessário alterar as regras de segurança para eliminar a aprovação de conhecimento: o conteúdo continua protegido pelo Worker e pelos perfis atuais.

Não foram habilitados serviços pagos, conectores adicionais ou faturamento. A análise automática continua dependendo de chave Gemini válida, consentimento, modelo e cota gratuitos disponíveis e índices preparados.
