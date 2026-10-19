# Complemento da ficha pelo conhecimento Gemini — 19/10/2026

## Causa e correção

Até esta alteração, o prompt proibia o modelo de preencher valores pelo próprio conhecimento. Ele podia reconhecer Sushi Go Party, mas apenas extrair fatos dos textos fornecidos. A ausência de duração num catálogo ou no texto do manual impedia esse campo de ser preenchido. Não era suficiente pedir mais campos ao mesmo extrator restrito a evidências.

Com a autorização explícita do usuário, a mesma geração principal agora recebe dois contratos distintos: `metadata` extrai/sintetiza fatos com evidências; `modelProfile` complementa lacunas pelo conhecimento do modelo. Não foi acrescentada outra chamada Gemini para esse complemento. A descoberta de nomes já existente continua sendo uma chamada adicional separada, no máximo uma por análise quando necessária.

O pedido usa o título corrigido, edição e documentos atuais. A resposta deve repetir a identidade solicitada e indicar se o modelo reconhece o jogo. Uma resposta para identidade diferente é recusada. Isso evita aplicação de respostas obsoletas; a declaração do modelo não constitui confirmação externa da identidade.

## Campos e prioridades

- Resumo em português, jogadores mínimo/máximo, duração mínima/máxima, idade, categorias, mecânicas e tipo podem receber o complemento do modelo.
- Uma duração fixa é duplicada nos dois campos. Faixas incompletas, invertidas ou fora dos limites existentes são recusadas; não se mistura metade de uma faixa do modelo com metade de uma fonte.
- PDF, fatos dos catálogos autorizados e edição correta têm prioridade. O modelo não desempata divergências entre fontes nem conta como voto independente.
- Uma sugestão do modelo só preenche campos vazios. Valores existentes e correções manuais são preservados. Uma fonte documentada posterior pode substituir uma sugestão automática do modelo ainda não confirmada pelo usuário.
- Título/edição não são alterados pela memória do modelo. Idioma pertence ao PDF e à escolha do usuário. Ausência de informação segura permanece vazia.

## Origem e persistência

Os campos complementados exibem **Gemini · conhecimento do modelo**. Nos detalhes consta que não têm fonte externa verificada. São persistidos com `basis: model`, `verified: false`, nome do modelo e contexto dos hashes dos documentos. Não recebem páginas, citações nem URLs inventadas.

Esse conteúdo não entra nas seções de regras, nos trechos pesquisáveis como evidência do manual ou na confirmação de aliases. As explicações de Consultar regras continuam sendo validadas contra as fontes. Se o PDF estiver ilegível, a ficha pode ser complementada pelo nome; nenhuma regra sem referência é criada. As limitações de leitura permanecem informadas.

`profileEvidenceProtocol: 3` e `profileModelCompletionProtocol: 1` anunciam o contrato novo. Análises anteriores parciais podem ser atualizadas no clique explícito. Abrir, salvar, consultar regras ou recarregar não inicia geração. O resultado continua privado, reaproveitado e vinculado ao usuário e à identidade atual.

## Evidências locais

- **213 testes frontend/modelos + 143 Worker + 27 permissões = 383 aprovados**, com provedores simulados e Firebase `demo-acervo` emulado.
- Oito testes novos cobrem complemento dos nove campos, prioridades, faixas, texto corrompido, identidade/edição, valores desconhecidos, origem sem evidência falsa, preservação manual, resposta sem regras e adoção/cache do rascunho.
- Três cadastros completos no navegador: catálogos autorizados; ficha factual Gamewright sem catálogos; conhecimento do próprio Gemini sem catálogos/editora. No último, duração 20/20, tipo, categorias e mecânicas foram aplicados e persistidos com origem do modelo. São valores de teste controlados, não confirmação factual de duração real de Sushi Go Party.
- Em cada cadastro: uma geração principal simulada e uma descoberta simulada; nova consulta reaproveitou cache; salvar, pesquisar regras e recarregar não repetiram IA/internet. Idade alterada manualmente de 8 para 9 permaneceu salva.
- Formulário real conferido em computador, tablet e celular, sem sobreposição; onze campos, seis origens, identificação multilíngue, uma revisão consolidada quando necessária e descarte de texto corrompido.
- Sintaxe, build estático, bundle Worker em dry-run e verificação de whitespace aprovados.

Relatórios/capturas ignorados pelo Git: `test-output/combined-profile/model-browser.json`, `test-output/profile-research/model-stage2.png`, `test-output/profile-research/model-worker-final.log`, `test-output/profile-research/model-root.log`, `test-output/profile-research/model-browser-regression.log` e `test-output/information-stage2/`.

## Limites e publicação

O teste demonstra o caminho completo de preenchimento e persistência com respostas controladas. Não houve chamada Gemini real; não se garante que o provedor preencherá corretamente todos os campos em qualquer jogo. Sugestões da memória do modelo podem conter erros e são identificadas como tal. Se o modelo não reconhecer o jogo ou devolver null, o sistema mantém a ausência e informa o resultado.

BGG/Ludopedia continuam exigindo suas credenciais e condições próprias; nenhuma integração foi habilitada artificialmente. Não foi usado Google Search Grounding. Nenhum dado real do Firebase ou Drive foi acessado ou modificado. Configurações de produção, regras de segurança e otimizações de leitura foram preservadas.

Na conclusão da implementação, as alterações estavam locais, sem commit, push ou deploy. Posteriormente, o proprietário autorizou a publicação conjunta, registrada em [Publicação do complemento Gemini](PUBLICACAO-COMPLEMENTO-GEMINI-2026-10-19.md).
