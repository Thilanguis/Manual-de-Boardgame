# Branding OAuth — preparação isolada de páginas públicas

Situação em 21/10/2026: **preparado localmente, não publicado**. Nenhuma configuração Google, Worker Cloudflare, secret, Firebase, permissão ou funcionalidade da biblioteca foi alterada nesta etapa. Nenhum commit, push ou chamada Gemini.

## Páginas e URLs propostos

O endereço do Pages foi confirmado pela API do GitHub: `https://thilanguis.github.io/Manual-de-Boardgame/`. A página inicial retorna 200; as três páginas abaixo ainda retornam **404**. Só cadastrar os links no Google após publicação autorizada e conferência anônima.

| Campo no Branding            | URL final proposta                                                |
| ---------------------------- | ----------------------------------------------------------------- |
| Página inicial do aplicativo | https://thilanguis.github.io/Manual-de-Boardgame/sobre.html       |
| Política de Privacidade      | https://thilanguis.github.io/Manual-de-Boardgame/privacidade.html |
| Termos de Serviço            | https://thilanguis.github.io/Manual-de-Boardgame/termos.html      |

`sobre.html` é a apresentação pública do aplicativo: explica sua finalidade e a conexão central com Drive, e liga diretamente à política e aos termos. A raiz continua sendo a biblioteca com o acesso existente. Não é necessário transformar o catálogo numa página pública.

## Alterações que entram no pacote

| Arquivo estático          | Alteração                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sobre.html`              | Apresentação, acesso aprovado, papel da IA, escopo limitado do Drive e contato pendente.                                                              |
| `privacidade.html`        | Dados de conta, armazenamento e uso de arquivos, serviços envolvidos, IA, remoção/revogação e contato pendente. Sem detalhes de credenciais privadas. |
| `termos.html`             | Acesso, conteúdo e direitos, revisão de sugestões, disponibilidade e contato pendente.                                                                |
| `styles/public-pages.css` | Estilo compartilhado e responsivo, sem fontes ou recursos externos.                                                                                   |
| `index.html`              | Somente links para as três páginas no rodapé e na área de entrada, visíveis antes de autenticar.                                                      |
| `service-worker.js`       | Somente nova versão do cache e exceção das três páginas públicas para que a PWA não substitua seus documentos pelo HTML da biblioteca.                |

As páginas públicas são HTML/CSS sem scripts, formulários, catálogo, PDFs, guias, contas, SDK Firebase, API Drive ou Gemini. O ícone é o mesmo recurso público já existente.

Arquivos de preparação/revisão, **fora do conteúdo a publicar**: este documento, `scripts/prepare-oauth-branding.mjs`, o teste de service worker e os relatórios locais. As modificações anteriores em `scripts/build.mjs`, demais JS, estilos do aplicativo e backend não entram no pacote.

## Isolamento da publicação

Baseline: commit `92e6c6dc0878485caab62ed9d453821d99e0ec53`, da [execução Pages bem-sucedida 39373676124](https://github.com/Thilanguis/Manual-de-Boardgame/actions/runs/39373676124). A cópia desse commit de `index.html`, `service-worker.js` e `config/app-config.js` foi comparada byte a byte com os três arquivos servidos no Pages: idênticos.

Preparação executável, apenas local:

```powershell
node scripts/prepare-oauth-branding.mjs
```

O script extrai somente fontes estáticas desse commit para uma pasta nova em `.secrets/oauth-branding-2026-10-21/`, executa o build **desse snapshot** e aplica as seis alterações permitidas. Não lê secrets nem publica. Interrompe se detectar diferenças fora da lista, remoção de arquivo, script nas páginas públicas ou endereço de e-mail não autorizado.

O pacote contém `public/`, `pages-artifact.tar` e `manifest.json`. A comparação verificou **288 arquivos preservados** e exatamente seis arquivos acrescentados/alterados. Todo JS da aplicação e a configuração pública são idênticos ao baseline. Não usar `npm run build` do workspace para esta publicação isolada.

Pacote revisado nesta sessão: `.secrets/oauth-branding-2026-10-21/review-PTkcsA/`. O `manifest.json` registra a lista e os hashes; `live-baseline-check.json` registra a comparação com os arquivos públicos atuais; `verification.json` registra os testes locais. Capturas de apresentação, privacidade, termos e entrada em `test-output/oauth-branding/`.

Validação concluída: três páginas em larguras de 390, 768 e 1440 pixels, navegação entre páginas, links institucionais acessíveis na entrada e catálogo oculto para visitante. Nenhuma requisição externa nem erro de navegador. A sessão Firebase foi **simulada sem usuário**; o comportamento do service worker do pacote foi verificado em VM. Os sete testes locais do service worker também passaram. Não foi realizado login real, teste do OAuth Google ou leitura Drive; esses resultados não comprovam recuperação da conexão.

Após autorização, reconferir se o Pages continua no baseline. Se mudou, preparar novamente a partir da versão realmente publicada. Publicar o artefato revisado; se for necessário passar por GitHub Actions, usar branch isolada a partir do baseline com apenas as seis diferenças e a execução manual do workflow Pages existente. Criação de commit/push/publicação depende da autorização correspondente; nada disso foi executado. Não mesclar ou enviar as demais alterações locais.

Na conferência posterior à publicação: abrir anonimamente as três URLs, testar os links da entrada, verificar o documento correto com uma PWA já instalada e confirmar que o catálogo continua exigindo autenticação e aprovação. A sessão atual é apenas preparação; testes locais não comprovam publicação nem recuperação OAuth.

## Contato: pendência deliberada

O proprietário **não autorizou divulgar seu e-mail pessoal**. As páginas explicam que o endereço exclusivo do Acervo está em preparação; usuários existentes podem usar o canal já utilizado com o responsável pela biblioteca. Nenhum endereço fictício ou pessoal foi incluído.

O campo **User support email** no Branding é obrigatório e aparece aos usuários na tela de consentimento. Segundo o Google, as opções aceitas são o e-mail da conta Google atualmente conectada ao Console ou um Google Group gerenciado por ela. Criar um endereço exclusivo compatível e definir seu uso é uma interação pendente do proprietário; um endereço inventado ou uma caixa que não aparece no seletor não resolve esse campo. Não selecionar o e-mail pessoal como alternativa automática. O contato de desenvolvedor é um campo separado, usado pelo Google para avisos do projeto.

Fonte: [Manage OAuth App Branding — User support email](https://support.google.com/cloud/answer/15549049?hl=en). A pendência não impede preparar as páginas; informar o proprietário antes de publicar/submeter o Branding. Não prometer que textos sem o canal definitivo garantem aprovação.

## Domínio GitHub Pages: registro e comprovação

1. **Formato do registro:** o candidato para Authorized domains é `thilanguis.github.io`, sem `https://`, sem `/Manual-de-Boardgame/` e sem o nome de arquivo. `github.io` consta na [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat); por isso `thilanguis.github.io` é o domínio privado superior relevante. Não cadastrar `github.com` só porque o código está hospedado ali, nem declarar `github.io` como propriedade do Acervo. O formato foi deduzido das regras oficiais e da lista; a aceitação efetiva do candidato ainda depende do Console.
2. **Antes dos links:** no projeto existente **Manual de Boardgame → Google Auth Platform → Branding → Authorized domains**, registrar somente os domínios realmente necessários. Não mudar agora os clientes, callbacks, origens ou a lista atual. A documentação exige registrar os domínios antes de usar suas URLs no Branding.
3. **Prova formal atual:** o guia de problemas de verificação do Google exige uma propriedade **Domain por DNS**, com registro TXT e a conta proprietária do projeto. Ele distingue isso de propriedade **URL prefix**, arquivo HTML ou meta tag. Não afirmar que adicionar `google-site-verification` na pasta do repositório resolve a verificação OAuth formal.
4. **Limitação concreta:** administrar esse repositório permite publicar no caminho `/Manual-de-Boardgame/`, mas não editar o DNS de `github.io` ou `thilanguis.github.io`. Portanto não temos, só com o GitHub Pages padrão, como fornecer a prova TXT exigida por esse procedimento. Não foi comprado domínio nem emitido registro de verificação.
5. **Se o Console exigir a prova formal:** as opções são usar um domínio que o proprietário já controle, configurando-o no Pages e comprovando seu DNS no Search Console, ou pedir orientação/revisão ao Google sobre a hospedagem e o enquadramento do aplicativo. Domínio próprio é suportado no Pages e não exige recriar o projeto/cliente OAuth. Não basta a verificação de domínio do próprio GitHub: a comprovação no Google é separada.
6. **Possível dispensa, sem presumir aprovação:** o Google documenta exceções de uso pessoal, para o próprio desenvolvedor ou poucas pessoas conhecidas. `drive.file` é não sensível e o Google informa que aplicações só com escopos não sensíveis não são obrigadas à verificação de escopos; marca/nome/logo possuem verificação separada. Só o proprietário autorizar o Drive é relevante, mas não certifica automaticamente dispensa para todo o projeto. Confirmar os escopos e os avisos efetivos do Console antes de escolher esse caminho. Uma biblioteca privada não se torna do tipo “Internal” sem a organização Google Workspace/Cloud Identity exigida para isso.

Fontes oficiais consultadas:

- [Branding: Authorized domains e requisitos de homepage](https://support.google.com/cloud/answer/15549049?hl=en).
- [Domain Verification: propriedade DNS e conta correta](https://support.google.com/cloud/answer/13804266?hl=en).
- [Brand verification e exceções de uso pessoal](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).
- [Verificação para escopos não sensíveis](https://support.google.com/cloud/answer/13463073?hl=en).
- [Escopo Drive `drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- [Domínio próprio no GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).

## Passos que ainda dependem da conta Google

Depois da publicação autorizada das páginas: escolher o e-mail exclusivo de suporte, preencher as URLs verificadas no Branding, resolver os avisos reais de domínio e, se aplicável, executar Verify Branding e Publish branding. A mudança **Audience → In production** é distinta da publicação de páginas e da publicação da marca.

Preparar páginas não renova o refresh token inválido. A restauração do Drive ainda exige a reconexão autorizada com o cliente existente, após resolver a configuração de produção. Não alterar chaves, secrets ou arquivos nesta etapa.
