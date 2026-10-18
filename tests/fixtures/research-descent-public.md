Capturas reais das APIs públicas Wikidata/Wikipédia, obtidas em 18/10/2026 pelo script opt-in `scripts/capture-public-research.mjs`. Nenhuma consulta a Firebase, Drive ou Gemini.

`research-descent-public.json.gz` contém URL completa, data UTC, status HTTP, corpo original e SHA-256 por resposta. `tests/public-research-replay.mjs` verifica os hashes e rejeita URLs ausentes, sem fallback de rede. As respostas incluem resultados negativos e entidades descartadas; os testes não fabricam seus metadados.

Consultas: Descent: Lendas da Escuridão / Descent: Legends of the Dark; As Ruínas Perdidas de Arnak / Lost Ruins of Arnak. Fatos Wikidata: CC0 (https://www.wikidata.org/wiki/Wikidata:Licensing). Introduções Wikipédia: CC BY-SA 4.0, autores/histórico disponíveis nas páginas indicadas em cada resposta (`curid`/título); os textos originais ficam preservados. O relatório do diagnóstico relaciona as entidades/artigos efetivamente utilizados.

O PDF oficial de teste não integra esta fixture nem o Git: https://cdn.svc.asmodee.net/production-asmodeeca/uploads/2023/10/84-descent-legends-of-the-dark-rulebook.pdf. Sua leitura é local; não há nova chamada Gemini. Informe seu caminho via ACERVO_DESCENT_PDF para o teste de navegador. O arquivo brasileiro usado pelo usuário não foi disponibilizado para inspeção.
