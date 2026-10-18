# Cadastro e edição — fluxo consolidado

Esta revisão substitui a distribuição de ações descrita em `FICHA-GEMINI-CONSENSO-2026-10-18.md`. As validações de evidência e consenso daquela implementação continuam valendo.

## Fluxo do usuário

1. **Identificar jogo:** selecionar um ou vários PDFs, conferir título, capa e documentos. A importação não pesquisa na internet nem inicia Gemini.
2. **Conferir informações:** todos os campos ficam nesta etapa. Dados extraídos e sugestões já armazenadas são recuperados sem gerar IA. **Completar informações** coordena o PDF/OCR, as fontes públicas disponíveis e o conhecimento Gemini. Resultados válidos são aplicados diretamente à ficha; alterações manuais são preservadas. Apenas conflitos pendentes exigem escolha na revisão consolidada.
3. **Publicar:** conferir o resumo, confirmar e **Adicionar à biblioteca** ou **Salvar alterações**. Salvar não inicia análise. A etapa final interrompe consumidores de sugestões para impedir mudanças tardias após a conferência.

Para um jogo existente: **Gerenciar jogo → Informações → Editar informações → Completar informações → Salvar alterações**. O editor abre diretamente na segunda etapa. **Informações** mostra somente valores persistidos e “Não informado” para lacunas; não consulta conhecimento nem apresenta sugestões como dados salvos.

**Gerenciar jogo → Regras** contém a manutenção separada: resumo do conhecimento, **Atualizar conhecimento com IA**, detalhes, referências e **Salvar correção**. O fluxo de correção continua disponível. Consultar regras não mudou.

Foram retirados do cadastro os botões **Pesquisar fontes**, **Ampliar pesquisa**, **Ler texto das primeiras páginas**, **Conferir informações** dentro de outro cartão e **Revisar sugestões encontradas**. O avanço normal entre etapas continua existindo. A consulta manual ao BGG permanece recolhida e identificada como externa. **Cancelar pesquisa** cancela a operação coordenada; não cria outra forma de completar a ficha.

## Coordenação, persistência e consumo

- `information-flow.js` controla a leitura inicial, a geração explícita e o ciclo de vida do acompanhamento. Usa o observador compartilhado existente, sem novo listener Firestore. Só acompanha periodicamente um resultado em andamento, enquanto o editor estiver aberto; fecha ao cancelar, concluir a conferência, fechar a tela ou perder permissão.
- Uma leitura inicial pendente cancelada não pode iniciar geração depois do cancelamento. Respostas de outra conta, edição ou conjunto de hashes são ignoradas.
- Resultado pronto, inclusive legado sem a ficha nova, é reutilizado. Abrir, voltar e editar não provocam regeneração. Para refazer conhecimento pronto, usar a ação explícita de manutenção de regras.
- Se uma análise explicitamente solicitada aguarda índices, a notificação de preparação concluída permite continuar essa solicitação. Não cria polling do catálogo ou geração espontânea.
- O rascunho tem modo `cachedOnly`: abrir a etapa apenas recupera o cache privado. A análise completa e o OCR acontecem pelo comando explícito, reutilizando checkpoints. Se IA estiver indisponível, a extração local e as fontes públicas continuam utilizáveis.
- Pesquisas guardam cache privado local durante a edição. O histórico compartilhado e a ficha só são gravados pelo salvamento normal. Resultados Gemini continuam armazenados separadamente no coordenador existente.
- A fila automática usa `reuseOnly`: pode adotar conhecimento do rascunho após conferir os índices autorizados, mas não pode iniciar Gemini nem consumir outra unidade de cota. O Worker anuncia `knowledgeReuseProtocol: 1`; contra uma versão antiga sem esse suporte, o frontend evita enviar essa operação automática.
- A lógica editorial das regras não foi alterada. Transferência única de PDF, restauração da fila e observação compartilhada continuam preservadas. A única mudança da fila é impedir nova geração automática.
- Não há nova coleção, banco, projeto, serviço pago, dependência ou alteração de regras de segurança. Testes utilizam somente `demo-acervo`, integrações simuladas e PDFs locais.

## Verificações

Resultado: **157 testes do aplicativo, 86 do Worker e 27 de segurança aprovados**, integração de navegador concluída e build do Worker em dry-run aprovado. Nenhuma chamada aos serviços reais.

As suítes incluem: cadastro inicial com três PDFs e retomada de upload; dados nos inputs antes de existir cadastro; edição com lacunas; conhecimento já salvo; conclusão tardia sem outro clique; cota; formato antigo; edição manual; voltar entre etapas; recarga; inspeção do documento emulado antes e depois de salvar; consultas e correções de regras; revogação de acesso; computador, tablet e celular.

Testes específicos cobrem cancelamento durante a leitura inicial e comprovam que `reuseOnly` não chama o provedor nem consome cota. As regressões do leitor verificam uma transferência por abertura, zoom, rolagem e PDFs distintos. As 17 consultas com PDFs locais continuam sem chamadas Gemini.

Logs: `test-output/firestore-fixes/flow-unit.log`, `flow-worker.log`, `flow-integration.log` e `flow-rule-quality.log`. Capturas: `flow-editor-1440.png`, `flow-editor-768.png` e `flow-editor-390.png`.

## Publicação

Implementação local. Frontend e Worker precisam ser publicados em conjunto, somente mediante autorização. Nenhum commit, push, deploy ou alteração de dados de produção foi realizado nesta tarefa. Os arquivos anteriormente staged permanecem preservados; esta revisão não modifica o índice Git.
