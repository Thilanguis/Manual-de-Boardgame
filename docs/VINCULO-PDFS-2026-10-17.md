# PDFs enviados e vínculos no cadastro — 17/10/2026

## Diagnóstico em leitura

Uma consulta restrita ao título Betrayal at House on the Hill confirmou um cadastro com somente `documents.main`, correspondente ao livro de regras de 13 páginas. A ficha mostrava o conteúdo efetivamente registrado; não era suficiente corrigir apenas sua renderização.

As regras publicadas foram lidas e comparadas às locais: são iguais. Os módulos servidos no localhost habitual também correspondem ao workspace. As consultas do Google Drive encontraram o principal ativo na pasta configurada, mas não localizaram os complementos pelos nomes informados. Isso não identifica, por si só, a falha histórica nem autoriza inventar vínculos.

Os registros usados para diagnóstico estão em `.secrets/document-diagnosis`, ignorados pelo Git. Nenhuma credencial foi impressa. Não houve alteração em dados, regras, arquivos ou serviços de produção.

## Correção implementada

- O vínculo de cada PDF é gravado em uma transação que relê o cadastro atual e altera somente documentos, principal, idioma e data. Não regrava uma cópia antiga de todo o jogo depois de um upload demorado.
- A conversão do manual legado e a inclusão do primeiro complemento passam a ocorrer juntas. Não há uma gravação intermediária que registre apenas o principal como se o lote estivesse concluído.
- A versão anterior do documento é capturada antes do upload e conferida na transação; uma substituição concorrente não é sobrescrita.
- Depois da gravação, há releitura do servidor para conferir documento, hash e arquivo Drive. Antes de fechar o cadastro, todos os complementos selecionados são conferidos novamente e a biblioteca recebe o registro confirmado.
- Se o Drive recebeu o arquivo, mas o vínculo falhou, a sessão de envio é preservada. A tentativa seguinte usa o upload concluído, em vez de apagá-lo e reenviar os mesmos bytes.
- As informações de uploads concluídos com vínculo pendente ficam no cache privado criptografado, vinculadas ao projeto e usuário. Sobrevivem ao reload; o logout continua limpando o cache privado. Acesso e conclusão exigem permissão de edição.
- Quando existe uma dessas pendências, a ficha e Gerenciar jogo mostram **Concluir cadastro dos PDFs**. Essa ação valida novamente a sessão no servidor, confere o arquivo, grava os vínculos e finaliza os mesmos arquivos. Não cria outro upload nem substitui metadados de um documento já vinculado.
- O Live Server foi configurado para ignorar logs, resultados dos testes, caches e arquivos privados; a configuração do servidor é aplicada quando ele é iniciado novamente. Durante leitura/upload, a página também solicita confirmação antes de sair. O servidor habitual do usuário não foi reiniciado nesta tarefa.

O protocolo usado para conferir o upload concluído já existe no Worker. A consulta de status segue a [documentação oficial do Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads#resume-upload). Não foram introduzidos serviços pagos ou novas credenciais no frontend.

## Testes realizados

- 121 testes do aplicativo aprovados, incluindo novas regressões de atualização concorrente, falha após upload, proteção de substituições e permissões das pendências.
- Navegador com Auth/Firestore emulados e Worker real usando Drive simulado: manual local de Betrayal (13 páginas) e três complementos, com metadados copiados do diagnóstico somente para o projeto demo. Nenhum desses testes escreveu em produção ou enviou PDFs ao Gemini.
- Fluxo: principal → **Adicionar mais PDFs** → três complementos → confirmar → salvar. Falha de vínculo provocada depois dos quatro PDFs chegarem ao Drive simulado; reload; recuperação das pendências; quatro documentos confirmados no Firestore, na ficha e no seletor do leitor; mesmos IDs de arquivo antes/depois, sem novos PDFs.
- Metadados corrigidos em outra sessão entre o envio e a recuperação foram preservados.
- Cadastro com três arquivos selecionados de uma vez, fonte pública, análise única, consulta sem novas gerações, revisão de dados e permissões continuaram passando no fluxo de integração existente.
- Os testes locais de seleção, arquivos inválidos, retirada, nomes, tipos, leitura separada, substituição, principal, remoção e responsividade passaram.

O simulador do Drive foi corrigido para responder ao status de sessões já concluídas, conforme o protocolo documentado. Ele não deve tratar todo upload concluído como sessão imediatamente expirada.

## Limite da recuperação

A recuperação protege os envios feitos com esta implementação. Ela não permite reconstruir retroativamente metadados de arquivos que uma versão anterior não registrou nem encontrar arquivos ausentes somente pelo título. O cadastro real consultado não foi modificado nem anunciado como recuperado. Os três PDFs complementares originais não estavam disponíveis localmente para testar seus conteúdos exatos.

Sem commit, push ou deploy.
