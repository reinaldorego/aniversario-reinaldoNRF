# LEVEL XVIII — PWA (protótipo visual)

## Dados
- Reinaldo NR Filho
- 18 anos
- 28/11/2026 (sábado), às 21h (Belém/PA)
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
- O áudio tenta começar no toque em **ENTRAR NA EXPERIÊNCIA**. Se o navegador bloquear a tentativa, o botão permite iniciar; durante a reprodução, ele pausa e retoma por toque. O service worker atualiza a versão dos arquivos da página; o MP3 permanece fora do pré-cache e é carregado sob demanda.

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
