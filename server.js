const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

const rooms = {};
const ranking = [];

io.on('connection', (socket) => {
    socket.on('entrar', (data) => {
        const { apelido, canal } = data;
        socket.join(canal);

        if (!rooms[canal]) {
            rooms[canal] = {
                game: new Chess(),
                players: [],
                time: { w: 900, b: 900 }, // 15 MINUTOS AQUI
                timers: null
            };
        }

        const room = rooms[canal];

        if (room.players.length < 2) {
            const cor = room.players.length === 0 ? 'w' : 'b';
            room.players.push({ id: socket.id, nick: apelido, cor });
            socket.emit('logado', { cor, canal, ranking });
            
            if (room.players.length === 2) {
                io.to(canal).emit('iniciar_jogo', { fen: room.game.fen() });
                startTimer(canal);
            }
        } else {
            socket.emit('logado', { cor: 'spectator', canal, ranking });
            socket.emit('iniciar_jogo', { fen: room.game.fen() });
        }
    });

    socket.on('movimento', (data) => {
        const room = rooms[data.canal];
        if (!room) return;

        const move = room.game.move({ from: data.from, to: data.to, promotion: 'q' });
        if (move) {
            io.to(data.canal).emit('atualizar_tabuleiro', { 
                fen: room.game.fen(), 
                lastMove: move 
            });

            if (room.game.game_over()) {
                clearInterval(room.timers);
                let msg = "FIM DE JOGO";
                if (room.game.in_checkmate()) msg = `XEQUE-MATE! VITÓRIA DAS ${room.game.turn() === 'w' ? 'PRETAS' : 'BRANCAS'}`;
                io.to(data.canal).emit('fim_jogo', { msg });
            }
        }
    });

    socket.on('enviar_msg', (data) => {
        io.to(data.canal).emit('receber_msg', data);
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
            clearInterval(room.timers);
            io.to(canal).emit('fim_jogo', { msg: `TEMPO ESGOTADO! AS ${turno === 'w' ? 'PRETAS' : 'BRANCAS'} VENCERAM.` });
        }
    }, 1000);
}

server.listen(3000, () => console.log('Servidor rodando na porta 3000'));
