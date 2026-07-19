let socket;
let currentUsername = "";

// Shared symmetric key for E2EE. This key never interacts with the server.
const SHARED_SECRET_KEY = "my-super-secret-vault-key"; 

async function login() {
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;
    const errorMsg = document.getElementById('login-error');

    errorMsg.innerText = ""; // Clear errors

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });

        const data = await response.json();

        if (data.success) {
            currentUsername = data.username;
            // Swap visible interfaces
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('chat-screen').classList.remove('hidden');
            document.getElementById('welcome-text').innerText = `Logged in as: ${currentUsername}`;
            
            // Initiate the WebSocket pipeline
            initSocket();
        } else {
            errorMsg.innerText = data.message;
        }
    } catch (err) {
        errorMsg.innerText = "Could not connect to server.";
    }
}

function initSocket() {
    socket = io(window.location.origin, {
        transports: ['websocket', 'polling']
    });

    // Helper function to handle decrypting and displaying a message
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
        } catch (e) {
            console.error("Decryption failed.", e);
        }
    }

    // Listen for the server sending the past 10 messages upon logging in
    socket.on('load_history', (history) => {
        const chatBox = document.getElementById('chat-box');
        chatBox.innerHTML = ""; // Clear out chatbox to prevent duplicates
        history.forEach(msg => {
            displayMessage(msg);
        });
    });

    // Listen for single incoming live messages
    socket.on('chat_message', (data) => {
        displayMessage(data);
    });
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    
    if (text !== "" && socket) {
        // Encrypt plain text using Advanced Encryption Standard (AES) before sending
        const encryptedText = CryptoJS.AES.encrypt(text, SHARED_SECRET_KEY).toString();
        
        socket.emit('chat_message', { user: currentUsername, text: encryptedText });
        input.value = "";
    }
}