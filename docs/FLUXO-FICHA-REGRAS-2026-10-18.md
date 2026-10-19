# Cadastro, ficha e regras na mesma preparação

Implementação local de 18/10/2026. Complementa as auditorias da ficha e da duração. Não houve commit, push, deploy, geração Gemini real ou alteração de dados de produção.

## Fluxo final

1. Anexar os PDFs permite identificar o jogo e conferir o nome. Abrir a etapa 2 não inicia IA.
2. **Completar informações** usa o nome corrigido, a edição atual e os documentos atuais. O servidor reúne os manuais e as fontes públicas da identidade correspondente.
3. Uma mesma resposta Gemini fornece os 11 campos da ficha e as seções de conhecimento já usadas por Consultar regras. Os campos válidos entram no formulário; as correções manuais continuam prioritárias. Uma duração fixa preenche os dois limites.
4. Ao publicar o jogo, o sistema salva a ficha, aproveita os índices já calculados, envia esses índices pelo armazenamento existente e vincula o conhecimento privado do rascunho ao jogo. A vinculação revalida o texto contra os índices autorizados e não chama Gemini.
5. A fila recebe o contexto que já foi vinculado. Não solicita a mesma adoção novamente. Consultar regras e recarregar usam os índices e o conhecimento armazenados.

Não foram criadas telas, aprovações por seção ou ações principais adicionais.

## O que foi integrado

- `profileMetadataProtocol: 2` identifica a preparação conjunta no Worker. O frontend evita repetir as pesquisas Wikidata/Wikipédia que o servidor já realizou. O protocolo anterior continua disponível como caminho compatível.
- Os conectores públicos existentes fornecem dados licenciados CC0/CC BY-SA; identidade, tipo de produto e edição são conferidos antes do aproveitamento. Homônimos incompatíveis não são combinados. As consultas continuam multilíngues, com preferência, tipo e aliases repassados. Um alias literal presente no manual pode ajudar a confirmação; uma pista não comprovada não declara equivalência automaticamente.
- BoardGameGeek e Ludopedia continuam participando da consolidação quando autorizados/configurados. Não foi ampliada a licença desses dados nem iniciado seu envio ao Gemini.
- O schema da ficha aceita evidências de dois tipos na mesma geração: página/passagem para PDF; URL/fato/trecho para fonte pública. Números são confrontados com o campo correspondente, evitando transformar duração em idade apenas porque o número existe na fonte.
- As fontes públicas complementam a ficha. Elas não podem fornecer seções específicas das regras do PDF. Tópicos, quantidade e formato editorial das regras foram preservados; a validação mantém documento, página e hash.
- O resumo validado do Gemini tem prioridade sobre um rótulo curto do catálogo ou uma descrição automática do PDF. Uma descrição corrigida ou confirmada pelo usuário é preservada.
- A origem distingue Gemini/manual, Gemini/fontes públicas e fatos recuperados diretamente. URL, licença, autoria e evidência ficam disponíveis nos detalhes e acompanham os dados salvos.
- As fontes públicas do resultado são ligadas ao conjunto de hashes dos manuais. Não migram para outro PDF com o mesmo título. A correção comprovada de título/edição continua permitindo o reaproveitamento legítimo.

Metadados gerais sem edição declarada permanecem identificados como sugestões com edição não confirmada. A confirmação final da ficha continua obrigatória. Uma edição explicitamente diferente é recusada; números incompatíveis não reaparecem pelo fallback. Dados revisados não são substituídos.

## Consumo e segurança

A coleta interna usa o perfil que o roteador acabou de autorizar na mesma requisição. Isso não cria cache de autorização entre requisições ou usuários. A permissão é conferida novamente antes de aceitar a geração. O teste de revogação durante a resposta rejeitou o resultado.

No teste unitário do endpoint do rascunho, a geração conjunta fez apenas a revalidação final do perfil: as duas consultas internas de catálogo não acrescentaram GETs de perfil. A autorização inicial do roteador é adicional e foi exercitada no navegador com o Worker completo. Esses números descrevem chamadas, não leituras faturadas.

Cache por conta, hash e identidade, controle de concorrência, limites de cota e proteção das correções foram mantidos. Não há chamadas Gemini por pesquisa de regras. Os exemplos de dados em fixtures não são um catálogo embutido na aplicação.

## Evidências e testes

### Cadastro completo no navegador

`tests/combined-profile-browser.mjs` usa Firebase Auth/Firestore emulados, frontend e Worker reais locais, Drive simulado e resposta Gemini simulada. O PDF de teste não fornece idade nem duração. O catálogo de teste fornece esses fatos e a mesma resposta Gemini prepara ficha e regras.

Resultado registrado em `test-output/combined-profile/browser.json`:

| Verificação                                            | Resultado                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Nome enviado ao Gemini                                 | `Sushi Go Party!`, corrigido após identificação com nome de arquivo técnico |
| Campos da ficha validados                              | 11                                                                          |
| Duração nos inputs e no registro                       | 20/20, conforme a fixture                                                   |
| Idade corrigida manualmente                            | 9 no registro, preservando a sugestão original na origem                    |
| Requisições de análise do rascunho                     | 1                                                                           |
| Gerações Gemini simuladas                              | 1                                                                           |
| Vinculação do conhecimento ao jogo                     | 1 POST, sem geração                                                         |
| Repetição de pesquisa Wikidata/Wikipédia pelo frontend | 0                                                                           |
| Reabrir, pesquisar regras e recarregar                 | Nenhuma nova geração ou pesquisa pública                                    |

Os 11 transportes HTTP públicos simulados da primeira coleta não são chamadas Gemini nem leituras Firestore. Não se repetiram no reaproveitamento, na vinculação ou nas consultas.

O teste completo anterior também passou: três PDFs, falha e retomada de um complemento, prioridade do manual sobre divergência externa, registro único, correções das regras, legado preservado, consulta sem IA, recarga, permissões, revogação de acesso e três larguras de tela.

### Regressões

- Aplicativo: **199/199** testes.
- Worker: **97/97** testes.
- Regras de segurança: **27/27**, em `demo-acervo`.
- Navegador: cadastro integrado, múltiplos PDFs, ficha completa/duração, Descent real com resposta Gemini simulada, consenso, resultados inválidos, identidade alterada, cache, restauração da fila e contexto já vinculado.
- A restauração dos 12 trabalhos concluídos continuou fazendo zero leituras de índices e zero análises. Fechar o jogo manteve zero listeners individuais. No teste novo, o cadastro já preparado fez uma leitura necessária do índice; o reload não acrescentou leitura ou adoção. Título/hash novos invalidaram o contexto corretamente.
- OCR local real: recuperação dirigida de uma página de Descent, com as outras 31 páginas conservadas e checkpoint reutilizável.
- Sintaxe, formatação, build estático e bundle do Worker em `--dry-run`.

Logs e capturas descartáveis permanecem em `test-output/`, ignorado pelo Git.

## Limites e publicação

As informações da fixture de Sushi Go Party são dados de teste explícitos, não uma consulta real ao Gemini ou comprovação da qualidade atual dos catálogos. Nenhuma credencial ou PDF privado foi enviado durante os testes.

O sistema examina todos os campos e preenche os que têm sustentação. Não inventa uma idade, edição ou duração quando todas as fontes disponíveis as omitem. Falhas de fonte e identidades ambíguas são indicadas nos detalhes. Não foi ativado Google Search/grounding, serviço pago ou integração adicional de tradução.

As mudanças estão locais. Para o site real usar o fluxo conjunto, é necessária publicação autorizada do Worker e do frontend compatíveis. Não é necessário recriar jogos, usuários, PDFs, índices, banco ou regras Firestore.
