let socket;
let currentUser = "";
let currentTarget = "";
let isRegisterMode = false;
const SHARED_SECRET_KEY = "my-really-really-really-secret-code";

let peerConnection;
let localStream;
let incomingOffer = null;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Restore session on page load
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = sessionStorage.getItem('chat_username');
    if (savedUser) {
        currentUser = savedUser;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        document.getElementById('welcome-bar').innerText = `Logged in as: ${currentUser}`;
        initSocket();
    }

    // Keydown listener for Enter to send vs Shift+Enter for newline
    const msgInput = document.getElementById('message-input');
    msgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevents adding a new line
            sendPrivateMsg();
        }
    });
});

function logout() {
    sessionStorage.removeItem('chat_username');
    location.reload();
}

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-title').innerText = isRegisterMode ? "Create Account" : "Secure Login";
    document.getElementById('primary-auth-btn').innerText = isRegisterMode ? "Register Account" : "Login";
    document.getElementById('toggle-auth-btn').innerText = isRegisterMode ? "Back to Login" : "Create an Account";
    document.getElementById('error-msg').innerText = "";
}

async function submitAuth() {
    const usernameInput = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('password').value.trim();
    const errorText = document.getElementById('error-msg');

    if(!usernameInput || !passwordInput) {
        errorText.innerText = "Please complete all fields.";
        return;
    }

    const endpoint = isRegisterMode ? '/register' : '/login';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });
        const data = await response.json();

        if (data.success) {
            if (isRegisterMode) {
                isRegisterMode = false;
                toggleAuthMode();
                errorText.style.color = "#04d361";
                errorText.innerText = "Account created! Please log in.";
            } else {
                currentUser = data.username;
                sessionStorage.setItem('chat_username', currentUser);
                document.getElementById('auth-screen').classList.add('hidden');
                document.getElementById('app-screen').classList.remove('hidden');
                document.getElementById('welcome-bar').innerText = `Logged in as: ${currentUser}`;
                initSocket();
            }
        } else {
            errorText.style.color = "#f75a68";
            errorText.innerText = data.message;
        }
    } catch(err) {
        errorText.innerText = "Connection error.";
    }
}

function initSocket() {
    socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
    socket.emit('register_active_user', currentUser);

    function displayMessage(data) {
        const chatBox = document.getElementById('chat-box');
        try {
            const bytes = CryptoJS.AES.decrypt(data.text, SHARED_SECRET_KEY);
            const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
            if (decryptedText) {
                const msgElement = document.createElement('p');
                // Support newlines in displayed messages
                const formattedText = decryptedText.replace(/\n/g, '<br>');
                msgElement.innerHTML = `<strong>${data.user}:</strong> ${formattedText}`;
                chatBox.appendChild(msgElement);
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        } catch (e) { console.error("Decryption error", e); }
    }

    socket.on('update_user_directory', (userList) => {
        const listDiv = document.getElementById('users-list');
        listDiv.innerHTML = "";

        userList.forEach(account => {
            if (account.username === currentUser) return;

            const card = document.createElement('div');
            const isActive = account.username === currentTarget;
            card.className = `user-card ${isActive ? 'active-target' : ''}`;
            
            const dotClass = account.isOnline ? 'dot-online' : 'dot-offline';
            const statusText = account.isOnline ? 'Online' : 'Offline';

            card.innerHTML = `
                <div>
                    <span class="dot ${dotClass}"></span>
                    <span>${account.username}</span>
                </div>
                <span style="font-size: 11px; opacity:0.7;">${statusText}</span>
            `;

            card.onclick = () => selectTargetUser(account.username);
            listDiv.appendChild(card);
        });
    });

    socket.on('load_history', (history) => {
        const chatBox = document.getElementById('chat-box');
        chatBox.innerHTML = ""; 
        history.forEach(msg => displayMessage(msg));
    });

    socket.on('chat_message', (data) => {
        const expectedRoom = [currentUser, currentTarget].sort().join('-');
        if (data.room === expectedRoom) {
            displayMessage(data);
        }
    });

    socket.on('incoming_call', async ({ from, offer }) => {
        incomingOffer = { from, offer };
        document.getElementById('call-banner').classList.remove('hidden');
        document.getElementById('call-status-text').innerText = `Incoming Call from ${from}...`;
        document.getElementById('accept-call-btn').classList.remove('hidden');
    });

    socket.on('call_answered', async ({ answer }) => {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        document.getElementById('call-status-text').innerText = `Call Connected`;
    });

    socket.on('ice_candidate', async ({ candidate }) => {
        if (peerConnection && candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });

    socket.on('call_ended', () => {
        cleanupCall();
    });
}

function showMobileTab(tab) {
    const sidebar = document.getElementById('sidebar');
    const mainChat = document.getElementById('main-chat');
    
    if (tab === 'contacts') {
        sidebar.classList.remove('mobile-hidden');
        mainChat.classList.add('mobile-hidden');
    } else {
        sidebar.classList.add('mobile-hidden');
        mainChat.classList.remove('mobile-hidden');
    }
}

function selectTargetUser(targetUsername) {
    currentTarget = targetUsername;
    
    document.getElementById('chat-header').innerText = `Chatting with: ${currentTarget}`;
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('start-call-btn').classList.remove('hidden');

    if (window.innerWidth <= 768) {
        showMobileTab('chat');
    }

    if (socket) {
        socket.emit('get_private_history', currentTarget);
    }
}

function sendPrivateMsg() {
    const msgInput = document.getElementById('message-input');
    const text = msgInput.value.trim();

    if (!currentTarget) return;

    if (text && socket) {
        const encryptedText = CryptoJS.AES.encrypt(text, SHARED_SECRET_KEY).toString();
        socket.emit('private_message', { to: currentTarget, text: encryptedText });
        msgInput.value = "";
    }
}

async function startCall() {
    if (!currentTarget) return;
    setupPeerConnection();

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('call_user', { to: currentTarget, offer });
    document.getElementById('call-banner').classList.remove('hidden');
    document.getElementById('call-status-text').innerText = `Calling ${currentTarget}...`;
    document.getElementById('accept-call-btn').classList.add('hidden');
}

async function acceptCall() {
    if (!incomingOffer) return;
    currentTarget = incomingOffer.from;
    setupPeerConnection();

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingOffer.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer_call', { to: currentTarget, answer });
    document.getElementById('call-status-text').innerText = `In Call with ${currentTarget}`;
    document.getElementById('accept-call-btn').classList.add('hidden');
}

function setupPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', { to: currentTarget, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        const remoteAudio = document.getElementById('remote-audio');
        remoteAudio.srcObject = event.streams[0];
    };
}

function endCall() {
    if (currentTarget) {
        socket.emit('end_call', { to: currentTarget });
    }
    cleanupCall();
}

function cleanupCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    document.getElementById('call-banner').classList.add('hidden');
}