# Ludopedia — acesso oficial e configuração

Procedimento conferido em 14/10/2026 nos [termos da aplicação](https://ludopedia.com.br/aplicativo), na [documentação oficial](https://ludopedia.com.br/api/documentacao.html) e no [esquema OpenAPI](https://ludopedia.com.br/api/openapi.yaml). O conector já está implementado e permanece desativado sem credenciais. PDF e Wikidata continuam funcionando.

## Custo e requisitos

A Ludopedia declara acesso gratuito não comercial, com atribuição e link nas páginas que utilizam seus dados. Proíbe clones e permite revogar o acesso. Não encontramos exigência publicada de assinatura Apoiador para essa API. Eventuais condições específicas recebidas no cadastro precisam ser conferidas.

A documentação ainda descreve a API como ALPHA, sujeita a mudanças. Não promete prazo de aprovação nem publica ali uma cota numérica garantida. Nosso código não contrata serviços pagos.

## Cadastro passo a passo

1. Entre na sua conta Ludopedia e abra [Meus aplicativos](https://ludopedia.com.br/aplicativos). A documentação indica essa área para cadastrar uma aplicação. O [formulário](https://ludopedia.com.br/aplicativo) apresenta nome, descrição e ícone 150 × 150.
2. Use o nome `Manual de Boardgames`. Na descrição, adapte este texto à finalidade real do projeto:

> Biblioteca pessoal e não comercial: https://thilanguis.github.io/Manual-de-Boardgame/. Consultará somente o catálogo oficial para sugerir metadados de jogos, com revisão manual, atribuição e links. Não criará um clone da plataforma, não coletará dados em massa e não utilizará funções de loja ou dados de visitantes.

3. Deixe `loja:produtos` e `loja:pedidos` desmarcados. O esquema de segurança de `/jogos` e `/jogos/{id}` não exige esses escopos adicionais.
4. A URI de retorno pertence ao OAuth para autorizar outras contas. Usaremos o token do proprietário gerado no cadastro, segundo a documentação. Não temos callback Ludopedia nem login Ludopedia de visitantes. Se a tela permitir, deixe a lista vazia. Se exigir uma URI ou um fluxo diferente, confirme com o suporte antes de preencher; não reutilize o callback Google Drive em `localhost:4180` nem invente um endereço que o sistema não atende.
5. Leia os termos e salve pela ação disponível na página, se concordar e o projeto se enquadrar. A documentação informa que são gerados `app_id`, `app_key` e `access_token` do proprietário. Confira se sua tela informa alguma pendência: não presumimos liberação imediata.

O formulário informa que o token do proprietário tem acesso amplo, mesmo sem marcar permissões adicionais. Nosso conector utiliza somente endpoints fixos de catálogo; não oferece rotas de coleções, partidas, produtos ou pedidos. Não descrevemos essa credencial como um token limitado exclusivamente ao catálogo.

## Solicitar ajuda ou autorização à equipe

O contato publicado na documentação da API é **api@ludopedia.com.br**. Se não conseguir gerar as credenciais, você pode enviar o modelo abaixo. O assistente não enviou nenhuma mensagem.

**Assunto:** Acesso gratuito não comercial à API — Manual de Boardgames

> Olá, equipe Ludopedia.
>
> Gostaria de utilizar a API oficial em uma biblioteca pessoal e não comercial: https://thilanguis.github.io/Manual-de-Boardgame/.
>
> Consultaremos metadados de jogos, com revisão manual, atribuição e links de origem. As chamadas serão feitas pelo servidor, com cache e respeito às limitações. Não faremos scraping ou extração em massa.
>
> Poderiam confirmar o enquadramento gratuito, como liberar as credenciais e os limites de requisições/cache? Não pretendemos copiar descrições ou imagens sem autorização específica.
>
> Obrigado.

Se já tiver cadastrado a aplicação, acrescente seu nome e o App ID solicitado pela equipe. Não inclua App Key, access_token, senhas nem credenciais Google/Firebase.

## Conectar ao Worker existente

1. Guarde o token em um JSON privado **fora da pasta do projeto**, com a propriedade `access_token`. Esse arquivo é diferente do JSON OAuth do Google Drive. App ID e App Key não substituem o token.
2. Informe ao assistente apenas o caminho do arquivo quando estiver pronto, ou execute no terminal aberto na pasta do projeto:

```powershell
node scripts/catalog-secret.mjs ludopedia "C:\caminho-privado\ludopedia.json"
```

3. O script utiliza o login Cloudflare existente e envia o token via stdin para o secret `LUDOPEDIA_TOKEN`. Não imprime seu conteúdo, não copia credenciais para o repositório e não altera o plano. O caminho acima é um exemplo; escolha uma pasta privada sua.
4. Recarregue o site; a disponibilidade pode ficar em cache por até um minuto. O secret torna a fonte disponível no formulário, mas a validade da autorização precisa ser confirmada pesquisando um jogo conhecido. O formulário de edição também permite pesquisar: não é necessário enviar outro PDF para esse teste.
5. Se houver erro de autorização, cota ou indisponibilidade, PDF/Wikidata permanecem independentes. Revisaremos a credencial sem tentar contornar bloqueios. Se o acesso oferecido exigir pagamento, a fonte continuará desativada.

Somente administradores aprovados com permissão de adicionar ou editar jogos acionam o conector. Visitantes não precisam de conta Ludopedia. Atribuição já está implementada na revisão, na ficha e no rodapé da biblioteca quando existem dados confirmados dessa fonte.

Para revogar, remova o secret pelo painel Cloudflare e revogue a aplicação na Ludopedia pelos controles disponíveis.
