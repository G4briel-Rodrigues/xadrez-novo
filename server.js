const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const { Chess } = require('chess.js');

const DB_PATH = './database.json';
let users = {};
if (fs.existsSync(DB_PATH)) { try { users = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { users = {}; } }
function saveDB() { fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2)); }

const rooms = { 
    "SubMundo": { players: [], game: null }, 
    "Recanto dos pecadores": { players: [], game: null }, 
    "Vozes sem fim": { players: [], game: null }, 
    "Solidão": { players: [], game: null }
};

app.use(express.static(__dirname));

function getRanking() {
    return Object.keys(users).map(nick => ({ nick, wins: users[nick].wins || 0 }))
        .sort((a, b) => b.wins - a.wins).slice(0, 5);
}

io.on('connection', (socket) => {
    socket.on('entrar', (data) => {
        const { apelido, senha, canal } = data;
        const room = rooms[canal];

        if (!room) return socket.emit('erro', 'Canal inexistente.');
        
        // VERIFICAÇÃO DE SALA EM USO (2 pessoas)
        if (room.players.length >= 2) {
            return socket.emit('erro', 'Este universo já está em uso por duas almas!');
        }

        if (users[apelido]) {
            if (users[apelido].senha !== senha) return socket.emit('erro', 'Senha incorreta.');
        } else {
            users[apelido] = { senha, wins: 0 }; saveDB();
        }

        socket.join(canal);
        room.players.push({ id: socket.id, apelido });
        const cor = room.players.length === 1 ? 'w' : 'b';
        
        if (room.players.length === 2) {
            room.game = new Chess(); 
            io.to(canal).emit('iniciar_jogo', { fen: room.game.fen() });
        }

        socket.emit('logado', { apelido, cor, canal, ranking: getRanking() });
    });

    // CHAT ISOLADO POR CANAL
    socket.on('enviar_msg', (data) => {
        io.to(data.canal).emit('receber_msg', data);
    });

    socket.on('movimento', (data) => {
        const room = rooms[data.canal];
        if (!room || !room.game || room.game.turn() !== data.cor) return;

        try {
            const move = room.game.move({ from: data.from, to: data.to, promotion: 'q' });
            if (move) {
                io.to(data.canal).emit('atualizar_tabuleiro', { fen: room.game.fen(), lastMove: move });
                if (room.game.isGameOver()) {
                    let msg = "EMPATE.";
                    if (room.game.isCheckmate()) {
                        users[data.apelido || room.players.find(p => (cor === 'w' ? 0 : 1)).apelido].wins++;
                        saveDB();
                        io.emit('atualizar_ranking', getRanking());
                        msg = `XEQUE-MATE! Uma alma foi ceifada.`;
                    }
                    io.to(data.canal).emit('fim_jogo', { msg });
                    room.game = null; room.players = [];
                }
            }
        } catch (e) {}
    });

    socket.on('disconnecting', () => {
        for (const canal of socket.rooms) {
            if (rooms[canal]) {
                rooms[canal].players = rooms[canal].players.filter(p => p.id !== socket.id);
                if (rooms[canal].game) rooms[canal].game = null; 
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));