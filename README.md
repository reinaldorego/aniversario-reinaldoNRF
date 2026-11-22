# LEVEL XVIII — PWA (protótipo visual)

## Dados
- Reinaldo NR Filho
- 18 anos
- 28/11/2026 (sábado), às 20h (Belém/PA)
- Ed. Dhahram
- Trav. Vileta, 1197
- Até 3 acompanhantes
- RSVP até 01/11/2026

## Como testar
A PWA precisa ser servida por HTTP/HTTPS para Service Worker funcionar.

### Opção simples no VS Code
Use a extensão Live Server e abra `index.html`.

### Python
Na pasta do projeto:
`python -m http.server 8000`

Depois acesse:
`http://localhost:8000`

## Trilha sonora do convite

- Música: **Horizon**, de **Diamond_Tunes**, obtida no Pixabay.
- Arquivo de origem confirmado: `diamond_tunes-horizon-369951.mp3`, SHA-256 `b3299040c0dd8eca81babe0c3fb5400e720fd88eda24c4000eb8f1b8d1a3da2f`.
- Asset local: `assets/audio/horizon-diamond-tunes.mp3`. A URL do convite inclui o hash para evitar a versão anterior no cache do navegador.
- O áudio tenta começar no toque em **ENTRAR NA EXPERIÊNCIA**. O convite e a galeria integrada compartilham a mesma reprodução. O botão pausa ou retoma por toque. Na mesma aba, o convite e a galeria guardam a posição da faixa e a escolha de pausar. Se o navegador bloquear a retomada, o alto-falante permite continuar. O MP3 é carregado sob demanda.

## Estado desta versão
- Layout responsivo
- Abertura cinematográfica
- Contagem regressiva
- Botão de localização
- RSVP simulado
- Access Pass simulado
- Dados salvos apenas em localStorage

Próxima etapa recomendada:
Google Sheets / Apps Script + QR real individual + painel de check-in.
