const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const { Chess } = require('chess.js'); // O Juiz do jogo

const DB_PATH = './database.json';

// --- SISTEMA DE BANCO DE DADOS ---
let users = {};
if (fs.existsSync(DB_PATH)) {
    try { users = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { users = {}; }
}
function saveDB() { fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2)); }

// --- GERENCIAMENTO DE SALAS E JOGOS ---
// Agora guardamos a instância do jogo (regras) dentro da sala
const rooms = { 
    "SubMundo": { players: [], game: null }, 
    "Recanto dos pecadores": { players: [], game: null }, 
    "Vozes sem fim": { players: [], game: null }, 
    "Solidão": { players: [], game: null }
};

app.use(express.static(__dirname));

function getRanking() {
    return Object.keys(users)
        .map(nick => ({ nick, wins: users[nick].wins || 0 }))
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 5);
}

io.on('connection', (socket) => {
    socket.on('entrar', (data) => {
        const { apelido, senha, canal } = data;
        const room = rooms[canal];

        if (!room) return socket.emit('erro', 'Canal inexistente.');
        if (room.players.length >= 2) return socket.emit('erro', 'Sala cheia.');

        // Autenticação
        if (users[apelido]) {
            if (users[apelido].senha !== senha) return socket.emit('erro', 'Senha incorreta.');
        } else {
            users[apelido] = { senha, wins: 0 };
            saveDB();
        }

        socket.join(canal);
        room.players.push({ id: socket.id, apelido });
        
        // Define cor: Primeiro é White, Segundo é Black
        const cor = room.players.length === 1 ? 'w' : 'b'; // w = white, b = black
        
        // Se a sala encher, inicia um novo jogo de xadrez LIMPO
        if (room.players.length === 2) {
            room.game = new Chess(); 
            io.to(canal).emit('iniciar_jogo', { fen: room.game.fen() });
        }

        socket.emit('logado', { 
            apelido, 
            cor, // 'w' ou 'b'
            canal, 
            ranking: getRanking() 
        });
    });

    socket.on('movimento', (data) => {
        const room = rooms[data.canal];
        if (!room || !room.game) return;

        // Tenta fazer o movimento nas regras oficiais
        try {
            // Verifica de quem é a vez
            if (room.game.turn() !== data.cor) {
                return socket.emit('erro_silencioso', 'Não é sua vez!');
            }

            // O método .move() joga o erro se o movimento for ilegal (ex: cavalo andar reto)
            const move = room.game.move({
                from: data.from, // ex: 'e2'
                to: data.to,     // ex: 'e4'
                promotion: 'q'   // sempre promove para rainha por simplicidade
            });

            if (move) {
                // Movimento VÁLIDO e ACEITO
                const isGameOver = room.game.isGameOver();
                
                io.to(data.canal).emit('atualizar_tabuleiro', { 
                    fen: room.game.fen(),
                    lastMove: move,
                    turn: room.game.turn()
                });

                if (isGameOver) {
                    if (room.game.isCheckmate()) {
                        // Quem fez o movimento ganhou
                        const winnerColor = move.color; 
                        const winnerSocketId = room.players.find((p, i) => (i === 0 && winnerColor === 'w') || (i === 1 && winnerColor === 'b')).id;
                        const winnerNick = room.players.find(p => p.id === winnerSocketId).apelido;

                        users[winnerNick].wins++;
                        saveDB();
                        io.emit('atualizar_ranking', getRanking());
                        io.to(data.canal).emit('fim_jogo', { msg: `XEQUE-MATE! ${winnerNick} ceifou a alma do oponente.` });
                    } else {
                        io.to(data.canal).emit('fim_jogo', { msg: 'EMPATE (Afogamento ou Repetição).' });
                    }
                    // Reseta o jogo
                    room.game = new Chess();
                    room.players = []; 
                    // Nota: Na vida real, você desconectaria os sockets ou reiniciaria a lógica aqui.
                }
            }
        } catch (e) {
            // Movimento ilegal ignorado
        }
    });

    socket.on('disconnecting', () => {
        for (const canal of socket.rooms) {
            if (rooms[canal]) {
                rooms[canal].players = rooms[canal].players.filter(p => p.id !== socket.id);
                // Se alguém sair, o jogo acaba/reseta
                if (rooms[canal].game) rooms[canal].game = null; 
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`SERVIDOR PROFISSIONAL rodando na porta ${PORT}`));