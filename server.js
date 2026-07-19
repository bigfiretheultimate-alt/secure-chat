const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Hardcoded database for credential validation
const USERS = {
    "user1": "password123",
    "user2": "securepass"
};

// Array to store the last 10 encrypted messages
let MESSAGE_HISTORY = [];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (USERS[username] && USERS[username] === password) {
        res.json({ success: true, username });
    } else {
        res.status(401).json({ success: false, message: "Invalid credentials" });
    }
});

io.on('connection', (socket) => {
    // Send previously saved messages to the newly connected user
    socket.emit('load_history', MESSAGE_HISTORY);

    socket.on('chat_message', (data) => {
        // Add the new message to our history list
        MESSAGE_HISTORY.push(data);

        // Keep only the last 10 messages
        if (MESSAGE_HISTORY.length > 10) {
            MESSAGE_HISTORY.shift(); 
        }

        // Broadcast to everyone
        io.emit('chat_message', data);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});