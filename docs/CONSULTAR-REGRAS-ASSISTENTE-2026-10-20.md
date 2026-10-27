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

Uma única chamada ao Gemini explica os trechos recuperados. Cada bloco precisa
de citação literal localizada em uma evidência enviada. Documento, hash, página,
URL e licença vêm do servidor, não de números inventados pelo modelo. Conflito
exige pelo menos duas referências; o modelo é instruído a não decidir a
divergência silenciosamente. Essa validação comprova procedência textual,
não é uma prova automática de toda interpretação semântica da resposta.

O botão de referência abre a página exata no leitor existente. Perguntas de
acompanhamento permanecem na mesma conversa privada. Fechar, cancelar, mudar
sessão/título/edição/PDF descarta a resposta pendente na interface. O servidor
também confere novamente a identidade antes de devolver o resultado.

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
| Timeout da recuperação/geração     | 30 segundos                    |
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

## Fontes externas: capacidade e limite real

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

**Nenhuma fonte real foi cadastrada ou consultada nesta tarefa.** A validação
externa usou HTTP e conteúdo simulados. Não há pesquisa geral na web, Google
Search Grounding nem fallback que simule pesquisa usando memória do modelo.
Se o modelo considerar insuficientes trechos que a recuperação classificou como
diretos, informa insuficiência; não dispara uma segunda geração automática.

## Rascunho de guia

A ação opcional de aproveitar explicação não foi exposta. O repositório legado
mantém rascunhos, mas a interface atual removeu seu editor e publicação. Criar
rascunhos sem uma revisão/publicação acessível deixaria conteúdo sem fluxo de
revisão. Respostas continuam privadas; nenhuma é publicada automaticamente.

## Validação e evidências

Tudo abaixo é local. Testes Node bloqueiam fetch externo; navegador bloqueia
serviços fora do servidor de testes; Firestore usa `demo-acervo` em emuladores.
Não houve Gemini real, operações no Drive/Firebase real ou deploy.

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

Para ativar no ambiente real será necessário publicar frontend e Worker
compatíveis; nenhuma publicação foi executada nesta tarefa.
