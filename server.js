const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Render or other cloud services assign a dynamic port via process.env.PORT
const PORT = process.env.PORT || 3000;

// Hardcoded database for credential validation
const USERS = {
    "user1": "password123",
    "user2": "securepass"
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Endpoint
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (USERS[username] && USERS[username] === password) {
        res.json({ success: true, username });
    } else {
        res.status(401).json({ success: false, message: "Invalid credentials" });
    }
});

// Socket.io WebSockets link the devices for instant routing
io.on('connection', (socket) => {
    // Listen for encrypted messages coming from a device
    socket.on('chat_message', (data) => {
        // Broadcast the encrypted payload instantly to all connected devices
        io.emit('chat_message', data);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});