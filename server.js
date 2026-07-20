const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const REGISTERED_USERS = {}; 
const ACTIVE_USERS = {}; // username -> socket.id
const MESSAGE_HISTORY = {}; 

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: "Missing fields" });
    if (REGISTERED_USERS[username]) return res.status(400).json({ success: false, message: "Username taken" });
    
    REGISTERED_USERS[username] = password;
    broadcastUserDirectory();
    res.json({ success: true });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (REGISTERED_USERS[username] && REGISTERED_USERS[username] === password) {
        res.json({ success: true, username });
    } else {
        res.status(401).json({ success: false, message: "Invalid credentials" });
    }
});

function getRoomId(user1, user2) {
    return [user1, user2].sort().join('-');
}

function broadcastUserDirectory() {
    const directory = Object.keys(REGISTERED_USERS).map(username => ({
        username: username,
        isOnline: Boolean(ACTIVE_USERS[username])
    }));
    io.emit('update_user_directory', directory);
}

io.on('connection', (socket) => {
    let authenticatedUser = null;

    socket.on('register_active_user', (username) => {
        authenticatedUser = username;
        ACTIVE_USERS[username] = socket.id;
        broadcastUserDirectory();
    });

    socket.on('get_private_history', (targetUser) => {
        if (!authenticatedUser) return;
        const room = getRoomId(authenticatedUser, targetUser);
        socket.emit('load_history', MESSAGE_HISTORY[room] || []);
    });

    socket.on('private_message', (data) => {
        if (!authenticatedUser) return;
        const { to, text } = data;
        const room = getRoomId(authenticatedUser, to);
        const newMsg = { user: authenticatedUser, text };

        if (!MESSAGE_HISTORY[room]) MESSAGE_HISTORY[room] = [];
        MESSAGE_HISTORY[room].push(newMsg);
        if (MESSAGE_HISTORY[room].length > 10) MESSAGE_HISTORY[room].shift();

        const recipientSocketId = ACTIVE_USERS[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('chat_message', { ...newMsg, room });
        }
        socket.emit('chat_message', { ...newMsg, room });
    });

    // --- WebRTC Voice Call Signaling ---
    socket.on('call_user', ({ to, offer }) => {
        const recipientSocketId = ACTIVE_USERS[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('incoming_call', { from: authenticatedUser, offer });
        }
    });

    socket.on('answer_call', ({ to, answer }) => {
        const recipientSocketId = ACTIVE_USERS[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call_answered', { from: authenticatedUser, answer });
        }
    });

    socket.on('ice_candidate', ({ to, candidate }) => {
        const recipientSocketId = ACTIVE_USERS[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('ice_candidate', { from: authenticatedUser, candidate });
        }
    });

    socket.on('end_call', ({ to }) => {
        const recipientSocketId = ACTIVE_USERS[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call_ended');
        }
    });

    socket.on('disconnect', () => {
        if (authenticatedUser) {
            delete ACTIVE_USERS[authenticatedUser];
            broadcastUserDirectory();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});