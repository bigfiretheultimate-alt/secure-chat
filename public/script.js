let socket;
let currentUser = "";
let currentTarget = "";
let isRegisterMode = false;
const SHARED_SECRET_KEY = "my-super-secret-vault-key";

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
                msgElement.innerHTML = `<strong>${data.user}:</strong> ${decryptedText}`;
                chatBox.appendChild(msgElement);
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        } catch (e) { console.error("Decryption error", e); }
    }

    // Render directory showing both online & offline users
    socket.on('update_user_directory', (userList) => {
        const listDiv = document.getElementById('users-list');
        listDiv.innerHTML = "";

        userList.forEach(account => {
            if (account.username === currentUser) return; // Hide self

            const card = document.createElement('div');
            const isActive = account.username === currentTarget;
            card.className = `user-card ${isActive ? 'active-target' : ''}`;
            
            const dotClass = account.isOnline ? 'dot-online' : 'dot-offline';
            const statusText = account.isOnline ? 'Online' : 'Offline';

            card.innerHTML = `
                <div class="user-info">
                    <span class="dot ${dotClass}"></span>
                    <span>${account.username}</span>
                </div>
                <span class="status-label">${statusText}</span>
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
}

function selectTargetUser(targetUsername) {
    currentTarget = targetUsername;
    
    // Update Chat Header & Enable Controls
    document.getElementById('chat-header').innerText = `Chatting with: ${currentTarget}`;
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;

    // Trigger UI selection styling update
    document.querySelectorAll('.user-card').forEach(card => {
        if(card.innerText.includes(targetUsername)) {
            card.classList.add('active-target');
        } else {
            card.classList.remove('active-target');
        }
    });

    // Request chat history with selected user
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