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

    // Handles live status tracking list rendering
    socket.on('update_status_list', (onlineUsers) => {
        const listDiv = document.getElementById('users-list');
        listDiv.innerHTML = "";
        onlineUsers.forEach(user => {
            if(user !== currentUser) {
                const item = document.createElement('div');
                item.className = "status-tag";
                item.innerHTML = `<span class="dot"></span> <span>${user}</span>`;
                listDiv.appendChild(item);
            }
        });
    });

    socket.on('load_history', (history) => {
        const chatBox = document.getElementById('chat-box');
        chatBox.innerHTML = ""; 
        history.forEach(msg => displayMessage(msg));
    });

    socket.on('chat_message', (data) => {
        // Only render immediately if it matches the current conversational path
        if (data.user === currentTarget || data.user === currentUser) {
            displayMessage(data);
        }
    });
}

function switchTargetChannel() {
    currentTarget = document.getElementById('target-user').value.trim();
    if (currentTarget && socket) {
        socket.emit('get_private_history', currentTarget);
    }
}

function sendPrivateMsg() {
    const msgInput = document.getElementById('message-input');
    const text = msgInput.value.trim();
    currentTarget = document.getElementById('target-user').value.trim();

    if (!currentTarget) {
        alert("Please specify a target person first!");
        return;
    }

    if (text && socket) {
        const encryptedText = CryptoJS.AES.encrypt(text, SHARED_SECRET_KEY).toString();
        socket.emit('private_message', { to: currentTarget, text: encryptedText });
        msgInput.value = "";
    }
}