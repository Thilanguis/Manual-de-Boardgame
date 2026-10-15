# Reconhecimento 1.5.0 — resultados reais e limites

Validação em 14/10/2026, fuso America/New_York. Site: [Manual de Boardgames](https://thilanguis.github.io/Manual-de-Boardgame/). API: [Worker](https://acervo-drive-api.acervo-boardgames.workers.dev/health). Nenhum upload, exclusão ou alteração do Drive foi feito para estes testes.

## O que estava funcionando antes

O site publicado estava na versão 1.4.0 e apontava para o Worker correto. A implantação do Worker `bf978201-fad3-4ad0-b3e3-8c7f4b4bd460`, de 15/10/2026 01:01:14 UTC, correspondia à implementação anterior. Não encontramos divergência de implantação que explicasse o problema.

Somente **Wikidata** estava habilitado como consulta automática. Ludopedia e BGG estavam desativados por falta de autorização/credenciais. Links de editoras e “Pesquisar no site do BGG” eram pesquisas humanas em outra aba, sem preenchimento automático. A mensagem agregada de zero resultados não explicava suficientemente essa pesquisa incompleta.

O PDF real de Sina da Sociedade possui 24 páginas compostas por imagens, sem camada de texto. A extração anterior não conseguiria ler sua introdução. Sua página tem tamanho físico incomum no arquivo, embora a imagem embutida tenha alta resolução; renderizar com escala pequena também prejudicava o OCR.

A entidade [Q137295527](https://www.wikidata.org/wiki/Q137295527) existe, mas não tinha rótulo/alias português no teste. A busca exata em português retornou zero; os títulos completos inglês e francês encontraram a mesma entidade. Não era correto concluir que o jogo não existia nessa fonte.

## O que mudou

- Wikidata e Wikipédia têm conectores automáticos ativos. A Wikipédia fornece introdução licenciada quando o artigo corresponde a uma identidade verificável de jogo; filmes, páginas de desambiguação e homônimos não verificados são descartados. A validação dessa identidade utiliza dados Wikidata, portanto uma indisponibilidade deste serviço também pode limitar esse conector.
- A tela distingue fonte habilitada, ainda não consultada, consultando, resposta com resultados, resposta sem correspondência, resposta parcial, falha e credenciais necessárias. Não consultada não é contabilizada como zero.
- Frontend e Worker expõem a versão **1.5.0** e protocolo de pesquisa **2**. Incompatibilidade exige atualizar o site em vez de produzir resultados enganosos.
- Há variantes normalizadas, títulos originais explícitos no PDF, índices PT/EN/FR, subtítulos e fallback para o índice de texto completo do Wikidata. Números que distinguem versões são preservados. Não há tradução automática de nomes desconhecidos.
- Um registro pequeno de identidade editorial revisada associa Sina da Sociedade aos nomes completos inglês/francês e ao código editorial ZMGPSM0101. As referências estão em `js/game-identities.js`. Ele contém nomes e identificadores, sem descrições ou estatísticas prontas. Os dados continuam sendo obtidos da API real. O vínculo identifica a obra e **não confirma a edição** do arquivo enviado; não se aplica a outros jogos de Senhor dos Anéis.
- A extração do PDF aceita introduções, objetivos e contexto com mais formatos. Cooperação e oposição são sugeridas somente com trechos explícitos para conferência. Mecânicas exigem termos presentes no texto; gênero não é convertido em mecânica.
- PDFs sem texto acionam OCR **local**, independente das fontes externas. Lê no máximo as três primeiras páginas, com cancelamento e prazo de 18 s. Tesseract.js/modelos fixados são hospedados junto ao site e carregados sob demanda; nenhuma página é enviada a serviço de OCR. Os campos ficam desmarcados até revisão. Erros de leitura, especialmente nomes próprios, precisam de correção humana.
- “Cidades” não pode mais ser interpretado como “idade”. PDFs que contêm faixas diferentes de jogadores, como jogo básico e expansões, deixam o campo vazio com evidência da divergência.
- Cada campo externo pode ser escolhido ou rejeitado. Dados divergentes do PDF ficam desmarcados. Foi verificado que aplicar jogadores do Wikidata preserva a descrição previamente confirmada do PDF.

## Testes com três PDFs e APIs públicas reais

O teste `tests/recognition-live-browser.mjs` abre o formulário real em Chrome, lê os PDFs reais, consulta os mesmos conectores usados pelo Worker e confirma sugestões por campo. **As chamadas Wikidata/Wikipédia foram reais; Authentication, perfil e Firestore foram emulados em `demo-acervo`.** Não foram usadas respostas de catálogo simuladas nesse teste. Não houve gravação na biblioteca de produção. Testes unitários separados usam fixtures para erros, permissões e condições difíceis de reproduzir.

Os números abaixo são candidatos finais aceitos, não todos os resultados brutos da busca. Na Wikipédia, os resultados genéricos que falharam na verificação de identidade não foram apresentados como jogos.

| Jogo / manual testado                                         | Wikidata | Wikipédia | Ludopedia                            | BGG                            |
| ------------------------------------------------------------- | -------: | --------: | ------------------------------------ | ------------------------------ |
| O Senhor dos Anéis: Sina da Sociedade, manual brasileiro v1.0 |        1 |         0 | Não consultada: sem token autorizado | Não consultada: sem token/logo |
| Colonizadores de Catan, manual português Catan Plus / Big Box |        1 |         1 | Não consultada: sem token autorizado | Não consultada: sem token/logo |
| O Senhor dos Anéis: Duelo pela Terra-média, Manual.pdf        |        0 |         0 | Não consultada: sem token autorizado | Não consultada: sem token/logo |

### Sina da Sociedade

Arquivo local testado: `o_senhor_dos_aneis_regras_em_pt_br_305303.pdf`, 24 páginas. O título foi associado pelo código editorial nos metadados, sem depender de a capa ter texto selecionável.

- PDF sem OCR: nenhum campo textual além da identificação por metadados e idioma indicado no nome/metadados.
- OCR das páginas 1–3: **descrição em português, tipo Cooperativo e categoria Cooperativo**, derivados da introdução da página 2. A classificação tem trecho de evidência, não uma lista inventada de mecânicas.
- Wikidata: um candidato real, nomes inglês/francês, ID BGG **436217**, jogadores **1–5**, classe cooperativa e descrição curta em inglês. Essa descrição é apenas um verbete curto, não uma sinopse rica. A descrição do PDF não foi substituída.
- Wikipédia: nenhum artigo de jogo aceito nas consultas realizadas.
- Permaneceram vazios: **idade, duração, mecânicas e edição do cadastro**. A entidade não declara os dois primeiros números; não fornece mecânicas explícitas. Os trechos processados do PDF não ofereceram evidência adequada desses campos. Créditos/versão do documento não foram convertidos automaticamente em edição comercial do jogo. Temas como fantasia não foram classificados por dedução.
- Identidade: [anúncio oficial Z-Man](https://www.zmangames.com/announcements/announcing-the-lord-of-the-rings-fate-of-the-fellowship/), [título francês oficial](https://www.asmodee.fr/product/seigneur-des-anneaux-le-destin-de-la-communaute/) e [referência da edição portuguesa no BGG](https://boardgamegeek.com/boardgameversion/754600/portuguese-edition) sustentam o registro revisado. A consulta BGG API continua desativada; usar uma referência humana não constitui um conector BGG ativo.

### Colonizadores de Catan

PDF obtido do [download público oficial Devir](https://devir.com.br/wp-content/uploads/2020/09/693152_CAT_BigBox19_Manual_PT03.pdf), somente para teste local. O arquivo inclui Catan Plus, jogo básico, jogo de dados e expansões. Não foi copiado ao Git nem adicionado à biblioteca pública. O título brasileiro foi confirmado no formulário para a pesquisa; o texto da primeira página não deve ser tomado como identificação automática da edição brasileira.

- PDF: **descrição/objetivo**. As faixas de jogadores divergentes foram preservadas como evidência, deixando os campos numéricos vazios. A interpretação incorreta de “cidades” como idade foi corrigida e testada.
- Wikidata [Q17271](https://www.wikidata.org/wiki/Q17271): título brasileiro, descrição curta em português, categoria explícita de jogo de estilo alemão, jogadores **3–4**, idade **10**, duração **75 min**. São fatos gerais da entidade, não números automaticamente válidos para todas as expansões do PDF.
- Wikipédia: um artigo português verificado, **título e descrição em português**, com atribuição, histórico dos autores e CC BY-SA 4.0. A descrição foi aplicada com confirmação no formulário.
- Permaneceram sem sugestão externa: **mecânicas, edição e tipo específico da partida**. A Wikipédia importa somente título/introdução; o Wikidata não ofereceu mecânicas nem uma classe específica de interação. Não deduzimos “competitivo” ou mecânicas a partir da categoria eurogame. Os números gerais do Wikidata exigem conferir qual produto/cenário está sendo cadastrado.

### Duelo pela Terra-média

Arquivo local `Manual.pdf`, oito páginas com texto. Seu título técnico de diagramação foi rejeitado; o nome do jogo foi informado no formulário para a pesquisa, em vez de aceitar um cabeçalho de acessibilidade como título.

- PDF: **descrição/objetivo e tipo Competitivo**, com evidência textual de oposição entre o jogador e o oponente.
- Wikidata/Wikipédia: **zero candidatos finais** nas consultas realizadas, incluindo a investigação manual dos nomes internacionais. Isso demonstra uma lacuna das fontes abertas, não ausência do jogo no mercado.
- Permaneceram vazios: **idade, duração, jogadores, categorias, mecânicas e edição**, sem evidência explícita adequada na extração ou candidato externo verificável. A confirmação manual de quantidade de jogadores continua possível; não deduzimos números de “você e seu oponente”.

## Desempenho e limites verificados

Na última repetição do teste, cada fonte respondeu em **0,41–0,79 s**: Sina 0,54/0,79 s; Catan 0,46/0,41 s; Duelo 0,43/0,63 s, respectivamente Wikidata/Wikipédia. São medições do ambiente de teste, incluindo a autorização emulada, sem garantia de latência no dispositivo do usuário ou Firestore real.

As fontes são consultadas em paralelo e cada resultado aparece ao concluir. O prazo normal permanece **3,5 s por fonte no Worker / 4,5 s no navegador**, incluindo token/autorização. “Ampliar pesquisa” permite 8/9,5 s somente quando solicitado. Cancelamento e cache continuam ativos; falhas não impedem usar o PDF. OCR é uma operação local separada, limitada a 18 s, podendo falhar por desempenho do aparelho ou download inicial dos modelos; não bloqueia salvar ou pesquisar externamente.

Não existe consulta automática gratuita e autorizada a todos os catálogos comerciais. Nesta implantação há **dois conectores externos habilitados**, com cobertura limitada. Ludopedia continua como prioridade brasileira quando houver token válido; BGG exige aprovação, token e logo oficial. Lojas/editoras permanecem referências humanas sem scraping. [Condições e ativação](FONTES-RECONHECIMENTO.md), [solicitação Ludopedia](LUDOPEDIA.md).

## Licenciamento, regressões e publicação

Wikidata fornece dados estruturados [CC0](https://www.wikidata.org/wiki/Wikidata:Data_access). A importação de texto da Wikipédia utiliza a [API TextExtracts](https://www.mediawiki.org/wiki/Extension:TextExtracts), com [atribuição e compartilhamento pela mesma licença](https://en.wikipedia.org/wiki/Wikipedia:Copyrights): artigo, histórico dos autores, CC BY-SA 4.0 e indicação de trecho modificado. A licença acompanha o conteúdo salvo e os links aparecem na ficha/descrição destacada. Imagens de catálogos não são importadas; mantém-se a capa renderizada do PDF.

Os arquivos de upload, retomada, tickets e acesso ao Drive não foram alterados. Authentication/Firestore continuam Spark, Worker Free e GitHub Pages; OCR não contrata infraestrutura. As regras Firestore existentes continuam em vigor. A implantação não instala tokens novos nem altera permissões ou arquivos do Drive.

Validação concluída: **98 testes automatizados** (39 frontend/OAuth local, 42 Worker e 17 regras), builds estático/Worker e QA de navegador do leitor, guias, pesquisa e administração passaram. O fluxo dos três PDFs com APIs reais também passou.

Unidades verificam aliases, números ambíguos, homônimos, classificação explícita, licença, pesquisa parcial, cancelamento, prazos, cache e preservação de campos. As verificações de navegador e regras também cobrem leitor, guias, revisão administrativa, publicação, isolamento de usuários, bloqueio e telas de celular/tablet. Os relatórios brutos e imagens com texto dos PDFs ficam somente em `test-output/`, ignorado pelo Git.

Após a publicação, `/health` e `/v1/research/sources` permitem conferir a versão e disponibilidade públicas. Consultas de catálogo continuam exigindo Firebase válido e permissão atual; chamadas anônimas são negadas. A sessão pessoal autenticada de produção não foi utilizada nos testes, portanto a validação pública de implantação não equivale a um teste dessa sessão.
