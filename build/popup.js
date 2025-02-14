// DOM Elements
const loginPrompt = document.getElementById('loginPrompt');
const signInButton = document.getElementById('signInButton');
const statusContainer = document.getElementById('statusContainer');
const openDashboard = document.getElementById('openDashboard');
const signOutButton = document.getElementById('signOutButton');
const transcriptionList = document.getElementById('transcriptionList');

// Initialize popup state
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const isAuthenticated = await window.soferApi.initializeAuth();
        console.log('Authentication state:', { isAuthenticated });
        if (isAuthenticated) {
            showAuthenticatedState();
        } else {
            showLoginPrompt();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showLoginPrompt();
    }
});

// Handle sign in button click
signInButton.addEventListener('click', async () => {
    try {
        await window.soferApi.login(); // This will open the sign-in page
    } catch (error) {
        console.error('Sign in failed:', error);
    }
});

// Handle open dashboard button
openDashboard.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://app.sofer.ai/dashboard' });
});

// Handle sign out button
signOutButton.addEventListener('click', async () => {
    try {
        await window.soferApi.logout(); // This will open the sign-out page
        showLoginPrompt();
    } catch (error) {
        console.error('Sign out failed:', error);
    }
});

// Show authenticated state
function showAuthenticatedState() {
    loginPrompt.style.display = 'none';
    statusContainer.classList.add('active');

    // Get transcriptions from storage
    chrome.storage.local.get('transcriptions', ({ transcriptions }) => {
        if (transcriptions) {
            updateTranscriptionList(transcriptions);
        }
    });
}

// Show login prompt
function showLoginPrompt() {
    loginPrompt.style.display = 'flex';
    statusContainer.classList.remove('active');
}

// Update transcription list
function updateTranscriptionList(transcriptions) {
    transcriptionList.innerHTML = '';

    const transcriptionEntries = Object.entries(transcriptions)
        .sort((a, b) => b[1].created - a[1].created)
        .slice(0, 10); // Show only the 10 most recent

    if (transcriptionEntries.length === 0) {
        transcriptionList.innerHTML = '<div class="transcription-item">No recent transcriptions</div>';
        return;
    }

    transcriptionEntries.forEach(([audioUrl, data]) => {
        const item = document.createElement('div');
        item.className = 'transcription-item';

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = data.title || 'Untitled';

        const status = document.createElement('div');
        status.className = `status ${data.status}`;
        status.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);

        item.appendChild(title);
        item.appendChild(status);

        if (data.status === 'completed') {
            item.addEventListener('click', () => {
                chrome.tabs.create({
                    url: `https://app.sofer.ai/transcripts/${data.id}`,
                });
            });
            item.style.cursor = 'pointer';
        }

        transcriptionList.appendChild(item);
    });
}

// Listen for transcription updates
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSCRIPTION_STATUS_UPDATE') {
        chrome.storage.local.get('transcriptions', ({ transcriptions }) => {
            if (transcriptions) {
                updateTranscriptionList(transcriptions);
            }
        });
    }
});
