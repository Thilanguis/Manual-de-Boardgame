# Pesquisa, conferência e página inicial — 1.7.0

## Comportamento

- “Revisar sugestões” permanece. Nenhum campo é aplicado ao pesquisar ou apenas avançar de etapa.
- Cartões mostram título em PT-BR quando houver um nome correspondente registrado para a mesma obra, título em inglês secundário, fonte discreta, resumo utilizável e dados agrupados. Traduções adicionais, edição, evidências e licenças ficam recolhidas. Não se presume que um título inglês seja necessariamente o título original.
- “1 jogo encontrado” conta obras identificadas, sem contar duas fontes da mesma obra como dois jogos. Fontes lentas continuam independentes. Falhas reais são avisadas; estado de cada conector e erros completos continuam em “Detalhes da pesquisa”.
- Um resultado com apenas título informa explicitamente a ausência dos outros dados. “2025 board game” e rótulos equivalentes não são oferecidos como sinopse. Conectores que ainda vão buscar os detalhes informam essa situação.
- A revisão mostra o valor de cada campo e o valor anterior quando há diferença. Intervalos são selecionados em pares. Aplicar exige campos selecionados e confirmação do administrador, preenche o rascunho e abre “Conferir dados”. A validação completa é obrigatória antes de publicar, permitindo conferir e corrigir campos ainda incompletos na etapa 2.
- Uma edição feita depois de abrir a revisão invalida a seleção dos campos afetados: a revisão é reapresentada e exige nova conferência, preservando o que foi digitado.

## Página inicial e textos

Estado técnico, cargo e provedor não aparecem mais na página inicial. “Sobre o acervo” e a atualização manual estão em “Opções”, junto do contador; a sincronização automática existente foi preservada. Diagnóstico e console continuam disponíveis em uma área recolhida de “Sobre o acervo” e nas configurações administrativas.

O destaque não mostra a frase redundante de inclusão recente, sinopses genéricas nem texto estrangeiro com idioma explicitamente registrado e sem confirmação. Dados antigos são preservados no cadastro para revisão; não há tradução ou sinopse inventada. A ausência de resumo não é substituída por um parágrafo explicativo. O destaque fica acima da biblioteca em todas as telas e usa exclusivamente o último jogo clicado neste navegador, por conta/biblioteca. Sem clique anterior, ou se esse jogo não estiver disponível, fica oculto. Um novo upload não muda a escolha. Títulos de cards podem ocupar duas linhas.

Avisos de conexão, autenticação, segurança, privacidade, direitos de compartilhamento e confirmação continuam acessíveis. O aviso de falta de internet permanece visível no fluxo principal. O rodapé anterior, incluindo o bloco “O manual certo. Na hora de jogar.”, o convite de instalação e a assinatura do Acervo, foi preservado conforme a preferência do proprietário.

## Teste concreto de Sina da Sociedade

`tests/research-ux-browser.mjs` executa o aplicativo real com o PDF brasileiro real de 24 páginas quando `ACERVO_SINA_PDF` é informado (esse caso foi executado em desktop). Tablet e celular usam um PDF sintético, identificado como teste. O cadastro é armazenado no IndexedDB real de um perfil descartável. Não ocorre envio ao Drive nem alteração de produção.

Apenas a resposta do conector é simulada, explicitamente no teste. Os fatos de identificação/partida foram conferidos na [página oficial da Z-Man](https://www.zmangames.com/game/the-lord-of-the-rings-fate-of-the-fellowship/): 1–5 jogadores, 60–150 minutos, 14+, aventura, estratégia e cooperação. O resumo em português é uma paráfrase curta escrita para a fixture, sem copiar descrição promocional. Isso não adiciona um conector Z-Man e não significa que o Wikidata real forneça esses campos.

| Verificação                                  | Resultado conferido                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Pesquisar → Revisar → Selecionar → Confirmar | Revisão manual preservada; campos vazios antes de confirmar                                              |
| Inputs em “Conferir dados”                   | Resumo, 1/5 jogadores, 60/150 minutos, idade 14, categorias, mecânicas e tipo conferidos individualmente |
| Ir e voltar                                  | Todos os valores preservados                                                                             |
| Salvar e ler o registro                      | Valores, fonte, licença e data da confirmação conferidos diretamente                                     |
| Edição durante a revisão                     | Texto digitado preservado; nova confirmação necessária                                                   |
| Somente título + rótulo genérico             | Só o título é oferecido; resumo e metadados continuam vazios tanto nos inputs quanto no registro salvo   |
| Home com 1 e 11 jogos                        | Desktop 1440, tablet 768 e celular 390, sem rolagem horizontal; capturas inspecionadas                   |

`tests/admin-browser.mjs` repete pesquisa/revisão/aplicação/ida e volta/salvamento na interface Firebase real conectada a Auth e Firestore **emulados**. Os mesmos campos de Sina são comparados ao documento lido diretamente do Firestore após salvar. Não cria contas reais.

## Regressões e limites

Passaram os testes de pesquisa progressiva/cancelamento, transferência de duração fixa e intervalos, cadastro em etapas até 320 px, títulos antigos, leitor PDF/texto/páginas/zoom, edição/substituição/exclusão, favoritos, guias, busca e atualização PWA com edição pendente. Os testes de unidade incluem apresentação, identificação segura, descarte de rótulos genéricos e estado de falhas. Fixtures e capturas ficam em `test-output/`, ignorado pelo Git.

As fontes reais continuam sendo as previamente autorizadas: esta mudança não habilita Ludopedia ou BGG sem credenciais. Quando uma fonte real só fornece nomes, o aplicativo informa esse limite e não completa campos com dados da fixture. Upload do Drive, regras do Firestore e permissões não foram modificados. Permanecem GitHub Pages, Firebase Spark, Workers Free e a pasta Drive já autorizada, sem novos serviços ou custos.

## Correções 1.7.1

Foi reproduzido um bloqueio real no botão de aplicação: a implementação validava o cadastro inteiro enquanto ele ainda estava na identificação. Uma duração parcialmente preenchida impedia aplicar outra sugestão e abrir a etapa 2. O teste de navegador foi executado antes da correção e falhou na asserção de visibilidade da etapa 2; depois, passou em desktop e celular.

A aplicação agora normaliza o rascunho sem exigir que os demais campos já estejam completos. Abre a etapa 2 diretamente para conferência. A navegação para publicação e o salvamento continuam usando `validateGame`; o teste verifica que duração incompleta ainda impede publicar. O painel só informa sucesso depois de verificar que a etapa 2 realmente está visível. Estados de bloqueio e alterações durante a revisão exibem aviso próximo ao botão ou levam o aviso à área visível.

Além de Sina e do caso só-título, `tests/research-real-data-browser.mjs` foi executado com o PDF real de **The Texas Chainsaw Massacre Slaughterhouse** e os metadados públicos reais já cadastrados, usados exclusivamente como resposta simulada da pesquisa. Todas as caixas foram marcadas. Título, descrição, jogadores 2–5 e duração 45–60 foram conferidos nos inputs e no registro local salvo em desktop/celular. Esse teste não altera dados de produção, não envia o PDF ao Drive e não afirma que uma API externa forneceu esses campos.

`tests/last-viewed-browser.mjs` verifica ausência de destaque antes de clicar, posição superior em 1440/768/390 px, troca pelo último clique, persistência após recarregar, manutenção da escolha após novo upload e ocultação ao remover o jogo selecionado. O rodapé anterior permanece preservado.

## Correções 1.7.2 — duração encontrada e inputs de minutos

Foram reproduzidas perdas na conversão de sugestões: `durationMinutes: 75` acompanhado de limites nulos era ignorado, e valores como `45 min` acabavam como `NaN`, deixando inputs numéricos vazios. O caminho do OCR também filtrava o campo de duração antigo antes de convertê-lo.

A conversão agora acontece antes da revisão, tanto para pesquisa quanto OCR. Duração fixa preenche ambos os limites; intervalo explícito preserva os dois valores; horas explícitas viram minutos, sem arredondar ou estimar. Um limite ausente só é completado se a mesma resposta também fornecer a duração completa e os valores forem compatíveis. Um mínimo isolado, sem essa informação, não é transformado em duração fixa. Dados apagados pelo administrador não são recuperados a partir de um valor antigo do cadastro.

`tests/research-duration.test.mjs` falhou antes da correção e passou depois. `tests/research-duration-browser.mjs` verifica cinco formatos em desktop/celular: limites vazios, um limite vazio com duração fixa explícita, número com unidade, intervalo em horas e OCR no formato antigo. Em todos os dez fluxos, confirma os dois inputs, ida/volta, números e origem no registro salvo e valores ao reabrir o cadastro. As respostas externas e do reconhecedor são fixtures identificadas, e o aplicativo/revisão/formulário/IndexedDB são reais em perfil descartável.

Não foram acrescentadas durações ao catálogo de produção nem novos conectores. Ausência de duração na fonte permanece ausência; esta alteração corrige o aproveitamento de valores explicitamente informados.

O teste administrativo com Auth/Firestore emulados também passou recebendo `1–2,5 horas` com limites nulos: os inputs e o documento salvo contêm 60 e 150 minutos. O teste não grava no catálogo de produção.

## Ajuste 1.7.4 — disposição anterior da biblioteca

Restaurados os espaçamentos do destaque e a apresentação dos títulos dos cards anteriores ao refinamento 1.7.0. Sobre o acervo volta à faixa acima da biblioteca; atualização manual permanece discreta na posição anterior aos filtros. O bloco original do rodapé volta ao mesmo contêiner da biblioteca. Textos curtos e diagnóstico recolhido foram preservados, sem estado técnico na página inicial. Destaque acima da biblioteca, último clique, revisão manual e correções de duração continuam funcionando.
