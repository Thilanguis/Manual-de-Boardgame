# Etapa 2 — Conferir informações: acabamento e validação

Alterações locais de 18/10/2026, após inspeção do fluxo já implementado. Sem commit, push ou deploy. Nenhum acesso ao Firebase, Drive, Gemini ou catálogos reais nesta etapa.

## O que já existia e foi preservado

- Formulário atual, fluxo Identificar jogo → Conferir informações → Publicar e um único botão **Completar informações**.
- Consolidação de PDF, ficha Gemini e catálogos; duração fixa repetida nos dois campos; proteção dos dados manuais; cache e identidade por título, edição e documentos.
- Descoberta multilíngue automática e uso de aliases confirmados. O nome inglês não é obrigatório. O idioma preferido não restringe as consultas a português.
- Filtro de texto corrompido e vocabulário local para termos conhecidos em outros idiomas.
- Espaçamento positivo já existente entre campos e origens. Não refiz o layout ou os serviços.

## Ajustes necessários encontrados

1. **Origem visível mesmo quando há concordância:** o resumo recolhido identifica PDF, Gemini analisando o manual, Gemini sintetizando fontes públicas, Wikidata, Wikipédia, BoardGameGeek e Ludopedia conforme os fatos recebidos. Não esconde os nomes sob “fontes reunidas” ou somente “fontes concordam”. Ao expandir, cada origem conserva seu link, licença e página quando disponível.
2. **Referências da Wikipédia:** o frontend conserva `fieldEvidence` recebido do conhecimento e prefere o URL da revisão específica quando fornecido. Não inventa número de página para catálogos externos.
3. **Correção manual prevalece também na apresentação:** um campo conferido/alterado não aparece com destaque de conflito nem exige outra confirmação. Isso vale para a edição atual e para correções já salvas. Valores que o usuário conferiu não continuam sendo contados como preenchimento automático, mesmo se coincidem com a sugestão anterior.
4. **Mensagens com escopo correto:** ausências/rejeições da análise Gemini são identificadas como tal; não afirmam que um dado encontrado pelo PDF ou catálogo está ausente da ficha inteira. Dentro dos detalhes, o resumo da ficha informa campos preenchidos e quais continuam sem dados. Sugestões rejeitadas têm motivo.
5. **Texto ilegível:** o aviso identifica a fonte real, em vez de atribuir qualquer corrupção ao PDF. O conteúdo corrompido não entra no campo, nas origens ou nas sugestões de tradução. Números legíveis da mesma fonte são preservados.
6. **Idioma do manual:** quando existe evidência de identificação no PDF, a origem é mostrada no seletor existente. É uma sugestão a conferir. Alteração manual tem prioridade; catálogos e Gemini não substituem o idioma do arquivo.
7. **Responsividade:** mantida a margem positiva; melhorada a altura de linha das origens e aplicado o mesmo espaçamento ao seletor de idioma. Não foram criados novos formulários, telas ou botões de pesquisa.

Arquivos de produto alterados nesta etapa: `js/metadata-form.js`, `js/research-panel.js`, `js/research-knowledge.js`, `styles/interface.css` e a versão do cache em `service-worker.js`. Nenhum arquivo do Worker, configuração, credencial, regra de segurança ou estrutura de armazenamento foi alterado nesta etapa.

## Teste completo da etapa 2

`tests/information-stage2-browser.mjs` usa o HTML, CSS, formulário, navegação de três etapas e controladores reais. Simula o PDF já preparado, o repositório e as respostas dos provedores. O jogo e todos os fatos do teste são sintéticos.

| Campo        | Valor da simulação                      | Origem exibida                              |
| ------------ | --------------------------------------- | ------------------------------------------- |
| Nome         | Jardins da Lua                          | Correção manual preservada                  |
| Sobre o jogo | Resumo em português                     | Gemini · manual, página 1                   |
| Jogadores    | 2–8                                     | PDF · texto do manual, página 1             |
| Duração      | 30/30 minutos                           | Wikidata + Gemini · fontes públicas         |
| Idade        | 8                                       | Wikipédia; link da revisão específica       |
| Tipo         | Cooperativo                             | Gemini · manual, página 1                   |
| Categorias   | Familiar                                | Ludopedia                                   |
| Mecânicas    | Seleção de cartas; Coleção de conjuntos | BoardGameGeek, termos traduzidos localmente |
| Idioma       | Português                               | PDF · idioma sugerido pelo texto            |
| Edição       | 2025                                    | Gemini · manual, página 1                   |

Verificações realizadas:

- Os 11 campos estruturados são preenchidos, além do idioma já identificado no PDF.
- Um alias inglês vindo da resposta simulada é enviado automaticamente ao conector, mantendo o título português corrigido como consulta principal e o campo de aliases do usuário vazio.
- Texto corrompido da Wikipédia é descartado, sem sugestão de tradução; a idade legível da mesma fonte continua utilizável.
- Uma sugestão Gemini com fonte inexistente é rejeitada e explicada; não impede que o catálogo preencha o campo.
- Idade corrigida para 9 e duração corrigida para 45/45 sobrevivem a novos resultados. Correções salvas continuam protegidas após reinicializar o estado do formulário.
- Uma divergência real de idade sem correção prévia gera uma única revisão consolidada; a escolha encerra o alerta.
- Campo sem resultado permanece vazio e é identificado nos detalhes.
- O teste mantém uma única preparação simulada; renderização, abertura das origens e correções não geram novas análises.
- Layout inspecionado em **1440 × 1000**, **820 × 1100** e **390 × 844**: sem transbordamento horizontal; distância de pelo menos 7 px entre controle e origem. Capturas com fontes recolhidas e expandidas foram conferidas visualmente.

Evidências locais ignoradas pelo Git: `test-output/information-stage2/browser.json`, `first.json`, `overview-*.png`, `origins-*.png`, `sources-*.png` e `classifications-*.png`.

Regressões finais aprovadas: **205 testes do aplicativo, 112 do Worker e 27 de segurança (344 no total)**, além dos testes de navegador da etapa 2, consenso, feedback, oito cenários da auditoria de informações e cadastro completo. No aplicativo completo com emuladores, a idade corrigida para 9 foi salva, índices e conhecimento foram vinculados ao jogo, e Consultar regras/reload não fizeram novas chamadas aos modelos ou catálogos. Sintaxe, build estático e `git diff --check` também passaram.

## Limitações

Esse teste comprova consolidação, aplicação nos inputs, proveniência, correções, conflitos e apresentação do frontend. Não comprova a cobertura dos catálogos reais, que o Gemini real encontrará todos os dados, nem a disponibilidade/autorização atual de integrações publicadas. O PDF do teste da etapa 2 é representado pelo resultado de preparação simulado; OCR e qualidade real do modelo não são medidos por esse teste.

Os testes complementares do aplicativo completo usam Auth/Firestore emulados e Drive/Gemini/catálogos simulados. A validação não consome a cota real do projeto. Nada foi publicado: recarregar o site publicado não instala estas mudanças locais.
