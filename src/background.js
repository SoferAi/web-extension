import {
    initializeAuth,
    createTranscription,
    checkTranscriptionStatus,
    handleApiError,
} from './api.js';

// Keep track of active polling intervals
const pollingIntervals = new Map();

// Initialize authentication state
chrome.runtime.onStartup.addListener(async () => {
    await initializeAuth();
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'CHECK_AUTH':
            handleCheckAuth(sendResponse);
            return true; // Keep channel open for async response

        case 'CREATE_TRANSCRIPTION':
            handleCreateTranscription(message.metadata, sender.tab.id, sendResponse);
            return true; // Keep channel open for async response

        case 'CHECK_TRANSCRIPTION':
            handleCheckTranscription(message.transcriptionId, sender.tab.id, sendResponse);
            return true; // Keep channel open for async response

        default:
            console.warn('Unknown message type:', message.type);
            return false;
    }
});

// Authentication check handler
async function handleCheckAuth(sendResponse) {
    try {
        const isAuthenticated = await initializeAuth();
        sendResponse({ isAuthenticated });
    } catch (error) {
        console.error('Auth check failed:', error);
        sendResponse({ isAuthenticated: false, error: handleApiError(error) });
    }
}

// Create transcription handler
async function handleCreateTranscription(metadata, tabId, sendResponse) {
    try {
        const sessionId = crypto.randomUUID();
        const accessToken = await getSessionFromCookie();

        if (!accessToken) {
            sendResponse({ error: 'Not authenticated' });
            return;
        }

        const response = await fetch(`${BASE_URL}/transcribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            credentials: 'include',
            body: JSON.stringify({
                audioUrl: metadata.audioUrl,
                info: metadata.info
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            sendResponse({ error: error.message || `HTTP error! status: ${response.status}` });
            return;
        }

        const data = await response.json();
        sendResponse({ transcriptionId: data.id });

        // Start polling for status
        startPolling(data.id, metadata.audioUrl, tabId);
    } catch (error) {
        console.error('Create transcription error:', error);
        sendResponse({ error: error.message || 'Failed to create transcription' });
    }
}

// Check transcription status handler
async function handleCheckTranscription(transcriptionId, tabId, sendResponse) {
    try {
        const accessToken = await getSessionFromCookie();

        if (!accessToken) {
            sendResponse({ error: 'Not authenticated' });
            return;
        }

        const response = await fetch(`${BASE_URL}/transcribe/${transcriptionId}/status`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            credentials: 'include'
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            sendResponse({ error: error.message || `HTTP error! status: ${response.status}` });
            return;
        }

        const data = await response.json();
        sendResponse({ status: data.status });

        // If not already polling, start polling
        if (!pollingIntervals.has(transcriptionId)) {
            startPolling(transcriptionId, data.audioUrl, tabId);
        }
    } catch (error) {
        console.error('Check status error:', error);
        sendResponse({ error: error.message || 'Failed to check transcription status' });
    }
}

// Polling function for transcription status
function startPolling(transcriptionId, audioUrl, tabId) {
    if (pollingIntervals.has(transcriptionId)) {
        return; // Already polling
    }

    const pollInterval = setInterval(async () => {
        try {
            const result = await checkTranscriptionStatus(transcriptionId);

            // Send status update to content script
            chrome.tabs.sendMessage(tabId, {
                type: 'TRANSCRIPTION_STATUS_UPDATE',
                audioUrl,
                status: result.status,
                transcriptionId,
            });

            // If completed or failed, stop polling
            if (result.status === 'completed' || result.status === 'failed') {
                clearInterval(pollInterval);
                pollingIntervals.delete(transcriptionId);
            }
        } catch (error) {
            const apiError = handleApiError(error);
            chrome.tabs.sendMessage(tabId, {
                type: 'TRANSCRIPTION_STATUS_UPDATE',
                audioUrl,
                error: apiError.message,
            });

            // Stop polling on error
            clearInterval(pollInterval);
            pollingIntervals.delete(transcriptionId);
        }
    }, 30000); // Poll every 30 seconds

    pollingIntervals.set(transcriptionId, pollInterval);
}

// Clean up polling intervals when extension is unloaded
chrome.runtime.onSuspend.addListener(() => {
    for (const interval of pollingIntervals.values()) {
        clearInterval(interval);
    }
    pollingIntervals.clear();
}); 