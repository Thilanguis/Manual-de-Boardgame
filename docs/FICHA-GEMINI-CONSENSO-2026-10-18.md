# Ficha Gemini e consenso — implementação local

Sem commit, push, deploy ou alterações em dados/credenciais de produção. Todos os testes desta tarefa usam serviços simulados ou emuladores.

## Cadastro e edição

Ao selecionar os PDFs e pesquisar ou entrar em **Conferir informações**, o aplicativo prepara os índices locais e solicita a análise da ficha quando o Worker informa suporte e a IA está configurada/autorizada. A análise inclui todos os documentos selecionados. Extração, OCR e checkpoints existentes são reaproveitados; arquivos são processados sequencialmente. É possível continuar editando os campos durante a análise.

A mesma resposta Gemini inclui as seções de conhecimento e `metadata`, com os campos editoriais já existentes: título, edição, descrição PT-BR, jogadores mínimos/máximos, duração mínima/máxima, idade, categorias/temas, mecânicas e tipo de jogo. O idioma continua sendo o do PDF; capa e permissões não são inferidas pela IA. Os limites de texto dos campos seguem o modelo atual.

Cada fato inclui fonte e evidência. Para manuais, documento, hash, página e passagem são verificados. Valores fora do modelo, referências inexistentes, citações inventadas e faixas inconsistentes são descartados. Há validação adicional para evitar usar números de componentes/jogadores como idade. Um documento explicitamente marcado como expansão ou de edição incompatível não fornece metadados para a ficha base.

Em **Gerenciar jogo → Informações → Editar informações**, o resultado salvo para a versão atual volta à mesma consolidação. Abrir e editar não gera novamente. Registros antigos sem a nova ficha continuam oferecendo os fatos existentes; os novos campos exigem a próxima atualização de conhecimento explicitamente solicitada pelo administrador, sem regeneração silenciosa.

## Rascunho privado, sem cadastro antecipado

- `POST /v1/research/draft-knowledge` exige autenticação aprovada e permissão de adicionar/editar. A chave Gemini permanece no Worker.
- O resultado fica no coordenador de conhecimento existente, separado por conta e conjunto de hashes. Não cria jogo, índice ou documento no Firestore; não envia PDF temporário ao Drive.
- O texto do rascunho é fornecido pelo editor autorizado e permanece uma sugestão privada. Ele não é tratado como conhecimento definitivo apenas porque o cliente declarou um hash.
- Depois do cadastro e da preparação dos índices, o servidor compara integralmente os textos/páginas e hashes do rascunho com os índices autorizados lidos do Drive. Só então revalida referências e incorpora o resultado ao jogo. Divergência exige o fluxo normal de análise verificada; não se promove conteúdo incompatível.
- IDs locais e ordem dos documentos podem mudar sem criar outra geração: as referências são remapeadas por hash e verificadas novamente.
- A adoção não consome outra unidade da cota nem substitui correções manuais de documentos inalterados. O conhecimento armazenado continua disponível para Consultar regras sem aprovação individual.

O cache local de resultado e índices usa o armazenamento privado existente por conta/hash. Recarregar/reselecionar a mesma versão reutiliza a análise. Requisições simultâneas compartilham uma Promise; no servidor, a lease e as cotas globais existentes continuam limitando a geração. Uma resposta já entregue não é reaplicada ao formulário em cada conferência do cache. Logout, troca de manual ou perda de permissão invalidam o consumidor. Uma geração já enviada pode concluir no servidor, mas o perfil é revalidado antes de aceitar o resultado.

Se outra aba iniciou a análise, o estado em andamento aparece com orientação para usar **Pesquisar fontes** novamente. Não há polling adicional do rascunho. Falhas não provocam tentativas automáticas: uma nova tentativa depende desse comando explícito. Os limites existentes de duas gerações por minuto e cinco por dia UTC são compartilhados com as análises normais.

## Consenso e revisão

O sistema agrupa primeiro a identidade e a edição. Jogos homônimos, expansões e versões explicitamente incompatíveis não participam da mesma votação.

- Manual atual com página/passagem verificável tem prioridade sobre catálogos divergentes.
- PDF e Gemini baseados no mesmo hash contam como uma origem.
- `sourceFamily`, `derivedFrom` e a independência registrada preservam vínculos entre reproduções. Wikidata/Wikipédia não são presumidas duas confirmações independentes.
- Domínios diferentes, por si só, não comprovam independência. Fontes sem essa informação não criam uma maioria artificial.
- Consenso exige ao menos duas origens independentes elegíveis e maioria estrita. Fontes de baixa qualidade ou edição não confirmada não votam em divergências específicas.
- Jogadores e duração são decididos como pares completos da mesma origem. Não se combina o mínimo de uma fonte com o máximo de outra.
- Categorias e mecânicas compatíveis continuam sendo reunidas sem duplicatas. Sinopses diferentes não são tratadas como votos numéricos.

Campos suficientes são preenchidos automaticamente. Divergências não resolvidas aparecem em **uma área consolidada na própria etapa 2**, com resumo e somente as decisões pendentes. Alternativas, páginas, atribuições e links permanecem recolhíveis. Escolher um valor nessa revisão não abre outro modal. Substituir uma correção manual por uma alternativa continua exigindo autorização explícita.

Campos corrigidos, confirmados ou esvaziados manualmente têm prioridade. Alterações automáticas efetivamente novas invalidam a confirmação final, para impedir salvar informações que chegaram depois da revisão. Reconsultar um resultado idêntico não invalida a confirmação.

Continuam exigindo revisão humana: empate ou evidência contraditória dentro do próprio manual; independência/edição insuficiente para resolver uma divergência; identidade ambígua; informações ausentes/ilegíveis; correções de interpretação. Ausência de evidência permanece ausência de valor.

## Regras e consumo preservados

O prompt editorial original das regras, `TOPICS` e a segmentação `manualPassages` foram comparados com HEAD e permaneceram idênticos. A ficha entra como schema/instrução adicionais na mesma resposta, sem alterar o schema das seções. Nenhuma consulta de regras chama Gemini.

As otimizações de transferência única do PDF, restauração da fila, acompanhamento compartilhado e encerramento de listeners foram preservadas. O novo endpoint valida o perfil no início e, se gerar, novamente ao terminar; não faz consultas de catálogo/jogo por campo. Reutilização local do rascunho não solicita a API. Não há nova coleção, regra Firestore, projeto Firebase, serviço pago ou biblioteca adicional.

O limite de texto da geração continua sendo 200 mil caracteres, sem omissão silenciosa de páginas. O rascunho tem corpo limitado e não contorna cotas. A análise pode permanecer parcial se o OCR não produzir evidência suficiente; isso não autoriza inventar campos.

## Validação

| Teste | Resultado |
| --- | --- |
| Suíte do aplicativo | 149 aprovados |
| Suíte do Worker | 85 aprovados |
| Regras, Auth/Firestore emulados | 27 aprovados |
| Consenso 3 contra 1 | Idade, jogadores e duração corretos; pares mantidos |
| Cópias, origem não demonstrada, edição distinta, expansão e baixa qualidade | Sem maioria falsa |
| Manual contra maioria externa | Valor do manual atual preservado com alternativas disponíveis |
| Dados ausentes, referência falsa, números errados e faixas invertidas | Campos descartados, sem inventar preenchimento |
| Rascunho no navegador | Três consumidores, alteração de título e reload: uma chamada simulada; nenhuma em edição de jogo salvo |
| Revisão consolidada em 1440/768/390 px | Preenchimento automático, uma divergência, escolha sem modal e correção manual preservada |
| Sina da Sociedade com três PDFs, Auth/Firestore/Worker sob fixtures | Ficha antes de existir jogo; valores da etapa 2; falha parcial de upload/retomada; três documentos salvos; uma geração e uma unidade de cota; reutilização depois do cadastro |
| Administração e consulta | Metadado ausente preenchido; sinopse confirmada e correção de regra preservadas; recarga e outros perfis sem gerar; atualização explícita testada |
| PDFs reais locais: Duelo, Resident Evil, Dead by Daylight, OCR inglês | 17 consultas continuam relevantes, com páginas corretas; zero Gemini |
| Leitor e fila | Uma transferência por abertura, páginas 1/11/22, zoom/rolagem/três telas; 12 trabalhos prontos restaurados sem leituras repetidas |

No teste integrado, a resposta Gemini é simulada com fatos e referências reais do PDF fictício de teste. PDFs comerciais foram usados somente nas regressões locais de consulta. Nenhum teste desta implementação utilizou Firebase, Drive ou Gemini de produção. Artefatos ficam em `test-output/firestore-fixes/profile-*.log` e relatórios locais de regras.

O teste com um campo/origem ausente também revelou uma suposição antiga de que todas as origens eram objetos: a ficha agora ignora origens nulas ao montar atribuições/evidências, sem impedir abrir ou editar o jogo.

## Ativação pendente

Frontend e Worker precisam ser publicados juntos, mediante autorização. O Worker anuncia `profileMetadataProtocol: 1`; sem esse suporte, o cadastro informa a indisponibilidade e permite preenchimento manual. Nenhum deploy foi realizado. As configurações e a autorização Gemini existentes são reutilizadas; não é necessário recriar jogos, PDFs, contas ou banco.
