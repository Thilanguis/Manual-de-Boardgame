# Acervo 1.8.0 — implementação local para revisão

15/10/2026. As etapas A, B e C foram implementadas sobre a versão 1.7.5. **Sem Gemini, commit, push, deploy ou alterações de dados de produção.**

## Entrega funcional

### A. Pesquisa multilíngue e consolidação

- PT-BR é a prioridade. Os planos de consulta cobrem também os índices EN e FR, mesmo para manual português. Nomes oficiais/aliases retornados podem alimentar uma rodada complementar, dentro do prazo global.
- Opções da pesquisa permitem informar nomes alternativos, um por linha, com prefixo opcional `en:`/`fr:`/`pt:`. Essas entradas são pistas, não traduções oficiais automaticamente aprovadas.
- Identificadores coincidentes são necessários para reunir fontes. IDs contraditórios, edição diferente ou classificação de produto incompatível não são fundidos. Tipo desconhecido permanece separado de tipo confirmado na consolidação; nome parecido ou subtítulo sozinho não comprova identidade.
- Uma correspondência pode reunir jogadores/duração de uma fonte e descrição/categorias de outra. Cada campo conserva valor original, idioma, origem, licença e data.
- Vocabulário PT-BR normaliza termos conhecidos de categorias, mecânicas e tipos. Termo desconhecido e descrição estrangeira não recebem tradução inventada.
- Revisar sugestões, Usar sugestões e Selecionar todos continuam disponíveis. A revisão identifica a origem por campo. Em caso de divergência, o seletor permite escolher a alternativa; limites de jogadores/duração mudam juntos para a mesma fonte.
- Aplicar abre Conferir dados. Alterações manuais continuam desmarcadas por padrão ou exigem confirmação de substituição no atalho direto. Publicação continua sendo uma ação separada.
- Wikidata passou a ler mecânicas explícitas em [P4151](https://www.wikidata.org/wiki/Property:P4151), reconhecer a classe explícita de expansão, aceitar idade em anos e converter duração explícita em horas. Afirmações com qualificadores de edição não viram fatos gerais.

O caminho normal tem orçamento global de 7 segundos, incluindo consulta ao histórico, e o ampliado de 10 segundos. A consulta ao histórico tem espera limitada a 1,2 segundo. O Worker conserva seu prazo por fonte e executa no máximo três buscas simultâneas dentro de cada conector. Não há varredura de sites ou pesquisa ilimitada em segundo plano.

### B. Pesquisa reutilizável e estado de revisão

Foi adotado **um documento privado `gameResearch/{gameId}`**, com conteúdo limitado, aliases indexados e revisão transacional. Dentro dele ficam identidades por identificador estável, nomes com idioma, edição conhecida/desconhecida, fatos, candidatos, conflitos e decisões. A projeção confirmada permanece em `games.sources`, que já existia.

Isso substitui a divisão preliminar em três coleções da proposta: permite reutilização por alias/identidade sem uma migração global do catálogo ou novo serviço de índice. A busca de edição consulta diretamente o documento do jogo; uma inclusão pode procurar por alias.

- IndexedDB mantém até 30 snapshots por projeto/conta. Novo cadastro ainda não salvo conserva a pesquisa no dispositivo; ao salvar o jogo, o snapshot também é guardado no Firestore.
- Uma consulta em jogo já existente pode guardar seu resultado sem aplicar os valores ao cadastro.
- O cache de candidatos dura seis horas. Fatos **já confirmados** continuam reutilizáveis depois disso, com a data antiga e apenas os campos revisados. Usar dados salvos não altera a data da consulta.
- A reutilização integral exige o mesmo SHA-256 válido do PDF e o mesmo contexto de edição. Hash ausente, diferente ou edição alterada não herda aprovação. Título, nomes e identificadores continuam disponíveis; os metadados de edição desconhecida são sugestões desmarcadas que exigem nova conferência. O atalho Usar sugestões abre essa revisão. Edições conhecidas diferentes reaproveitam somente a identificação, sem descrição, jogadores, duração, idade, categorias ou mecânicas da outra edição. Regras, páginas e idioma do PDF anterior não são transferidos.
- Entradas locais são separadas por hash e priorizam o manual exato. A leitura do Firestore guarda o snapshot original, preservando a revisão do PDF de origem. Decisões novas registram hash/edição; confirmar apenas parte dos campos não aprova os restantes para o novo PDF. Históricos antigos sem hash exigem nova conferência.
- O administrador pode marcar Consultar novamente as fontes ou usar Ampliar pesquisa. A revisão conserva informações sobre seleção/rejeição; os campos do cadastro não são substituídos durante uma atualização.
- A persistência de candidatos é permitida somente para Wikidata CC0 e Wikipédia CC BY-SA, com atribuição. Respostas brutas, tokens e resultados de fontes restritas não são copiados para o histórico. BGG/Ludopedia continuam condicionados às autorizações existentes; sua habilitação não muda essa política de retenção automaticamente.
- Documentos têm limite de aproximadamente 120 KB e revisão transacional. Não existe cópia do texto integral do PDF no Firestore.
- Regras reais bloqueiam leitura/escrita de visitantes, usuários comuns, pendentes e bloqueados. Escrita exige editor ativo, jogo existente, responsável correto e revisão consecutiva. Quem só pode adicionar não ganha edição sobre pesquisa de jogos de outro responsável. Exclusão continua reservada ao proprietário.
- O campo longo do histórico fica fora da indexação do Firestore. Não há TTL automático, Functions, Storage, banco adicional ou alteração de plano.

Se o histórico estiver indisponível, o cadastro e as fontes continuam funcionando. Uma falha ao guardar o histórico conserva o jogo salvo e exibe um aviso; não anuncia sincronização concluída.

### C. Conhecimento do PDF, guias e Consulta rápida

- O índice completo já existente continua sendo a base comum. Trechos mantêm página física, SHA-256 do PDF e método de leitura. A Consulta rápida pesquisa esse índice sem processar novamente o documento a cada pergunta.
- A classificação de assuntos passou a reconhecer mais termos PT/EN/FR, incluindo preparação, objetivo, habilidades, combate, regras especiais e vitória/derrota. Categorias de assunto ajudam a localizar conteúdo estrangeiro; não traduzem nem reescrevem a regra.
- Ler próximas páginas escaneadas usa o Tesseract local em lotes de até três páginas. Cada página gera checkpoint, com estado concluído, baixa confiança ou falha. Uma nova sessão retoma apenas o que falta. Há opção de tentar novamente páginas não legíveis.
- Cancelamento preserva as páginas já concluídas. A retomada verifica os bytes/hash do manual antes de aceitar o checkpoint. Trocar o PDF invalida as referências anteriores.
- O índice informa cobertura incompleta e páginas não legíveis. O leitor original permanece disponível. Resultados de OCR são identificados para conferência na página.
- Sugestões do PDF continuam sendo **trechos para revisão**, não explicações fabricadas. Títulos OCR são filtrados para não transformar qualquer frase com “objetivo” ou “ação” em seção; duplicações na mesma página são removidas.
- Uma descrição de catálogo já confirmada pode ser acrescentada como Visão geral. Essa seção não ganha página fictícia do manual; conserva links de origem, autores e licença em uma área recolhida.
- Guias continuam exigindo revisão/publicação. Os arquivos de índice e imagens usam o mecanismo existente do Drive e a pasta já autorizada. Não foi alterado o upload de PDFs.

O OCR não contorna documentos protegidos e não envia o arquivo a um serviço externo. Erros de leitura, colunas e diagramas ainda precisam de conferência humana. Não são produzidas respostas didáticas ou FAQs ausentes do manual por inferência.

## Testes realizados

### APIs públicas reais, chamadas pelos conectores locais

Executado `tests/research-live.mjs`, com opt-in explícito. Somente leitura; não usa o Worker publicado nem credenciais privadas. O relatório detalhado fica em `test-output/research-live-1.8.json`, ignorado pelo Git.

| Jogo consultado em português          | Wikidata | Wikipédia | O que veio de fato                                                                                                                                                                            |
| ------------------------------------- | -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O Senhor dos Anéis: Sina da Sociedade | 1        | 0         | Identidade Q137295527, aliases PT/EN/FR, jogadores 1–5, cooperação/categoria. O rótulo genérico não é oferecido como sinopse. Duração, idade e mecânicas não vieram: continuam ausentes.      |
| Colonizadores de Catan                | 1        | 1         | Identidade Q17271, nomes multilíngues, jogadores, duração, idade/categorias no Wikidata; introdução PT licenciada na Wikipédia.                                                               |
| Takenoko                              | 1        | 1         | Identidade Q15850035, nomes EN/FR, jogadores no Wikidata e introdução em inglês na Wikipédia. Campos não fornecidos permanecem vazios; a descrição inglesa não foi traduzida artificialmente. |

Referências de identidade: [Sina](https://www.wikidata.org/wiki/Q137295527), [Catan](https://www.wikidata.org/wiki/Q17271), [Takenoko](https://www.wikidata.org/wiki/Q15850035). A contagem representa os conectores abertos consultados, não catálogos que dependem de token.

O teste de consulta inclui nomes oficiais ingleses e franceses de Sina e confirma que artigos de filmes/universos não foram importados como regras do jogo. O resultado não habilita scraping das editoras consultadas na proposta.

### PDFs reais em português

| Manual local                                    | Resultado                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sina da Sociedade                               | 24 páginas, inicialmente sem texto extraível. OCR real em oito lotes deixou **24/24 páginas com texto utilizável**, nenhuma falha. Índice comprimido reaberto e páginas físicas conferidas. Referências encontradas incluem Preparação p.4, Objetivo p.9, Ações p.10 e Vitória/derrota p.19. |
| Texas Chainsaw Massacre Slaughterhouse PT-BR    | 29 páginas; 28 com texto extraível, uma página sem texto. Índice e referências verificados. A página restante não foi declarada analisada por OCR neste teste.                                                                                                                               |
| Takenoko, manual em português da segunda edição | 8/8 páginas com texto extraível; índice, compressão/reabertura e referências verificados.                                                                                                                                                                                                    |

O texto integral e os próprios PDFs não entram no Git. Os testes usam perfis descartáveis e não enviam esses arquivos ao Drive.

### Interface, aplicação e reutilização

- `research-reuse-browser.mjs`: aplicação real com PDF de Sina real em desktop, tablet e celular. Apenas respostas dos conectores são simuladas. Reúne campos EN/FR e descrição PT de teste, seleciona todos, confere inputs, salva, recarrega e verifica fonte/licença por campo. Duas consultas de reaproveitamento fazem **zero chamadas aos conectores**. Aliases oficiais inglês/francês reutilizam a identidade; alternativa de duração muda o par de limites corretamente.
- `research-editions-browser.mjs`: dois PDFs sintéticos diferentes de Sina, com o mesmo título e edição desconhecida, em desktop/celular. Confere que o segundo PDF exige revisão, que os campos ficam desmarcados e que aceitar só o título deixa os outros inputs e o cadastro salvo vazios. Verifica dois históricos independentes, preferência pelo hash exato e preservação do snapshot original ao recuperar uma projeção do Firestore simulado. Regressões unitárias cobrem também edições conhecidas diferentes, hash ausente, cache vencido, reconferência explícita e rejeição de decisões de outro PDF.
- `admin-browser.mjs`: SDKs Auth/Firestore reais ligados aos emuladores. Confere documento salvo, snapshot privado e decisões. Um **segundo perfil de navegador, sem IndexedDB anterior**, recupera a pesquisa do Firestore com **zero chamadas à API de pesquisa**. Também preserva os testes de cargos, bloqueio, aprovação e recuperação de senha.
- `research-real-data-browser.mjs`: PDF real de Texas e metadados públicos reais já cadastrados usados como resposta simulada. Resumo, jogadores 2–5 e duração 45–60 conferidos na etapa 2 e no registro salvo, em desktop/celular. Isso não afirma que uma API externa forneceu esses dados.
- `research-duration-browser.mjs`: dez fluxos desktop/celular com duração fixa, unidade textual, intervalo em horas, OCR antigo, aceitação direta, seleção em lote, cancelamento de substituição na edição, salvamento e reabertura.
- `research-ux-browser.mjs`: PDF real de Sina em desktop, revisão/seleção/aplicação, edição manual preservada, caso somente título, biblioteca de um/onze jogos e responsividade em 1440/768/390 px. Quando o teste troca a resposta simulada, solicita nova consulta explicitamente para não confundir cache válido com falha.
- `ocr-progress-browser.mjs`: Tesseract **real** em quatro páginas de imagens sintéticas. Lote 1–3, checkpoint, recarga e retomada somente da p.4; trechos adicionados e publicação revisada conferidos.
- Guias existentes: PDF de vinte páginas, busca por expressão/acentos, imagem, revisão, publicação, referência p.20 e uso no celular/tablet.
- Leitor/biblioteca: importação, edição, exclusão, favoritos, PDF/texto/páginas/zoom e shell offline passaram. Destaque pelo último clique e disposição da biblioteca preservados. Atualização PWA conserva edição pendente e limpa apenas o shell anterior.

**135 testes automatizados passaram:** 72 do aplicativo, 43 do Worker e 20 das regras no emulador. Além deles, passaram os fluxos de navegador descritos acima.

Testes unitários/regras cobrem também homônimos, expansão, IDs contraditórios, edições distintas, origem por campo, vocabulário, expiração, retenção permitida, histórico confirmado, OCR cancelado e rejeição do hash/página errados. Build estático e bundle Worker foram preparados localmente; o comando do Worker foi **dry-run**, sem publicação.

## Limites e publicação futura

1. Fontes abertas têm cobertura variável. A implementação reutiliza e combina o que existe; não completa lacunas com valores da fixture. Ludopedia/BGG continuam exigindo autorização e configuração privada.
2. A versão em produção permanece a anterior. Para ativar esta entrega depois de aprovada, publicar primeiro Worker e regras/índices compatíveis, depois o frontend/Pages e conferir as versões. Antes das novas regras, o histórico entre dispositivos não estará habilitado; o fallback local e a pesquisa continuam disponíveis.
3. Não há mudança de plano, faturamento, Gemini ou API paga. O uso continua sujeito às cotas já existentes. O consumo real de CPU do Workers Free precisa ser observado após a publicação autorizada; o OCR e a indexação pesada ficam no dispositivo.
4. O histórico é privado e a versão pública contém somente o cadastro/guia já aprovados. Conhecimento anterior não é reclassificado como regra oficial da nova edição.
5. A implementação não foi commitada. A proposta e este relatório podem entrar no mesmo commit funcional; nenhum commit separado da proposta é necessário.

## Comandos locais de verificação

```bash
npm test
npm --prefix worker test
npm run test:rules
npm run check
npm run build
```

Os scripts de navegador exigem `ACERVO_TEST_MODULES` apontando para as dependências Playwright/pdf-lib e o servidor em `ACERVO_TEST_URL`. Os testes reais de PDF usam caminhos locais por variáveis de ambiente, sem embutir documentos no projeto. `research-live.mjs` exige `ACERVO_LIVE_RESEARCH=1` para permitir as consultas externas de leitura.
