# Redução de consultas Firestore — validação local

**Atualização posterior, por solicitação do proprietário:** o bloqueio geral de localhost foi retirado. `npm start` usa os serviços reais em 127.0.0.1:4174, sem recarga automática; `npm run dev` mantém testes isolados. As quatro otimizações e seus resultados abaixo foram preservados. A descrição do bloqueio e a medição de `local-protection-browser.mjs` neste relatório registram o estágio anterior; a validação atual desse teste verifica seleção manual real sem executar Firebase e recusa de configuração real no modo isolado.

Correções locais sobre a auditoria `test-output/firestore-audit/DIAGNOSTICO-FIRESTORE.md`. Sem commit, push, deploy, alteração de regras/credenciais ou chamadas a Firebase real. Auth/Firestore usam `demo-acervo`; Drive, fontes externas e Gemini são simulados. O manual Resident Evil é um arquivo real local.

## Alterações

- O leitor recebe uma transferência autenticada por abertura e atende as faixas do PDF.js pelo Blob local efêmero. Continua verificando perfil/jogo no Worker, sem cache de autorização. O download respeita o limite de leitura existente de 200 MiB, pode ser interrompido e não é persistido. O upload e seus blocos permanecem iguais.
- A fila ignora listas provisórias durante o carregamento do catálogo e compartilha a restauração pendente. Só remove trabalhos quando há um catálogo confirmado. Hash/documento/versão continuam sendo conferidos.
- Informações e Consultar regras compartilham acompanhamento do mesmo jogo, usuário e documentos. O último consumidor encerra timer e requisição; fechar ou sair de Informações suspende seu acompanhamento, preservando edições. A geração no servidor continua independente.
- Atualizar a disponibilidade de um jogo fechado não reabre a observação individual de índices. Fechamento, troca de jogo, logout e perda de acesso encerram os consumidores.
- A configuração local agora exige emuladores. A prévia real é uma opção separada, explícita, sem Live Server; instruções em `DESENVOLVIMENTO.md`.

**Troca no leitor:** a primeira página aguarda o download completo. As páginas seguintes e o zoom não transferem novas faixas pela rede. Blob/stream evitam construir um ArrayBuffer integral adicional, mas não equivalem a uma medição de memória em aparelhos físicos. O browser controla o armazenamento temporário do Blob. Fechar o leitor ou revogar acesso destrói o documento/canvas; bytes previamente entregues a um usuário autorizado não podem ser retroativamente retirados do dispositivo.

## Medição comparável

Mesma massa da auditoria: 12 jogos, 12 documentos, índices prontos e proprietário aprovado. SDK = contador lógico de documentos retornados/alterações em snapshots, **não leituras faturadas**. GETs = chamadas REST explícitas do Worker ao Firestore, sem somá-las às avaliações das regras. Consultas vazias/cache e alvos internos do SDK têm particularidades descritas na auditoria original.

| Cenário | SDK antes → depois | GETs Worker/Firestore antes → depois | Listeners ao final antes → depois |
| --- | ---: | ---: | ---: |
| Primeira abertura, 12 índices ainda sem fila local | 39 → 39 | 73 → 73 | 4 → 4 |
| Dez minutos reais sem interação | 0 → 0 | 0 → 0 | 4 → 4 |
| Abrir/fechar jogo cinco vezes | 0 → 0 | 0 → 0 | 4 → 4 |
| Abrir contexto de Consultar regras | 2 → 2 | 4 → 4 | 4 → 4 |
| Seis pesquisas após carregar contexto | 0 → 0 | 0 → 0 | 4 → 4 |
| Reload, trabalhos concluídos restaurados | 39 → 15 | 37 → 37 | 4 → 4 |
| Reconexão natural da rede | 3 → 3 | 37 → 37 | 4 → 4 |
| Preparar documento sem índice | 7 → 7 | 13 → 13 | 4 → 4 |
| Resident Evil: páginas 1, 11, 22 | 0 → 0 | 60 → 2 | 4 → 4 |
| IA em andamento, Informações visível por 8 s | 0 → 0 | 8 → 8 | 5 → 5 |
| IA em andamento, administração fechada por 8 s | 0 → 0 | 6 → 0 | 5 → 5 |
| Administração anterior + Consultar regras, janela de 11 s | 2 → 2 | 18 → 10 | 4 → 4 |
| Disponibilidade após fechar jogo | 0 → 0 | 13 → 13 | 5 → 4 |
| Segunda aba: contador SDK da própria segunda aba | 39 → 15 | 37 → 37 | principal 5 → 4; segunda 4 → 4 |
| Logout | 0 → 0 | 0 → 0 | 0 → 0 |

O teste ocioso durou 600,249 s (antes 600,159 s), sem novas assinaturas. O cenário principal de reconexão também dispara eventos online/offline manualmente e mediu SDK=4; o ensaio complementar usa somente a rede real do navegador e confirma SDK=3. O foco avança o relógio do navegador 61 s para testar o throttle, sem apresentar esse avanço como tempo real decorrido.

No painel escondido, o quinto listener ainda corresponde à ficha do jogo que permanece aberta. Fechar essa ficha/abrir a consulta encerra-o. Não é acompanhamento da IA; o acompanhamento fechado fez zero GETs.

Reduções comprovadas: **96,7% dos GETs** no ensaio do PDF; **24 retornos de documentos SDK a menos** por reload; **zero polling oculto**; nenhuma assinatura individual reaberta pelo foco com a ficha fechada. Abertura fria, capas, disponibilidade e preparação inicial continuam tendo o custo medido, sem alegação de redução global diária.

## Regressões e evidências

- `npm test`: 140 testes passaram. Worker: 81 passaram. Regras: 27 passaram.
- `unified-validation.mjs`: cadastro, sessão aprovada/pendente/visitante, Worker, conhecimento automático simulado, correção preservada, pesquisa sem nova IA, recarga e três telas. Bloqueio com PDF aberto remove o leitor/canvas e o token anterior recebe 403 no Worker.
- `preparation-restore-browser.mjs`: 12 trabalhos prontos sobrevivem a catálogo provisório vazio e restauração concorrente, sem getters/OCR repetidos; mudança de hash confere só o documento alterado; catálogo confirmado vazio remove trabalhos.
- `pdf-single-transfer-browser.mjs`: Resident Evil de 25.937.122 bytes, páginas 1/11/22, zoom, rolagem, complemento independente, fechamento e download interrompido, em 1440/768/390 px. Uma requisição de mídia por abertura; nenhuma Range pela rede.
- `knowledge-observer.test.mjs`: consumidores compartilham requisição/polling; último fechamento aborta; troca de conta/permissão ignora resposta atrasada; hash/UID isolados; zero geração na leitura.
- `local-protection-browser.mjs`: três reloads locais com emuladores desligados selecionam demo e param antes do SDK, sem tentativa externa. Configuração mista e prévia na porta errada são recusadas por testes.
- Regressões de documentos separados, falhas/retentativas, cota Gemini, corrida de consulta/revogação, descrições e 17 consultas reais de Duelo/Resident Evil/Dead by Daylight/OCR inglês passaram.
- OCR real de Sina da Sociedade: 24 páginas legíveis, zero falhas, cancelamento/retomada e reutilização após reload. Nenhuma chamada Gemini real.

Artefatos ignorados: `test-output/firestore-fixes/after.json`, `postchecks.json`, `local-protection.json`, logs de testes e cobertura das regras. Os roteiros `measure-after.mjs` e `postchecks-after.mjs` usam Auth 9189, Firestore 8189, servidor 4186 e recusam outros destinos. O relatório original mantém a definição dos contadores e os resultados anteriores.

## Limite da conclusão histórica

Essas correções demonstram reduções nos cenários locais; não atribuem as 38 mil leituras históricas a uma causa. O novo print mostra aproximadamente 41 mil acumuladas e uma subida principal entre 13h e 16h no eixo exibido. A data/fuso do gráfico, recargas efetivamente recebidas, abas, usuários e versão ativa naquele período ainda precisam ser confirmados para uma correlação temporal. Não foi feita nova consulta remota para completar essa informação.
