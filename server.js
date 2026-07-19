const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Dynamic In-Memory Databases
const REGISTERED_USERS = {}; 
const ACTIVE_USERS = {}; // Maps username -> socket.id
const MESSAGE_HISTORY = {}; // Maps "userA-userB" -> array of last 10 messages

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Account Creation Endpoint
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: "Missing fields" });
    }
    if (REGISTERED_USERS[username]) {
        return res.status(400).json({ success: false, message: "Username taken" });
    }
    REGISTERED_USERS[username] = password;
    res.json({ success: true });
});

// Login Endpoint
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (REGISTERED_USERS[username] && REGISTERED_USERS[username] === password) {
        res.json({ success: true, username });
    } else {
        res.status(401).json({ success: false, message: "Invalid credentials" });
    }
});

// Helper to standardise dynamic chat room channel IDs alphabetically
function getRoomId(user1, user2) {
    return [user1, user2].sort().join('-');
}

io.on('connection', (socket) => {
    let authenticatedUser = null;

    // Triggered right after successful frontend login
    socket.on('register_active_user', (username) => {
        authenticatedUser = username;
        ACTIVE_USERS[username] = socket.id;
        
        // Broadcast the updated online list to everyone
        io.emit('update_status_list', Object.keys(ACTIVE_USERS));
    });

    // Load private history between two specific users
    socket.on('get_private_history', (targetUser) => {
        if (!authenticatedUser) return;
        const room = getRoomId(authenticatedUser, targetUser);
        socket.emit('load_history', MESSAGE_HISTORY[room] || []);
    });

    // Handle targeted direct message delivery
    socket.on('private_message', (data) => {
        if (!authenticatedUser) return;
        const { to, text } = data;
        const room = getRoomId(authenticatedUser, to);

        const newMsg = { user: authenticatedUser, text };

        if (!MESSAGE_HISTORY[room]) MESSAGE_HISTORY[room] = [];
        MESSAGE_HISTORY[room].push(newMsg);
        if (MESSAGE_HISTORY[room].length > 10) MESSAGE_HISTORY[room].shift();

        // Deliver to recipient if online
        const recipientSocketId = ACTIVE_USERS[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('chat_message', newMsg);
        }
        // Deliver back to sender's UI
        socket.emit('chat_message', newMsg);
    });

    // Handle sudden disconnect cleanups
    socket.on('disconnect', () => {
        if (authenticatedUser) {
            delete ACTIVE_USERS[authenticatedUser];
            io.emit('update_status_list', Object.keys(ACTIVE_USERS));
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});