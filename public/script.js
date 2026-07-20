const socket = io();

// Config & State
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const SHARED_SECRET_KEY = "my-really-really-really-secret-code";

let currentUser = "";
let currentTarget = "";
let isGroupChat = false;

// WebRTC State (1-on-1)
let peerConnection = null;
let localStream = null;
let screenStream = null;
let isMuted = false;
let isScreenSharing = false;

// WebRTC State (Group Mesh)
let groupPeers = {}; // { socketId: RTCPeerConnection }
let groupLocalStream = null;
let inGroupCall = false;

/* ==========================================================================
   AUTHENTICATION LOGIC
   ========================================================================== */
let isLoginMode = true;

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? "Secure Login" : "Create Account";
    document.getElementById('primary-auth-btn').innerText = isLoginMode ? "Login" : "Register";
    document.getElementById('toggle-auth-btn').innerText = isLoginMode ? "Create an Account" : "Back to Login";
    document.getElementById('error-msg').innerText = "";
}

async function submitAuth() {
    const usernameInput = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('password').value.trim();
    const errorMsg = document.getElementById('error-msg');

    if (!usernameInput || !passwordInput) {
        errorMsg.innerText = "Please fill in all fields.";
        return;
    }

    const endpoint = isLoginMode ? '/login' : '/register';
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });
        const data = await response.json();

        if (data.success) {
            if (isLoginMode) {
                currentUser = data.username;
                document.getElementById('welcome-bar').innerText = `Logged in as: ${currentUser}`;
                document.getElementById('auth-screen').classList.add('hidden');
                document.getElementById('app-screen').classList.remove('hidden');
                
                socket.emit('register_active_user', currentUser);
            } else {
                alert("Account created successfully! Please log in.");
                toggleAuthMode();
            }
        } else {
            errorMsg.innerText = data.message || "Authentication failed.";
        }
    } catch (err) {
        errorMsg.innerText = "Server error. Try again later.";
    }
}

function logout() {
    location.reload();
}

/* ==========================================================================
   NAVIGATION & DIRECTORY
   ========================================================================== */

socket.on('update_user_directory', (directory) => {
    const usersList = document.getElementById('users-list');
    usersList.innerHTML = "";

    directory.forEach(u => {
        if (u.username === currentUser) return; // Skip self

        const card = document.createElement('div');
        card.className = `user-card ${currentTarget === u.username && !isGroupChat ? 'active-target' : ''}`;
        card.onclick = () => selectUser(u.username);

        const statusDot = `<span class="dot ${u.isOnline ? 'dot-online' : 'dot-offline'}"></span>`;
        card.innerHTML = `<div>${statusDot}<strong>${u.username}</strong></div>`;
        usersList.appendChild(card);
    });
});

function selectGroupChat() {
    isGroupChat = true;
    currentTarget = "";
    
    document.getElementById('chat-header').innerText = "🌐 Global Group Chat";
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;

    // Toggle header button visibility for group view
    document.getElementById('start-call-btn').classList.add('hidden');
    document.getElementById('screen-share-btn').classList.add('hidden');

    document.querySelectorAll('.user-card').forEach(c => c.classList.remove('active-target'));
    document.getElementById('group-room-card').classList.add('active-target');

    socket.emit('get_group_history');
}

function selectUser(targetUsername) {
    isGroupChat = false; // RESET group chat state!
    currentTarget = targetUsername;
    
    document.getElementById('chat-header').innerText = `Chatting with: ${currentTarget}`;
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;

    // Toggle header buttons for 1-on-1 view
    if (currentTarget !== "Gemini AI") {
        document.getElementById('start-call-btn').classList.remove('hidden');
    } else {
        document.getElementById('start-call-btn').classList.add('hidden');
    }

    document.querySelectorAll('.user-card').forEach(c => c.classList.remove('active-target'));
    document.getElementById('group-room-card').classList.remove('active-target');
    
    // Highlight selected contact card
    const cards = document.querySelectorAll('#users-list .user-card');
    cards.forEach(card => {
        if (card.innerText.includes(targetUsername)) {
            card.classList.add('active-target');
        }
    });

    socket.emit('get_private_history', currentTarget);
}

/* ==========================================================================
   MESSAGING & DECRYPTION
   ========================================================================== */

function sendPrivateMsg() {
    const msgInput = document.getElementById('message-input');
    const text = msgInput.value.trim();
    if (!text || !socket) return;

    const encryptedText = CryptoJS.AES.encrypt(text, SHARED_SECRET_KEY).toString();

    if (isGroupChat) {
        socket.emit('group_message', { text: encryptedText });
    } else if (currentTarget) {
        socket.emit('private_message', { to: currentTarget, text: encryptedText });
    }
    msgInput.value = "";
}

// Support Enter key to send message
document.getElementById('message-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrivateMsg();
    }
});

socket.on('load_history', (history) => {
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML = "";
    history.forEach(msg => displayMessage(msg));
});

socket.on('load_group_history', (history) => {
    if (isGroupChat) {
        const chatBox = document.getElementById('chat-box');
        chatBox.innerHTML = "";
        history.forEach(msg => displayMessage(msg));
    }
});

socket.on('chat_message', (data) => {
    if (!isGroupChat) {
        displayMessage(data);
    }
});

socket.on('group_message', (data) => {
    if (isGroupChat) {
        displayMessage(data);
    }
});

function displayMessage(msgData) {
    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return;

    let decryptedText = "";
    try {
        const bytes = CryptoJS.AES.decrypt(msgData.text, SHARED_SECRET_KEY);
        decryptedText = bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        decryptedText = "[Decryption Error]";
    }

    const isSelf = msgData.user === currentUser;
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isSelf ? 'sent' : 'received'}`;
    
    bubble.innerHTML = `
        <div class="message-author">${msgData.user}</div>
        <div>${decryptedText}</div>
    `;

    chatBox.appendChild(bubble);
    chatBox.scrollTop = chatBox.scrollHeight;
}

/* ==========================================================================
   GROUP VOICE CALL (MESH WEBRTC)
   ========================================================================== */

async function toggleGroupCall() {
    const btn = document.getElementById('group-call-btn');
    if (!inGroupCall) {
        try {
            groupLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            inGroupCall = true;
            btn.innerText = "❌ Leave Group Voice";
            btn.classList.replace('call-btn', 'end-btn');
            
            socket.emit('join_group_call');
        } catch (err) {
            alert("Microphone access is required to join group voice.");
        }
    } else {
        leaveGroupCall();
    }
}

socket.on('all_call_users', (users) => {
    users.forEach(u => {
        createGroupPeer(u.socketId, true);
    });
});

socket.on('user_joined_call', ({ socketId }) => {
    createGroupPeer(socketId, false);
});

socket.on('mesh_signal', async ({ fromSocketId, signal }) => {
    let pc = groupPeers[fromSocketId];
    if (!pc) pc = createGroupPeer(fromSocketId, false);

    if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('send_mesh_signal', { toSocketId: fromSocketId, signal: { sdp: pc.localDescription } });
        }
    } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
});

socket.on('user_left_call', ({ socketId }) => {
    if (groupPeers[socketId]) {
        groupPeers[socketId].close();
        delete groupPeers[socketId];
    }
    // Clean up DOM element
    const audioEl = document.getElementById(`audio-${socketId}`);
    if (audioEl) audioEl.remove();
});

function createGroupPeer(targetSocketId, isInitiator) {
    const pc = new RTCPeerConnection(rtcConfig);
    groupPeers[targetSocketId] = pc;

    if (groupLocalStream) {
        groupLocalStream.getTracks().forEach(track => pc.addTrack(track, groupLocalStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('send_mesh_signal', { toSocketId: targetSocketId, signal: { candidate: event.candidate } });
        }
    };

    pc.ontrack = (event) => {
        let audioEl = document.getElementById(`audio-${targetSocketId}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio-${targetSocketId}`;
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
        }
        audioEl.srcObject = event.streams[0];
    };

    if (isInitiator) {
        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            socket.emit('send_mesh_signal', { toSocketId: targetSocketId, signal: { sdp: offer } });
        });
    }

    return pc;
}

function leaveGroupCall() {
    inGroupCall = false;
    const btn = document.getElementById('group-call-btn');
    btn.innerText = "🔊 Join Group Voice";
    btn.classList.replace('end-btn', 'call-btn');

    socket.emit('leave_group_call');

    Object.keys(groupPeers).forEach(id => {
        groupPeers[id].close();
        const audioEl = document.getElementById(`audio-${id}`);
        if (audioEl) audioEl.remove();
    });
    groupPeers = {};

    if (groupLocalStream) {
        groupLocalStream.getTracks().forEach(t => t.stop());
        groupLocalStream = null;
    }
}

/* ==========================================================================
   1-ON-1 CALLS & SCREEN SHARING
   ========================================================================== */

async function startCall() {
    if (!currentTarget) return;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    
    peerConnection = create1on1PeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('call_user', { to: currentTarget, offer });
    
    document.getElementById('call-banner').classList.remove('hidden');
    document.getElementById('call-status-text').innerText = `Calling ${currentTarget}...`;
    document.getElementById('mute-btn').classList.remove('hidden');
    document.getElementById('screen-share-btn').classList.remove('hidden');
}

socket.on('incoming_call', async ({ from, offer }) => {
    currentTarget = from;
    document.getElementById('call-banner').classList.remove('hidden');
    document.getElementById('call-status-text').innerText = `Incoming call from ${from}`;
    document.getElementById('accept-call-btn').classList.remove('hidden');
    
    window.pendingOffer = offer;
});

async function acceptCall() {
    document.getElementById('accept-call-btn').classList.add('hidden');
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    peerConnection = create1on1PeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    await peerConnection.setRemoteDescription(new RTCSessionDescription(window.pendingOffer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer_call', { to: currentTarget, answer });
    
    document.getElementById('mute-btn').classList.remove('hidden');
    document.getElementById('screen-share-btn').classList.remove('hidden');
}

socket.on('call_answered', async ({ answer }) => {
    document.getElementById('call-status-text').innerText = `In call with ${currentTarget}`;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice_candidate', async ({ candidate }) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('call_ended', () => {
    endCall(false);
});

function endCall(notifyPeer = true) {
    if (notifyPeer && currentTarget) {
        socket.emit('end_call', { to: currentTarget });
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }

    document.getElementById('call-banner').classList.add('hidden');
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('mute-btn').classList.add('hidden');
    document.getElementById('screen-share-btn').classList.add('hidden');
}

function create1on1PeerConnection() {
    const pc = new RTCPeerConnection(rtcConfig);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', { to: currentTarget, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        if (event.track.kind === 'video') {
            const videoEl = document.getElementById('remote-video');
            videoEl.srcObject = event.streams[0];
            document.getElementById('video-container').classList.remove('hidden');
        } else if (event.track.kind === 'audio') {
            const audioEl = document.getElementById('remote-audio');
            audioEl.srcObject = event.streams[0];
        }
    };

    return pc;
}

function toggleMute() {
    if (!localStream && !groupLocalStream) return;
    isMuted = !isMuted;
    
    const stream = localStream || groupLocalStream;
    stream.getAudioTracks()[0].enabled = !isMuted;
    
    const muteBtn = document.getElementById('mute-btn');
    muteBtn.innerText = isMuted ? "🔇 Unmute" : "🎙️ Mute";
}

async function toggleScreenShare() {
    if (!peerConnection) return;

    if (!isScreenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: true
            });

            const screenTrack = screenStream.getVideoTracks()[0];
            peerConnection.addTrack(screenTrack, screenStream);

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('call_user', { to: currentTarget, offer });

            isScreenSharing = true;
            document.getElementById('screen-share-btn').innerText = "🛑 Stop Share";
        } catch (e) {
            console.error("Screen share error:", e);
        }
    } else {
        stopScreenShare();
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }
    isScreenSharing = false;
    document.getElementById('screen-share-btn').innerText = "🖥️ Share Screen";
}

function toggleFullscreen() {
    const container = document.getElementById('video-container');
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => console.error(err));
    } else {
        document.exitFullscreen();
    }
}