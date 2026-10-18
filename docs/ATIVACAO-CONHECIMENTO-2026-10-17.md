# Ativação dos serviços e conhecimento pelos manuais — 17/10/2026

## Operações autorizadas realizadas

- Perfil proprietário existente confirmado como `superadmin`, `approved`, com o UID esperado. Nenhum perfil foi recriado ou alterado.
- Firebase confirmado sem faturamento (`billingEnabled: false`).
- Backup das regras e das versões anteriores do Worker guardado em `.secrets/deployment-2026-10-17`, fora do Git. O script não sobrescreve o primeiro backup.
- Regras atuais compiladas, testadas nos emuladores e publicadas. Cache privado e índices por documento passam a ter as regras correspondentes à versão local.
- Worker atualizado com protocolo de documentos, conhecimento e Durable Object SQLite. Os secrets existentes do Drive foram preservados.
- API de gerenciamento de chaves e API Gemini habilitadas sem cadastrar faturamento. As chaves públicas existentes foram inspecionadas: já possuem restrições que não permitem usar Gemini.
- Criada uma chave exclusiva `Acervo Gemini Worker`, restrita a `generativelanguage.googleapis.com`, cadastrada como secret `GEMINI_API_KEY`. O valor não foi impresso nem incluído no frontend/Git.
- O endpoint de saúde confirma Drive conectado, conhecimento configurado e protocolos atuais. Uma tentativa sem login ao conhecimento foi recusada com HTTP 401.

## Fluxo implementado

O cadastro salva o jogo normalmente. A preparação extrai o texto de todos os documentos, continua o OCR e persiste índices vinculados a jogo, documento e hash. O conhecimento aguarda os índices; não consome cota Gemini antes de ter evidência disponível.

Depois do preparo e da autorização de envio, a fila solicita a geração uma vez por contexto. A reserva e o resultado ficam no Durable Object; abrir, pesquisar ou recarregar usa o registro salvo. Checkpoints da fila evitam repetir o pedido. Mudança de hash ou edição cria outro contexto, sem confirmar automaticamente regras da versão anterior.

O Worker obtém os índices diretamente dos arquivos privados vinculados no Firestore/Drive, usando autenticação do solicitante e autorização do arquivo. Não aceita um texto arbitrário do cliente como se fosse um manual verificado. Envia ao Gemini textos, páginas e identificadores sintéticos das fontes; não envia credenciais, perfil, UID ou IDs internos do armazenamento.

O resultado fica em PT-BR e cada seção precisa citar um trecho existente na página indicada. Página inventada, citação ausente e índice de outro documento/hash são rejeitados. Páginas sem leitura suficiente são identificadas. Nenhum excesso de tamanho é truncado silenciosamente: a versão atual aceita até 200.000 caracteres somando os documentos e índices descomprimidos de até 4 MB por documento para essa geração. A consulta direta do índice continua independente dessa limitação do Gemini.

Buscar regras combina os índices, o guia publicado e o conhecimento salvo. Referências Gemini originadas no manual conservam documento/hash/página e podem abrir a página original. No editor, importar o conhecimento cria seções não revisadas com essas referências; a publicação continua exigindo revisão humana. Não são publicados automaticamente textos de IA.

## Modelo e controle de uso

O modelo fixo é `gemini-3.5-flash-lite`, com raciocínio `minimal`. O 3.8 Flash excedeu o prazo de geração nas verificações; o Flash-Lite produziu uma síntese válida de cinco seções, com referências às duas páginas de um manual fictício. Não há fallback automático para outro modelo ou para serviços pagos.

Continuam os limites persistentes de cinco inícios por dia UTC e dois por minuto, para todo o projeto. Pesquisas não geram chamadas ao modelo. Falhas não são repetidas em loop.

Condições verificadas em 17/10/2026: [preços Gemini](https://ai.google.dev/gemini-api/docs/pricing), [níveis de raciocínio](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [restrições de chaves](https://ai.google.dev/gemini-api/docs/api-key), [SQLite no Workers Free](https://developers.cloudflare.com/durable-objects/platform/limits/).

## Consentimento de envio de conteúdo

O proprietário autorizou explicitamente o envio dos dois manuais de validação e a geração automática pelos manuais cadastrados, após ser informado do destino Gemini/Google e do tratamento de dados do plano gratuito. `KNOWLEDGE_FROM_MANUAL=true` e `ALLOW_MANUAL_AI=true` habilitam agora esse fluxo. Ter uma chave, por si só, não é tratado como consentimento; o backend conserva a trava quando `ALLOW_MANUAL_AI` não for `true`.

A tentativa inicial sem consentimento foi rejeitada pela revisão automática e não foi executada. Depois da autorização explícita, os dois índices locais já preparados foram enviados ao modelo para a validação real. Não foi necessário repetir a extração ou o OCR. Uma chave adicional colada pelo usuário no chat não foi usada; permanece em uso somente a chave privada já configurada pelo assistente no servidor.

## Evidências vinculadas ao manual

Os testes reais detectaram que o modelo podia parafrasear citações e, assim, invalidar todas as seções. O manual agora é enviado integralmente como trechos identificados por documento e página, sem omitir texto. O modelo seleciona um `evidenceId`; o servidor resolve a citação a partir do trecho original e verifica que ele pertence à página e ao documento indicados. IDs inexistentes, página incorreta ou evidência de outro documento são recusados. O texto didático continua identificado como não revisado: uma referência válida não prova, sozinha, que toda a explicação esteja correta.

## Verificação

- Suítes do aplicativo e Worker, com rede externa bloqueada; regras testadas somente no projeto demo.
- Chrome: índice legado, busca com página de PDF, falha sem falso zero, editor e guia publicado.
- Fila: preparo concluído, ausência de geração sem consentimento, geração única após habilitação simulada, persistência sem nova consulta após recriar a fila.
- Resident Evil PT-BR: 22/22 páginas legíveis, 100.116 caracteres, sem OCR.
- Sina da Sociedade: 24/24 páginas legíveis com OCR, 46.186 caracteres.
- Geração real autorizada de Resident Evil: 12 seções aceitas, com referências às páginas 4, 18, 8, 9, 17, 12, 13, 11 e 19.
- Geração real autorizada de Sina da Sociedade: 14 seções aceitas, com referências às páginas 2, 9, 4, 10, 13, 14, 12 e 19.
- Índices, respostas do provedor e sínteses de validação ficam privados em `.secrets/manual-validation`, fora do Git e separados dos registros reais do acervo. A validação não publicou guias nem modificou os cadastros existentes. No aplicativo, o resultado de cada geração autorizada fica no registro persistente do Worker.

Não houve commit, push ou publicação do frontend GitHub Pages. O localhost usa os arquivos atuais; publicar o frontend continua uma ação separada. Não foram removidos usuários, jogos, PDFs, capas ou guias existentes.
