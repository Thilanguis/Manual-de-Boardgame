# Busca de regras e guias — 17/10/2026

## Diagnóstico

Uma única consulta ao endpoint público `/health` do Worker configurado retornou `ok: true` e o projeto esperado, mas sem `fileProtocol`, `knowledgeProtocol` e `maxPdfBytes`. A versão local do Worker declara `fileProtocol: 2` e `knowledgeProtocol: 1`. Portanto, o frontend local estava usando um servidor sem os protocolos necessários. Essa consulta não acessou documentos, usuários, índices, Drive ou Gemini.

A geração de conhecimento não está operacional nesse servidor. A mensagem anterior misturava esse caso com ausência de chave Gemini. Não é possível concluir se a chave existe apenas pelo health.

O preparo automático atual também depende do acesso a `cacheKeys` nas regras Firestore e da API de documentos do Worker. Alterar somente o frontend ou limpar o cache da PWA não atualiza essas dependências. A negativa de um índice não demonstra que o usuário perdeu sua conta ou acesso ao PDF.

## Correções locais

- Servidores antigos não provocam consultas à coleção nova de índices que ainda não suportam.
- Índices de versões anteriores vinculados ao guia podem ser reaproveitados. A leitura do guia e do arquivo continua autenticada, e hash, documento e páginas são validados.
- O guia publicado é tentado antes do rascunho, evitando uma dependência desnecessária de permissões de edição.
- Uma negativa da coleção nova permite tentar o índice legado pelas rotas autorizadas; não se abre nenhuma regra ou arquivo.
- Falha de carregamento não é apresentada como uma pesquisa válida sem correspondências. Índices disponíveis dos demais documentos continuam pesquisáveis.
- O estado de falha é limpo ao abrir outro jogo.
- A ausência de protocolo Gemini é apresentada como necessidade de atualização do servidor.
- Um administrador pode abrir o editor diretamente de “Como jogar” quando o guia ainda não existe. Isso não gera nem publica regras automaticamente.

## Validação

Testes de compatibilidade cobrem índice legado, servidor antigo, bloqueio de metadados, hash diferente, documento diferente, sessão sem leitura e arquivo negado. O Chrome executou o painel real com dependências simuladas: busca “atacar”, resultado do índice, link para o PDF, erro sem falso zero, acesso ao editor e leitura do guia publicado. Não foram utilizados dados de produção.

## O que permanece pendente

Para preparar e compartilhar índices novos, será necessário publicar o Worker compatível e as regras atuais, seguindo a transição privada documentada. Para geração por Gemini, também é necessário configurar o binding de conhecimento e a chave privada no servidor. Essas ações não foram executadas.

Os jogos antigos sem índice precisam de uma primeira preparação; os índices já existentes e compatíveis são reutilizados. “Como jogar” depende de um guia revisado e publicado. A implementação atual do Gemini recebe fontes públicas, e não o manual completo; transformar o PDF integral em conhecimento didático é uma funcionalidade adicional, não realizada por essas correções.

Nenhum commit, push, deploy, mudança de regras, geração Gemini ou alteração dos dados de produção foi realizado.
