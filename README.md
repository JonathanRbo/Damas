# ♟ Damas Brasileiras

Jogo de Damas Brasileiras completo, jogável no navegador — com IA, multiplayer local e online P2P.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)

## 🎮 Modos de Jogo

| Modo | Descrição |
|------|-----------|
| **vs Computador** | Jogue contra a IA com 3 níveis de dificuldade (Fácil, Médio, Difícil) |
| **Local (2 Jogadores)** | Dois jogadores no mesmo dispositivo |
| **Online** | Multiplayer P2P via WebRTC — sem servidor necessário |

## 📋 Regras (Damas Brasileiras)

- Tabuleiro 8×8, cada jogador começa com 12 peças
- Peças comuns movem-se uma casa na diagonal, **apenas para frente**
- **Capturas** são feitas pulando peças adversárias (frente ou trás)
- **Captura obrigatória**: se puder capturar, deve capturar
- **Captura máxima**: deve escolher a sequência que captura mais peças
- Ao alcançar a última fileira, a peça vira **Dama (Rei)**
- **Damas voadoras**: damas movem-se qualquer número de casas na diagonal
- Damas capturam à distância, podendo pousar em qualquer casa após a peça capturada
- Vence quem capturar todas as peças do oponente ou bloquear todos os seus movimentos

## 🚀 Como Jogar

### Opção 1: GitHub Pages
Acesse diretamente pelo navegador (após ativar GitHub Pages no repositório).

### Opção 2: Local
```bash
# Clone o repositório
git clone https://github.com/seu-usuario/damas.git
cd damas

# Abra no navegador (qualquer um dos métodos abaixo)
# Método 1: Abra o index.html diretamente
open index.html

# Método 2: Use um servidor local
npx serve .
# ou
python -m http.server 8000
```

> **Nota:** Para o modo online funcionar, é necessário servir via HTTP/HTTPS (não funciona abrindo o arquivo diretamente via `file://`).

## 🌐 Modo Online

O modo online utiliza **PeerJS** (WebRTC) para conexão direta entre jogadores:

1. O **Jogador 1** clica em "Criar Sala" e recebe um código de 6 caracteres
2. O **Jogador 2** digita o código e clica em "Entrar"
3. A conexão é estabelecida diretamente entre os dois (P2P)
4. Nenhum dado passa por servidores — a conexão é direta

## 🤖 IA (Inteligência Artificial)

A IA utiliza o algoritmo **Minimax com poda Alpha-Beta**:

| Dificuldade | Profundidade | Descrição |
|-------------|-------------|-----------|
| Fácil | 2 níveis | Joga de forma simples, comete erros intencionais |
| Médio | 4 níveis | Jogo equilibrado, bom para praticar |
| Difícil | 6 níveis | Joga de forma estratégica e competitiva |

A função de avaliação considera:
- Valor das peças (damas valem mais)
- Controle do centro do tabuleiro
- Avanço das peças
- Mobilidade (quantidade de movimentos disponíveis)

## 🛠 Tecnologias

- **HTML5** — Estrutura
- **CSS3** — Estilos, animações e responsividade
- **JavaScript (Vanilla)** — Toda a lógica do jogo
- **PeerJS** — Conexão P2P para modo online
- **WebRTC** — Comunicação em tempo real

## 📁 Estrutura do Projeto

```
damas/
├── index.html          # Página principal
├── css/
│   └── style.css       # Estilos e animações
├── js/
│   └── game.js         # Lógica do jogo, IA e online
└── README.md           # Documentação
```

## 📱 Responsivo

O jogo é totalmente responsivo e funciona em:
- Desktop
- Tablet
- Celular

## 📄 Licença

MIT License — sinta-se livre para usar, modificar e distribuir.
