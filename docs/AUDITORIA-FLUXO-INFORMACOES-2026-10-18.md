# Auditoria do fluxo único — correções e evidências

Revisão local, sem commit, push, deploy ou acesso aos serviços reais. Esta revisão atualiza o tratamento de legado descrito em `FLUXO-CADASTRO-EDICAO-2026-10-18.md`: **Completar informações pode atualizar explicitamente uma ficha Gemini ausente**, mesmo quando já existem regras salvas.

## Defeitos reproduzidos antes da correção

Os testes foram escritos e executados antes de alterar o comportamento. Os seis testes de controle falharam; as quatro reproduções no Chrome também falharam. Os registros originais foram preservados.

| Reprodução                                                                           | Antes                                                                       | Depois                                                                                                   |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Legado com regras, sem ficha; abrir e clicar explicitamente em Completar informações | Nenhuma geração, ficha continuava ausente                                   | Abrir não gera; o clique solicita uma atualização com aviso de cota                                      |
| Objeto `profile: {}` sem análise comprovada                                          | Era tratado como ficha suficiente                                           | Exige atualização explícita; um marcador do servidor diferencia uma análise nova legitimamente sem fatos |
| Alterar título durante uma resposta                                                  | A resposta antiga passava pela assinatura                                   | Resposta ignorada e consumidor encerrado                                                                 |
| Alterar edição ou PDF durante o acompanhamento                                       | Resultado ignorado parcialmente, acompanhamento não invalidado corretamente | Consumidor encerrado; sem preencher a nova identidade                                                    |
| Resposta da geração após mudança de identidade                                       | Podia ser entregue ao consumidor novo                                       | Resultado e erro tardios são ignorados                                                                   |
| Substituir conhecimento válido por resultado inválido                                | A consolidação ainda continha idade 14                                      | Candidato removido e consolidação reconstruída                                                           |
| Invalidar identidade depois do preenchimento automático                              | Idade automática 14 permanecia no input                                     | Valor automático dependente removido; sinopse manual preservada                                          |
| Jogo salvo, índice pronto e IA indisponível                                          | Não recuperava a idade do índice                                            | Recupera somente fatos sustentados no índice, sem IA                                                     |
| Cota esgotada, PDF pronto e fonte pública disponível                                 | A idade do índice permanecia vazia                                          | PDF e fonte pública contribuem, mantendo o aviso de cota                                                 |

Evidências anteriores: `test-output/firestore-fixes/audit-before-unit.log`, `audit-before-browser.log` e `audit-browser-before.json`. Evidências posteriores: `audit-after-unit.log`, `audit-after-browser.log` e `audit-browser-after.json`.

## Comportamento corrigido

- A ficha é reconhecida por evidências verificáveis para os documentos atuais, título e edição compatíveis. A simples existência de regras ou de um objeto vazio não basta.
- Sem ficha, **abrir** informa que uma nova análise consumirá cota. **Completar informações** faz a solicitação explícita, compartilhada entre consumidores concorrentes. Não é necessário mudar para a aba Regras.
- O Worker preserva as correções manuais de regras durante essa atualização. Uma repetição do mesmo identificador de requisição não gera novamente nem incrementa a cota.
- Uma análise nova que não encontra fatos recebe um marcador de processamento validado. Isso impede gastar cota repetidamente apenas porque o manual não informa determinados campos. Resultado inválido não recebe esse tratamento.
- A identidade do consumidor inclui conta, jogo, título normalizado, edição, hash do PDF principal e identidades/hashes dos documentos. O hash principal é considerado mesmo enquanto a lista `documents` ainda reflete uma versão anterior, durante uma substituição não salva.
- As respostas do rascunho também verificam título, edição e documentos capturados no início. Alterações manuais invalidam a operação pendente.
- Resultados Gemini antigos do cache de pesquisa não são reinseridos como novas sugestões. O resultado atual do conhecimento tem seu próprio consumidor validado.
- Valores automáticos sem suporte deixam os inputs quando a sugestão é retirada. Valores salvos, confirmados ou editados manualmente permanecem. Alterar somente preferências da pesquisa não descarta evidências válidas da mesma identidade.

## Recuperação do PDF sem IA: alcance real

O editor consulta primeiro o índice privado local válido. Pelo comando explícito, se necessário, recupera o índice técnico autorizado existente. Não baixa nem processa novamente o PDF para este preenchimento. Um índice válido fica em cache mesmo quando não contém fatos de cadastro, evitando novas leituras apenas por não haver metadados.

Na reprodução isolada, o PDF continha explicitamente jogadores **2–4**, duração **30–60 minutos**, idade **14**, edição **3**, categoria **Fantasia**, mecânica **Gestão de cartas** e interação **Cooperativo**. Esses fatos foram recuperados com documento, página e hash. A fonte pública simulada acrescentou **Aventura**. A descrição permaneceu vazia: o texto não oferecia uma sinopse adequada.

O teste mediu **uma recuperação de índice e zero gerações** tanto sem IA quanto com cota esgotada. Esses valores descrevem a fixture; não significam leituras faturadas. Um manual real sem duração, idade ou descrição explícitas continuará com os respectivos campos vazios. Índice ausente, incompatível ou ilegível não autoriza inventar valores.

## Problemas adicionais identificados e tratados

1. **Valores automáticos órfãos:** remover apenas o candidato e os detalhes de origem deixava o valor no input. A retirada agora considera a dependência da sugestão, sem apagar edições manuais.
2. **Identidade não salva contra identidade do servidor:** o endpoint usa o jogo persistido. Gerar para título/edição/PDF alterados no editor poderia gastar cota com o contexto anterior. O cliente envia uma pré-condição; o Worker a valida antes de iniciar a geração. Se houver diferença, pede para salvar a identificação primeiro. Contra Worker antigo sem esse protocolo, a solicitação é bloqueada com explicação, sem iniciar IA.
3. **Análise válida sem fatos:** um `profile` vazio não pode significar ao mesmo tempo “formato antigo” e “manual analisado, dados ausentes”. O marcador do servidor evita uma sequência de regenerações pagas em cota.
4. **Lista de PDFs do rascunho:** a verificação inclui também os complementares ainda não salvos. Isso foi verificado no cadastro com três PDFs, preservando a incorporação posterior do conhecimento.

Não foi realizada uma auditoria exaustiva de todo o aplicativo nem atribuída qualquer causa nova ao consumo histórico do Firestore.

## Validação final

- **166 testes do aplicativo e 87 do Worker aprovados.**
- Nove testes específicos de controle aprovados: os seis que falhavam antes e três verificações adicionais de análise vazia, troca do principal com lista antiga e erro tardio.
- Oito cenários específicos no Chrome aprovados, incluindo mudanças de título, edição e PDF durante a resposta.
- Integração real do código do aplicativo/Worker com **Auth e Firestore emulados**, Drive/Gemini simulados: cadastro de três PDFs, retomada de upload, editor, atualização explícita do legado, inspeção dos inputs e do cadastro antes/depois de salvar, correções manuais, recarga e três larguras de tela.
- **27 testes de segurança aprovados**, incluindo revogação e proibição de escrita por usuário comum.
- Worker isolado: ficha legada ganha idade comprovada, correção manual de ataque permanece, duas entregas da mesma requisição produzem **uma chamada ao provedor simulado e uma unidade de cota**; identidade divergente recebe 409 sem outra chamada.
- **17 consultas com PDFs comerciais locais**, incluindo OCR salvo em inglês, mantêm resultados/páginas esperados e **zero Gemini**. São regressões da consulta de regras, sem enviar manuais a serviços externos.
- Rascunho e consenso preservam cache, escolha consolidada e edição manual. A fila e o leitor foram verificados separadamente, mantendo restauração sem reanálise e transferência única por abertura.

O prompt editorial, os tópicos e o comportamento de Consultar regras foram preservados. As configurações de produção, credenciais, regras Firestore e mecanismos de transferência/observação não foram alterados. Não há nova tela, botão concorrente, coleção ou serviço. Frontend e Worker precisam ser publicados juntos somente após autorização.
