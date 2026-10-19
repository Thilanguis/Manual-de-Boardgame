# Ficha completa e duração — 18/10/2026

Atualização posterior: [cadastro, ficha e regras na mesma preparação](FLUXO-FICHA-REGRAS-2026-10-18.md) integra as fontes públicas à mesma geração e vincula o resultado ao salvar. Os números abaixo registram a etapa anterior.

Complementa a [auditoria anterior](AUDITORIA-FICHA-QUALIDADE-2026-10-18.md). Correções locais; nenhuma publicação ou operação em dados reais.

## Defeitos reproduzidos

1. O schema exigia `metadata`, mas nenhum de seus campos era obrigatório. Uma descrição válida bastava para considerar o resultado reutilizável e impedir a atualização explícita dos campos restantes.
2. Uma resposta com duração fixa em apenas um dos limites era descartada como faixa incompleta. A normalização de sugestões também conservava somente um limite e recusava extremos invertidos.
3. Ao aproveitar o índice no cadastro, a consolidação podia preencher a edição. A comparação com a identidade capturada antes da leitura então interrompia o fluxo antes da chamada de IA. O teste no navegador reproduziu zero gerações e estado parado em “Lendo…”.

Os quatro casos iniciais de `tests/complete-profile.test.mjs` falharam antes das correções: schema incompleto, duração única descartada, normalização parcial e ausência de distinção entre ficha parcial e completa. Os oito testes atuais passam, incluindo recuperação de um extremo omitido quando o intervalo completo está escrito na evidência.

## Comportamento corrigido

- A mesma geração já existente deve examinar os **11 campos** do formulário: título, edição, descrição, jogadores mínimo/máximo, duração mínima/máxima, idade, categorias, mecânicas e tipo. Cada chave é obrigatória no contrato e admite `null` quando não há evidência. O idioma continua representando o PDF verdadeiro.
- As instruções adicionadas são da ficha. Não foram alterados tópicos, quantidade, formato editorial ou lógica das seções de regras.
- O resultado registra os campos examinados (`profileAnalysis`, versão 3). Uma descrição isolada do contrato antigo não bloqueia mais a atualização explícita. Abrir ou recarregar não inicia IA. Cota, autorização, deduplicação e preservação de correções continuam vigentes.
- Uma ficha antiga que já contém os 11 fatos válidos é reutilizada, mesmo sem o marcador novo. Uma análise nova que examinou tudo e concluiu legitimamente pela ausência de fatos também é reutilizada; não existe ciclo de geração para preencher o que as fontes não informam.
- Duração fixa comprovada de **90 minutos → 90/90**; intervalo **60–120 → 60/120**; extremos invertidos são ordenados. A evidência permanece ligada à fonte/página. Um limite expressamente aberto (“no mínimo 90 minutos”) não é transformado em duração fixa.
- Digitar uma duração em um dos inputs e sair dele preenche o outro, caso esteja vazio. Um valor já existente ou uma correção manual não é sobrescrito automaticamente. O texto de ajuda foi atualizado.
- Fatos de identidade preenchidos sincronamente pela própria consolidação do índice são incorporados antes da requisição. Mudanças externas de título, edição ou PDF durante operações pendentes continuam invalidando a resposta.
- A verificação do cache do rascunho considera a identidade recontextualizada com provas do mesmo documento. Uma edição preenchida pela própria análise não provoca outra geração no clique seguinte.
- A versão do cache estático foi atualizada para distribuir os módulos corrigidos quando houver publicação autorizada.

## Validação isolada

### Cadastro completo no navegador

`tests/complete-profile-browser.mjs` usa o aplicativo, PDF.js, sintetizador/validadores do Worker, consolidação, formulário e IndexedDB reais. O PDF é sintético e a resposta do provedor é explicitamente simulada. Toda rede externa é bloqueada.

Quatro fluxos verificam os 11 campos nos inputs e no registro salvo: duração fixa entregue somente pelo mínimo, somente pelo máximo, intervalo normal e intervalo invertido. Foram conferidos avanço/retorno de etapa, idade corrigida para 16, preenchimento manual de duração 75/75, salvamento e recarga. Há **uma geração simulada por fluxo**, mesmo repetindo Completar informações. Um cenário preenche edição pelo índice; outro, pelo Gemini simulado.

O teste do Worker reproduz uma ficha antiga com somente descrição e uma regra corrigida: abrir não gera, o clique explícito atualiza uma vez e conserva a regra. O clique seguinte reutiliza o resultado completo. Outro caso confirma que uma ficha antiga já completa não consome cota para ganhar o marcador novo.

### Regressões

- Aplicativo: **192/192** testes.
- Worker: **93/93** testes.
- Segurança: **27/27**, somente Auth/Firestore Emulators `demo-acervo`.
- Navegador: quatro cadastros completos; Descent inglês real com Gemini simulado e catálogo gravado; oito casos de disponibilidade/invalidação; cache e três identidades modificadas durante resposta pendente; consenso e correções manuais.
- OCR local real: página 2 de Descent recuperada, outras 31 intactas, checkpoint reutilizado; zero chamadas externas.
- Layout da ficha em desktop, tablet e celular verificado pelo teste anterior reexecutado.
- Sintaxe, build estático e bundle local do Worker com `--dry-run`.

Logs e evidências descartáveis: `test-output/complete-profile-before.log`, `test-output/complete-profile-root.log`, `test-output/complete-profile-worker.log`, `test-output/complete-profile-security.log`, `test-output/complete-profile/browser.json` e logs individuais de navegador. Emuladores encerrados ao terminar a suíte.

## Limites da comprovação

O contrato e o caminho até os campos/salvamento foram comprovados com respostas controladas. **Não foi executada geração Gemini real nem consultado o registro privado do clique fotografado.** Não é possível atribuir retrospectivamente todos os campos vazios desse clique a uma única causa, nem garantir que o modelo real encontrará fatos ausentes do manual e dos catálogos disponíveis.

O sistema deve tentar todos os campos e aproveitar os dados sustentados pelas fontes; continua proibido inventar idade, duração ou edição. Regras e correções manuais permanecem preservadas. Estas alterações não acrescentam consultas Firestore: a cobertura é verificada sobre o conhecimento já carregado. Frontend e Worker precisam receber os arquivos corrigidos em publicação futura autorizada.

O schema usa campos obrigatórios e objetos anuláveis conforme o [contrato oficial de Schema do Gemini](https://ai.google.dev/api/generate-content#Schema). Não foi ativada integração, serviço pago ou busca adicional do provedor.
