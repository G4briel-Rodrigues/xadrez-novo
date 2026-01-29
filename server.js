const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

const rooms = {};
let ranking = []; // Armazena os vencedores

io.on('connection', (socket) => {
    console.log('Uma alma conectou: ' + socket.id);

    socket.on('entrar', (data) => {
        const { apelido, canal } = data;
        socket.join(canal);

        if (!rooms[canal]) {
            rooms[canal] = {
                game: new Chess(),
                players: [],
                time: { w: 900, b: 900 }, // 15 MINUTOS (900 segundos)
                timers: null,
                rematchRequests: new Set()
            };
        }

        const room = rooms[canal];

        // Lógica para ocupar as cores ou ser espectador
        if (room.players.length < 2) {
            const cor = room.players.length === 0 ? 'w' : 'b';
            room.players.push({ id: socket.id, nick: apelido, cor });
            
            socket.emit('logado', { cor, canal, ranking });
            
            // Inicia o jogo quando o segundo jogador entra
            if (room.players.length === 2) {
                io.to(canal).emit('iniciar_jogo', { fen: room.game.fen() });
                startTimer(canal);
            }
        } else {
            // Entra como espectador
            socket.emit('logado', { cor: 'spectator', canal, ranking });
            socket.emit('iniciar_jogo', { fen: room.game.fen() });
        }
    });

    socket.on('movimento', (data) => {
        const room = rooms[data.canal];
        if (!room) return;

        // Validação básica de turno
        if (room.game.turn() !== data.cor) return;

        const move = room.game.move({ from: data.from, to: data.to, promotion: 'q' });
        
        if (move) {
            io.to(data.canal).emit('atualizar_tabuleiro', { 
                fen: room.game.fen(), 
                lastMove: move 
            });

            if (room.game.game_over()) {
                finalizarJogo(data.canal, room.game.in_checkmate() ? 'checkmate' : 'draw');
            }
        }
    });

    socket.on('enviar_msg', (data) => {
        io.to(data.canal).emit('receber_msg', data);
    });

    socket.on('pedir_revanche', (data) => {
        const room = rooms[data.canal];
        if (!room) return;

        room.rematchRequests.add(socket.id);
        
        if (room.rematchRequests.size >= 2) {
            // Reinicia tudo para 15 minutos
            room.game = new Chess();
            room.time = { w: 900, b: 900 };
            room.rematchRequests.clear();
            io.to(data.canal).emit('iniciar_jogo', { fen: room.game.fen() });
            startTimer(canal);
        } else {
            socket.to(data.canal).emit('revanche_solicitada', "O oponente quer revanche...");
        }
    });

    socket.on('disconnect', () => {
        // Limpeza básica ao desconectar pode ser adicionada aqui
    });
});

function startTimer(canal) {
    const room = rooms[canal];
    if (room.timers) clearInterval(room.timers);

    room.timers = setInterval(() => {
        const turno = room.game.turn();
        room.time[turno]--;

        io.to(canal).emit('sync_time', room.time);

        if (room.time[turno] <= 0) {
            finalizarJogo(canal, 'timeout');
        }
    }, 1000);
}

function finalizarJogo(canal, motivo) {
    const room = rooms[canal];
    clearInterval(room.timers);

    let vencedor = null;
    let msg = "FIM DE JOGO";

    if (motivo === 'checkmate') {
        const corVencedora = room.game.turn() === 'w' ? 'b' : 'w';
        vencedor = room.players.find(p => p.cor === corVencedora);
        msg = `XEQUE-MATE! VITÓRIA DAS ${corVencedora === 'w' ? 'BRANCAS' : 'PRETAS'}`;
    } else if (motivo === 'timeout') {
        const corVencedora = room.game.turn() === 'w' ? 'b' : 'w';
        vencedor = room.players.find(p => p.cor === corVencedora);
        msg = `TEMPO ESGOTADO! VITÓRIA DAS ${corVencedora === 'w' ? 'BRANCAS' : 'PRETAS'}`;
    } else {
        msg = "EMPATE!";
    }

    if (vencedor) {
        atualizarRanking(vencedor.nick);
    }

    io.to(canal).emit('fim_jogo', { msg });
    io.emit('atualizar_ranking', ranking);
}

function atualizarRanking(nick) {
    const user = ranking.find(u => u.nick === nick);
    if (user) {
        user.wins++;
    } else {
        ranking.push({ nick, wins: 1 });
    }
    ranking.sort((a, b) => b.wins - a.wins);
}

server.listen(3000, () => {
    console.log('--- Servidor do Caps Rodando em http://localhost:3000 ---');
});
