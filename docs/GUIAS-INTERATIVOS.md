# Proposta — Aprender a jogar

A primeira versão foi implementada na v1.3.0, incluindo consulta rápida sem IA. Consulte [a documentação atual](BIBLIOTECA-INTELIGENTE.md). O texto abaixo registra a proposta original.

Esta é uma proposta para avaliação, antes de implementar os guias. O PDF original permanece disponível pelo leitor existente. A arquitetura continua com HTML/CSS/JavaScript, GitHub Pages, Firebase Authentication/Firestore Spark e o Worker Free que acessa a pasta PDFs existente do proprietário.

## O que o código atual oferece

- `js/reader.js` abre o PDF com PDF.js, páginas, zoom, seleção de texto e retomada de leitura.
- `js/pdf.js` extrai texto de até 12 páginas/80 mil caracteres na importação. Não preserva um mapa de evidências por página para um guia completo.
- `js/recognition.js` identifica metadados por evidências, sem um modelo de IA ou OCR.
- `js/firebase-repository.js` aplica o fluxo pending/approved e oferece operações de jogos; Firestore e Worker verificam permissões.
- O Worker aceita atualmente somente PDF e capa JPEG. Imagens de guias precisam de um tipo e rotas próprios, com autorização e vínculo ao conteúdo publicado.
- O cadastro já está em Entrar → Criar conta. No celular, o texto Entrar fica oculto e aparece o avatar. Na proposta de interface, dar destaque ao cadastro e melhorar o rótulo acessível desse botão.

## Experiência de leitura

Ao abrir um jogo, apresentar Manual completo e Aprender a jogar. O segundo botão fica disponível quando existe um guia publicado compatível com o manual atual; durante preparação, mostrar Guia em preparação. Visitantes acessam o conteúdo publicado sem cadastro.

O guia abre numa tela própria, com o título do jogo e acesso permanente ao PDF. No celular, usar uma coluna, índice recolhível e botões grandes; no tablet, aproveitar um índice lateral quando houver espaço. Oferecer pesquisa dentro do guia, realce dos resultados e links com fragmentos de URL para compartilhar uma seção sem depender de reescrita de rotas no GitHub Pages.

Seções iniciais: visão geral/objetivo, preparação, componentes, turno, ações, regras importantes, fim de jogo/vitória, dúvidas frequentes e exemplos ilustrados. O administrador pode renomear, ordenar, acrescentar ou omitir seções. Não publicar uma seção vazia como se contivesse uma regra.

## Conteúdo e armazenamento

| Informação                   | Local proposto                                                    | Acesso                                                      |
| ---------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| PDF e capa existentes        | Drive, com referências atuais do jogo                             | Política atual do catálogo                                  |
| Rascunho do guia             | `guideDrafts/{gameId}` no Firestore                               | Administradores autorizados                                 |
| Guia publicado               | `gameGuides/{gameId}` no Firestore                                | Leitores autorizados pela visibilidade do jogo              |
| Imagens e recortes do guia   | Mesma pasta PDFs no Drive, com marcação de jogo e imagem          | Worker autoriza pela publicação ou pela permissão de edição |
| Indicação de guia disponível | Campos opcionais pequenos em `games/{gameId}`                     | Catálogo atual                                              |
| Histórico das publicações    | Eventos administrativos com metadados, sem cópias de todo o texto | Administradores                                             |

Separar rascunho e publicação em documentos diferentes. Firestore lê documentos inteiros; esconder campos na interface não protege notas ou sugestões ainda não aprovadas. [Regras por documento e campos](https://firebase.google.com/docs/firestore/security/rules-fields).

Um guia seria um documento estruturado com schemaVersion, gameId, revisão, identificação do PDF usado, data de publicação e uma lista ordenada de seções com IDs estáveis. Os dados privados de revisão ficam no rascunho e no histórico, sem e-mails administrativos na cópia pública.

Cada seção contém blocos de texto, listas, avisos, imagens, exemplos ou perguntas/respostas. Texto formatado usa tipos e marcas permitidos, como negrito e itálico. O renderer cria elementos DOM de uma lista fechada; não executa HTML arbitrário nem JavaScript vindo do editor. Links externos aceitam apenas protocolos seguros. Imagens contêm referências Drive, legenda, texto alternativo e eventual fonte no PDF; não armazenar base64 no Firestore.

Para a primeira versão, limitar o guia a 512 KiB serializados e manter imagens fora do documento. Isso fica abaixo do limite de 1 MiB por documento. Se guias reais ultrapassarem esse limite, dividir o conteúdo por seções numa etapa posterior. Excluir texto longo dos índices, pois a busca será local. [Limites do Firestore](https://firebase.google.com/docs/firestore/quotas).

## Editor e publicação

Administradores aprovados com `editGames` podem criar, editar, reorganizar, revisar e publicar o guia de um jogo existente. A permissão `addGames` sozinha não concede edição de guias. O superadmin mantém acesso completo; exclusão definitiva do jogo continua exclusiva dele.

O editor oferece blocos, formatação simples, listas, avisos, imagens com legenda, pré-visualização de celular/tablet e referências ao PDF. Reordenar também com botões Subir/Descer, sem depender de arrastar no celular. Salvar rascunho com atraso após alterações, evitando uma gravação por tecla, e um botão Salvar agora.

Sugestões automáticas entram como não revisadas. O administrador ajusta o texto, confirma as fontes e marca cada seção como revisada antes de publicar. A revisão representa aprovação explícita do responsável, não uma garantia automática de que o texto está correto.

Publicar copia o rascunho aprovado para um snapshot público numa transação, atualizando a indicação do catálogo e registrando responsável/revisão no histórico. O leitor recebe a versão completa anterior até a nova estar pronta. Edições posteriores continuam privadas até outra publicação. Controle de versão detecta alterações concorrentes e evita sobrescrever o trabalho de outro editor.

As regras Firestore autorizam leitura/escrita, validam o esquema e exigem o vínculo da publicação ao jogo e ao evento administrativo. O Worker verifica o token Firebase e o perfil efetivo antes de operações de imagens. Visitantes, contas pending, rejeitadas, bloqueadas ou comuns não escrevem, mesmo chamando as APIs diretamente.

## Sugestões a partir do PDF

Criar uma análise separada, iniciada pelo administrador com Sugerir conteúdo do PDF. Reutilizar PDF.js e a organização de linhas existente, mas preservar o número da página de cada trecho. Processar as páginas progressivamente, com progresso e cancelamento, sem tornar a importação atual mais pesada.

Detectar títulos como Objetivo, Preparação, Componentes, Turno e Fim de jogo e organizar trechos curtos correspondentes em sugestões. Preservar listas e termos do original, sem inferir regras não escritas. Uma seção sem evidência fica sem sugestão. Para perguntas frequentes, usar perguntas explícitas do documento ou apresentar perguntas para o editor responder; não fabricar respostas.

A primeira versão automatiza a localização e organização de evidências. A reescrita didática e a criação de exemplos ficam sob revisão editorial. Não prometer resumos generativos confiáveis usando apenas os extratores atuais. Não adicionar APIs pagas de IA ou OCR. PDFs escaneados com pouco texto recebem indicação de preenchimento manual.

As fontes associam SHA-256 do PDF, página física, eventual rótulo impresso e trecho curto. Ver no manual abre o leitor atual na página física indicada, mediante um parâmetro opcional; a abertura normal preserva sua retomada atual. Não confundir número impresso com posição da página no arquivo.

Se o PDF for substituído, preservar o conteúdo do guia e exigir revisão das referências antes de disponibilizar uma versão compatível. Comparar o hash do PDF em regras e na interface permite detectar isso sem Functions. Não abrir uma página do PDF novo como se fosse a fonte antiga.

## Imagens e infraestrutura

Acrescentar suporte a imagens do guia ao upload retomável existente, com IDs próprios e formatos raster permitidos. Comprimir no dispositivo, validar tamanho/formato e marcar cada arquivo com projeto, jogo e identificador da imagem. Todos os envios continuam usando OAuth do proprietário na pasta PDFs existente; não criar outra pasta.

Uma imagem de rascunho só pode ser lida por um editor autorizado. Para leitura pública, o Worker precisa conferir que o arquivo está referenciado no guia publicado daquele jogo, além de conferir proprietário/pasta/projeto. Não basta conhecer o ID do Drive. A exclusão do jogo deve também tratar guia e imagens vinculadas pelo fluxo autorizado, com retomada de limpeza em caso de falha.

Buscar um guia somente quando ele for aberto. Pesquisar seu texto no navegador, aproveitando a normalização de acentos existente, sem serviço externo de busca. Usar carregamento tardio de imagens. Não duplicar todos os guias e PDFs no cache da PWA.

Não contratar serviços novos nem ativar Blaze. O consumo adicional será de documentos Firestore, requisições Worker e espaço do Google One já contratado, sujeito às cotas atuais. Não há garantia de uso ilimitado.

## Integração e verificação

Criar módulos separados de modelo/validação, visualização, editor e sugestões, usando a interface de repositório atual. Estender somente os pontos necessários: detalhes do jogo, operações Firestore, regras, rotas de imagens do Worker e abertura opcional do PDF por página. Campos novos no catálogo são opcionais para manter jogos antigos válidos. O modo local deve preservar os jogos já existentes ao acrescentar armazenamento de guias.

Antes de publicar a funcionalidade, verificar: rascunhos inacessíveis a visitantes; publicações com autorização efetiva; contas bloqueadas perdendo escrita; imagens privadas sem vazamento; publicação atômica e conflito entre editores; evidências por página; troca de PDF invalidando fontes antigas; navegação, pesquisa e acessibilidade em celular/tablet; e regressão do cadastro, importação, substituição, exclusão, favoritos, PWA e leitor PDF.

Implementar em etapas verificáveis: modelo/regras e editor manual; leitura pública e referências; imagens pelo Worker; sugestões com evidências. A arquitetura desta proposta ainda não foi implementada.
