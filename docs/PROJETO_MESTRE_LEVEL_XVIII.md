# LEVEL XVIII — REINALDO 18 LIVE EXPERIENCE

**Documento Mestre de Requisitos e Continuidade**

**Versão:** 1.0 (baseline de planejamento)

**Data:** 07/11/2026

**Responsável pelo projeto:** Reinaldo Rêgo

**Status:** especificação inicial para revisão técnica pelo Codex; **não** atesta que mudanças recentes estejam publicadas.

> **Objetivo deste documento:** ser a fonte central de decisões, escopo, requisitos e critérios de aceite para evoluir o convite já existente. Antes de modificar qualquer código, o Codex deve ler este documento, o histórico do projeto e os arquivos reais do repositório. Em caso de divergência entre o documento e a implementação, **não sobrescrever a implementação**; registrar o conflito e pedir validação da alteração proposta.

---

## 1. Visão do produto

Transformar o convite digital interativo **LEVEL XVIII** em uma experiência contínua para os 18 anos de **Reinaldo NR Filho**:

1. **Antes do evento:** convite cinematográfico, acesso individual, confirmação de presença, Access Pass e orientações.
2. **Na chegada:** QR Code de credenciamento e check-in já desenvolvido no ecossistema existente.
3. **Durante a festa:** acesso pelo celular ao **REINALDO 18 — LIVE EXPERIENCE**, com galeria de fotos atualizada a partir de publicações do organizador e do fotógrafo oficial.
4. **Após a festa:** acesso à galeria como álbum digital de lembranças.

**Princípio central:** a evolução deve ampliar o projeto sem romper o convite, os links individuais, o RSVP, o QR Code, o Access Pass ou o check-in já aprovados.

## 2. Dados oficiais do evento (alteração aprovada em novembro)

| Campo | Valor | Situação |
| --- | --- | --- |
| Aniversariante | Reinaldo NR Filho | Confirmado |
| Comemoração | 18 anos | Confirmado |
| **Data da festa** | **28/11/2026 (sábado)** | **Novo dado definitivo** |
| **Início** | **21h, horário de Belém (UTC−03:00)** | **Novo dado definitivo** |
| Local | Salão de festas do Edifício Dhahram | Confirmado |
| Endereço | Travessa Vileta, nº 1197 — Belém/PA | Confirmado |
| Identidade | Dark Cinematic / Black & Gold Tech | Aprovado |
| Imagem do convite | Nova fotografia enviada do aniversariante (camisa clara, cenário externo) | Substituição solicitada; conferir asset local |
| Informações de acompanhantes | **Não exibir no card principal** | Aprovado |
| Card substituto | **LIVE EXPERIENCE / Momentos ao vivo** | Aprovado |
| Prazo para RSVP | Data anterior era 01/11/2026, agora ultrapassada | **Pendente redefinição/decisão** |

**Atenção:** versões anteriores do site, dos arquivos gráficos, da planilha e do Apps Script podem conter **15/11/2026 às 20h**. Estes são dados históricos do convite e **não** correspondem ao evento atualizado. A data de aniversário pessoal e a data da festa não devem ser confundidas.

## 3. Ativos existentes e histórico validado

### 3.1 Repositório e publicação conhecidos

- Repositório: <https://github.com/reinaldorego/aniversario-reinaldoNRF>
- Publicação do convite: <https://reinaldorego.github.io/aniversario-reinaldoNRF/>
- Branch de produção documentada anteriormente: `main`.
- Pilha anterior do convite: `HTML`, `CSS`, `JavaScript`, `manifest.webmanifest`, `sw.js` e `assets/`.
- Backend existente documentado: **Google Apps Script + Google Sheets**, com abas `CONFIG`, `CONVIDADOS`, `LOGS`.

**Estado histórico documentado em 20/09/2026:** versão Mobile V2 publicada e fluxo de convite, RSVP, Access Pass, QR Code, retorno ao Countdown e check-in validado em teste. **Estado real em 07/11/2026:** a ser auditado pelo Codex no repositório/implantação; não presumir que todos os componentes continuam idênticos.

### 3.2 Comportamentos existentes a preservar

- Link individual por convidado, incluindo token válido quando exigido.
- Entrada pelo convite público, seguida de confirmação controlada.
- RSVP pelo Apps Script com atualização da planilha e registros de log.
- Access Pass individual com QR Code para check-in.
- Check-in controlado por equipe autorizada, com proteção de acesso e duplicidade.
- Retorno após confirmação à seção `04 // COUNTDOWN`, preservando token/contexto; implementação histórica baseada em parâmetro de confirmação e âncora `#countdown`.
- Possibilidade de reabrir o Access Pass.
- Site responsivo e a estética visual já validada.
- Evolução do Apps Script por **nova versão da implantação existente**, sem mudar o endereço público sem planejamento e testes.

**Segurança:** não registrar neste repositório senhas, PINs, credenciais, tokens reais de convidados, segredos de API ou dados pessoais de teste. Configurações sensíveis devem permanecer fora do código público. Os tokens de teste anteriores **não** são para distribuição.

### 3.3 Fontes de referência anteriores

- `ESTADO_ATUAL_CONVITE_REINALDO_NRF_2026-09-20.md` (registro histórico existente no acervo do projeto).
- `ESTADO_MESTRE_CONVITE_REINALDO_NRF_2026-09-14.md` (registro histórico existente no acervo do projeto).
- Código-fonte real e histórico Git como evidência final para decidir o que é funcional.

## 4. Escopo funcional

### RF-01 — Convite digital

- Exibir identidade cinematográfica LEVEL XVIII e a nova foto do aniversariante sem alterar seus traços faciais.
- Atualizar textos, data e horário para **28/11/2026 às 21h**.
- Atualizar contador regressivo no fuso `America/Belem` / UTC−03:00, sem depender do fuso do visitante.
- Exibir local e abrir rota/localização em aplicativo de mapa.
- Evitar informações obsoletas incorporadas ao próprio arquivo de imagem (data, horário, dia da semana, botão não clicável).
- Manter leitura confortável e animações moderadas no celular; respeitar preferência por redução de movimento.

### RF-02 — Confirmação e credenciamento existentes

- Manter o fluxo de RSVP tokenizado já validado.
- Preservar dados de convidados e acompanhantes na área de RSVP/admin, sem exibir a regra de acompanhantes no card principal do convite.
- Não ampliar, reduzir nem remover o limite de acompanhantes automaticamente; a regra atual deverá ser auditada e eventualmente redefinida pelo responsável.
- Preservar Access Pass, QR Code, check-in e logs existentes.
- Revisar o prazo de RSVP e o comportamento após vencimento **antes** de publicar atualizações.

### RF-03 — Card LIVE EXPERIENCE integrado ao convite

- Substituir o card de acompanhantes da seção `02 // THE EVENT` por **LIVE EXPERIENCE**.
- Exibir título curto como **Momentos ao vivo** e descrição como **Acompanhe os registros da festa pelo celular**.
- Card deve ter navegação real para a página da galeria, acessível por caminho estável dentro do mesmo projeto ou submódulo compatível.
- **Antes do evento:** indicar "Em breve" sem prometer fotos existentes.
- **Durante o evento:** permitir acesso à galeria atualizada.
- **Após o evento:** dar acesso ao álbum de lembranças.

### RF-04 — Galeria de fotos (somente visualização para convidados)

- Interface **mobile-first**, adaptável a diferentes telas e conexões.
- Grid/mosaico e visualização ampliada da foto selecionada.
- Mostrar somente fotos autorizadas/publicadas.
- Atualização de novas fotos sem obrigar o convidado a recarregar a página inteira; prever atualização manual de contingência.
- Estado vazio amigável, carregamento, falhas de rede e retorno à navegação.
- Ordenação cronológica e carregamento progressivo de imagens; otimizar tamanho das prévias.
- A galeria deve continuar acessível após o evento como álbum digital, conforme regras de publicação e retenção definidas.

### RF-05 — Publicação restrita de fotografias

- **Somente Reinaldo Rêgo e o fotógrafo oficial** podem enviar/publicar imagens.
- Convidados têm acesso de leitura às fotos, sem formulário de upload e sem credenciais de publicação.
- Fluxo de autenticação/autorização dos dois publicadores deve ser definido e testado.
- Google Drive será a fonte de armazenamento dos originais; não tornar a pasta privada inteira pública por conveniência.
- Controlar estados de imagem quando adotados (por exemplo: recebida, publicada, retirada) e permitir retirar uma imagem da galeria.
- Guardar metadados mínimos para data, origem, ordem e publicação; não expor dados sensíveis em URLs públicas.

### RF-06 — Controle administrativo

- Painel privado com acesso restrito para administrar fotos/publicações e acompanhar falhas de atualização.
- Exibir status de sincronização e última atualização de forma honesta; não apresentar "ao vivo" se estiver sem comunicação.
- O módulo de fotos não deve poder alterar convidados, confirmações ou check-ins sem autorização explícita e necessidade técnica.

### RF-07 — Experiência durante e depois da festa

- Convidados acessam conteúdo **exclusivamente pelo próprio celular**, por link do convite e/ou QR Code específico da galeria.
- **Não haverá telão, televisão, slideshow projetado ou módulo para exibição pública em tela no salão.**
- O QR da galeria, se criado, é diferente do QR do Access Pass/check-in; não alterar o QR já existente.
- Transição organizada: apresentação antes do evento → galeria durante a festa → álbum posterior.

### RF-08 — Privacidade e uso das imagens

- Definir política de acesso e compartilhamento (link do convite, público restrito, ou autenticação) antes de publicar fotos pessoais.
- Prever retirada/ocultação de imagens a pedido do organizador.
- Evitar exibição de dados pessoais de convidados em galerias públicas ou em metadados.
- Definir período de permanência do álbum e política de backup.

## 5. Fora do escopo aprovado

- Upload de fotos por convidados.
- Telão, televisão ou qualquer exibição de fotos projetada durante o evento.
- Rede social pública, ranking de convidados, comentários abertos ou compartilhamento automático em redes sociais.
- Reconhecimento facial, identificação biométrica, rastreamento individual de quem viu cada foto.
- Recriar sem necessidade os sistemas existentes de RSVP, QR e check-in.
- Migrar a infraestrutura do convite ou trocar URL pública sem análise e aprovação.

**Nota:** funcionalidades não listadas podem ser propostas como ideias, mas **não estão autorizadas para implementação automática** pelo Codex.

## 6. Arquitetura: existente versus proposta

### 6.1 Base existente (histórico; verificar em auditoria)

```text
Convite no GitHub Pages (HTML/CSS/JS/PWA)
        |
        +--> RSVP por token --> Google Apps Script --> Google Sheets
        |                                             CONFIG / CONVIDADOS / LOGS
        +--> Access Pass / QR --> Check-in do Apps Script
```

### 6.2 Evolução planejada (arquitetura de referência, a homologar)

```text
Convite LEVEL XVIII (GitHub Pages)
        |
        +--> [card LIVE EXPERIENCE]
                    |
                    v
        live-experience/ (frontend mobile-first)
                    |
                    v
        Serviço/API autenticado de publicação e leitura
                    |
          +---------+---------+
          |                   |
      Google Drive        Índice de fotos
      originais privados  (a definir)
          |
          v
      Pré-visualizações e fotos publicadas para convidados
```

**Restrição técnica:** GitHub Pages hospeda conteúdo estático; autenticação administrativa, acesso protegido ao Drive e credenciais de API não devem ser implementados somente no JavaScript público. O backend apropriado é uma **decisão arquitetural pendente**, que pode ser um serviço separado enquanto o convite mantém a hospedagem atual.

**Tecnologias consideradas em conversas anteriores, mas ainda não aprovadas como obrigatórias:** Next.js, Vercel, Supabase, Google Apps Script e Python. O Codex deve comparar necessidade, complexidade, custo e segurança antes de propor uma escolha final. **Não criar dependências pagas sem aprovação.**

## 7. Organização sugerida do repositório

```text
aniversario-reinaldoNRF/
├── index.html                   # existente; preservar
├── styles.css                   # existente; preservar
├── app.js                       # existente; preservar
├── sw.js                        # existente; preservar
├── manifest.webmanifest         # existente; preservar
├── assets/                      # existente; preservar
├── live-experience/             # novo módulo proposto
│   ├── index.html
│   ├── css/
│   ├── js/
│   ├── assets/
│   └── README.md
├── docs/
│   ├── PROJETO_MESTRE_LEVEL_XVIII.md  # este documento
│   ├── ESTADO_ATUAL.md                # gerar após auditoria
│   ├── ARQUITETURA_LIVE_EXPERIENCE.md # gerar após avaliação
│   ├── PLANO_IMPLEMENTACAO.md         # gerar após avaliação
│   └── REGISTRO_DECISOES.md           # opcional: decisões e alterações
└── README.md
```

Essa árvore é uma **proposta**, não uma declaração dos arquivos existentes. Não mover nada para corresponder a ela sem um plano aprovado. Se a estrutura real for diferente, manter a existente e documentar.

## 8. Requisitos não funcionais

| ID | Requisito | Critério esperado |
| --- | --- | --- |
| RNF-01 | Celular primeiro | Navegação legível, botões acionáveis e sem rolagem horizontal nos tamanhos testados. |
| RNF-02 | Desempenho | Miniaturas otimizadas, carregamento sob demanda e teste com conexão móvel. |
| RNF-03 | Robustez | Tratar conexão lenta/queda, fotos não encontradas e atualizações incompletas. |
| RNF-04 | Acessibilidade | Textos alternativos adequados, contraste, foco visível e redução de movimento. |
| RNF-05 | Segurança | Segredos fora do frontend/repositório; controle de acesso efetivo no servidor. |
| RNF-06 | Privacidade | Fotos disponíveis apenas conforme política explicitamente aprovada. |
| RNF-07 | Continuidade | Convite, RSVP, QR e check-in continuam funcionais após mudanças. |
| RNF-08 | Observabilidade | Registro mínimo de erros, sincronização e eventos de publicação sem expor dados pessoais. |
| RNF-09 | Recuperação | Backup recuperável e plano de reversão por versão/commit. |
| RNF-10 | Atualização | Objetivo de novas fotos aparecerem rapidamente; periodicidade e meta em minutos a definir em testes reais. |

## 9. Critérios de aceite por fluxo

### CA-01 — Convite

- [ ] Mostra 28/11/2026 (sábado), às 21h, no texto **e** nas imagens que apresentarem informações.
- [ ] Foto nova aprovada, sem alteração de identidade facial.
- [ ] Card de acompanhantes substituído por LIVE EXPERIENCE.
- [ ] Responsividade validada no celular e no desktop.
- [ ] Countdown usa a data/hora novas; não exibe tempo negativo.
- [ ] Navegação e links existentes preservados.

### CA-02 — RSVP / QR / Check-in (regressão obrigatória)

- [ ] Link individual com token válido abre o convite correto.
- [ ] RSVP grava na planilha e em logs corretamente.
- [ ] Access Pass abre com dados e QR individual.
- [ ] Equipe autorizada consegue fazer check-in.
- [ ] Tentativa duplicada permanece bloqueada.
- [ ] Retorno ao Countdown e reabertura do Access Pass continuam funcionando.
- [ ] Dados de testes não são distribuídos aos convidados reais.

### CA-03 — LIVE EXPERIENCE

- [ ] Antes da festa, card abre página de apresentação (sem dados simulados passando por reais).
- [ ] Durante a festa, fotos publicadas por organizador/fotógrafo aparecem no celular do convidado.
- [ ] Convidado não consegue enviar, excluir ou editar fotos.
- [ ] Usuário não autenticado não acessa recursos administrativos.
- [ ] Novo lote de fotos não exige recarregar a página inteira, quando a atualização estiver disponível.
- [ ] Galeria trata ausência de fotos e falha de internet.
- [ ] Álbum continua navegável após a festa, conforme política definida.
- [ ] Não existe módulo de telão ou slideshow para projeção.

## 10. Marcos de implementação — trabalho incremental

1. **M0 — Auditoria e preservação:** inspecionar `git status`, branch, estrutura, versões e implantações; confirmar backup; inventariar fluxos sem modificar código.
2. **M1 — Documentação:** reconciliar este Documento Mestre com o repositório; criar estado atual, arquitetura proposta, riscos e plano com aprovação humana.
3. **M2 — Atualizar convite:** nova foto, informações 28/11 21h, corrigir arte e countdown, trocar card; rodar testes de regressão RSVP/QR/check-in.
4. **M3 — Galeria estática de demonstração:** layout funcional com dados de teste explicitamente identificados, sem credenciais e sem alterar produção.
5. **M4 — Autenticação e integração com Drive:** restringir publicação a dois perfis, implementar acesso às fotos publicadas, carregamento incremental e recuperação de erros.
6. **M5 — Homologação no celular:** testes de acesso convidados, autorização de publicação, rede lenta, rotas, cache/PWA, segurança e privacidade.
7. **M6 — Publicação controlada:** preparar rollback, aprovar alteração, publicar e validar URLs; documentar resultado.

**Regra:** não avançar de marco sem evidência dos testes definidos e aceite do responsável.

## 11. Pendências e decisões explícitas

| ID | Tema | Decisão necessária / ação |
| --- | --- | --- |
| P-01 | Prazo RSVP | Redefinir o limite anterior (01/11/2026, já vencido) e atualizar as regras em todas as camadas aplicáveis. |
| P-02 | Nova foto | Identificar o nome/caminho do asset e composição final aprovada; confirmar se será retrato puro, hero com overlay ou nova arte estática. |
| P-03 | Publicação das fotos | Definir fluxo dos dois publicadores, aprovação/ocultação e limites de acesso. |
| P-04 | Acesso à galeria | Decidir entre acesso por link privado, token de convidado ou outro método adequado; evitar exposição involuntária. |
| P-05 | Backend e hospedagem | Validar opção técnica compatível com custo, segurança e desempenho. |
| P-06 | Regras de acompanhantes | Preservar dados do RSVP até decisão expressa sobre mudanças; remover apenas o card do convite. |
| P-07 | Prazo de álbum | Definir retenção, backup, retirada de imagens e encerramento do acesso. |
| P-08 | Identidade do fotógrafo | Configurar credenciais do fotógrafo oficial sem registrar dados sensíveis neste documento. |
| P-09 | Performance real | Validar atualização de fotos em conexões móveis no local, sem prometer latência ainda não testada. |
| P-10 | Estado de produção | Auditar se a versão histórica de setembro corresponde à versão atualmente publicada. |

## 12. Diretrizes obrigatórias para o Codex

1. **Ler este documento antes de qualquer alteração funcional.**
2. Verificar fatos no repositório atual: estrutura, branch, `git status`, testes e histórico.
3. Diferenciar: **implementado e validado**, **planejado**, **pendente** e **descartado**.
4. Antes de alterar: entender → localizar problema → modificar o mínimo → testar → validar → documentar.
5. Não criar repositório Git novo nem executar operações destrutivas (`reset --hard`, `clean`, substituição em massa) sem autorização.
6. Não mover, apagar, renomear ou reescrever módulos existentes só para adequá-los à estrutura sugerida.
7. Não introduzir fotos ou dados falsos como registros reais de convidados.
8. Não expor tokens/PINs de convidados, URLs administrativas privadas, senhas ou segredos em Markdown, logs ou código público.
9. Manter URLs públicas atuais e URLs de Apps Script enquanto o plano não aprovar uma mudança controlada.
10. Não publicar/deployar nem fazer `git push` automaticamente; somente após revisão e autorização explícita.
11. Ao encerrar cada marco, apresentar arquivos alterados, testes executados, falhas e pendências.
12. Se uma instrução conflitar com o comportamento validado, **parar a mudança desse trecho e registrar o conflito**.

## 13. Primeiro comando de trabalho recomendado ao Codex

> Execute somente uma auditoria de leitura do projeto. Leia `docs/PROJETO_MESTRE_LEVEL_XVIII.md`, inspecione a branch e os arquivos existentes e compare com os requisitos. Produza um relatório de diferenças e uma proposta de implementação, **sem modificar arquivos de produção, sem publicar e sem executar comandos destrutivos**. Identifique o que já está implementado e o que falta. Aguarde aprovação do próximo marco.

## 14. Referências técnicas oficiais

- GitHub Pages (hospedagem estática): <https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site>
- Google Drive API / listagem: <https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list>
- Google Apps Script — Web Apps: <https://developers.google.com/apps-script/guides/web>
- MDN — Progressive Web Apps: <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps>
- Codex e instruções de repositório (`AGENTS.md`): <https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex>

---

**Regra de governança:** este documento especifica o que construir; a auditoria técnica documentará como está construído; o plano de implementação dirá o que pode ser alterado em cada marco. Nenhum deles, isoladamente, substitui evidência de teste sobre o código real.
