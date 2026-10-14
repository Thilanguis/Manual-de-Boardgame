# Dependências de navegador

PDF.js 5.6.205, build `legacy`, distribuído pela Mozilla sob Apache-2.0. Os módulos, worker, CMaps, fontes e recursos WASM ficam locais para leitura de PDF sem CDN. A licença original acompanha `pdfjs/LICENSE`; o CSS de seleção de texto é extraído da distribuição dessa versão. Não alterar módulos minificados/gerados diretamente.

Fonte: https://github.com/mozilla/pdf.js e https://mozilla.github.io/pdf.js/getting_started/

Firebase 13.0.0 (App, Auth e Firestore) é importado em módulos ES pela CDN oficial `www.gstatic.com` somente quando a biblioteca na nuvem é selecionada. O Service Worker mantém em cache apenas os módulos carregados dessa versão. O aplicativo usa Spark e não chama Firebase Storage ou Cloud Functions.
