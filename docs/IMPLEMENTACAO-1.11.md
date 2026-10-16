# Acervo 1.11 — ficha, conhecimento e regressões

Implementação local de 16/10/2026. Sem commit, push, deploy, migração ou alteração de dados/regras de produção.

## Interface

A ficha mantém a capa e os dados, com três ações principais: **Ler manual**, **Como jogar** e **Buscar regras**. Favoritar continua como ação auxiliar. A descrição é limitada visualmente a quatro linhas; Ver mais/Ver menos só aparece quando necessário. O texto completo permanece no cadastro. A capa não acompanha a altura da descrição.

**Documentos** é uma seção recolhida de leitura. Um único PDF mostra Manual principal, idioma e páginas, sem outro botão de abertura. Vários documentos mostram nomes amigáveis, tipo, idioma e páginas, permitindo escolher o PDF. Não há OCR, formulários ou manutenção nessa seção.

**Gerenciar jogo** reúne exatamente três áreas recolhidas:

- **Informações:** edição do cadastro, revisão do conhecimento, sugestões para os campos e atualização explícita da IA. A exclusão do jogo continua aqui, exclusiva do proprietário.
- **Documentos:** adicionar, substituir, renomear, classificar, alterar principal e remover; estados da preparação, pausa, retomada e recuperação de erros reais.
- **Guia:** único acesso ao editor didático, que mantém imagens, trechos dos PDFs, referências, Salvar rascunho, Pré-visualizar e Publicar guia.

Como jogar lê exclusivamente o guia publicado. Não carrega o índice/OCR para abrir um guia, nem oferece Editar rascunho ou manutenção. A ausência de guia é informada discretamente. Os cards não mostram contadores de documentos preparados.

## Geração e persistência

Depois do primeiro salvamento de um jogo no Firebase, o frontend solicita a geração sem aguardar a IA para fechar o cadastro. Uma edição comum do cadastro não repete a geração. PDFs e leitura independem da IA.

O novo endpoint autenticado `GET/POST /v1/games/{id}/knowledge` resolve o jogo no Firestore com o JWT do solicitante e valida seu perfil atual. Leitores autorizados podem consultar; somente quem pode editar gera novamente ou revisa. Uma conta com permissão apenas de adicionar pode solicitar a geração inicial do próprio cadastro. Visitantes, pendentes, bloqueados e leitores sem edição não geram IA.

O backend consulta Wikidata e Wikipédia em paralelo, com prazos curtos e cache existente. O acesso de fundo ao Wikidata respeita `maxlag=5`. Um artigo completo só é consultado pela API oficial após ser identificado como artigo do jogo. Títulos homônimos, expansões incompatíveis e edições contraditórias são descartados. A primeira versão utiliza essas fontes com licenças abertas; não envia descrições de catálogos restritos à IA sem verificar autorização de reutilização.

O Gemini recebe apenas título, edição e fatos/textos obtidos nessas fontes públicas. **Não recebe PDF, OCR, hash do PDF, descrições privadas do cadastro, perfil, UID, e-mail, tokens Firebase ou credenciais do Drive.** Não há ferramentas, upload de arquivos ao Google, Google Search grounding ou consulta ao modelo em cada busca.

O resultado passa por um contrato JSON: PT-BR, assuntos permitidos, tamanhos limitados e referência a uma fonte realmente consultada, com uma citação literal verificável. Referências inventadas e seções sem evidência são rejeitadas. Regras específicas exigem fonte que confirme a edição; quando ela não for confirmada, o conhecimento fica restrito ao contexto geral e as lacunas são registradas. A verificação de uma citação não equivale a comprovar toda a explicação: o conteúdo continua identificado como IA não confirmada até a revisão humana.

São preservados título, edição, data, modelo, versão, originais, idiomas, identificadores públicos, URLs, licenças, histórico de autores e decisões por seção. Não há publicação automática de guia. Importar uma sugestão no editor cria uma seção não revisada, sem inventar página de PDF.

### Controle persistente no Worker

O binding **GAME_KNOWLEDGE**, classe **KnowledgeStore**, usa um Durable Object com SQLite. Ele guarda conhecimento, revisões, deduplicação e cota. Não utiliza uma coleção Firestore gravável pelo cliente para controlar as chamadas: isso permitiria ao cliente alterar o controle da própria cota.

O jogo continua no Firestore, os PDFs/capas no Drive e os índices na arquitetura existente. O objeto só é alcançado pelo binding interno; todas as rotas públicas passam pela autorização do Worker. A leitura nunca aceita um ID como autorização. Chaves de controle e leases não são expostos na resposta do endpoint.

A identidade inclui ID do jogo, título, edição e tipo. Se a edição estiver desconhecida, inclui também o hash do manual para separar contextos. O hash não vai ao Gemini. Trocar o manual ou a edição não transforma conhecimento de outra versão em conteúdo confirmado.

- Uma transação persistente reserva a geração antes de chamar o provedor.
- Oito solicitações concorrentes para o mesmo contexto produzem uma única reserva.
- Ler, pesquisar, abrir guia, trocar de usuário e recarregar não iniciam geração.
- Uma atualização explícita tem identificador idempotente e preserva textos aceitos, corrigidos ou rejeitados. A versão evita que uma revisão antiga sobrescreva outra.
- Falha, interrupção ou resposta incerta não geram novas tentativas automáticas. Uma execução interrompida expira para um estado de atenção; o administrador decide uma nova tentativa.
- O limite interno é **cinco inícios por dia UTC e dois por minuto**, para todo o projeto. A cota do Google pode ser menor. Uma tentativa que falha também ocupa a reserva interna, protegendo o serviço contra repetição.
- Sem chave ou binding, o cadastro funciona e a geração aguarda configuração. Não há loop de tentativas. Após configurar, os jogos pendentes podem ser gerados em Informações; recarregar não consome a API.
- O processamento tem um prazo global de 26 segundos, com fontes em paralelo e timeout de 18 segundos na chamada do modelo, para caber no processamento de fundo do Worker. Falhas são registradas; não há fallback pago.

O modelo fixado é `gemini-3.8-flash`, listado com entrada e saída gratuitas na [tabela oficial da Gemini API](https://ai.google.dev/gemini-api/docs/pricing), consultada em 16/10/2026. Uma mudança futura de modelo ou das condições requer nova conferência; o código não escolhe automaticamente outro modelo. Durable Objects SQLite estão disponíveis no [Workers Free](https://developers.cloudflare.com/durable-objects/platform/pricing/), com cotas próprias. Esta implementação não altera o plano da conta.

## Revisão e busca

Informações oferece as sugestões realmente encontradas, seleção individual e Selecionar todos. Somente após confirmação elas vão ao formulário da etapa 2. Descrição, jogadores, duração mínima/máxima, idade e taxonomias mantêm a fonte. Valores contraditórios não são escolhidos automaticamente. Os demais campos do cadastro permanecem intactos. O salvamento continua exigindo confirmação do administrador.

As seções do conhecimento podem ser aceitas, corrigidas ou rejeitadas. Salvar uma seção preserva edições ainda não salvas nas demais. A atualização da IA preserva correções e rejeições já guardadas.

Buscar regras pesquisa localmente o conhecimento armazenado, todos os índices disponíveis e o guia publicado, com relevância e sinônimos de assuntos em português, inglês e francês. Perguntas sobre montar a partida podem localizar Preparação; ganhar pode localizar Vitória. Uma consulta simples como jogo continua válida. Resultados distinguem guia revisado, PDF/OCR e IA não confirmada, com origem e aviso de edição geral. PDFs mantêm documento, hash e página correta. Não há resposta inventada quando não existem trechos sustentados.

## Preparação e regressões

- Extração, OCR automático entre lotes, tradução local quando disponível, checkpoints, índices compartilhados e criptografia foram preservados.
- A preparação da chave privada agora compartilha a mesma requisição em andamento por sessão. Uma falha de configurações gerais não impede a tentativa independente de preparar a chave.
- A manutenção de OCR, análise e tradução fica apenas em Documentos. Tentar novamente recupera páginas que falharam sem reprocessar as que já estão corretas; o editor do guia aproveita os índices preparados.
- Erros de acesso ao cache distinguem recusa de autorização, sessão inválida e conexão. A manutenção mostra o motivo e permite tentar novamente, sem bloquear o PDF original nem criar um cache aberto.
- Capas reais, restauração da sessão, compatibilidade do manual legado, CORS/Range, privacidade e remoção recuperável continuam nos testes.
- O limite permanece **200 MiB (209.715.200 bytes)**, com blocos de **8 MiB**. Não houve mudança do transporte ou do Drive para acomodar Gemini.

## Verificação

### Suítes

93 testes do aplicativo, 70 do Worker e 26 das regras Firestore. O build estático e o build do Worker são locais; o último é `wrangler deploy --dry-run`.

### Navegador e runtime

- Cadastro pelo formulário inicia uma síntese em segundo plano. Múltiplas solicitações concorrentes não geram chamadas extras.
- Selecionar todos preenche descrição, mínimo/máximo de jogadores, mínimo/máximo de duração e idade nos inputs da etapa 2; os valores foram conferidos também no registro salvo.
- Várias pesquisas, abertura, recarga e consulta por outro usuário reutilizam o conhecimento, sem chamada adicional ao modelo.
- Revisão de duas seções preserva a edição ainda não salva da outra; atualização explícita mantém ambas as correções.
- Guia recebe sugestões não revisadas; só aparece em Como jogar depois de revisão e publicação. O leitor não recebe controles administrativos.
- Sem chave, falha de rede, HTTP 429 e resposta inválida foram exercitados, conservando conhecimento anterior válido e sem repetição automática.
- Proprietário, subadministrador com edição, leitor aprovado, pendente e visitante passam pelo Worker real e Firestore/Auth emulados. As fontes e o Gemini desse fluxo são **simulados**; não se trata de uma chamada real ao provedor.
- Um teste adicional usa **SQLite real no Miniflare/workerd local**, conferindo concorrência e persistência da reserva e do conhecimento após reiniciar o runtime. Não cria recursos Cloudflare.
- Três títulos — Catan, Azul e O Senhor dos Anéis: Sina da Sociedade — exercitam os conectores reais com respostas públicas simuladas e atribuições verificadas.
- Resumos longos/curtos, Ver mais/Ver menos, capa alinhada e ausência de overflow foram conferidos em viewports de desktop, tablet e celular.
- Múltiplos PDFs: cadastro, análise automática, índice unificado, leitura do documento certo, substituição, principal e remoção; o rascunho anterior permanece independente.
- Guia com 20 páginas: imagem, formatação, revisão/publicação, rascunho separado, busca e abertura da página 20.
- Resident Evil real: **22/22 páginas legíveis, 212 títulos indexados e 32 resultados** na consulta de teste.
- Sina da Sociedade real: **24/24 páginas legíveis por OCR, nove títulos e 14 resultados**. Houve pausa, recarga e retomada; páginas concluídas não foram repetidas. Os índices foram reutilizados após nova recarga.
- Os PDFs reais foram processados localmente. Não foram enviados ao Gemini. Esses testes não medem memória de aparelhos físicos nem provam qualidade de uma síntese real do modelo.
- O cadastro completo de 157,3 MiB e de exatamente 200 MiB foi repetido com Worker real, Firebase emulado e Drive simulado. O arquivo original de 157,3 MiB usado na versão 1.10.1 já não estava disponível; nesta repetição, a cópia do manual otimizado de Dead by Daylight, de 20 páginas, recebe um stream não utilizado para atingir o tamanho exato. Isso testa tamanho/transporte, sem representar um PDF naturalmente desse tamanho. O original é preservado. Também se verificam limite remoto antigo, rollback por regras antigas e preservação do formulário.

Evidências ignoradas pelo Git: `test-output/gemini-browser-report.json`, `gemini-browser-final.log`, `knowledge-worker.log`, `knowledge-unit.log`, `knowledge-final-regressions.log`, `knowledge-durable.log`, `knowledge-documents.log`, `knowledge-guides.log`, `knowledge-real-pdf.log`, `automatic-real-report.json`, `full-upload-report.json` e capturas `knowledge-detail-*.png`.

## Configuração pendente

Nenhuma chave Gemini real foi lida, criada, cadastrada ou utilizada nesta entrega. Para ativar posteriormente:

1. No [Google AI Studio](https://aistudio.google.com/apikey), criar uma chave de API em um projeto **sem faturamento**, mantendo o nível gratuito. Não ativar faturamento nem usar Vertex AI. O projeto Firebase pode continuar Spark.
2. Restringir a chave à Generative Language API quando a configuração permitir. Nunca colocá-la em `app-config.js`, no Git ou no chat.
3. **Após autorizar a configuração/publicação**, cadastrar a chave exclusivamente como secret `GEMINI_API_KEY` do Worker. Exemplo de comando a executar na pasta `worker`: `npx wrangler secret put GEMINI_API_KEY`. Não foi executado nesta entrega.
4. Conferir as cotas gratuitas e a disponibilidade de `gemini-3.8-flash` para essa chave. O aplicativo não ativa faturamento ao encontrar uma restrição.
5. Após autorização, publicar coordenadamente frontend, Worker e regras locais compatíveis. O `wrangler.jsonc` declara o binding e a migração **SQLite** do novo objeto; essa migração está apenas preparada, não foi executada remotamente.
6. Em um jogo de teste autorizado, conferir a síntese real, as fontes, a edição e as lacunas antes de publicar qualquer guia. Para jogos já cadastrados, usar Gerenciar jogo → Informações → Gerar conhecimento com IA.

O nível gratuito do Google informa uso de conteúdo para melhorar produtos; por isso o contrato restringe o envio às fontes públicas. A síntese real, a cota específica da chave e o funcionamento do novo binding em produção permanecem pendentes dessa configuração e da autorização de publicação. O servidor publicado continua inalterado.
