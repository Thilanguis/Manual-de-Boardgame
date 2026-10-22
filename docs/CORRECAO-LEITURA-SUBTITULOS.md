# Revisão da apresentação em Consultar regras

O exemplo da página 3 de Duelo pela Terra Média reproduzia três defeitos:

1. O separador de frases interpretava `A.` como frase completa, separando-o de
   `Pegar uma Carta de Capítulo`. A prévia não conservava a hierarquia tipográfica.
2. Fragmentos de texto do PDF deixavam espaços antes de vírgulas/pontos e dentro
   de parênteses. A limpeza é apenas da representação de leitura.
3. A página combina parágrafos largos, desenho com legenda e duas caixas de
   regras. A separação global em colunas não reconhecia essas regiões locais:
   misturava `Carta disponível` à frase e alternava linhas das duas caixas.

As três reproduções falharam antes da correção e passaram depois. Uma quarta
regressão assegura que tabelas curtas conservem rótulos e valores na mesma linha.

## Correção

- Prefixos alfabéticos permanecem junto ao texto na prévia.
- Títulos confirmados pela tipografia do PDF são renderizados como subtítulos,
  sem transformar qualquer letra ou número em instrução/etapa.
- Espaços artificiais na pontuação são normalizados somente para apresentação.
- Layout v5 reconhece regiões locais com um vão vertical comum. Cada caixa é
  lida por inteiro, preservando o `ou` original entre as alternativas.
- Texto lateral curto fica em detalhe próprio, fora dos parágrafos da regra.
- Tabelas ambíguas permanecem literais e oferecem conferência na página do PDF.
- Cache de leitura e cache PWA atualizados para descartar projeções anteriores.

Nenhuma alteração no PDF, no texto original do índice, nos hashes, nas citações,
no preenchimento de Conferir informações ou nas chamadas Gemini. Todo o trabalho
permanece local, sem commit, push, deploy ou alterações de produção.

## Validação

- `tests/rule-formatting-regression.test.mjs`: quatro regressões da apresentação.
- 237 testes do frontend e 167 do Worker aprovados.
- `tests/rule-quality-real-browser.mjs`: 17 buscas nos quatro PDFs reais locais,
  referências/páginas preservadas, originais intactos e tradução simulada sobre
  OCR salvo. Inclui verificações específicas da prévia e expansão de Turnos.
- Página original e interface inspecionadas visualmente; capturas em
  `test-output/rule-reading-audit/`, nas larguras 1440, 768 e 390.
- Leitura estruturada, legado e cancelamento/reabertura testados no Chrome.
- Build estático e verificação de sintaxe/cache PWA aprovados.
- Testes adicionais de vários PDFs e da etapa Conferir informações executados
  com serviços simulados. Nenhuma geração Gemini real foi executada.

Limite: PDFs com diagramas/tabelas cuja ordem não seja inequívoca ainda exigem
conferir a página original. A apresentação não inventa regras para completá-los.
