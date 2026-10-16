# Limpeza local do Acervo — 16/10/2026

Medições em MiB (1 MiB = 1.048.576 bytes), pelo tamanho lógico dos arquivos; não equivalem necessariamente ao espaço alocado no disco. O total antes da limpeza do projeto era 1111,98 MiB. Foram removidos **133,59 MiB (140,078,924 bytes)** em 511 arquivos. A medição final inclui apenas um pequeno relatório novo além do trabalho preservado.

| Pasta | Antes (MiB) | Depois (MiB) |
|---|---:|---:|
| `test-output` | 35,99 | 2,84 |
| `test-output/development` | 0,22 | 0,00 |
| `.test-tools` | 329,57 | 246,86 |
| `node_modules` | 346,11 | 346,11 |
| `worker/node_modules` | 169,76 | 169,76 |
| `tests/runtime/node_modules` | 32,35 | 32,35 |
| `worker/.build` | 0,76 | 0,76 |
| `public` | 17,67 | 0,00 |
| `.firebase` | 0,02 | 0,00 |
| `.build` | 0,00 | 0,00 |
| `PDFs` | 137,65 | 137,65 |

## O que foi removido

- ZIPs `java21.zip` e `node24.zip`, mantendo as instalações extraídas.
- Capturas antigas, relatórios gerados, logs, PDF simulado, pacotes temporários do OCR e builds de teste em `test-output`.
- Banco fictício, arquivos simulados e exportações dos emuladores em `test-output/development`.
- Cópia gerada do site em `public`, cache local de Hosting e pequeno diretório gerado `.build` da raiz.
- Log `firestore-debug.log`.

O PDF real `test-output/catan-pt.pdf` permanece. A pasta `PDFs`, fontes, documentos, configurações, credenciais e alterações locais foram preservados. A comparação SHA-256 conferiu os arquivos protegidos; a única ausência encontrada no inventário foi o log explicitamente descartável removido acima.

## Serviços e isolamento

O servidor auxiliar `scripts/serve.mjs` na porta 4174 foi identificado e encerrado. Firebase Emulators e Worker já estavam desligados. A verificação final não encontrou listeners nas portas 4173, 4174, 4181, 8080, 9099, 8787, 8788, 4400, 4500 e 9150 nem processos identificáveis de emuladores/Worker do Acervo. Outros programas foram preservados.

Nenhuma alteração de configuração de conexão foi feita. O localhost continua isolado e não passa automaticamente para produção. Nenhum teste, consulta de produção, commit, push ou deploy foi executado. O banco fictício será recriado pelo seed na próxima execução de `npm run dev`; o código e as ferramentas dos emuladores permanecem disponíveis.

## Principal ocupação fora do projeto — apenas diagnóstico

- `C:\Users\gabri\.codex`: aproximadamente 7,93 GiB; sessões respondem por 6,59 GiB.
- Um único histórico de sessão tem aproximadamente 5,16 GiB. A data da última modificação observada foi 14/10/2026. Isso identifica a ocupação atual, não mede sua taxa histórica de crescimento.
- Runtimes compartilhados em `.cache/codex-runtimes`: aproximadamente 1,30 GiB.
- Cache compartilhado dos emuladores Firebase: aproximadamente 130,37 MiB.
- Cache padrão de navegadores `C:\Users\gabri\AppData\Local\ms-playwright` não foi encontrado.

Essas pastas compartilhadas não foram limpas: históricos, plugins, ferramentas e runtimes podem ser usados pelo Codex e por outros projetos. Remover sessões pode perder contexto/conversas; essa ação exige uma decisão separada. Não foi executada limpeza global.

## Como limitar o crescimento

1. Encerrar com `npm run dev:stop` ou Ctrl+C ao terminar. Não usar reset para encerrar: ele recria dados fictícios.
2. Após conferir os resultados, descartar capturas, logs e fixtures simulados antigos de `test-output`. Evitar acumular versões e PDFs preenchidos artificialmente para testes de tamanho.
3. Manter manuais reais exclusivamente em `PDFs` e no armazenamento previsto; `test-output` deve conter somente resultados descartáveis. O Catan existente não foi movido automaticamente.
4. Gerar `public` somente quando necessário; `npm run build` o recria. Os builds do Worker e seus caches são pequenos atualmente.
5. Não remover `node_modules`, Java ou Node portáteis indiscriminadamente. Eles são instalações necessárias/reutilizáveis, não o principal crescimento observado. Os manifests e lockfiles ficam preservados para reinstalação futura.
6. Evitar imprimir conteúdo de PDFs inteiros, dados base64 e saídas volumosas de testes nas conversas do Codex. Gravar relatórios em arquivos e mostrar resumos reduz a produção de novos históricos grandes. O conteúdo dos históricos existentes não foi inspecionado, portanto não se atribuiu uma causa específica ao arquivo de 5,16 GiB.

