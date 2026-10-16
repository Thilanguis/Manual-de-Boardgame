# Proposta — pesquisa multilíngue e conhecimento por edição

Data da análise: 15/10/2026. Base examinada: Acervo 1.7.5, commit `42553ad`.

Proposta aprovada pelo proprietário em 15/10/2026. A entrega local está descrita no [relatório de implementação](IMPLEMENTACAO-1.8.md).

Este documento registra a proposta original. Não implementa nem ativa conectores, IA, coleções ou mudanças no aplicativo. Não foi executado commit, push ou deploy nesta etapa. Nos próximos trabalhos, os comandos de commit serão entregues ao proprietário; publicação exige solicitação explícita.

## 1. O que já existe e será reaproveitado

| Área          | Implementação atual                                                                                                                      | Lacuna observada                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Identificação | `js/game-identities.js`: variações PT/EN/FR, subtítulos e uma identidade editorial revisada para Sina da Sociedade                       | Não aprende identidades confirmadas dinamicamente; aliases informados pelo administrador não fazem parte de um registro central      |
| Fontes        | Worker: Wikidata e Wikipédia habilitados por configuração padrão; Ludopedia/BGG condicionados a credenciais                              | Conectores não constituem uma base persistente de pesquisa por obra/edição                                                           |
| Busca         | Consultas paralelas, cancelamento e prazo por fonte; fast path do Worker com 3,5 s                                                       | Wikipédia limita a consulta normal a dois idiomas; descoberta de aliases não alimenta sistematicamente uma segunda rodada            |
| Apresentação  | `sameWork` compara identificadores e rejeita incompatibilidades explícitas; título PT é preferido                                        | Cards podem compartilhar nomes, mas não consolidam todos os campos entre fontes com proveniência individual                          |
| Cadastro      | Revisar sugestões, Usar sugestões, Selecionar todos, transferência à etapa 2 e confirmação antes de salvar                               | Origem do candidato é usada para vários campos; uma consolidação deve preservar a fonte real de cada valor                           |
| Persistência  | `sources.catalog.matches` conserva até seis correspondências confirmadas com nomes e dados originais; cache HTTP em memória no Worker    | Não armazena de forma durável todas as descobertas/rejeições; nomes confirmados não são reutilizados como plano completo de pesquisa |
| Conhecimento  | Índice do PDF por hash, páginas físicas, busca em Web Worker, cache IndexedDB, índice comprimido no Drive e guias revisados no Firestore | Taxonomia limitada; índice completo não usa o OCR existente no cadastro                                                              |
| OCR           | Tesseract local, cancelável, até três páginas por chamada; idioma PT/EN/FR                                                               | Sem continuidade por página para construir o índice de um manual escaneado inteiro                                                   |

Os pontos de integração são `research-panel.js`, `research-client.js`, `game-identities.js`, os conectores em `worker/src/catalog/`, os repositórios, `pdf-index.js`, `pdf-ocr.js`, `guide-model.js` e `guide-panel.js`. A biblioteca, o leitor e o fluxo de upload permanecem como estão.

## 2. Estrutura proposta, sem IA

Fluxo: **PDF e nomes já conhecidos → identidade candidata → fontes autorizadas → fatos comparáveis → revisão → cadastro e conhecimento reutilizáveis**.

### Identidade da obra e identidade da edição

- Uma obra recebe `workId` estável, identificadores externos e nomes com idioma, referência e estado de revisão. Sem identificador confiável, usar ID provisório; título normalizado não será a identidade definitiva.
- A edição recebe `editionId`, editora, código de produto/EAN quando disponíveis, idioma, versão e ligação com a obra. O PDF mantém seu SHA-256 e número de páginas.
- Nomes alternativos são aliases da obra, não novos jogos. Um nome digitado pelo administrador é uma pista até ser confirmado; não ganha automaticamente o estado de título oficial.
- IDs coincidentes permitem comparar a obra. Edição desconhecida continua desconhecida. Edições diferentes não compartilham automaticamente componentes, páginas ou regras.
- Base, expansão e versão independente permanecem distintos. Nome parecido, tradução literal, tema comum ou subtítulo reduzido só descobrem candidatos.
- O nome apresentado prioriza PT-BR confirmado. Não gerar um título francês a partir de tradução literal.

### Planejamento da pesquisa

1. Ler nome, idioma e evidências do PDF, junto dos nomes/IDs já confirmados na biblioteca.
2. Consultar o armazenamento antes da rede. Mostrar imediatamente resultados reutilizáveis e sua data.
3. Na rede, priorizar PT-BR e distribuir consultas independentes entre fontes/idiomas. EN e FR também participam quando o PDF é português.
4. Usar labels, aliases, sitelinks e identificadores dos resultados para descobrir equivalências documentadas. Com identidade resolvida, buscar detalhes por ID e artigo por ligação verificada, evitando nova adivinhação pelo título.
5. Complementar campos ausentes com nomes oficiais encontrados. Uma rodada complementar automática cabe no orçamento restante; buscas adicionais ficam em Ampliar pesquisa.
6. Sem subtítulo, gerar apenas candidato de menor confiança. Não aceitar o resultado só porque contém O Senhor dos Anéis, por exemplo.

Orçamento proposto: fonte com prazo máximo de 3,5 s no caminho rápido, resultados progressivos, no máximo seis consultas externas por rodada e até três conexões simultâneas dentro de cada chamada do conector. A pesquisa normal terá orçamento global de até 7 s para as duas rodadas; os primeiros resultados aparecem antes. Ao atingir o prazo, conservar o que chegou. Ampliar pesquisa será explícito, cancelável e limitado a 10 s globais. Esses valores são limites de espera, não promessa de encontrar informações.

O Worker continua fazendo consultas e validação pequenas. OCR, indexação, comparação extensa e renderização ficam no dispositivo. O plano gratuito tem 10 ms de CPU por requisição e 50 subrequests; espera de rede não conta como CPU. A implementação precisará medir o consumo real. [Limites oficiais do Workers](https://developers.cloudflare.com/workers/platform/limits/).

## 3. Fatos por campo e apresentação em português

Cada informação terá pelo menos:

```text
campo, valor normalizado, valor original, idioma original,
fonte/identificador, URL, data da consulta, licença/atribuição,
workId, editionId ou edição não confirmada,
evidência/página/hash quando vier do PDF,
estado: sugerido | confirmado | rejeitado | conflitante,
revisor e data da confirmação
```

Jogadores e duração serão pares de limites, aproveitando a conversão já testada. Não misturar mínimo de uma edição com máximo de outra, nem tratar limite isolado como intervalo completo.

O comparador deduplicará valores equivalentes e conservará todas as referências que os sustentam. Discordâncias permanecem como alternativas; não fazer média, estimar limite nem escolher silenciosamente a maioria. A prioridade do PDF depende de haver evidência explícita naquela edição; silêncio do PDF não comprova ausência de uma característica.

Um vocabulário versionado terá IDs estáveis e rótulos PT-BR/EN/FR para categorias, mecânicas e tipos: `cooperative` → Cooperativo; `deck_building` → Construção de baralho; `worker_placement` → Alocação de trabalhadores. O termo original será preservado. Termo desconhecido ou ambíguo fica para revisão; cooperação não será inferida só por temática.

Descrições PT existentes e licenciadas têm preferência. Na ausência delas, apresentar o original com o idioma, permitindo edição manual. Tradução de texto longo sem IA não está prometida. Para Wikipédia, preservar URL, autores/histórico, licença e indicação de adaptação, inclusive após edição. Dados estruturados Wikidata são CC0; isso não libera automaticamente capas ou textos de outras origens. [Wikidata: licenciamento](https://www.wikidata.org/wiki/Wikidata:Licensing), [termos Wikimedia](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use).

Na interface, um resultado consolidado mostra título PT, nome original secundário e apenas os campos disponíveis. Uma indicação curta informa quantas fontes contribuíram. Aliases, identificação da edição, divergências e detalhes técnicos ficam recolhidos. A revisão mostra a fonte de cada campo. Permanecem Revisar sugestões, Usar sugestões e Selecionar todos, sem mudar o layout da biblioteca.

Confirmar transfere os valores escolhidos à etapa 2; edição/idioma também serão mapeados explicitamente. Alterações manuais exigem confirmação antes de substituição. Nenhuma pesquisa publica o jogo ou o guia automaticamente.

## 4. Armazenamento e permissões

Proposta de dados compactos, sem trocar a infraestrutura:

| Registro                          | Finalidade                                                                            | Acesso                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `gameIdentities/{workId}`         | IDs e aliases confirmados, separados das edições                                      | Escrita administrativa validada; leitura pública apenas da projeção confirmada |
| `gameAliases/{hashDoNomeEIdioma}` | Índice limitado de identidades candidatas; homônimos podem apontar a mais de uma obra | Sem sobrescrever a identidade pelo simples resultado de busca                  |
| `gameResearch/{gameId}`           | Snapshot por obra/edição/PDF com fatos, fontes, conflitos e revisão                   | Rascunho disponível apenas a administradores autorizados                       |
| `games/{gameId}`                  | Cadastro público atual e referências aos fatos confirmados                            | Permissões existentes preservadas                                              |
| Guias e índice atuais             | Seções publicadas, trechos e páginas por SHA-256                                      | Reutilizar `guideDrafts`, `gameGuides` e arquivos de índice do Drive           |

O rascunho de uma inclusão ainda não salva fica em IndexedDB. Ao salvar, a pesquisa é vinculada ao jogo/edição; na edição de um jogo existente, salvar o snapshot é uma operação administrativa separada, sem aplicar dados ao formulário automaticamente. Somente a projeção confirmada acompanha o conteúdo público. Licenças que proíbam persistência excluem aquela resposta do snapshot; não salvar indiscriminadamente o JSON de todas as APIs.

Reusar primeiro a identidade e os fatos confirmados, depois resultados consultados ainda válidos. A chave inclui edição, idioma preferido, versão do esquema e política da fonte; evidências do manual também incluem hash. Atualização explícita preserva versões/revisões anteriores limitadas e escolhas rejeitadas até mudarem a fonte ou a edição. Cache expirado pode ser mostrado com data, sem fingir uma consulta nova. Falha de rede não elimina conhecimento confirmado.

Documentos de pesquisa terão teto proposto de 128 KiB, até 32 aliases, até 60 fatos e retenção limitada de revisões. Texto completo do PDF não vai para Firestore: permanece no índice comprimido do Drive já existente. Excluir índices desnecessários de textos/valores extensos. Concorrência é controlada por revisão/transação, como nos guias.

Regras validarão tipos, tamanho, referências, autor e permissões reais; um visitante não grava sugestões ou aliases. O Worker valida JWT Firebase e perfil atual no Firestore. Escrita via REST autenticada também deve passar pelas regras. A permissão de edição continua sem conceder exclusão definitiva ou promoção de usuários. Não introduzir conta de serviço com acesso irrestrito para simplificar.

Não usar TTL automático do Firestore: exclusões TTL exigem faturamento. Expiração de cache será avaliada na leitura. O teto oficial de documento é 1 MiB; a cota gratuita tem 1 GiB de dados, 50 mil leituras e 20 mil escritas diárias. Sem faturamento, esgotamento deve resultar em falha tratada e retomada, não contratação automática. [Cotas oficiais do Firestore](https://firebase.google.com/docs/firestore/quotas).

## 5. Base de conhecimento para guias e consulta rápida

Estender o índice atual com tópicos estáveis: objetivo, componentes, preparação, turnos, ações, regras especiais, habilidades/combate, pontuação, vitória/derrota e FAQ. A ausência de um assunto não cria uma seção com regras inventadas.

Cada trecho guarda página física, idioma, hash do PDF, método de extração e situação de revisão. O guia pode reutilizar um trecho como rascunho e permitir explicação didática escrita pelo administrador. Consulta rápida pesquisa o mesmo índice e as seções publicadas; uma pergunta nova não reprocessa o PDF.

Dados gerais de catálogo podem alimentar Visão geral. Serão marcados como informação externa, sem virar regra oficial ou receber número de página fabricado. FAQ sem respostas verificadas permanece ausente; cabe oferecer perguntas para o administrador responder com o manual.

PDF substituído invalida referências e checkpoints daquele hash. O conhecimento da edição anterior não é apagado silenciosamente nem transferido como válido à nova edição. Usar o fluxo de arquivos de índice/guia já autorizado dentro da pasta PDFs existente; não criar outra pasta, expor documentos pessoais ou alterar a titularidade dos arquivos.

### OCR progressivo

Reutilizar Tesseract em lotes pequenos, inicialmente três páginas, uma imagem por vez. Reutilizar o worker OCR durante o lote, liberar canvas e gravar checkpoint por página no IndexedDB. Registrar páginas concluídas, com pouca confiança, com falha e ainda não processadas. Continuar somente por ação do administrador.

Entregar parciais identificados como índice incompleto, com cobertura de páginas; falha numa página não invalida o restante. Retomada verifica hash e versão do extrator. Aplicação/publicação continua exigindo revisão. OCR não burla senha ou proteção do documento. Este processamento usa o dispositivo, sem serviço externo ou promessa de prazo uniforme no celular.

## 6. Fontes autorizadas e conectores adicionais

Wikidata e Wikipédia continuam como conectores automáticos abertos. BGG e Ludopedia permanecem condicionados à autorização existente da aplicação e credenciais do proprietário, com suas regras de atribuição/cache. Um link de consulta manual não será listado como conector ativo.

Páginas oficiais de editoras podem documentar uma identidade durante revisão humana; isso não autoriza uma rotina de scraping. Novas integrações de editoras brasileiras, francesas ou canadenses precisam de API/feed permitido ou autorização específica antes de entrar na pesquisa automática. Campos e imagens sem licença/autorização de reutilização não entram por conveniência.

## 7. Avaliação Gemini e Google Search

Esta análise não criou chave, chamou Gemini, enviou PDF, habilitou API ou vinculou faturamento.

- **Cotas/preço:** a tabela atual informa entrada/saída gratuitas e Search até 500 requisições/dia para Gemini 2.5 Flash/Flash-Lite; Gemini 3.8 Flash tem inferência gratuita, mas Search indisponível no Free. Cotas de Search não garantem a mesma quantidade de inferências. [Preços oficiais](https://ai.google.dev/gemini-api/docs/pricing).
- **Incerteza relevante:** os termos descrevem Search via API como serviço pago, embora a tabela apresente a franquia gratuita de alguns modelos. É preciso confirmar elegibilidade e exigência de faturamento do projeto/modelo antes de propor ativação. [Termos Gemini](https://ai.google.dev/gemini-api/terms).
- **Limites reais:** RPM, TPM e RPD dependem de projeto/modelo e são consultados no AI Studio; não são garantidos. Passar a Tier 1 envolve faturamento. Não haverá upgrade automático ou fallback para modelo pago. [Limites oficiais](https://ai.google.dev/gemini-api/docs/rate-limits).
- **Privacidade:** na modalidade gratuita, entradas/saídas podem ser usadas para melhoria dos produtos e analisadas por humanos. Isso exige autorização informada antes de enviar trechos de manuais; conta Google One não representa autorização para o Acervo enviar PDFs. [Tratamento de dados](https://ai.google.dev/gemini-api/terms#unpaid-services).
- **PDF:** a API suporta compreensão de documentos de até 50 MB ou mil páginas, sujeita também à janela de contexto/modelo. Capacidade técnica não garante interpretação correta de regras nem referência correta de página. [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing).
- **Base reutilizável:** as restrições de Search vedam cache/coleta programática e uso dos resultados fundamentados para criar uma base de dados, salvo exceções específicas que não liberam este catálogo. Portanto, não propor Search como alimentador automático do conhecimento persistente. Seria necessário esclarecer outro uso permitido ou autorização do fornecedor. [Restrições de Search](https://ai.google.dev/gemini-api/terms#grounding-with-google-search).

Recomendação: implementar primeiro a base sem IA. Uma etapa opcional futura poderia usar Gemini **sem Search** para sugerir explicações/traduções a partir de trechos autorizados e já indexados, com validação de páginas e revisão humana. Essa opção depende de consentimento, quota/modelo gratuito verificados e tratamento dos direitos do material. Não está incluída na implementação recomendada agora.

Se aprovada futuramente, chave somente em secret do Worker, JWT/permissão de edição, limite por usuário e limite global persistente, limites de texto/saída, cancelamento, tratamento de 429 e desligamento simples. Não registrar PDFs/tokens/prompts completos nos logs. Conter custo não será baseado apenas num contador em memória, que não representa todas as instâncias do Worker.

## 8. Exemplo real: Sina da Sociedade

O registro editorial atual já liga Sina da Sociedade, Fate of the Fellowship e Le Destin de la Communauté a uma obra identificada; ainda precisa confirmar a edição do PDF de cada cadastro. Não precisa inventar o nome francês.

Há um exemplo concreto de divergência: a [página oficial Z-Man](https://www.zmangames.com/game/the-lord-of-the-rings-fate-of-the-fellowship/) informa 1–5 jogadores, 14+ e 60–150 minutos; a [página oficial Asmodee France](https://www.asmodee.fr/product/seigneur-des-anneaux-le-destin-de-la-communaute/) informa 1–5, 14+ e 60 minutos. A solução proposta mantém as duas durações com referência para revisão; não presume igualdade de edição nem usa 60 como limite definitivo da versão brasileira. Estas páginas foram consultadas para a proposta, não convertidas em novos conectores do aplicativo.

## 9. Etapas sugeridas para aprovação

| Etapa                  | Entrega                                                                                                               | Dependência                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A                      | Identidade/aliases editáveis, busca complementar PT/EN/FR, vocabulário, consolidação por campo e aplicação na etapa 2 | Fontes abertas atuais; sem IA                              |
| B                      | Pesquisa persistente por edição, reutilização entre dispositivos, permissões/revisões e origem por campo              | Firestore Spark; novos esquemas/regras testados localmente |
| C                      | Base compartilhada por guia/consulta, classificação de tópicos, OCR progressivo e retomada por hash                   | Índice e arquivos do Drive atuais; sem serviço adicional   |
| D, opcional            | Gemini sem Search para material autorizado                                                                            | Aprovação separada de privacidade e configuração gratuita  |
| Fora do escopo inicial | Coleta automática de Search, scraping de editoras, APIs pagas                                                         | Sem autorização/condições suficientes                      |

Recomendo aprovar A, B e C. Cada etapa será compatível com cadastros antigos e ativada somente após seus testes. D fica desabilitada e não bloqueia nenhuma função.

## 10. Critérios de aceitação e publicação

Os testes da nova arquitetura ainda não foram executados: são o contrato da implementação após aprovação.

1. Sina pelo nome brasileiro, original inglês e título francês documentado chega à mesma obra, sem declarar edição confirmada pelo nome.
2. Variações com subtítulo, nome alternativo do administrador e código de produto geram candidatos; homônimo e expansão permanecem separados.
3. Fonte EN com duração/jogadores e fonte FR com categorias são consolidadas somente sob identidade compatível; origem e idioma de cada campo continuam disponíveis.
4. Cooperativo, construção de baralho e alocação de trabalhadores usam o mesmo vocabulário PT-BR; termo desconhecido não é traduzido por adivinhação.
5. Discordâncias de edição ou valores exigem revisão; ausência de metadados não aparece como cadastro completo.
6. Revisar/Usar sugestões → etapa 2 → ida/volta → salvar → reabrir: verificar inputs e documento, inclusive duração e textos editados.
7. Segunda consulta compatível usa dados persistidos sem requisições externas redundantes; refresh, expiração e falha de cache são testados separadamente.
8. Trecho com página/habilidade/combate alimenta guia e busca; PDF novo não aceita página do hash antigo. Nenhuma regra de catálogo vira regra oficial.
9. OCR cancelado retoma só páginas faltantes; falha é identificada e o PDF continua legível no leitor original.
10. Emuladores comprovam visitante sem escrita, edição autorizada, bloqueio efetivo e publicação revisada. Nenhuma conta/arquivo de produção é criado pelos testes.
11. Desktop, tablet e celular preservam o layout da biblioteca e os atalhos 1.7.5. Fontes reais e fixtures são identificadas separadamente no relatório.

Alterações serão entregues localmente, com diff, resultado de testes e comandos Bash de commit. Push, deploy do Worker e publicação de regras dependem de pedido explícito; nunca serão consequência automática de concluir a implementação. Os arquivos estáticos podem ser publicados pelo GitHub Actions após o push feito pelo proprietário, mas isso não atualiza automaticamente Worker/regras: a futura entrega terá uma sequência compatível de publicação e checagem de protocolo, sem deixar o frontend depender de backend ainda não atualizado.
