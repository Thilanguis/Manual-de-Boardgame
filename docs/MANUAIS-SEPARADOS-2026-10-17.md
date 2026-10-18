# Manuais separados por jogo

Cada documento mantém seu ID, nome, arquivo, hash, número de páginas e progresso de leitura. O cadastro múltiplo inspeciona e envia cada PDF individualmente; não concatena arquivos nem soma páginas para exibição na lista.

A lista passou a mostrar o nome de todos os PDFs, inclusive o principal. Antes, o nome do principal era substituído por “Manual principal”, e os complementos tinham nome e informações misturados na mesma linha. Agora, cada item mostra nome, tipo, idioma, páginas e ação de leitura. Nomes personalizados e números do nome original são preservados.

O leitor mantém o PDF original e oferece “Manual em leitura” quando há mais de um documento. A troca carrega o documento escolhido e restaura apenas seu progresso. As referências de pesquisa continuam indicando o documento e a página correspondentes.

Validação: `npm test` (108 testes) e `tests/documents-browser.mjs`, com PDFs sintéticos separados de 13, 60 e 8 páginas. O teste confere três registros e três itens visíveis, conteúdo e paginação reais de cada arquivo, progresso independente, recarga, troca do principal, substituição e remoção individual. Verificado em computador, tablet e celular, sem serviços de produção.

Nenhum PDF ou cadastro existente no Drive/Firestore foi modificado. Um arquivo já combinado antes do envio permanece um único PDF; esta alteração não o divide automaticamente. Um arquivo ausente do cadastro não é recriado pela alteração visual.
