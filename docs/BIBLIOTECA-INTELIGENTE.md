# Biblioteca inteligente — versão 1.3.0

O BGG é opcional e permanece desativado até a configuração do token de aplicação no Worker. O botão indisponível agora informa esse estado e não mostra um cursor de espera. Consultas ativas têm prazo de 25 segundos, incluindo a obtenção do token Firebase; não são iniciadas automaticamente durante a importação. Falhas não impedem salvar os dados do PDF. A capa externa também tem prazo de espera e mantém a capa original quando falha.

## Como usar

1. Abra um jogo. **Manual completo** mantém o leitor atual; **Aprender a jogar** mostra o guia publicado; **Consulta rápida** pesquisa guia e texto do PDF, com links para a página física original.
2. Como administrador com `editGames`, escolha **Editar guia e índice**. Adicione seções ou clique em **Analisar PDF completo**, com progresso e cancelamento. O processamento separado lê todas as páginas, confere o hash e usa bookmarks, tamanho dos títulos, palavras conhecidas e sumários. Não produz resumos nem respostas inventadas.
3. **Adicionar sugestões do PDF ao rascunho** acrescenta trechos sem sobrescrever seções existentes. Ajuste título, texto, apresentação, página, imagem e legenda. Use `**negrito**` e `*itálico*`, listas por linhas e tipos aviso, exemplo ou pergunta/resposta. Há botões para subir, descer e remover seções.
4. **Salvar rascunho** preserva o trabalho privado. **Pré-visualizar** mostra sua apresentação. Marque as seções revisadas e escolha **Publicar guia revisado** para disponibilizar a versão nova. Edições posteriores ficam privadas até a próxima publicação. Salvamento e publicação detectam alterações concorrentes no Firestore.
5. Visitantes também podem analisar o PDF para consulta em seu dispositivo, sem criar ou publicar um guia. Quando há índice publicado, ele é reutilizado. A busca ocorre em um Web Worker no navegador, sem serviço externo.

## Armazenamento e segurança

- Firestore: `guideDrafts/{gameId}` privado, `gameGuides/{gameId}` publicado e eventos `publishGuide` em `auditEvents`. Leitores herdam a visibilidade do jogo. Regras exigem `editGames`, revisão explícita, cópia do rascunho salvo, hash atual, revisão incremental e auditoria. Não basta esconder controles.
- Textos das seções: JSON estruturado dentro de `content`, até 350 KB; no máximo 100 seções, 20.000 caracteres por seção. O renderer cria elementos DOM e texto; não executa HTML, scripts ou links vindos do PDF/editor.
- Índice integral: JSON gzip de até 8 MiB no Drive central, com limite de 20 MB de texto extraído e 22 MB de JSON descomprimido. Não ocupa um documento gigante no Firestore. O limite interrompe a análise explicitamente, sem publicar um índice parcial.
- Ilustrações: convertidas em JPEG no dispositivo e enviadas ao Drive central. Imagens e índices usam uploads retomáveis e credenciais do proprietário somente no Worker. A pasta PDFs existente é preservada.
- O Worker só disponibiliza arquivos vinculados ao guia publicado, ou ao rascunho para editores autorizados. Confere proprietário, pasta, projeto, jogo, tipo de arquivo e permissões reais do Firestore.
- O navegador guarda até três índices recentes em IndexedDB, separados por projeto/conta/jogo/hash. Esse cache não recebe todos os PDFs nem faz sincronização em segundo plano. A última seção consultada é guardada por conta no dispositivo.
- Exclusão do jogo limpa guias e arquivos associados em lotes retomáveis de oito arquivos, respeitando os subrequests do Worker Free. `guideDeletion/{gameId}` é um checkpoint privado exclusivo do proprietário. Arquivos sem vínculo válido são preservados. Ilustrações removidas de uma seção e índices anteriores podem permanecer ligados ao rascunho para recuperação; são limpos na exclusão do jogo.

## Substituição do PDF

O guia publicado e o rascunho são preservados. Um aviso indica referências antigas; links para páginas da versão anterior ficam desativados. Use **Revisar referências para o PDF atual**, confira as páginas e marque novamente as seções antes de publicar. A análise do índice novo não substitui explicações revisadas.

## Reconhecimento e limites

Nomes de arquivos são normalizados e títulos genéricos, como “LIVRO DE”, são descartados. A importação rápida continua lendo até 12 páginas e sugere somente valores com evidência: jogadores, duração, idade, tipo, categorias, mecânicas, edição, descrição e idioma. Campos desconhecidos permanecem vazios; idioma desconhecido fica “Outro”. A lista de nomes candidatos e os trechos de origem permitem confirmar divergências.

PDFs escaneados podem não oferecer texto; não há OCR. Textos com colunas, fontes incomuns ou sumários com numeração impressa podem exigir organização manual. Sumários impressos são identificados como referências a conferir, sem presumir que a numeração impressa seja igual à página física. Bookmarks e cabeçalhos repetidos também precisam de revisão editorial. Trechos longos das sugestões têm até 5.000 caracteres; o índice de busca conserva o texto extraído das páginas completas dentro dos limites acima.

O guia precisa ser escrito/revisado para ensinar o jogo. Não há IA, serviço pago de busca ou promessa de interpretação automática de regras complexas. Nada ativa faturamento: Firebase Spark, GitHub Pages, Workers Free e o armazenamento Drive já contratado continuam sujeitos às respectivas cotas.

## Validação

Testes cobrem normalização e ausência de metadados, busca por expressão/acentos, compressão/hash, limites e timeout BGG; acesso a rascunhos, publicação revisada/auditada e visibilidade pelas regras; imagens públicas/privadas, proteção contra referências de outro jogo e limpeza em lotes na API. Testes de navegador usam PDFs sintéticos isolados (20 páginas e bookmarks), imagens, revisão/publicação, rascunho independente, cancelamento, pesquisa, abertura na página 20, substituição, HTML inerte, celular/tablet e regressão do leitor/upload/offline. As fixtures não são publicadas na biblioteca real.
