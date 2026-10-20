# Prazo da ficha e integração real das fontes — 19/10/2026

## Resposta sobre o funcionamento

Completar informações coleta os textos extraídos dos PDFs, suas páginas e as fontes públicas habilitadas. A geração principal `gemini-3.5-flash-lite` recebe esse material e a identidade corrigida para produzir ficha, resumo e explicações de regras. O contrato separado `modelProfile` permite complementar metadados pelo conhecimento do modelo, com origem explícita e sem evidência externa fictícia.

A chamada adicional `gemini-2.5-flash-lite` sugere nomes alternativos. Não é uma chamada com navegação ou Google Search. A consulta à internet é feita pelos conectores, que entregam os fatos à síntese. A configuração publicada continua anunciando `googleSearchGrounding:false`. Ter duas chamadas Gemini não significa que uma delas navegue. A comunicação anterior com o usuário não distinguiu suficientemente essas funções.

BGG/Ludopedia continuam dependendo de credenciais próprias; os metadados do Worker publicado não incluem esses tokens. Não foram ativados novos provedores ou serviços pagos. A descoberta de nomes indisponível não bloqueia a geração principal. Se a geração principal falhar, o frontend mantém o caminho independente de pesquisa nos catálogos habilitados, além dos fatos do PDF e das correções manuais.

## Defeito comprovado

A chamada principal era interrompida por `AbortSignal.timeout(18000)`. A tarefa externa tinha mais um prazo de 26 segundos. O mesmo catch traduzia timeout e qualquer falha de rede para "A geração não terminou", impedindo identificar o motivo real pelo print. Portanto, a captura não comprova qual dos dois ocorreu naquela tentativa, embora o corte local de 18 segundos seja um defeito reproduzido.

O teste com relógio virtual e resposta válida aos 19 segundos falhava no código anterior e passou depois. Dois testes adicionais reproduziam a ausência de prazo/diagnóstico específico. Os logs anteriores e posteriores estão em `test-output/profile-timeout/`.

## Correção

- Somente a ficha combinada recebe prazo finito de 60 segundos para a geração e 85 segundos para a tarefa, incluindo revalidação final. O processamento antigo não combinado conserva seus limites.
- Timeout, falha de rede e HTTP do provedor possuem motivos distintos, sem expor mensagens internas ou dados privados.
- A análise explícita de jogo salvo aguarda a tarefa antes de devolver a resposta; evita depender do limite de 30 segundos de `waitUntil` após responder. O rascunho já aguardava a conclusão. A [documentação Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil) distingue o tempo da requisição aberta e o limite após resposta/desconexão.
- Nenhuma repetição automática, chamada de fallback ou geração extra foi acrescentada. Schema, prompts, Google Search, autenticação, permissões, identidade, leases e regras de persistência permanecem iguais.
- Ao desconectar o cliente, continua aplicável o limite de execução pós-desconexão da plataforma. Não se introduziu fila durável nova nem se garantiu execução ilimitada após fechamento.

## Testes e publicação

147 testes do Worker aprovados; 27 testes de permissões em `demo-acervo` aprovados. Cadastro completo no navegador com PDF e Gemini simulados passou: campos complementados, origem persistida, correção manual e ausência de novas gerações nas consultas/reload. Teste adicional de jogo salvo confirma que a resposta não é liberada antes de a tarefa principal concluir. Falha de rede agora espera HTTP 502 com `provider-network`, em vez de classificá-la incorretamente como timeout 504.

Sintaxe, bundle dry-run e `git diff --check` conferidos. Publicado somente Worker, pela autorização contínua do proprietário, **sem commit nem push**. Nenhuma chamada Gemini real ou acesso a dados reais Firebase/Drive foi usado para validação.

Versão publicada: `2db476df-01f3-4305-b75f-559c6de03b90`, deployment `423086f9-b156-4e15-8478-98effc44e52d`, criado em `2026-10-19T21:17:03Z` (17:17 America/New_York). Bundle SHA-256 `0ee65a31c2cd100721ad1e3bce50ab3d33a71011cf091d16f0cb7c8a7f8b1158`.

Somente GET /health e metadados de publicação foram consultados: configuração, seis variáveis, sete nomes de segredos, namespace, runtime e migration preservados. Rollback anterior: `7bbd609b-1c70-4b1d-87bc-51d1e7b38df0`. Frontend permanece no commit `c4300ee`. Não houve mudança de banco ou de regras Firebase.

Essa correção remove o corte prematuro local; não garante disponibilidade do Gemini nem comprova o sucesso de uma nova geração real. Um HTTP 503 do provedor continua sendo tratado como tal, sem promessa de que aguardar mais o resolverá.
