/* ================================================
   DAMAS BRASILEIRAS - Game Engine
   Regras: Damas voadoras, captura máxima obrigatória
   ================================================ */

// === CONSTANTS ===
const EMPTY = 0;
const BLACK = 1;       // Player 1 (bottom)
const WHITE = 2;       // Player 2 (top)
const BLACK_KING = 3;
const WHITE_KING = 4;

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

// === GAME STATE ===
let board = [];
let currentPlayer = BLACK;
let selectedPiece = null;
let validMoves = [];
let gameMode = null;         // 'local', 'ai', 'online'
let aiDifficulty = 'medium';
let gameOver = false;
let moveHistory = [];
let multiCapturePos = null;  // Position during multi-capture sequence
let lastMove = null;

// Online state
let peer = null;
let conn = null;
let myColor = null;
let roomId = null;
let isHost = false;

// Stats
let captures = { [BLACK]: 0, [WHITE]: 0 };

// ===================================================
//  BOARD INITIALIZATION
// ===================================================

function createInitialBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) {
        if (r < 3) b[r][c] = WHITE;
        else if (r > 4) b[r][c] = BLACK;
      }
    }
  }
  return b;
}

function cloneBoard(b) {
  return b.map(row => [...row]);
}

// ===================================================
//  UTILITY
// ===================================================

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function isOwn(piece, player) {
  if (player === BLACK) return piece === BLACK || piece === BLACK_KING;
  return piece === WHITE || piece === WHITE_KING;
}

function isOpponent(piece, player) {
  if (piece === EMPTY) return false;
  if (player === BLACK) return piece === WHITE || piece === WHITE_KING;
  return piece === BLACK || piece === BLACK_KING;
}

function isKing(piece) {
  return piece === BLACK_KING || piece === WHITE_KING;
}

function pieceColor(piece) {
  if (piece === BLACK || piece === BLACK_KING) return BLACK;
  if (piece === WHITE || piece === WHITE_KING) return WHITE;
  return EMPTY;
}

function opponent(player) {
  return player === BLACK ? WHITE : BLACK;
}

// ===================================================
//  MOVE GENERATION (Brazilian Rules)
// ===================================================

/**
 * Find all capture sequences from a given position.
 * Returns array of sequences: { path: [{r,c},...], captured: [{r,c},...] }
 */
function findCaptureSequences(b, r, c, piece) {
  const king = isKing(piece);
  const player = pieceColor(piece);
  const results = [];

  function dfs(row, col, path, captured, boardState) {
    let foundMore = false;

    for (const [dr, dc] of DIRS) {
      if (king) {
        // Flying king: scan along diagonal for opponent piece
        let dist = 1;
        while (true) {
          const mr = row + dr * dist;
          const mc = col + dc * dist;
          if (!inBounds(mr, mc)) break;

          const midPiece = boardState[mr][mc];

          if (isOwn(midPiece, player)) break;

          if (isOpponent(midPiece, player)) {
            // Check it's not already captured in this sequence
            const alreadyCaptured = captured.some(cp => cp.r === mr && cp.c === mc);
            if (alreadyCaptured) break;

            // Look for empty landing squares beyond the captured piece
            let landDist = 1;
            while (true) {
              const lr = mr + dr * landDist;
              const lc = mc + dc * landDist;
              if (!inBounds(lr, lc)) break;
              if (boardState[lr][lc] !== EMPTY) break;

              foundMore = true;

              const newCaptured = [...captured, { r: mr, c: mc }];
              const newPath = [...path, { r: lr, c: lc }];

              // Temporarily update board for recursive search
              const newBoard = cloneBoard(boardState);
              newBoard[row][col] = EMPTY;
              newBoard[mr][mc] = EMPTY; // Remove captured piece
              newBoard[lr][lc] = piece;

              dfs(lr, lc, newPath, newCaptured, newBoard);
              landDist++;
            }

            break; // After finding an opponent, stop scanning this direction
          }

          dist++;
        }
      } else {
        // Regular piece: capture by jumping over adjacent opponent
        const mr = row + dr;
        const mc = col + dc;
        const lr = row + dr * 2;
        const lc = col + dc * 2;

        if (!inBounds(lr, lc)) continue;
        if (!isOpponent(boardState[mr][mc], player)) continue;
        if (captured.some(cp => cp.r === mr && cp.c === mc)) continue;
        if (boardState[lr][lc] !== EMPTY) continue;

        foundMore = true;

        const newCaptured = [...captured, { r: mr, c: mc }];
        const newPath = [...path, { r: lr, c: lc }];

        const newBoard = cloneBoard(boardState);
        newBoard[row][col] = EMPTY;
        newBoard[mr][mc] = EMPTY;
        newBoard[lr][lc] = piece;

        dfs(lr, lc, newPath, newCaptured, newBoard);
      }
    }

    if (!foundMore && captured.length > 0) {
      results.push({ path, captured });
    }
  }

  dfs(r, c, [{ r, c }], [], cloneBoard(b));
  return results;
}

/**
 * Get non-capture moves for a piece.
 */
function getNonCaptureMoves(b, r, c, piece) {
  const king = isKing(piece);
  const player = pieceColor(piece);
  const moves = [];

  for (const [dr, dc] of DIRS) {
    if (!king) {
      // Regular pieces move forward only
      const forward = player === BLACK ? -1 : 1;
      if (dr !== forward) continue;

      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && b[nr][nc] === EMPTY) {
        moves.push({ from: { r, c }, to: { r: nr, c: nc }, captured: [] });
      }
    } else {
      // King can fly along diagonals
      let dist = 1;
      while (true) {
        const nr = r + dr * dist;
        const nc = c + dc * dist;
        if (!inBounds(nr, nc) || b[nr][nc] !== EMPTY) break;
        moves.push({ from: { r, c }, to: { r: nr, c: nc }, captured: [] });
        dist++;
      }
    }
  }

  return moves;
}

/**
 * Get all valid moves for a player, enforcing maximum capture rule.
 */
function getAllValidMoves(b, player) {
  let allCaptures = [];
  let maxCaptureCount = 0;

  // Find all capture sequences for all pieces
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!isOwn(b[r][c], player)) continue;

      const sequences = findCaptureSequences(b, r, c, b[r][c]);
      for (const seq of sequences) {
        if (seq.captured.length > maxCaptureCount) {
          maxCaptureCount = seq.captured.length;
          allCaptures = [];
        }
        if (seq.captured.length === maxCaptureCount) {
          allCaptures.push({
            from: seq.path[0],
            to: seq.path[seq.path.length - 1],
            path: seq.path,
            captured: seq.captured
          });
        }
      }
    }
  }

  if (maxCaptureCount > 0) {
    return allCaptures;
  }

  // No captures: return regular moves
  const regularMoves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!isOwn(b[r][c], player)) continue;
      regularMoves.push(...getNonCaptureMoves(b, r, c, b[r][c]));
    }
  }

  return regularMoves;
}

/**
 * Get valid moves for a specific piece (filtered from all valid moves).
 */
function getMovesForPiece(b, player, r, c) {
  const allMoves = getAllValidMoves(b, player);
  return allMoves.filter(m => m.from.r === r && m.from.c === c);
}

// ===================================================
//  MOVE EXECUTION
// ===================================================

function executeMove(b, move) {
  const newBoard = cloneBoard(b);
  const piece = newBoard[move.from.r][move.from.c];

  newBoard[move.from.r][move.from.c] = EMPTY;

  // Remove captured pieces
  for (const cap of move.captured) {
    newBoard[cap.r][cap.c] = EMPTY;
  }

  // Place piece at destination
  let finalPiece = piece;

  // Check promotion
  if (piece === BLACK && move.to.r === 0) finalPiece = BLACK_KING;
  if (piece === WHITE && move.to.r === 7) finalPiece = WHITE_KING;

  newBoard[move.to.r][move.to.c] = finalPiece;

  return newBoard;
}

// ===================================================
//  GAME STATE CHECKS
// ===================================================

function checkGameOver(b, player) {
  const moves = getAllValidMoves(b, player);
  if (moves.length === 0) {
    return opponent(player); // The other player wins
  }

  // Check if player has any pieces
  let hasPieces = false;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isOwn(b[r][c], player)) {
        hasPieces = true;
        break;
      }
    }
    if (hasPieces) break;
  }

  if (!hasPieces) return opponent(player);

  return null; // Game continues
}

function countPieces(b, player) {
  let count = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isOwn(b[r][c], player)) count++;
    }
  }
  return count;
}

// ===================================================
//  AI - MINIMAX WITH ALPHA-BETA PRUNING
// ===================================================

function evaluate(b, aiPlayer) {
  const humanPlayer = opponent(aiPlayer);
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = b[r][c];
      if (piece === EMPTY) continue;

      const owner = pieceColor(piece);
      const king = isKing(piece);
      const mult = owner === aiPlayer ? 1 : -1;

      // Piece value
      score += mult * (king ? 7 : 3);

      // Position bonuses
      // Center control
      const centerR = Math.abs(3.5 - r);
      const centerC = Math.abs(3.5 - c);
      score += mult * (4 - centerR - centerC) * 0.15;

      // Advancement bonus for regular pieces
      if (!king) {
        const advancement = owner === BLACK ? (7 - r) : r;
        score += mult * advancement * 0.3;
      }

      // Edge pieces are slightly weaker (can't be jumped from both sides)
      if (c === 0 || c === 7) {
        score += mult * 0.5; // Back row / edge protection
      }

      // King mobility bonus
      if (king) {
        const mobility = getNonCaptureMoves(b, r, c, piece).length;
        score += mult * mobility * 0.1;
      }
    }
  }

  // Mobility bonus
  const aiMoves = getAllValidMoves(b, aiPlayer).length;
  const humanMoves = getAllValidMoves(b, humanPlayer).length;
  score += (aiMoves - humanMoves) * 0.2;

  // Check for win/loss
  if (humanMoves === 0) score += 1000;
  if (aiMoves === 0) score -= 1000;

  return score;
}

function minimax(b, depth, alpha, beta, maximizing, aiPlayer) {
  const player = maximizing ? aiPlayer : opponent(aiPlayer);
  const winner = checkGameOver(b, player);

  if (winner !== null) {
    return winner === aiPlayer ? 10000 - (10 - depth) : -10000 + (10 - depth);
  }

  if (depth === 0) {
    return evaluate(b, aiPlayer);
  }

  const moves = getAllValidMoves(b, player);

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const newBoard = executeMove(b, move);
      const evalScore = minimax(newBoard, depth - 1, alpha, beta, false, aiPlayer);
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const newBoard = executeMove(b, move);
      const evalScore = minimax(newBoard, depth - 1, alpha, beta, true, aiPlayer);
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function getAIMove(b, aiPlayer, difficulty) {
  const depthMap = { easy: 2, medium: 4, hard: 6 };
  const depth = depthMap[difficulty] || 4;

  const moves = getAllValidMoves(b, aiPlayer);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  // For easy mode, add some randomness
  if (difficulty === 'easy' && Math.random() < 0.3) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let bestScore = -Infinity;
  let bestMoves = [];

  for (const move of moves) {
    const newBoard = executeMove(b, move);
    const score = minimax(newBoard, depth - 1, -Infinity, Infinity, false, aiPlayer);

    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }

  // Pick randomly among equally good moves
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

// ===================================================
//  ONLINE - PeerJS WebRTC
// ===================================================

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function createOnlineRoom() {
  roomId = generateRoomId();
  isHost = true;
  myColor = BLACK;

  showOnlineStatus('Conectando...');

  peer = new Peer('damas-' + roomId);

  peer.on('open', () => {
    document.getElementById('room-code-display').textContent = roomId;
    document.getElementById('room-info').classList.remove('hidden');
    showOnlineStatus('Sala criada! Aguardando oponente...');
  });

  peer.on('connection', (connection) => {
    conn = connection;
    setupConnection();
    showOnlineStatus('Oponente conectado!');
    setTimeout(() => {
      startGame('online');
      conn.send({ type: 'start', color: WHITE });
    }, 500);
  });

  peer.on('error', (err) => {
    console.error('PeerJS error:', err);
    if (err.type === 'unavailable-id') {
      showOnlineStatus('Este código já está em uso. Tente novamente.');
    } else {
      showOnlineStatus('Erro de conexão. Verifique sua internet.');
    }
  });
}

function joinOnlineRoom() {
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!code) {
    showOnlineStatus('Digite o código da sala.');
    return;
  }

  isHost = false;
  roomId = code;

  showOnlineStatus('Conectando à sala...');

  peer = new Peer();

  peer.on('open', () => {
    conn = peer.connect('damas-' + code, { reliable: true });

    conn.on('open', () => {
      setupConnection();
      showOnlineStatus('Conectado! Aguardando início...');
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
      showOnlineStatus('Erro ao conectar. Verifique o código.');
    });
  });

  peer.on('error', (err) => {
    console.error('PeerJS error:', err);
    showOnlineStatus('Sala não encontrada ou erro de conexão.');
  });
}

function setupConnection() {
  conn.on('data', (data) => {
    handleOnlineMessage(data);
  });

  conn.on('close', () => {
    if (!gameOver) {
      showToast('Oponente desconectou.');
      gameOver = true;
    }
  });
}

function handleOnlineMessage(data) {
  switch (data.type) {
    case 'start':
      myColor = data.color;
      startGame('online');
      break;
    case 'move':
      receiveOnlineMove(data.move);
      break;
    case 'restart':
      resetGameState();
      renderBoard();
      updateUI();
      showToast('Oponente reiniciou o jogo.');
      break;
  }
}

function sendOnlineMove(move) {
  if (conn && conn.open) {
    conn.send({
      type: 'move',
      move: {
        from: move.from,
        to: move.to,
        path: move.path,
        captured: move.captured
      }
    });
  }
}

function receiveOnlineMove(moveData) {
  const move = moveData;
  animateMove(move, () => {
    board = executeMove(board, move);
    captures[opponent(myColor)] += move.captured.length;
    lastMove = move;
    currentPlayer = myColor;
    renderBoard();
    updateUI();

    const winner = checkGameOver(board, currentPlayer);
    if (winner) {
      endGame(winner);
    }
  });
}

function cancelOnline() {
  if (peer) {
    peer.destroy();
    peer = null;
  }
  conn = null;
  roomId = null;
}

function showOnlineStatus(msg) {
  const el = document.getElementById('online-status');
  if (el) el.textContent = msg;
}

function copyRoomCode() {
  if (roomId) {
    navigator.clipboard.writeText(roomId).then(() => {
      showToast('Código copiado!');
    }).catch(() => {
      showToast('Selecione e copie o código manualmente.');
    });
  }
}

// ===================================================
//  UI FUNCTIONS
// ===================================================

function showSubmenu(type) {
  hideSubmenus();
  const subId = type + '-submenu';
  document.getElementById(subId).classList.remove('hidden');
  document.querySelector('.menu-buttons').classList.add('hidden');
}

function hideSubmenus() {
  document.querySelectorAll('.submenu').forEach(el => el.classList.add('hidden'));
  document.querySelector('.menu-buttons').classList.remove('hidden');
  document.getElementById('room-info').classList.add('hidden');
  showOnlineStatus('');
}

function switchScreen(from, to) {
  document.getElementById(from).classList.remove('active');
  document.getElementById(to).classList.add('active');
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden', 'hiding');

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, duration);
}

// ===================================================
//  GAME INITIALIZATION
// ===================================================

function startGame(mode, difficulty) {
  gameMode = mode;
  if (difficulty) aiDifficulty = difficulty;

  resetGameState();

  // Set player names
  const p1Name = document.getElementById('player1-name');
  const p2Name = document.getElementById('player2-name');

  switch (mode) {
    case 'ai':
      p1Name.textContent = 'Você';
      p2Name.textContent = `Computador (${difficulty === 'easy' ? 'Fácil' : difficulty === 'hard' ? 'Difícil' : 'Médio'})`;
      break;
    case 'local':
      p1Name.textContent = 'Jogador 1 (Escuras)';
      p2Name.textContent = 'Jogador 2 (Claras)';
      break;
    case 'online':
      if (myColor === BLACK) {
        p1Name.textContent = 'Você (Escuras)';
        p2Name.textContent = 'Oponente (Claras)';
      } else {
        p1Name.textContent = 'Oponente (Escuras)';
        p2Name.textContent = 'Você (Claras)';
      }
      break;
  }

  switchScreen('menu-screen', 'game-screen');
  renderBoard();
  updateUI();

  // If AI goes first (shouldn't happen with standard rules, but just in case)
  if (mode === 'ai' && currentPlayer === WHITE) {
    setTimeout(doAIMove, 500);
  }
}

function resetGameState() {
  board = createInitialBoard();
  currentPlayer = BLACK;
  selectedPiece = null;
  validMoves = [];
  gameOver = false;
  moveHistory = [];
  multiCapturePos = null;
  lastMove = null;
  captures = { [BLACK]: 0, [WHITE]: 0 };
  document.getElementById('game-over-modal').classList.add('hidden');
}

function restartGame() {
  if (gameMode === 'online' && conn && conn.open) {
    conn.send({ type: 'restart' });
  }
  resetGameState();
  renderBoard();
  updateUI();
}

function backToMenu() {
  cancelOnline();
  hideSubmenus();
  gameOver = true;
  switchScreen('game-screen', 'menu-screen');
}

// ===================================================
//  RENDERING
// ===================================================

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  const allMoves = gameOver ? [] : getAllValidMoves(board, currentPlayer);
  const piecesWithCaptures = new Set();
  const hasCaptures = allMoves.length > 0 && allMoves[0].captured && allMoves[0].captured.length > 0;

  if (hasCaptures) {
    for (const m of allMoves) {
      piecesWithCaptures.add(`${m.from.r},${m.from.c}`);
    }
  }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const square = document.createElement('div');
      const isDark = (r + c) % 2 === 1;
      square.className = `square ${isDark ? 'square-dark' : 'square-light'}`;
      square.dataset.row = r;
      square.dataset.col = c;

      // Last move highlight
      if (lastMove) {
        if ((r === lastMove.from.r && c === lastMove.from.c) ||
            (r === lastMove.to.r && c === lastMove.to.c)) {
          square.classList.add('last-move');
        }
      }

      // Valid move / capture indicators
      const isValidTarget = validMoves.some(m => m.to.r === r && m.to.c === c);
      if (isValidTarget) {
        const isCapture = validMoves.some(m => m.to.r === r && m.to.c === c && m.captured.length > 0);
        square.classList.add(isCapture ? 'valid-capture' : 'valid-move');
      }

      // Piece
      const piece = board[r][c];
      if (piece !== EMPTY) {
        const pieceEl = document.createElement('div');
        const colorClass = (piece === BLACK || piece === BLACK_KING) ? 'dark' : 'light';
        const kingClass = isKing(piece) ? ' king' : '';
        pieceEl.className = `piece ${colorClass}${kingClass}`;

        // Selected
        if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
          pieceEl.classList.add('selected');
        }

        // Must capture indicator
        if (hasCaptures && piecesWithCaptures.has(`${r},${c}`) && isPlayerTurn()) {
          pieceEl.classList.add('must-capture');
        }

        // Disable pieces that aren't current player's or when it's not their turn
        if (!isOwn(piece, currentPlayer) || !isPlayerTurn()) {
          pieceEl.classList.add('disabled');
        }

        square.appendChild(pieceEl);
      }

      // Click handler (only on dark squares)
      if (isDark) {
        square.addEventListener('click', () => handleSquareClick(r, c));
      }

      boardEl.appendChild(square);
    }
  }
}

function updateUI() {
  // Piece counts
  document.getElementById('player1-pieces').textContent = countPieces(board, BLACK);
  document.getElementById('player2-pieces').textContent = countPieces(board, WHITE);
  document.getElementById('player1-captures').textContent = captures[BLACK];
  document.getElementById('player2-captures').textContent = captures[WHITE];

  // Turn indicator
  const p1Info = document.getElementById('player1-info');
  const p2Info = document.getElementById('player2-info');
  p1Info.classList.toggle('active-turn', currentPlayer === BLACK && !gameOver);
  p2Info.classList.toggle('active-turn', currentPlayer === WHITE && !gameOver);
}

function isPlayerTurn() {
  if (gameOver) return false;

  switch (gameMode) {
    case 'local':
      return true; // Both players use the same screen
    case 'ai':
      return currentPlayer === BLACK; // Player is always BLACK
    case 'online':
      return currentPlayer === myColor;
    default:
      return false;
  }
}

// ===================================================
//  INPUT HANDLING
// ===================================================

function handleSquareClick(r, c) {
  if (gameOver || !isPlayerTurn()) return;

  const piece = board[r][c];

  // Clicking on a valid move target
  if (selectedPiece) {
    const move = validMoves.find(m => m.to.r === r && m.to.c === c);
    if (move) {
      performMove(move);
      return;
    }
  }

  // Clicking on own piece
  if (isOwn(piece, currentPlayer)) {
    const moves = getMovesForPiece(board, currentPlayer, r, c);
    if (moves.length > 0) {
      selectedPiece = { r, c };
      validMoves = moves;
    } else {
      selectedPiece = null;
      validMoves = [];
      // Check if there are mandatory captures elsewhere
      const allMoves = getAllValidMoves(board, currentPlayer);
      if (allMoves.length > 0 && allMoves[0].captured && allMoves[0].captured.length > 0) {
        showToast('Captura obrigatória! Selecione uma peça que pode capturar.');
      }
    }
    renderBoard();
    return;
  }

  // Clicking on empty square - deselect
  selectedPiece = null;
  validMoves = [];
  renderBoard();
}

function performMove(move) {
  // Animate and execute
  animateMove(move, () => {
    board = executeMove(board, move);
    captures[currentPlayer] += move.captured.length;
    lastMove = move;
    selectedPiece = null;
    validMoves = [];

    // Send move to opponent if online
    if (gameMode === 'online') {
      sendOnlineMove(move);
    }

    // Switch turn
    currentPlayer = opponent(currentPlayer);

    renderBoard();
    updateUI();

    // Check game over
    const winner = checkGameOver(board, currentPlayer);
    if (winner) {
      endGame(winner);
      return;
    }

    // AI turn
    if (gameMode === 'ai' && currentPlayer === WHITE) {
      setTimeout(doAIMove, 400);
    }
  });
}

function doAIMove() {
  if (gameOver) return;

  const move = getAIMove(board, WHITE, aiDifficulty);
  if (!move) {
    endGame(BLACK);
    return;
  }

  animateMove(move, () => {
    board = executeMove(board, move);
    captures[WHITE] += move.captured.length;
    lastMove = move;
    currentPlayer = BLACK;
    renderBoard();
    updateUI();

    const winner = checkGameOver(board, currentPlayer);
    if (winner) {
      endGame(winner);
    }
  });
}

// ===================================================
//  ANIMATION
// ===================================================

function animateMove(move, callback) {
  const boardEl = document.getElementById('board');
  const fromSquare = boardEl.querySelector(`[data-row="${move.from.r}"][data-col="${move.from.c}"]`);
  const toSquare = boardEl.querySelector(`[data-row="${move.to.r}"][data-col="${move.to.c}"]`);

  if (!fromSquare || !toSquare) {
    callback();
    return;
  }

  const pieceEl = fromSquare.querySelector('.piece');
  if (!pieceEl) {
    callback();
    return;
  }

  const fromRect = fromSquare.getBoundingClientRect();
  const toRect = toSquare.getBoundingClientRect();
  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;

  pieceEl.classList.add('moving');
  pieceEl.style.transition = 'transform 0.3s ease';
  pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;

  // Animate captured pieces
  if (move.captured && move.captured.length > 0) {
    setTimeout(() => {
      for (const cap of move.captured) {
        const capSquare = boardEl.querySelector(`[data-row="${cap.r}"][data-col="${cap.c}"]`);
        if (capSquare) {
          const capPiece = capSquare.querySelector('.piece');
          if (capPiece) {
            capPiece.classList.add('captured');
          }
        }
      }
    }, 150);
  }

  setTimeout(() => {
    callback();
  }, 350);
}

// ===================================================
//  GAME END
// ===================================================

function endGame(winner) {
  gameOver = true;

  const modal = document.getElementById('game-over-modal');
  const title = document.getElementById('game-over-title');
  const message = document.getElementById('game-over-message');

  let winnerName = '';

  switch (gameMode) {
    case 'ai':
      if (winner === BLACK) {
        title.textContent = '🎉 Você Venceu!';
        message.textContent = 'Parabéns! Você derrotou o computador!';
      } else {
        title.textContent = '😔 Você Perdeu';
        message.textContent = 'O computador venceu desta vez. Tente novamente!';
      }
      break;
    case 'local':
      winnerName = winner === BLACK ? 'Jogador 1 (Escuras)' : 'Jogador 2 (Claras)';
      title.textContent = '🏆 Fim de Jogo!';
      message.textContent = `${winnerName} venceu a partida!`;
      break;
    case 'online':
      if (winner === myColor) {
        title.textContent = '🎉 Você Venceu!';
        message.textContent = 'Parabéns pela vitória online!';
      } else {
        title.textContent = '😔 Você Perdeu';
        message.textContent = 'Seu oponente venceu desta vez.';
      }
      break;
  }

  modal.classList.remove('hidden');
  renderBoard();
  updateUI();
}
