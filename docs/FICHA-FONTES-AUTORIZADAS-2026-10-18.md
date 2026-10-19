# Ficha única: Gemini e catálogos autorizados

Implementação local em 18/10/2026 (execuções de teste também registradas em 19/10 UTC). Sem commit, push, deploy ou consultas a Firebase, Drive e Gemini reais. Foram consultadas somente documentações públicas dos provedores.

## Funcionamento

O usuário fornece/corrige o nome e clica em **Completar informações**. A abertura do cadastro não inicia IA. A identidade inclui título, edição e hashes dos PDFs; resultados de outra identidade não preenchem o formulário.

1. O PDF fornece fatos legíveis e evidências por página. O OCR local e seu cache são preservados.
2. Wikidata e Wikipédia são consultados pelas APIs existentes. A Wikipédia agora inclui a ficha técnica (infobox) da mesma revisão na requisição que já buscava a introdução, sem uma consulta extra por artigo. Aproveita jogadores, duração, idade, categorias e mecânicas quando inequívocos; guarda referência à revisão, licença e autores. Não transforma setup, qualificadores ou números de outras seções em duração da partida.
3. Se ainda faltarem fatos, uma tentativa adicional com `gemini-2.5-flash-lite` propõe nomes oficiais em português, inglês e francês para descobrir a mesma obra. Recebe título corrigido, edição, tipo e campos ausentes. Não recebe PDFs, hashes, credenciais do usuário, URLs arbitrárias ou ferramentas Google Search. Os números ou URLs que um modelo possa devolver fora do contrato são ignorados. Uma pista não confirma identidade.
4. Os nomes propostos podem ampliar as consultas às APIs autorizadas. Para aplicar valores, uma fonte precisa confirmar a identidade independentemente do Gemini. Não há importação de páginas arbitrárias de editoras/lojas nem scraping.
5. A geração existente `gemini-3.5-flash-lite` recebe os manuais e fatos das fontes públicas CC0/CC BY-SA confirmadas, produzindo regras e ficha na mesma síntese. **O prompt editorial e o contrato das seções de regras não foram alterados nesta etapa.** Dados de BGG/Ludopedia não são enviados ao modelo sem autorização específica do fornecedor: seus fatos entram diretamente na consolidação local.
6. BGG e Ludopedia, quando habilitados, continuam na mesma ação e na mesma ficha. BGG aproveita agora categorias e mecânicas explícitas. Termos conhecidos são traduzidos por vocabulário local; termos desconhecidos não ganham uma tradução inventada. Uma duração fixa preenche mínimo e máximo; faixas mantêm seus extremos.
7. Ao salvar, campos, origens, índices e conhecimento são vinculados ao jogo existente. O rascunho não cria um jogo definitivo prematuramente. Correções manuais dos campos e das regras conservam prioridade. Ausência de evidência continua sendo ausência, mesmo após uma análise concluída.

## Duas falhas adicionais reproduzidas

- **Resumo encontrado, detalhe bloqueado:** a busca de BGG/Ludopedia era seguida imediatamente do pedido de detalhe. O intervalo local de 1 segundo bloqueava esse segundo pedido. Agora o detalhe aguarda o intervalo local, com cancelamento e prazo limitado. `Retry-After` e bloqueios do provedor continuam impedindo novas consultas, sem retry automático.
- **Fontes isoladas por falta de ID cruzado:** só o resumo não tem os elementos necessários para reconhecer a obra entre os dois catálogos. Durante uma pesquisa explícita, busca-se o detalhe de no máximo um resultado com nome exato por provedor, além dos membros já identificados. Os detalhes permitem reunir BGG/Ludopedia por nome exato, ano original e conjunto de designers, com tipo e edição compatíveis. Identificadores compartilhados contraditórios, anos/designers divergentes, resumos, expansões e múltiplas obras compatíveis não são unidos. A confirmação derivada mantém a prova; não altera as respostas originais dos conectores. A ausência de prova deixa uma revisão consolidada de identidade.

Essa comparação usa `ano_publicacao`, nunca `ano_nacional`, e `designers[].nm_profissional`, conforme o [OpenAPI oficial Ludopedia](https://ludopedia.com.br/api/openapi.yaml). Não inventa um ID de ligação a partir do nome.

## Limites e cache

- Atualização autorizada em 19/10: a descoberta mantém **1 tentativa por análise** para deduplicação; os limites internos de duas por minuto e cinco por dia foram removidos, tanto da descoberta quanto da síntese. Continuam valendo as cotas e recusas do provedor. Os antigos contadores ficam inertes, sem redefinição de dados.
- Portanto uma preparação pode utilizar **uma chamada de descoberta 2.5 + uma chamada de síntese 3.5**. Não é uma única chamada total. Se os fatos já bastarem, a descoberta é dispensada. Abrir editor, digitar em campos, consultar regras e recarregar não geram novamente.
- A versão/resultado da descoberta fica no conhecimento. Resposta sem pistas ou modelo indisponível é reutilizada sem loop. Erros transitórios/cota incluem `retryAt`; somente um novo clique explícito elegível pode renovar. O health local anuncia `profileDiscoveryProtocol:1`, o modelo, os limites e `googleSearchGrounding:false`, além do protocolo de ficha 2 e dos protocolos de identidade/reuso já existentes.
- Não foram criados listeners ou leituras Firestore para esse orçamento. Os catálogos internos usam o perfil já autorizado na mesma requisição. Pedidos HTTP explícitos de pesquisa/detalhe mantêm as verificações de acesso existentes. Isso não representa uma medição de leituras faturadas.
- [A disponibilidade do modelo 2.5](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite) pode depender do histórico de acesso do projeto. 401/403/404 não acionam outro modelo ou serviço pago. O estado aparece em Detalhes da pesquisa; PDF, síntese principal e catálogos continuam independentes.

## Google Search e integrações

Não utilizamos Google Search Grounding para formar a biblioteca persistente, conforme a escolha do usuário e as [condições específicas do serviço](https://ai.google.dev/gemini-api/terms#grounding-with-google-search). Não se deve confundir nomes sugeridos pela IA com uma pesquisa web realizada pelo modelo.

| Fonte          | Dados e condição para participar                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wikidata       | API CC0 já preparada; identidade e fatos dependem da cobertura dos itens.                                                                                                                                                                                                                   |
| Wikipédia      | Introdução/ficha técnica CC BY-SA, com atribuição, histórico e revisão. Não há garantia de artigo sobre todo jogo.                                                                                                                                                                          |
| BoardGameGeek  | Conector existente requer aplicação aprovada, `BGG_TOKEN` e logo oficial em `BGG_LOGO_URL`. Campos estruturados, sem copiar descrição/capa autoral. Ver [procedimento existente](FONTES-RECONHECIMENTO.md).                                                                                 |
| Ludopedia      | Conector existente requer aplicação/token autorizado em `LUDOPEDIA_TOKEN`. Fatos com atribuição e link; ver [procedimento existente](LUDOPEDIA.md), [documentação oficial](https://ludopedia.com.br/api/documentacao.html) e [condições da aplicação](https://ludopedia.com.br/aplicativo). |
| Editoras/lojas | Continuam como referências manuais até haver autorização/licença específica para integração e armazenamento.                                                                                                                                                                                |

Não inspecionei segredos nem alterei a configuração publicada. Não confirmei a habilitação atual das contas BGG/Ludopedia/Gemini; os testes usam tokens fictícios e respostas simuladas. O código não habilita uma integração só porque há um link para o site. Frontend e Worker novos ainda precisam de uma publicação autorizada para mudar o site real.

## Consultar regras

Permanece baseado no conhecimento armazenado e nos índices válidos. As buscas não chamam nenhum modelo nem consultam a internet. As fontes reservadas à ficha não podem se transformar em evidência para uma regra do PDF. Uma nova resposta online com IA é uma ação futura separada; não foi adicionado botão, chamada automática ou nova tela nesta tarefa.

## Evidências e limites da validação

- Suítes finais: **205 testes do aplicativo + 112 do Worker + 27 de segurança = 344 aprovados**. Sintaxe, build estático, `git diff --check` e bundle do Worker com `wrangler deploy --dry-run` aprovados. O dry-run não publicou nada.
- Comparação isolada com o conector de `HEAD` (`4d34b45`), usando o mesmo intervalo e um provedor simulado: antes, 1 transporte e detalhe bloqueado com 429; depois, 2 transportes e detalhe 200 após a espera. Evidência: `test-output/profile-catalog-before-after.json`.
- `worker/test/profile-discovery.test.mjs`: título/edição atuais; contrato sem Google Search; ausência de PDF/hash/chave no corpo; pistas limitadas; valores inventados descartados; ambiguidade; 403/404/429; confirmação independente obrigatória.
- `worker/test/profile-budget.test.mjs`: concorrência, limites por minuto/dia, lease/expiração e tentativa única.
- `worker/test/wiki-infobox.test.mjs`: duração fixa/faixa, idade, contexto, conflitos e revisão/licença preservadas no mesmo pedido.
- `worker/test/catalog.test.mjs`: categorias/mecânicas BGG e tradução local; aliases por idioma; busca seguida de detalhe respeitando intervalo; `Retry-After` sem nova consulta.
- `tests/metadata-consolidation.test.mjs`: união entre catálogos com prova, bloqueio de identidade insuficiente/conflitante e preservação de outros alfabetos nos designers.
- `worker/test/combined-profile.test.mjs`: ficha/regras juntas, cache/adopção sem repetição, modelo complementar indisponível sem interromper dados válidos, correções das regras e revogação durante geração.
- `tests/combined-profile-browser.mjs`: formulário e módulos reais, Auth/Firestore emulados e Drive/Gemini/catálogos simulados. **11 inputs preenchidos; 1 síntese 3.5, 1 descoberta 2.5, 4 transportes BGG/Ludopedia (busca+detalhe de cada)**. Novo clique reutiliza cache. Cadastro vincula índices e conhecimento; idade corrigida manualmente é preservada. Consulta de regras e reload não acrescentam chamadas aos dois modelos ou aos catálogos. Todos os destinos externos não simulados são bloqueados.
- `tests/profile-feedback-browser.mjs`: desktop 1440, tablet 820 e celular 390, uma ação principal, mensagens sem contradição e origens com pelo menos 7 px de distância dos inputs.
- Regressões adicionais de navegador: 8 cenários da auditoria de informações; troca de identidade/cache no rascunho; OCR Tesseract local da página 2 do PDF inglês de Descent já existente, com outras 31 páginas intactas, checkpoint reutilizado e zero chamadas externas.

Logs/capturas ficam em `test-output/`, ignorado pelo Git. Esses testes comprovam transporte, consolidação, aplicação, persistência e limites. Não comprovam que um provedor real retornará todos os dados de Descent/Sushi Go Party. Os valores da fixture são sintéticos, não um cadastro factual desses jogos. Metadados sem fonte suficiente, edição ambígua e traduções desconhecidas continuam podendo exigir revisão humana.
