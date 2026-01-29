const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const { Chess } = require('chess.js');

const DB_PATH = './database.json';
let users = {};

// Carrega o banco de dados
if (fs.existsSync(DB_PATH)) {
    try { users = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { users = {}; }
}
function saveDB() { fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2)); }

// Estrutura das Salas (Universos)
const rooms = { 
    "SubMundo": { players: [], game: null, timer: null, times: { w: 180, b: 180 }, rematch: [] }, 
    "Recanto dos pecadores": { players: [], game: null, timer: null, times: { w: 180, b: 180 }, rematch: [] }, 
    "Vozes sem fim": { players: [], game: null, timer: null, times: { w: 180, b: 180 }, rematch: [] }, 
    "Solidão": { players: [], game: null, timer: null, times: { w: 180, b: 180 }, rematch: [] }
};

app.use(express.static(__dirname));

function getRanking() {
    return Object.keys(users).map(nick => ({ nick, wins: users[nick].wins || 0 }))
        .sort((a, b) => b.wins - a.wins).slice(0, 5);
}

// Lógica do Relógio (diminui 1 segundo de quem é a vez)
function startTimer(canal) {
    const room = rooms[canal];
    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        if (!room.game || room.game.isGameOver()) {
            clearInterval(room.timer);
            return;
        }

        const turn = room.game.turn(); // 'w' ou 'b'
        room.times[turn]--;

        io.to(canal).emit('sync_time', room.times);

        // Se o tempo acabar (0 ou menos)
        if (room.times[turn] <= 0) {
            clearInterval(room.timer);
            const winnerColor = turn === 'w' ? 'b' : 'w';
            const winnerPlayer = room.players.find(p => p.cor === winnerColor);
            
            let msg = "O TEMPO DE VIDA ACABOU.";
            if (winnerPlayer) {
                if(users[winnerPlayer.apelido]) {
                    users[winnerPlayer.apelido].wins++;
                    saveDB();
                }
                msg = `TEMPO ESGOTADO! Vitória de ${winnerPlayer.apelido}.`;
            }
            
            io.emit('atualizar_ranking', getRanking());
            io.to(canal).emit('fim_jogo', { msg });
            room.game = null; 
        }
    }, 1000);
}

io.on('connection', (socket) => {
    socket.on('entrar', (data) => {
        const { apelido, senha, canal } = data;
        const room = rooms[canal];

        if (!room) return socket.emit('erro', 'Universo inexistente.');

        // Login ou Registro
        if (users[apelido]) {
            if (users[apelido].senha !== senha) return socket.emit('erro', 'Senha incorreta.');
        } else {
            users[apelido] = { senha, wins: 0 }; saveDB();
        }

        socket.join(canal);

        // Define se é Jogador ou Espectador
        let cor = 'spectator';
        const activePlayers = room.players.filter(p => p.cor !== 'spectator');
        
        if (activePlayers.length < 2) {
            // Se tem vaga, entra como jogador
            const hasWhite = activePlayers.some(p => p.cor === 'w');
            cor = hasWhite ? 'b' : 'w';
            room.players.push({ id: socket.id, apelido, cor });
        } else {
            // Sala cheia = Espectador
            room.players.push({ id: socket.id, apelido, cor: 'spectator' });
            socket.emit('erro', 'Sala cheia. Você entrou como FANTASMA (Espectador).');
        }

        // Se completou 2 jogadores e não tem jogo, inicia
        const playersNow = room.players.filter(p => p.cor !== 'spectator');
        if (playersNow.length === 2 && !room.game) {
            room.game = new Chess();
            room.times = { w: 180, b: 180 }; // 3 minutos
            room.rematch = [];
            io.to(canal).emit('iniciar_jogo', { fen: room.game.fen() });
            startTimer(canal);
        } else if (room.game) {
            // Se já tem jogo, mostra para quem entrou agora
            socket.emit('iniciar_jogo', { fen: room.game.fen() });
            socket.emit('sync_time', room.times);
        }

        socket.emit('logado', { apelido, cor, canal, ranking: getRanking() });
    });

    socket.on('enviar_msg', (data) => {
        io.to(data.canal).emit('receber_msg', data);
    });

    socket.on('movimento', (data) => {
        const room = rooms[data.canal];
        if (!room || !room.game) return;
        if (room.game.turn() !== data.cor) return; // Não é sua vez

        try {
            const move = room.game.move({ from: data.from, to: data.to, promotion: 'q' });
            if (move) {
                io.to(data.canal).emit('atualizar_tabuleiro', { fen: room.game.fen(), lastMove: move });
                
                if (room.game.isGameOver()) {
                    clearInterval(room.timer);
                    let msg = "EMPATE NA ESCURIDÃO.";
                    
                    if (room.game.isCheckmate()) {
                        const winner = room.game.turn() === 'w' ? 'b' : 'w';
                        const winnerObj = room.players.find(p => p.cor === winner);
                        if (winnerObj) {
                            users[winnerObj.apelido].wins++;
                            saveDB();
                            msg = `XEQUE-MATE! ${winnerObj.apelido} ceifou uma alma.`;
                        }
                    }
                    io.emit('atualizar_ranking', getRanking());
                    io.to(data.canal).emit('fim_jogo', { msg });
                }
            }
        } catch (e) {}
    });

    socket.on('pedir_revanche', (data) => {
        const room = rooms[data.canal];
        if (!room) return;

        if (!room.rematch.includes(socket.id)) {
            room.rematch.push(socket.id);
        }

        const activePlayers = room.players.filter(p => p.cor !== 'spectator');
        io.to(data.canal).emit('revanche_solicitada', `Revanche: ${room.rematch.length}/${activePlayers.length} aceitaram.`);

        if (room.rematch.length >= activePlayers.length && activePlayers.length === 2) {
            room.game = new Chess();
            room.times = { w: 180, b: 180 };
            room.rematch = [];
            io.to(data.canal).emit('iniciar_jogo', { fen: room.game.fen() });
            startTimer(data.canal);
        }
    });

    socket.on('disconnecting', () => {
        for (const canal of socket.rooms) {
            if (rooms[canal]) {
                rooms[canal].players = rooms[canal].players.filter(player => player.id !== socket.id);
                // Se ficar menos de 2 jogadores, jogo pausa/encerra
                if (rooms[canal].players.filter(p => p.cor !== 'spectator').length < 2) {
                    clearInterval(rooms[canal].timer);
                    rooms[canal].game = null; 
                    io.to(canal).emit('erro', 'Oponente desconectou. O universo colapsou.');
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
