# Acervo 1.6.0 — contas, cadastro e biblioteca

Revisão de qualidade de 14/10/2026. Foram reaproveitados os formulários e métodos Firebase existentes, o repositório, o leitor PDF.js, os guias e os conectores autorizados. Não foi criado outro sistema de login nem adicionada dependência, serviço ou faturamento.

## Contas e acesso público

Login com e-mail e senha é a primeira opção. **Criar conta grátis** tem botão próprio; **Esqueceu a senha?** permanece legível e acessível ao toque. Google aparece depois, separado visualmente, como alternativa. O parâmetro público opcional `enableGoogleLogin: false` em `config/app-config.js` oculta login/vínculo Google em instalações que não habilitaram esse provedor; o padrão preserva a opção existente. O provedor também precisa estar habilitado no Firebase para funcionar. O cadastro por senha não depende dele.

Os formulários têm títulos específicos, foco nos campos, autocomplete, orientações, carregamento e erros compreensíveis. A recuperação mantém a mensagem neutra para não informar a existência de uma conta. Nome, e-mail, tipo de acesso, situação e métodos vinculados substituem o UID como conteúdo principal de **Minha conta**. O UID continua intacto e só aparece ao abrir **Informações técnicas para suporte**, com ação de copiar. O vínculo Google fica recolhido como recurso opcional. Logout continua disponível e identificado.

Cadastro continua `pending/user`, com todas as permissões administrativas desligadas. Aprovação, cargos, bloqueios e UID proprietário mantêm as mesmas regras. Leitura pública continua disponível sem conta. Nenhum perfil existente foi migrado ou alterado pela revisão visual.

## Cadastro em três etapas

1. **Identificar jogo:** selecionar PDF, conferir capa/título, escolher alternativas e revisar fontes complementares/OCR. A pesquisa manual BGG fica numa seção recolhida, separada dos conectores automáticos.
2. **Conferir dados:** resumo, jogadores, duração mínima/máxima, idade, tipo, categorias, mecânicas, idioma e edição.
3. **Publicar:** resumo dos dados, visibilidade, origens e confirmação antes de salvar.

Voltar entre etapas preserva os mesmos campos no DOM; não reabre formulários nem reinicia o rascunho. Avançar valida os dados. Salvar só aparece na etapa final. Botões ficam fora da área rolável e etapas não mudam durante o salvamento. No celular, capa/controles aparecem na identificação e cedem espaço aos dados nas etapas seguintes. O envio retomável ao Drive, os arquivos e sua finalização continuam os mesmos.

A visibilidade explica a política efetiva: se a biblioteca inteira estiver pública por configuração global, desmarcar a publicação individual não torna o jogo privado. Na biblioteca local, a opção não publica arquivos na internet.

## Duração sem perda de dados

Novos campos: `minDurationMinutes` e `maxDurationMinutes`, inteiros de 1 a 1440, preenchidos juntos ou ambos nulos. O mínimo não pode superar o máximo.

- `60` e `120` aparecem como **60–120 min**; o campo legado `durationMinutes` fica nulo, sem calcular uma média.
- `45` e `45` aparecem como **45 min**; `durationMinutes` também recebe 45 para compatibilidade.
- Jogos antigos sem os novos campos continuam usando `durationMinutes` como mínimo e máximo. Não há migração em lote. Ao editar e salvar, o par é acrescentado sem perder o valor.
- Limpar explicitamente os dois campos deixa duração desconhecida; o valor antigo não reaparece por fallback.
- **Até 30 min** exige que a duração máxima confirmada seja até 30. Um jogo de 30–60 min fica fora. A ordenação crescente usa primeiro o mínimo, depois o máximo; desconhecidos ficam no fim.

Formulário, edição, Firestore, cards, destaque, detalhes, filtros, ordenação e revisão de sugestões usam o par. A extração reconhece faixas em português, inglês e francês, inclusive 1–2 horas como 60–120 minutos. Durações distintas de cenários/edições continuam sem uma escolha arbitrária. Fontes que só declaram um valor fornecem uma sugestão fixa, sem inventar intervalo. O conector BGG preparado respeita mínimo/máximo explícitos quando autorizado; ele continua desativado sem as credenciais exigidas.

A alteração de `firestore.rules` é limitada aos novos campos e sua consistência com o legado. Papéis, aprovação, auditoria e autorização do Drive não foram relaxados. Regras precisam estar publicadas antes do novo frontend para aceitar intervalos.

## Títulos e preenchimento

Metadados/nomes `.indd`, `.idml` e outros títulos de editoração são rejeitados como sugestões e como novo título salvo. Um cadastro antigo com nome técnico aparece como **Título a revisar**, sem exibir o nome de arquivo como título de capa/destaque. A equipe vê **Revisar título** e alternativas no editor. O destaque usa um jogo com título utilizável; se só há cadastros em revisão, oferece explorar a biblioteca.

O registro público com `ZMGPSM0101 v1.0.indd` foi identificado na inspeção. O código editorial permite oferecer **O Senhor dos Anéis: Sina da Sociedade** no editor. Para corrigi-lo: **Revisar título → Editar informações → escolher a alternativa → conferir dados → Publicar → confirmar e salvar**. O título armazenado não foi trocado automaticamente; títulos já revisados não são substituídos em segundo plano.

Foram ampliadas expressões de duração, idade e termos explícitos de mecânicas PT/FR/EN. A evidência e, quando identificada, a página física ficam disponíveis. Dados confiáveis do PDF não são sobrescritos por sugestões divergentes sem confirmação; limites de duração são escolhidos em conjunto. A conversão de duração antiga preserva sua origem quando o número não muda.

Continuam ativos Wikidata e Wikipédia. Ludopedia/BGG ainda dependem das autorizações descritas em [Fontes de reconhecimento](FONTES-RECONHECIMENTO.md). OCR segue local, limitado às primeiras páginas, com revisão. Não há tradução automática, invenção de regras ou nova integração simulada.

## Biblioteca, detalhes e acessibilidade

O tema escuro, vermelho e capas foi preservado. O destaque ficou mais compacto; a biblioteca aproveita melhor monitores grandes, com grade adaptável e cards proporcionais. Busca/filtros, botões de toque, contraste e tamanhos de texto foram refinados. Carregamento é separado do estado de biblioteca vazia. Erros de capa não impedem consultar os registros.

Detalhes organizam edição, resumo, jogadores, intervalo de duração, idade, idioma, tipo, categorias e mecânicas. **Manual completo**, **Aprender a jogar** e **Consulta rápida** permanecem disponíveis. Uma consulta explica se o guia não foi publicado ou foi criado para outro PDF; isso não bloqueia o manual oficial. O estado da fonte/atribuições permanece acessível.

Padrões da revisão ficam em `styles/interface.css`, carregado depois do CSS existente. Contas e etapas foram separados em `js/account-panel.js` e `js/game-steps.js`, sem framework. Foram conferidos foco de teclado, diálogos, texto legível, controles de toque e reflow até 320 px. A revisão visual não equivale a uma certificação completa de acessibilidade por leitor de tela ou a testes em todos os aparelhos reais.

## PWA e validação

O Service Worker muda para `acervo-v1.6.0` e inclui os novos módulos/CSS. A instalação busca o shell com `cache: reload`, evitando reaproveitar HTML/JS antigos do cache HTTP. A ativação ainda depende da ação **Atualizar**. Se há edição, upload ou autenticação em andamento, os dados são preservados e a ação de atualizar continua disponível para depois de concluir/cancelar.

Verificações automatizadas:

| Fluxo                                | Como foi verificado                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cadastro por e-mail/senha sem Google | Firebase Auth/Firestore emulados, opção Google oculta no teste; conta criada como pending, sem privilégios                                 |
| Login e logout                       | Interface real com Firebase Auth emulado; erro de senha legível e novo login                                                               |
| Recuperação                          | Solicitação pelo formulário, código gerado pelo Auth emulado, troca de senha aplicada e login com a senha nova; nenhum e-mail real enviado |
| Aprovação/bloqueio                   | Contas distintas, contador/notificação em tempo real, promoção, subadmin, bloqueio imediato e auditoria                                    |
| Minha conta                          | Nome/e-mail/cargo/status/provedor conferidos; UID recolhido; copiar testado com clipboard isolado                                          |
| Duração 60–120                       | PDF sintético com intervalo, etapas, salvamento no IndexedDB e Firestore emulado, exibição em card/destaque/detalhes                       |
| Compatibilidade                      | Jogos com `durationMinutes: 30/45`, edição e origem preservadas; valores inválidos e incoerentes negados pelo Firestore                    |
| Título `.indd`                       | Importação e salvamento recusam nome técnico; cadastro antigo só é corrigido ao confirmar/salvar a alternativa                             |
| Filtro/ordenação                     | Até 30 usa máximo, intervalos longos excluídos, mistura de legado/novo e duração desconhecida                                              |
| Responsividade                       | Login/cadastro/recuperação/perfil em desktop, tablet e celular; publicação até 320×640 sem rolagem horizontal e botão salvar visível       |
| Regressões                           | Leitor, texto/páginas/zoom, substituição de PDF, favoritos, guias/índice, imagens, rascunho/publicação e pesquisa progressiva              |
| Atualização PWA                      | Chrome isolado com cache HTTP de 24 h; edição preservada, atualização do HTML e JavaScript comprovada, cache anterior removido             |

108 testes automatizados de unidades/regras (47 frontend/OAuth local, 42 Worker, 19 Firestore) passaram, além das suítes de navegador e builds. Fixtures, screenshots e relatórios brutos ficam em `test-output/`, fora do Git e da publicação.

Authentication/Firestore completos foram testados em `demo-acervo`; isso não cria usuários de produção nem exercita um popup Google real. O upload central não foi refeito com arquivos particulares: o código de envio foi preservado e suas regressões continuam passando. As fontes externas podem continuar incompletas quando não houver dados autorizados, e o usuário deve confirmar o título antigo no editor. Spark, Workers Free, Drive existente e GitHub Pages permanecem a infraestrutura, sem novos serviços pagos ou credenciais.

### Correção 1.6.1 — pesquisa e etapa 2

A pesquisa apresentava sugestões na identificação, mas avançar deixava o formulário sem indicar que elas ainda aguardavam confirmação. Agora a etapa 2 mostra resultados pendentes com um atalho para revisá-los. “Usar campos na etapa 2” aplica os campos selecionados e leva diretamente ao formulário preenchido, com indicação do que foi aproveitado. Uma seleção vazia não pode mais ser apresentada como aplicação bem-sucedida. Erros de validação ficam visíveis na revisão; dados conflitantes continuam exigindo seleção explícita.

O teste `tests/research-transfer-browser.mjs` utiliza o `app.js` real, PDF sintético e armazenamento IndexedDB real; somente o conector externo recebe uma fixture. Em desktop e celular, verificou resumo, duração fixa de 75 minutos, substituição confirmada por faixa 60–120, categorias, resumo da publicação e valores após salvar/recarregar/reabrir. A pesquisa progressiva e o cancelamento também foram verificados. Não houve alteração no upload, nas permissões ou no leitor PDF.
