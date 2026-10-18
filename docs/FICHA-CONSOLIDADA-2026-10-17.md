# Ficha consolidada do cadastro

Implementação local, sem publicação ou alterações de produção.

## Funcionamento

A conferência acontece nos próprios campos da etapa 2. A pesquisa apresenta um resumo com acesso à ficha, em vez de fichas concorrentes e listas de aprovação. Gerenciar jogo → Informações usa o mesmo modelo para mostrar os dados salvos e sugestões para campos vazios; Editar informações abre essa mesma ficha editável.

Campos consolidados: título, edição, descrição, jogadores mínimos/máximos, duração mínima/máxima, idade, categorias, mecânicas e tipo de jogo. O idioma verdadeiro do PDF permanece separado. Origem, idioma, texto original, licença, data, referências, documento e hash acompanham os fatos disponíveis.

Prioridades:

1. Correções e valores já confirmados são preservados, inclusive apagamentos intencionais.
2. Fatos explícitos do PDF da versão atual têm prioridade na sugestão principal.
3. Catálogos autorizados completam lacunas; conhecimento Gemini salvo, com evidência verificada, também contribui.
4. PDF e Gemini baseados no mesmo documento não contam como confirmações independentes.

Fontes concordantes produzem uma indicação discreta no campo. Divergências numéricas, de edição ou de tipo de jogo aparecem somente no campo afetado. Alternativas ficam recolhidas e substituir um valor preenchido exige confirmação; mínimos/máximos são trocados juntos pela mesma origem. Categorias e mecânicas complementares são reunidas sem duplicatas. Sinopses diferentes e aliases oficiais não são classificados automaticamente como contradições factuais.

Identificadores incompatíveis, expansões e edições explicitamente diferentes são separados. Correspondências ambíguas exigem escolher a obra; não há fusão por semelhança textual. Fontes sem edição continuam identificadas como tal. Textos estrangeiros não traduzidos ficam nos detalhes, preservando o original; não são apresentados como descrição PT-BR.

Respostas progressivas atualizam apenas sugestões automáticas ainda intocadas. Não desfazem digitação nem esvaziamento manual. Metadados recebidos depois da consulta de detalhes não são substituídos por uma resposta resumida posterior.

## Persistência e Gemini

Antes do primeiro salvamento: PDF/OCR e conectores públicos existentes. Não há uploads temporários nem chamada antecipada ao Gemini. A análise automática existente continua após salvar e preparar os índices.

Na edição: dados do PDF, pesquisas reutilizáveis e conhecimento Gemini compatível são carregados sem gerar novamente. Sugestões ficam no formulário até a confirmação normal do salvamento. A confirmação final também registra os fatos conferidos para a reutilização da pesquisa, respeitando hash, edição e licenças existentes.

Gerenciar → Informações mantém resumo da análise e correções pontuais de conhecimento. Foi removida a segunda ficha de metadados com checkboxes Gemini. Atualizar conhecimento com IA permanece explícito e exige confirmação. Consultar regras continua local, sem chamada de geração por pergunta.

## Validação

- Suíte principal: 127 testes, incluindo consolidação, edição desconhecida, PDFs distintos, homônimos, origens, apagamentos e metadados legados de PDF.
- Worker: 81 testes.
- Firestore: 27 testes de regras com emuladores demo-acervo.
- Chrome: Catan em 1440, 768 e 390 px; valores dos inputs, edição/apagamento, salvamento, recarga e ficha administrativa verificados.
- Chrome: Sina da Sociedade com PDF + catálogo + Gemini salvo simulados; duração, concordância, metadados recebidos por consulta de detalhes, falha de fonte independente, hash incompatível e zero gerações na pesquisa.
- Integração Auth/Firestore/Worker: Sina, três PDFs no cadastro, falha parcial e retomada, registro salvo, uma geração inicial, consulta sem nova geração, correção preservada, atualização explicitamente solicitada e acesso por diferentes perfis.
- Regressões Chrome: documentos separados de 13/60/8 páginas, abertura e progresso individuais, substituição e remoção, cadastro com falhas, consulta de regras e quota simulada.

APIs públicas, Drive e Gemini foram simulados nos testes repetitivos. Não foram consumidas cotas de produção. Não houve commit, push, deploy ou mudança de regras publicadas. O limite de 50 MiB e os blocos de upload existentes foram preservados.
