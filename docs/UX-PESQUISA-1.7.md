# Pesquisa, conferência e página inicial — 1.7.0

## Comportamento

- “Revisar sugestões” permanece. Nenhum campo é aplicado ao pesquisar ou apenas avançar de etapa.
- Cartões mostram título em PT-BR quando houver um nome correspondente registrado para a mesma obra, título em inglês secundário, fonte discreta, resumo utilizável e dados agrupados. Traduções adicionais, edição, evidências e licenças ficam recolhidas. Não se presume que um título inglês seja necessariamente o título original.
- “1 jogo encontrado” conta obras identificadas, sem contar duas fontes da mesma obra como dois jogos. Fontes lentas continuam independentes. Falhas reais são avisadas; estado de cada conector e erros completos continuam em “Detalhes da pesquisa”.
- Um resultado com apenas título informa explicitamente a ausência dos outros dados. “2025 board game” e rótulos equivalentes não são oferecidos como sinopse. Conectores que ainda vão buscar os detalhes informam essa situação.
- A revisão mostra o valor de cada campo e o valor anterior quando há diferença. Intervalos são selecionados em pares. Aplicar exige campos selecionados e confirmação do administrador, preenche o formulário e abre “Conferir dados”. A validação precede a aplicação.
- Uma edição feita depois de abrir a revisão invalida a seleção dos campos afetados: a revisão é reapresentada e exige nova conferência, preservando o que foi digitado.

## Página inicial e textos

Estado técnico, cargo e provedor não aparecem mais na página inicial. “Sobre o acervo” e a atualização manual estão em “Opções”, junto do contador; a sincronização automática existente foi preservada. Diagnóstico e console continuam disponíveis em uma área recolhida de “Sobre o acervo” e nas configurações administrativas.

O destaque não mostra a frase redundante de inclusão recente, sinopses genéricas nem texto estrangeiro com idioma explicitamente registrado e sem confirmação. Dados antigos são preservados no cadastro para revisão; não há tradução ou sinopse inventada. A ausência de resumo não é substituída por um parágrafo explicativo. Em telas grandes com 1–3 jogos, destaque e biblioteca ficam lado a lado; coleções maiores mantêm a largura da grade. Títulos de cards podem ocupar duas linhas. Telas menores mantêm o empilhamento.

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
