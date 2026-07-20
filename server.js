const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const { GoogleGenAI } = require('@google/genai');
const CryptoJS = require('crypto-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// 1. Connection strings (replace with your actual password and key)
const MONGO_URI = "mongodb+srv://admin:firewaterchat@cluster0.zbclxv1.mongodb.net/chat_db?retryWrites=true&w=majority&appName=Cluster0";
const GEMINI_API_KEY = "AIzaSyAQ.Ab8RN6LEYwnWi959nnnUhfX_lcDUDViFbRtyiLH6-KfSBcyJzA";

// 2. Initialize Gemini
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Connect to MongoDB Database
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas successfully!'))
    .catch(err => console.error('MongoDB connection error:', err));

// Define Database Schemas
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

const ACTIVE_USERS = {}; // Tracks live socket connections

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
        io.emit('update_user_directory', directory);
    } catch (err) {
        console.error("Error broadcasting user directory:", err);
    }
}

io.on('connection', (socket) => {
    let authenticatedUser = null;

    socket.on('register_active_user', async (username) => {
        authenticatedUser = username;
        ACTIVE_USERS[username] = socket.id;
        await broadcastUserDirectory();
    });

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
        const { to, text } = data; // 'text' is AES-encrypted from frontend
        const room = getRoomId(authenticatedUser, to);

        try {
            // Save & send human message
            const savedMsg = new Message({ room, user: authenticatedUser, text });
            await savedMsg.save();

            const recipientSocketId = ACTIVE_USERS[to];
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('chat_message', { room, user: authenticatedUser, text });
            }
            socket.emit('chat_message', { room, user: authenticatedUser, text });

            // --- Gemini AI Bot Handling ---
            if (to === "Gemini AI") {
                // 1. Decrypt user's text for Gemini
                const bytes = CryptoJS.AES.decrypt(text, SHARED_SECRET_KEY);
                const plainPrompt = bytes.toString(CryptoJS.enc.Utf8);

                // 2. Fetch answer from Gemini
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: plainPrompt,
                });
                const plainReply = response.text || "Sorry, I couldn't process that.";

                // 3. Encrypt Gemini's response so frontend can decrypt it
                const encryptedReply = CryptoJS.AES.encrypt(plainReply, SHARED_SECRET_KEY).toString();

                // 4. Save & emit encrypted reply back to user
                const aiMsgData = { room, user: "Gemini AI", text: encryptedReply };
                const savedAiMsg = new Message(aiMsgData);
                await savedAiMsg.save();

                socket.emit('chat_message', aiMsgData);
            }
        } catch (err) {
            console.error("Error handling message or Gemini API:", err);
        }
    });

    // WebRTC Voice Call Signaling
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

    socket.on('disconnect', async () => {
        if (authenticatedUser) {
            delete ACTIVE_USERS[authenticatedUser];
            await broadcastUserDirectory();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});