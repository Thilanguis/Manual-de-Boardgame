# Pesquisa da ficha e resumo — correções locais de 19/10/2026

> Atualização do escopo: o usuário autorizou complementar as lacunas pelo conhecimento do próprio Gemini. A implementação atual está descrita em [Complemento Gemini](COMPLEMENTO-GEMINI-MODELO-2026-10-19.md). As restrições abaixo sobre metadados exclusivamente documentados descrevem a etapa anterior; as regras continuam exigindo evidências.

## O que faltava

A síntese combinada consultava apenas Wikidata/Wikipédia. BGG/Ludopedia podiam preencher campos numa pesquisa posterior do frontend, mas seus fatos não chegavam ao mesmo pedido Gemini. Também não existia consulta da ficha da editora. O prompt proíbe completar lacunas por memória; portanto o reconhecimento do nome, sozinho, não fornecia dados que os conectores não haviam recuperado.

Além disso, os identificadores e a prova de ligação BGG/Ludopedia se perdiam na hidratação das fontes do conhecimento. O formulário podia receber dados enquanto o diagnóstico dizia zero correspondências confirmadas. O teste completo de navegador reproduziu esse defeito e passou após preservar a identidade.

## Fluxo implementado

1. O clique existente em **Completar informações** usa o título corrigido, edição e documentos atuais.
2. Consulta os catálogos habilitados e autorizados. BGG/Ludopedia têm no máximo um detalhe de identidade inequívoca por conector; aproveitam o perfil já autorizado da requisição, sem acrescentar verificações Firestore por fonte.
3. A descoberta Gemini já existente pode propor nomes em português/inglês/francês. Equivalência precisa de nomes presentes no PDF, IDs cruzados ou identidade comprovada dos catálogos. A memória da IA, sozinha, não confirma outro nome/edição.
4. Consulta adaptadores registrados de editoras quando a editora é identificada no manual. O primeiro adaptador é **Gamewright**, utilizável por produtos dessa editora, sem valores cadastrados especificamente para Sushi Go Party.
5. A mesma geração de síntese recebe dois objetivos explícitos para metadata: **resumo curto em PT-BR** e **ficha estruturada de todos os campos**. Recebe cartões com valores, fonte e citações literais dos fatos estruturados. As instruções, tópicos e formato das seções de regras não foram alterados.
6. A consolidação aplica fatos válidos diretamente, mesmo quando o modelo omite aquele número. Uma duração fixa preenche mínimo/máximo; intervalos preservam os dois extremos. Correções manuais têm prioridade. Dados conflitantes não são fundidos numa faixa inventada.
7. Salva e reaproveita o resultado por contexto/versão. O frontend evita repetir os conectores já consultados no servidor. Salvar, consultar regras, abrir ou recarregar não geram novamente.

Há uma geração principal de resumo/ficha/regras e, quando necessária, até uma descoberta complementar de nomes. Não foi adicionada uma terceira chamada Gemini.

## Editora e evidências

A [página pública Gamewright de Sushi Go Party](https://gamewright.com/product/Sushi-Go-Party), consultada em 19/10/2026, informa 2–8 jogadores, idade 8+ e **30 minutos**. O extrator foi conferido também sobre o HTML real guardado localmente, sem nova IA. O [robots.txt](https://gamewright.com/robots.txt) permite a rota `/product/`; PDFs, imagens, descrição promocional e demais rotas não são consultados pelo adaptador.

O adaptador extrai somente os números da ficha identificada, com URL, trecho factual, data e origem. Não pressupõe licença aberta do texto do site. Ignora números de navegação/outros produtos; não confirma uma edição desconhecida. A requisição tem host/caminho fixos, no máximo duas páginas candidatas, bloqueio de redirects, limite de 150 kB, prazo, cache de fatos e respeito a Cache-Control/429/Retry-After. Não recebe URLs arbitrárias do usuário ou da IA, nem envia credenciais às editoras.

O cache público não guarda o HTML. A referência original e a data da consulta permanecem nos fatos reaproveitados. IDs/documentos/hashes privados ficam fora do prompt Gemini.

## Validação de referências

Um ID de passage incorreto em metadata pode ser recuperado **somente** quando o excerpt literal ocorre em um único passage da mesma página/documento informados. O servidor grava o ID canônico encontrado. Texto ausente, correspondência ambígua, outra página, números incompatíveis ou edição errada continuam rejeitados. Não se buscou uma página alternativa para justificar a resposta.

`profileEvidenceProtocol: 2` anuncia a coleta ampliada. Uma análise parcial antiga pode ser atualizada no clique explícito quando o servidor anuncia a versão nova; a abertura não gera nada. Um servidor antigo continua compatível, sem fingir que oferece a coleta nova.

## Testes e resultados

- **213** testes frontend/modelos, **135** Worker e **27** permissões em `demo-acervo`: **375 passaram**.
- Navegador completo com catálogos simulados: todos os campos da fixture preenchidos, duração 20/20, resumo/classificações e edição explícita; BGG/Ludopedia participam antes da síntese e não repetem a pesquisa no frontend.
- Navegador completo sem Wikimedia, BGG ou Ludopedia: PDF + ficha factual Gamewright, duração **30/30 com origem Editora**, jogadores 2/8, idade inicialmente 8, resumo, tipo, categorias e mecânicas retornados pelo Gemini simulado. Edição ausente permanece vazia.
- Em ambos: cadastro salvo, índices/conhecimento vinculados, consulta de regras e reload sem outra geração/pesquisa. Idade corrigida manualmente para 9 permanece após salvar e reabrir.
- Testes de título português/pista inglesa, equivalência não comprovada, duração fixa/intervalo, HTTP 429, redirects, resposta excessiva, página errada, referência ambígua, cache legado e preservação das regras corrigidas.
- Build estático, sintaxe, dry-run do bundle Worker e `git diff --check` passaram.

Logs, relatório do cadastro e captura da etapa 2 ficam em `test-output/profile-research/` e `test-output/combined-profile/`, ignorados pelo Git. Os dois provedores Gemini e serviços Firebase/Drive dos testes são simulados/emulados. Não houve geração Gemini real nem acesso a dados reais do Acervo nesta rodada.

## Limites e publicação

O teste comprova integração, validação e preenchimento com respostas controladas, não garante que toda futura resposta Gemini preencherá todos os campos. Informação sem fonte válida permanece ausente. A edição não é deduzida do copyright. O adaptador de editora implementado é Gamewright; outras editoras dependem de adaptadores próprios ou dos catálogos disponíveis.

BGG/Ludopedia continuam dependendo dos tokens e condições já existentes; esta tarefa não criou credenciais nem habilitou fontes em produção. Não foi usado Google Search Grounding para construir a base.

Na conclusão desta etapa, as mudanças estavam locais, sem commit, push ou deploy. A autorização excepcional anterior havia sido consumida na publicação de `0dc4f53`. O proprietário concedeu posteriormente nova autorização para esta entrega, registrada em [Publicação do complemento Gemini](PUBLICACAO-COMPLEMENTO-GEMINI-2026-10-19.md).
