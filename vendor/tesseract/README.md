# OCR local — distribuições oficiais

- Tesseract.js **6.0.1**, Apache-2.0: https://github.com/naptha/tesseract.js/tree/v6.0.1
- Tesseract.js-core **6.1.2**, Apache-2.0: https://github.com/naptha/tesseract.js-core
- Modelos `tessdata_fast` **4.1.0**, Apache-2.0: https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0

As distribuições foram obtidas dos pacotes oficiais npm, sem executar scripts de instalação, e os modelos diretamente do repositório oficial com tag fixada. `models.json` registra URL e SHA-256 do conteúdo original de cada modelo. Licenças estão preservadas neste diretório.

Só são carregados o motor LSTM (SIMD e alternativa sem SIMD), o worker do navegador e os modelos português/inglês/francês. Código/modelos são hospedados junto com o site. OCR processa imagens renderizadas pelo PDF.js no dispositivo; nenhuma página/PDF é enviada para serviços externos.

Carregamento é sob demanda; esses arquivos não entram no precache inicial da PWA. Após uso online podem ser mantidos no cache local. Não há API, chave, faturamento, tradução automática ou geração de regras.
