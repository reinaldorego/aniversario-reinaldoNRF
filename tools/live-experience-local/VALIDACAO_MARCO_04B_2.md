# Validação — Marco 04B.2

Base inicial verificada: feature/live-experience, HEAD 1f6b5d6, árvore limpa. Implementação e testes exclusivamente locais, com dados e identidades sintéticos.

## Resultado

- npm.cmd run check: sintaxe válida em 12 arquivos JavaScript.
- npm.cmd test: **101 testes/subtestes aprovados; zero falhas, cancelamentos ou skips**.
- Regressão: os 33 testes/subtestes do 04B.1 continuam aprovados, sem editar sua suíte ou baseline de preservação.
- Novos: 68 testes/subtestes, distribuídos por 19 cenários principais D01–D19.
- Não houve SDK, instalação de dependências, chamada Google, login, OAuth, credencial ou requisição à internet. O HTTP exercitado é somente loopback.
- Um primeiro ensaio detectou uma expectativa incorreta em D05 após recuperação de falha transitória. Corrigido o teste para verificar ausência de checkpoint no ciclo falho e admitir checkpoint apenas em reconciliação posterior válida, com publicação ainda pausada. A suíte final passa integralmente.

## Evidências dos requisitos

| Pedido / teste | Resultado final |
| --- | --- |
| E01 / D01 — dois publicadores | Pasta/ancestrais/arquivo permitidos por permissionIds configurados; publicação automática após estabilidade, processamento e revalidação. |
| E02 / D02 — terceiro escritor | Negado para owner, writer, organizer, fileOrganizer e também leitores/commenters externos; nome/e-mail não conferem papel. |
| E03 / D03 — anyone/group/domain | Negados inclusive como reader. |
| E04 / D04 — herança insegura | Negados ancestral externo, writer herdado e inheritedFrom desconhecido. |
| E05 / D05 — ACL indeterminada | Bloqueio por visibilidade não atestada, resposta parcial, 403, ausência de escritor, papel desconhecido ou ancestral cíclico. |
| E06 / D06 — páginas | Três fotos em páginas distintas e permissões paginadas; query de parent exata, não trashed e filtro defensivo. |
| E07 / D07 — tokens | Token repetido/inválido e campos ausentes falham sem checkpoint parcial. |
| E08 / D08 — incompleteSearch | Rejeitado, assim como inventários diferentes entre os dois passes. |
| E09 / D09 — erros | Matriz de 15 casos: 403/404/429/500/timeout em files.list, permissions.list e obtenção de conteúdo. |
| E10 / D10 — ACL durante operação | Mudança no worker e no último gate impede PUBLISHED e mantém pausa. |
| E11 / D11 — retirada | Parent fora da pasta e trashed geram retirada; 404 ambíguo preserva estado e bloqueia leitura não verificável. |
| E12 / D12 — falha temporária | Três publicados preservam estados/revisão/checkpoint em falha; falso inventário vazio é recusado pela consulta individual. |
| E13 / D13 — versão/substituição | Bytes novos com mesmo modifiedTime exigem nova geração e estabilização; versão nova com mesmos bytes não duplica processamento. |
| E14 / D14 — duplicatas | SHA-256 mantém um processamento/card; cópia não é promovida após retirada do canônico. |
| E15 / D15 — job antigo | Callback após retirada é STALE; pausa não impede retirada e retomada não ressuscita a foto. |
| E16 / D16 — checkpoint/reinício | Falha na segunda página não avança; nova instância restaura inventário e começa paginação na primeira página, recuperando processamento sem duplicar efeitos. |
| E17 / D17 — privacidade | API real de loopback não contém Drive IDs, ACL, nomes, e-mails, hashes, description ou checkpoint privado. |
| E18 / D18 + T01–T21 — regressão | Arquivo da suíte anterior conserva SHA-256; todos os 33 testes/subtestes passam; cliente não dispõe de transporte Google. |
| Adicional / D19 | MD5/tamanho inconsistentes, versão ausente, alteração durante download e troca de identidade da fonte são bloqueados. |

## Interpretação

D16 reabre armazenamento persistido e cria outra instância de DriveSource sobre a mesma origem em memória; não homologa um processo Google real. O teste de processo interrompido do 04B.1 permanece na regressão T09.

A semântica de ACL é apenas a dos mocks. A flag aclVisibility é contexto sintético de teste, não garantia de completude fornecida pela API real. Não há homologação OAuth, conta, identidade humana, cotas, custos, rede móvel, Google Drive ou publicação em produção.

Todos os 31 arquivos protegidos pela baseline anterior mantêm seus hashes. Alterações funcionais preexistentes limitadas a src/engine.mjs, para a interface de fonte. README do módulo atualizado; convite, galeria, RSVP, QR, check-in, SW/manifest, documentos de arquitetura e Documento Mestre preservados.

Nenhuma migração de estado filesystem para Drive foi executada. Estado de fonte distinta é rejeitado, sem apagar dados. Os temporários são exclusivos dos testes e seus servidores encerram ao terminar. Nenhum commit, push, merge ou deploy.

Contratos, campos e pendências: [DRIVE_MOCK.md](DRIVE_MOCK.md).
