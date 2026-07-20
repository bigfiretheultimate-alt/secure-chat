const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const genai = require('@google/genai');
const CryptoJS = require('crypto-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Database & API Configuration
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:firewaterchat@cluster0.zbclxvl.mongodb.net/?appName=Cluster0";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize Gemini AI
const GoogleGenAIClass = genai.GoogleGenAI || genai;
const ai = new GoogleGenAIClass({ apiKey: GEMINI_API_KEY });

const SHARED_SECRET_KEY = "my-really-really-really-secret-code";

// Connect to MongoDB
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas successfully!'))
    .catch(err => console.error('MongoDB connection error:', err));

// Database Schemas
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const messageSchema = new mongoose.Schema({
    room: { type: String, required: true },
    user: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

const ACTIVE_USERS = {}; // { username: socket.id }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Account Creation Endpoint
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: "Missing fields" });

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ success: false, message: "Username taken" });

        const newUser = new User({ username, password });
        await newUser.save();

        await broadcastUserDirectory();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server database error" });
    }
});

// Login Endpoint
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username, password });
        if (user) {
            res.json({ success: true, username: user.username });
        } else {
            res.status(401).json({ success: false, message: "Invalid credentials" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Server database error" });
    }
});

function getRoomId(user1, user2) {
    return [user1, user2].sort().join('-');
}

async function broadcastUserDirectory() {
    try {
        const allUsers = await User.find({}, 'username');
        const directory = allUsers.map(u => ({
            username: u.username,
            isOnline: Boolean(ACTIVE_USERS[u.username])
        }));
        directory.unshift({ username: "Gemini AI", isOnline: true });
        io.emit('update_user_directory', directory);
    } catch (err) {
        console.error("Error broadcasting user directory:", err);
    }
}

// Socket.io Real-Time Communications
io.on('connection', (socket) => {
    let authenticatedUser = null;

    socket.on('register_active_user', async (username) => {
        authenticatedUser = username;
        socket.username = username;
        ACTIVE_USERS[username] = socket.id;
        await broadcastUserDirectory();
    });

    // --- 1-ON-1 CHAT & GEMINI AI ---
    socket.on('get_private_history', async (targetUser) => {
        if (!authenticatedUser) return;
        const room = getRoomId(authenticatedUser, targetUser);
        try {
            const history = await Message.find({ room }).sort({ timestamp: -1 }).limit(10);
            socket.emit('load_history', history.reverse());
        } catch (err) {
            console.error("Error loading chat history:", err);
        }
    });

    socket.on('private_message', async (data) => {
        if (!authenticatedUser) return;
        const { to, text } = data;
        const room = getRoomId(authenticatedUser, to);

        try {
            const savedMsg = new Message({ room, user: authenticatedUser, text });
            await savedMsg.save();

            const recipientSocketId = ACTIVE_USERS[to];
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('chat_message', { room, user: authenticatedUser, text });
            }
            socket.emit('chat_message', { room, user: authenticatedUser, text });

            // Gemini AI Bot Handling
            if (to === "Gemini AI") {
                const bytes = CryptoJS.AES.decrypt(text, SHARED_SECRET_KEY);
                const plainPrompt = bytes.toString(CryptoJS.enc.Utf8);

                const response = await ai.models.generateContent({
                    model: 'gemini-flash-latest',
                    contents: plainPrompt,
                });
                const plainReply = response.text || "Sorry, I couldn't process that.";

                const encryptedReply = CryptoJS.AES.encrypt(plainReply, SHARED_SECRET_KEY).toString();

                const aiMsgData = { room, user: "Gemini AI", text: encryptedReply };
                const savedAiMsg = new Message(aiMsgData);
                await savedAiMsg.save();

                socket.emit('chat_message', aiMsgData);
            }
        } catch (err) {
            console.error("Error handling private message or Gemini API:", err);
        }
    });

    // --- GROUP CHAT LOGIC ---
    socket.on('get_group_history', async () => {
        try {
            const history = await Message.find({ room: 'GLOBAL_GROUP' }).sort({ timestamp: -1 }).limit(30);
            socket.emit('load_group_history', history.reverse());
        } catch (err) {
            console.error("Error loading group history:", err);
        }
    });

    socket.on('group_message', async (data) => {
        if (!authenticatedUser) return;
        const { text } = data;
        const room = 'GLOBAL_GROUP';

        try {
            const savedMsg = new Message({ room, user: authenticatedUser, text });
            await savedMsg.save();

            io.emit('group_message', { room, user: authenticatedUser, text });
        } catch (err) {
            console.error("Error saving group message:", err);
        }
    });

    // --- 1-ON-1 WEBRTC CALL SIGNALING ---
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

    // --- GROUP VOICE CALL SIGNALING (MESH) ---
    socket.on('join_group_call', () => {
        socket.join('group_room');
        socket.to('group_room').emit('user_joined_call', {
            signalUser: authenticatedUser,
            socketId: socket.id
        });

        const clients = Array.from(io.sockets.adapter.rooms.get('group_room') || []);
        const otherUsers = clients
            .filter(id => id !== socket.id)
            .map(id => ({ socketId: id, username: io.sockets.sockets.get(id)?.username }));
        
        socket.emit('all_call_users', otherUsers);
    });

    socket.on('send_mesh_signal', ({ toSocketId, signal }) => {
        io.to(toSocketId).emit('mesh_signal', {
            fromSocketId: socket.id,
            fromUser: authenticatedUser,
            signal
        });
    });

    socket.on('leave_group_call', () => {
        socket.leave('group_room');
        socket.to('group_room').emit('user_left_call', { socketId: socket.id });
    });

    // --- DISCONNECT HANDLER ---
    socket.on('disconnect', async () => {
        if (authenticatedUser) {
            delete ACTIVE_USERS[authenticatedUser];
            socket.to('group_room').emit('user_left_call', { socketId: socket.id });
            await broadcastUserDirectory();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});