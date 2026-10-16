# Acervo 1.9 — OCR contínuo, consulta e tradução local

Implementação local, sem commit, push ou deploy. Firebase Spark, Drive, Worker e permissões permanecem na arquitetura existente. Não foi ativada API paga nem serviço que receba documentos.

## O que mudou

- Um início de OCR percorre todas as páginas pendentes em lotes de até três. Mantém progresso, cancelamento, checkpoint por página e retomada após recarregar. Cada página é tentada uma vez por execução; tentar novamente seleciona somente falhas/baixa confiança. Páginas já legíveis não são substituídas. Uma falha também conserva eventual texto nativo curto.
- O OCR feito durante o cadastro pode alimentar o índice do jogo salvo. A análise completa preserva essas páginas, extrai as restantes e guarda checkpoints. Um índice completo válido é reutilizado em vez de oferecer processamento repetido.
- A Consulta rápida pesquisa páginas inteiras, traduções e guia publicado, com resultados agrupados por página e referências ao PDF atual. O contexto do worker é atualizado após OCR/tradução. Referências de outro hash continuam desativadas.
- O editor recupera o índice do rascunho mesmo sem publicação e sem cache local. Checkpoints distinguem alterações locais ainda não salvas de um índice já enviado. O arquivo do índice é enviado ao salvar, evitando um upload por lote; a publicação continua explícita.
- Páginas sem cabeçalhos também oferecem sugestões de trechos. A inclusão respeita os limites do rascunho, informa quando existem outros trechos na consulta e não duplica ou sobrescreve seções existentes. Trechos continuam sendo citações para revisão, sem explicações ou regras inventadas.
- A tradução usa a **Translator API local do navegador**, com adaptação por campo/página, divisão de textos longos, cache por conteúdo/idioma/conta/manual, progresso e retomada. Não existe fallback remoto. O download do pacote de idioma começa na ação Traduzir; o documento não é enviado ao Google.
- Títulos próprios só usam nomes oficiais fornecidos pelas fontes. O idioma real do manual permanece independente da tradução. Originais, idioma, fonte, licença e método são preservados. Termos de catálogo conhecidos usam vocabulário PT; textos maiores e termos desconhecidos usam tradução de texto completo ou edição manual.
- Textos estrangeiros conhecidos ficam pendentes, em vez de aparecer como português. Na pesquisa, é possível escrever traduções sem motor local e depois selecionar/aplicar os campos na etapa 2. Uma tradução não sobrescreve texto já editado. Seções pendentes não passam pela validação de publicação apenas por marcar revisão.
- O shell PWA foi versionado para 1.9.0 e inclui os novos módulos, preservando os mecanismos de atualização e os documentos fora do cache do shell.

## Tradução: configuração e limites reais

Não é necessário configurar chave, token ou servidor para a opção implementada. Em um Chrome de computador compatível, no endereço HTTPS do site ou em localhost, use **Traduzir para português**. O navegador poderá baixar os pacotes de idioma. Disponibilidade pode depender da versão, das políticas e dos idiomas configurados no navegador.

A API oferece português (`pt`), sem garantir uma variante exclusivamente brasileira. O Acervo registra separadamente o destino editorial PT-BR e o destino efetivo do motor. A variante brasileira e a fidelidade das regras precisam ser revisadas antes da publicação.

Em celular ou navegador sem essa API, é possível ler as traduções já salvas/publicadas e escrever traduções no editor. A geração automática nesse dispositivo não está habilitada. Para ampliá-la seria necessário outro motor local compatível ou uma integração externa autorizada; nenhum serviço externo foi configurado automaticamente.

Documentação primária consultada: [Translator API do Chrome](https://developer.chrome.com/docs/ai/translator-api), [especificação da API](https://webmachinelearning.github.io/translation-api/). O adaptador aceita um provedor substituível para manutenção/testes; não há configuração pública de credenciais ou endpoint de tradução.

## Verificação em navegador com PDFs locais reais

Os testes usam perfis descartáveis e a biblioteca local. Não gravam no Firebase ou Drive de produção.

| Manual                  | Resultado real                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resident Evil PT-BR     | 22/22 páginas com texto extraível. Sugestões, revisão/publicação de teste, busca por “cartas”, abertura do PDF e recarga do índice passaram.                                                                                                                   |
| Sina da Sociedade PT-BR | 24 páginas sem texto extraível inicialmente. OCR real deixou 24/24 legíveis, zero falhas. Cancelamento após checkpoint, recarga e retomada sem repetir páginas, execução automática até o fim, sugestões, publicação de teste e busca por “objetivo” passaram. |
| Resident Evil em inglês | 19 páginas; 18 com texto extraível. OCR da capa não produziu texto utilizável e ficou registrado como baixa confiança, sem fingir conclusão. Consulta do original, aviso de tradução pendente e persistência após recarga passaram.                            |

`tests/knowledge-flows-browser.mjs` gera `test-output/knowledge-flows.json`, ignorado pelo Git. Os PDFs e seus textos não entram no repositório.

## Tradução real e testes de integração

- `translation-native-browser.mjs` usou o motor **real** do Chrome em perfil PT-BR. Inglês e francês produziram português com o original registrado. Uma frase inglesa resultou em “Mova o sobrevivente para o corredor. Cada turno permite duas ações.” O teste não usa documentos reais nem API remota. A primeira tentativa em outro perfil/par de idiomas falhou; a interface trata essa indisponibilidade, e o teste final prepara cada idioma por uma ação própria.
- `translation-browser.mjs` usa motor simulado para testar deterministicamente o aplicativo: tradução EN, preservação de edição manual, índice privado do rascunho recuperado após limpar o cache e recarregar, revisão/publicação, consulta PT, abertura de página e telas de 1440/390 px. Essa fixture não é uma avaliação da qualidade linguística.
- `catalog-translation-browser.mjs` confere tradução local simulada e entrada manual sem API: revisão → seleção → etapa 2 → registro salvo em PT, fonte/original preservados e idioma do PDF mantido em inglês.
- `ocr-progress-browser.mjs` usa Tesseract real com imagens sintéticas: reaproveita OCR do cadastro, cancela após uma página, recarrega, retoma somente o que falta e publica trechos revisados.
- Os fluxos anteriores de pesquisa, cache por hash/edição, duração, conflitos, aplicação na etapa 2, salvamento/reabertura, biblioteca, leitor, favoritos, guias, responsividade e atualização PWA também foram executados.
- Administração passou nos emuladores reais de Authentication/Firestore, incluindo leitura privada da pesquisa em outro perfil e revogação de permissões.

**144 testes de suíte passaram:** 81 do aplicativo, 43 do Worker e 20 das regras, além dos fluxos de navegador descritos. Sintaxe/configurações, formatação e build estático foram verificados localmente. Não houve publicação.

## Executar os testes

```bash
npm test
npm --prefix worker test
npm run test:rules
npm run check
npm run build
```

Os testes de navegador usam `ACERVO_TEST_MODULES` (Playwright/pdf-lib), `ACERVO_TEST_URL` (servidor local) e, para os manuais reais, `ACERVO_RESIDENT_PDF`, `ACERVO_SINA_PDF` e `ACERVO_ENGLISH_PDF`. O teste nativo de tradução pode baixar pacotes de idioma e registra a disponibilidade real, que varia por navegador.
