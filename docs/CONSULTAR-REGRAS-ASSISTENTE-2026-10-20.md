# Consultar regras e assistente contextual — implementação local

Escopo: somente Consultar regras. Conferir informações, ficha Gemini, cadastro,
campos, permissões de edição e conectores de metadados continuam com seu fluxo
existente. Nenhum commit, push, deploy ou alteração de produção foi executado.

## Leitura

- Projeção descartável com títulos, parágrafos, listas, sequências explícitas,
  avisos e exemplos; DOM seguro, sem executar HTML dos PDFs ou do modelo.
- Preserva índice original, texto, traduções, citações, documento, hash e página.
- Layout v4 organiza colunas e títulos largos em faixas. Margens recorrentes são
  avaliadas em lotes de até oito páginas, limitando a memória.
- Microtexto de cartas/diagramas não vira regra corrida. A prévia informa a
  limitação e permite abrir o PDF; tabelas textuais permanecem literais.
- Pesquisa, classificação, deduplicação, guias publicados e tradução existente
  continuam disponíveis sem Gemini. Documentos de outra edição e expansões são
  identificados. O assistente recusa documento incompatível com a edição aberta.
- Corrigida também a corrida entre o evento de fechar um diálogo e reabri-lo.

## Assistente

`POST /v1/games/:id/rule-question`, anunciado por `ruleAssistantProtocol: 1`.
Somente pergunta explícita inicia a operação. Abrir consulta, abrir painel,
navegar por assuntos e pesquisar tradicionalmente não geram IA.

Atualização de 25/10/2026, a pedido do proprietário: o Worker confirma o perfil
efetivo no Firestore e aceita qualquer conta aprovada, inclusive leitor comum,
independentemente das flags adicionar/editar. Visitante, pendente, rejeitado,
bloqueado e UID divergente não recebem autorização. A checagem é repetida antes
da geração e do resultado. Isso não concede permissão para editar cadastros.

O contexto inclui jogo, título, edição, assunto, documento e página. O servidor
carrega índices autorizados, valida vínculos e hashes e seleciona no máximo 12
passagens. FAQ/errata compatíveis participam; expansão não é incorporada ao jogo
base. Texto enviado pelo cliente nunca serve como evidência.

O Gemini explica os trechos recuperados e retorna IDs de evidências. O servidor
anexa o texto original da referência, sem pedir à IA que recopie citações. IDs
inventados continuam rejeitados; respostas legadas com citações explícitas
precisam coincidir com o texto, tolerando somente espaços e quebras de linha.
Documento, hash, página,
URL e licença vêm do servidor, não de números inventados pelo modelo. Conflito
exige pelo menos duas referências; o modelo é instruído a não decidir a
divergência silenciosamente. Essa validação comprova procedência textual,
não é uma prova automática de toda interpretação semântica da resposta.

O botão de referência abre a página exata no leitor existente. Perguntas de
acompanhamento permanecem na mesma conversa privada. Fechar, cancelar, mudar
sessão/título/edição/PDF descarta a resposta pendente na interface. O servidor
também confere novamente a identidade antes de devolver o resultado.

### Fluxo visual da conversa

Pesquisar nos PDFs continua sendo uma consulta independente, sem chamada Gemini
ao digitar. O botão superior Perguntar ao Gemini envia a pergunta diretamente e
troca a área de resultados pela conversa, com um único campo de acompanhamento.
Se uma pergunta já estiver escrita e o usuário acionar o assistente em um trecho,
ela é enviada sem precisar ser digitada ou submetida uma segunda vez.

A última resposta fica em destaque; mensagens anteriores e fontes começam
recolhidas. A interface distingue interpretação da IA, base em PDF/internet e
consulta externa realmente realizada. Erros pertencem à pergunta atual; uma
repetição explícita substitui a tentativa falha, sem misturar o erro à resposta
anterior. Voltar à pesquisa restaura a consulta dos PDFs.

Perguntas de acompanhamento como "eles" ou "isso" reutilizam o contexto das
perguntas recentes para recuperar evidências. A explicação anterior da IA não
é tratada como regra nem substitui os textos dos documentos.

## Configuração e consumo

Configuração **local inspecionada**, sem consulta ao painel ou às cotas reais do
provedor: modelo principal `gemini-3.5-flash-lite`; descoberta de nomes existente
`gemini-2.5-flash-lite`; geração da ficha sem limite interno diário/minuto;
descoberta com limite de uma execução por análise. Esses mecanismos não mudaram.

As perguntas usam o modelo principal já configurado. A atualização de 25/10
remove as cotas internas de 10/30 chamadas diárias, o teto de quatro perguntas
por conversa e os tetos de concorrência por conta e global. Contadores antigos
não são consultados ou incrementados; sua limpeza por expiração continua normal.
Somente a mesma pergunta simultânea da mesma conta é deduplicada.

Permanecem os limites técnicos de cada requisição:

| Controle                           | Limite local novo              |
| ---------------------------------- | ------------------------------ |
| Pergunta                           | 1.000 caracteres               |
| Contexto serializado               | 24.000 caracteres              |
| Evidências                         | 12 passagens                   |
| Resposta                           | 2.048 tokens                   |
| Timeout do fluxo completo          | 90 segundos                    |
| Cache privado de resposta/conversa | 24 horas                       |
| Cache privado de índices no Worker | 5 minutos, limitado em memória |

As quatro trocas mais recentes são retidas para o contexto da conversa, sem
impedir novas perguntas. Cache evita chamadas repetidas. Não há repetição
automática de falhas; limites retornados pelo Gemini são informados como erros
do provedor. Remover cotas do Acervo não muda o plano do Google: no Free Tier,
exceder a cota bloqueia requisições; no nível pago pode haver cobrança pelo uso.
O nível da chave não foi confirmado nesta atualização. Nenhuma configuração de
faturamento foi modificada. Referências: [cobrança](https://ai.google.dev/gemini-api/docs/billing)
e [limites do Gemini](https://ai.google.dev/gemini-api/docs/rate-limits).

Usa o binding `GAME_KNOWLEDGE` e SQLite existentes, com namespace separado de
fichas, histórico/cache por UID e limpeza de expiração por alarm. Não cria novo
banco, binding ou serviço. Requer `ALLOW_MANUAL_AI=true` já existente e a chave
Gemini configurada. Não foi habilitada nenhuma configuração em produção.

## Fontes externas: pesquisa complementar (27/10/2026)

Primeiro o assistente usa os índices dos documentos compatíveis. A recuperação
considera a raridade dos termos e aproxima plurais para não preencher o contexto
com fichas genéricas quando a pergunta trata de uma habilidade específica.

Quando a primeira explicação declara evidência insuficiente, o servidor planeja
uma pesquisa Google com `gemini-2.5-flash-lite` e `google_search`, usando a chave
existente. O modelo de explicação continua `gemini-3.5-flash-lite`. O 2.5 permite
usar grounding disponível no Free Tier; isso não modifica o plano nem garante
gratuidade caso o projeto já esteja no nível pago. Referências:
[preços](https://ai.google.dev/gemini-api/docs/pricing) e
[grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search).

A pesquisa recebe título, edição e pergunta, com as perguntas recentes como
contexto quando a mensagem é de acompanhamento. Não recebe PDFs, respostas
anteriores da IA, UID, hashes ou credenciais da conta do Acervo. Só segmentos associados a
`groundingSupports` e URLs HTTPS válidas participam da síntese final. O modelo
deve tratar exclusivamente do jogo físico, distinguindo videogames, edições e
expansões; fontes conhecidas do videogame Dead by Daylight são rejeitadas.

Os textos do grounding são identificados como **resumos de pesquisa**, não
transcrições literais da página ou regras oficiais por definição. A interface
mostra links e as sugestões do Google em iframe sem execução de scripts ou acesso
à origem da sessão. Não declara pesquisa se os metadados não confirmarem a
consulta. A procedência não comprova automaticamente toda interpretação semântica.

O fluxo pode fazer uma geração para os PDFs e, quando necessário, uma pesquisa
e uma síntese complementar. Não repete falhas em ciclo e não cria cotas de uso.
Falha de pesquisa ou síntese preserva a explicação parcial sustentada pelos PDFs.
Resposta insuficiente não fica presa no cache: nova tentativa explícita é
permitida. Cache privado de respostas completas e histórico por UID permanecem.
`RULE_ASSISTANT_WEB_SEARCH=false` permite desativar a etapa externa no servidor.

### Fontes oficiais já configuradas

Catálogos de metadados não são tratados como autoridade sobre regras específicas.
Quando a recuperação do PDF não apresenta evidência direta suficiente, existe
um adaptador de fontes oficiais autorizadas, configurado opcionalmente no Worker
por `RULE_ASSISTANT_OFFICIAL_SOURCES`:

```json
[
  {
    "gameId": "ID-DO-JOGO",
    "edition": "EDIÇÃO-CONFIRMADA",
    "name": "FAQ oficial autorizado",
    "url": "https://editora.example/faq",
    "official": true,
    "reuseAllowed": true,
    "license": "Permissão ou licença previamente conferida"
  }
]
```

O navegador não fornece URLs. O servidor aceita apenas registros explícitos,
HTTPS sem redirecionamentos, mesma identidade/edição e permissão de reutilização.
Limita a três páginas, respostas de até 100 KB e seis passagens externas.
Falhas, indisponibilidade e ausência de correspondência são informadas.

A validação automatizada usa HTTP e Gemini simulados. A conferência dos dois
documentos reais do cadastro foi somente leitura; a pesquisa da investigação
encontrou uma página da própria Level 99 sobre a Artista:
[Malicious Expansion Preview](https://www.level99games.com/blogs/news/malicious-expansion-preview-jonah-the-artist).
Isso não significa que o novo fluxo já foi publicado ou executado com a chave
real: essas etapas dependem da autorização de publicação e validação.

## Rascunho de guia

A ação opcional de aproveitar explicação não foi exposta. O repositório legado
mantém rascunhos, mas a interface atual removeu seu editor e publicação. Criar
rascunhos sem uma revisão/publicação acessível deixaria conteúdo sem fluxo de
revisão. Respostas continuam privadas; nenhuma é publicada automaticamente.

## Validação e evidências

Tudo abaixo é local. Testes Node bloqueiam fetch externo; navegador bloqueia
serviços fora do servidor de testes; Firestore usa `demo-acervo` em emuladores.
Não houve Gemini real, escritas no Drive/Firebase real ou deploy nesta atualização.

- `tests/rule-reading.test.mjs`: listas, números sem sequência, exceções,
  alfabetos válidos, corrupção, tabela, margens e título largo. Inclui regressão
  de página simples com título grande para não ocultar seu corpo como microtexto.
- `worker/test/rule-assistant.test.mjs`: autorização, cache privado, acompanhamento,
  identidade alterada durante geração, concorrência, cancelamento, timeout,
  orçamento exclusivo, fontes oficiais simuladas e citações inválidas.
- `worker/test/api.test.mjs`: chamada HTTP direta de leitor/visitante recusada.
- `worker/test/manual-knowledge.test.mjs`: somente a consulta nova aproveita as
  páginas legíveis de um índice parcial; a geração da ficha conserva seu critério.
- `tests/knowledge-durable.mjs`: SQLite real local, reinício, orçamento/cache
  persistidos, histórico privado e invalidação de identidade.
- `tests/rule-assistant-browser.mjs`: painel, pergunta/follow-up/cache, 429/503,
  cancelamento, referência aberta no leitor real, revogação, troca de edição,
  usuário comum e subadministrador sem edição; desktop/tablet/celular.
- `tests/rule-assistant-real-evidence.mjs`: recuperação do Worker nos quatro
  índices reais, contexto limitado, hash e citação literal na página original;
  explicação simulada somente para conferir o vínculo, sem inferir qualidade da IA.
- `tests/rule-reading-browser.mjs`: hierarquia, listas, sequência, exceção,
  exemplo, tabela, traduções EN/FR **simuladas**, vários documentos e leitor sem IA.
- `tests/rule-quality-real-browser.mjs`: PDFs reais locais de Duelo pela Terra
  Média, Resident Evil, Dead by Daylight e Zombicide, 17 consultas com páginas
  esperadas, OCR previamente salvo, colunas e diagramas; texto original intacto.
  Também confere tradução disponível **simulada** vinculada ao OCR inglês real.
- `tests/documents-browser.mjs`: PDFs sintéticos de 13/60/8 páginas, nomes,
  progresso individual, consulta, recarga, substituição, principal e remoção.
- `tests/rule-loading-browser.mjs` e `tests/rule-query-race-browser.mjs`: legado,
  conhecimento armazenado, reabertura e invalidação de respostas atrasadas.
- `tests/information-stage2-browser.mjs`: regressão da etapa 2 preservada,
  11 campos, seis origens e correções manuais, com serviços simulados.

Imagens e relatórios ficam em `test-output/rule-quality/` e
`test-output/rule-assistant/` (ignorados pelo Git). A aparência foi inspecionada
visualmente. Qualidade de resposta Gemini em produção, disponibilidade real de
fontes oficiais e qualidade de OCR/tradução novos não foram comprovadas por mocks.
O assistente reutiliza índices/OCR existentes; não executa OCR novo ao perguntar.

Suítes finais aprovadas: **233 testes do frontend, 167 do Worker e 33 de regras
Firestore**, além dos cenários de navegador e persistência descritos acima.
Sintaxe/cache PWA, build estático e bundle Worker em `--dry-run` aprovados.

### Revisão da conversa e pesquisa complementar — 27/10/2026

A revisão local mais recente passou em **268 testes do frontend e 196 do
Worker**. Os testes de navegador usam respostas simuladas em desktop, tablet e
celular: envio único pela busca ou pelo trecho, acompanhamento, histórico e
fontes recolhidos, indicação de consulta externa, erro vinculado à pergunta
atual, repetição explícita sem duplicar a tentativa e retorno à pesquisa dos PDFs.

Oito cenários com os índices locais de Dead by Daylight conferem sacrifício e
Artista/corvos nos dois documentos, independentemente de sua ordem. O guia
atual tem a ficha da Artista na página 29; as interações do manual principal
aparecem nas páginas 12 e 14. Referências fornecidas pelo servidor preservam o
texto do índice. Citações explícitas adulteradas continuam recusadas. A
recuperação de acompanhamento conserva o assunto das perguntas anteriores.

Esta revisão de conversa e pesquisa complementar ainda requer publicação de
frontend e Worker compatíveis e um teste autorizado com Gemini real. Os testes
simulados não comprovam a qualidade da resposta nem a disponibilidade real da
pesquisa Google para a chave em produção.
