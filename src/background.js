// Environment configuration
const ENV = 'production'; // Will be updated by storage
const getBaseUrl = () => ENV === 'development' ? 'http://localhost:3000' : 'https://app.sofer.ai';
let BASE_URL = getBaseUrl();
const AUTH_COOKIE_PREFIX = 'sb-auth-auth-token';

// Initialize environment from storage
chrome.storage.local.get('environment', ({ environment }) => {
    if (environment) {
        ENV = environment;
        BASE_URL = getBaseUrl();
        console.log('Environment set to:', ENV);
        console.log('Base URL:', BASE_URL);
    }
});

// Helper function to extract access token from cookie value
const extractAccessToken = (cookieValue) => {
    try {
        console.log('Attempting to extract token from:', cookieValue.substring(0, 50) + '...');

        if (cookieValue.startsWith('base64-')) {
            const base64Value = cookieValue.replace('base64-', '');
            console.log('Found base64 value, decoding...');

            try {
                const decodedValue = atob(base64Value);
                console.log('Successfully decoded base64');
                const parsedValue = JSON.parse(decodedValue);
                console.log('Parsed JSON structure:', Object.keys(parsedValue));

                if (parsedValue.access_token) {
                    return parsedValue.access_token;
                }
            } catch (e) {
                console.log('Base64 decode or JSON parse failed:', e.message);
            }
        }

        // Try parsing as JSON directly
        try {
            const parsedValue = JSON.parse(cookieValue);
            if (parsedValue.access_token) {
                return parsedValue.access_token;
            }
        } catch (e) {
            // If it looks like a JWT token, use it directly
            if (cookieValue.includes('eyJ')) {
                console.log('Using value directly as JWT token');
                return cookieValue;
            }
        }

        console.log('Failed to extract token from cookie value');
        return null;
    } catch (error) {
        console.error('Failed to extract access token:', error);
        return null;
    }
};

// Helper function to get auth token from cookies
const getAuthToken = async () => {
    return new Promise((resolve) => {
        chrome.cookies.getAll({ domain: 'app.sofer.ai' }, (cookies) => {
            console.log('Found cookies:', cookies.map(c => c.name));

            // Try cookies with .0 and .1 suffixes first
            for (const suffix of ['.0', '.1']) {
                const authCookie = cookies.find(cookie =>
                    cookie.name === AUTH_COOKIE_PREFIX + suffix
                );

                if (authCookie && authCookie.value) {
                    console.log(`Found auth cookie with suffix ${suffix}`);
                    const token = extractAccessToken(authCookie.value);
                    if (token) {
                        console.log('Successfully extracted token');
                        resolve(token);
                        return;
                    }
                }
            }
            console.log("No valid auth cookie found");

            // Fallback to any cookie starting with the prefix
            const authCookie = cookies.find(cookie =>
                cookie.name.startsWith(AUTH_COOKIE_PREFIX)
            );

            if (authCookie && authCookie.value) {
                console.log('Found auth cookie with prefix match');
                const token = extractAccessToken(authCookie.value);
                resolve(token);
                return;
            }

            console.log('No valid auth cookie found');
            resolve(null);
        });
    });
};

// Check authentication status
const checkAuth = async () => {
    try {
        const token = await getAuthToken();
        if (!token) {
            console.log('No auth token found');
            return false;
        }

        console.log('Verifying token with backend...');
        const response = await fetch(`${BASE_URL}/api/auth/verify`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const isAuthenticated = response.ok;
        console.log('Auth verification result:', isAuthenticated);
        return isAuthenticated;
    } catch (error) {
        console.error('Auth check failed:', error);
        return false;
    }
};

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CHECK_AUTH') {
        checkAuth().then(isAuthenticated => {
            console.log('Sending auth status:', isAuthenticated);
            sendResponse({ isAuthenticated });
        });
        return true; // Keep the message channel open for async response
    }
});

// Keep track of active polling intervals
const pollingIntervals = new Map();

// Initialize authentication state
chrome.runtime.onStartup.addListener(async () => {
    await initializeAuth();
});

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