// Environment configuration
let ENV = 'development'; // Default to development
const getBaseUrl = () => ENV === 'development' ? 'http://localhost:3000' : 'https://app.sofer.ai';
let BASE_URL = getBaseUrl();
const SUPABASE_URL = 'https://auth.sofer.ai';
const AUTH_COOKIE_PREFIX = 'sb-auth-auth-token';

// Initialize environment from storage
const initializeEnvironment = async () => {
    try {
        const { environment } = await chrome.storage.local.get('environment');
        if (environment) {
            ENV = environment;
        } else {
            // Default to development and save it
            ENV = 'development';
            await chrome.storage.local.set({ environment: 'development' });
        }
        BASE_URL = getBaseUrl();
        console.log('[Background] Environment set to:', ENV);
        console.log('[Background] Base URL:', BASE_URL);
    } catch (error) {
        console.error('[Background] Failed to initialize environment:', error);
        // Ensure we're in development mode if initialization fails
        ENV = 'development';
        BASE_URL = getBaseUrl();
    }
};

// Initialize environment immediately
initializeEnvironment();

// Listen for environment changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.environment) {
        ENV = changes.environment.newValue;
        BASE_URL = getBaseUrl();
        console.log('[Background] Environment updated to:', ENV);
        console.log('[Background] Base URL updated to:', BASE_URL);
    }
});

// Helper function to extract access token from cookie value
const extractAccessToken = (cookieValue) => {
    try {
        // Log the raw cookie value for debugging
        console.log('Raw cookie value:', cookieValue.substring(0, 50) + '...');

        // First check if it's a JWT token (regardless of prefix)
        if (cookieValue.includes('eyJ')) {
            // Extract the JWT token part
            const jwtMatch = cookieValue.match(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
            if (jwtMatch) {
                console.log('Found JWT token in cookie value');
                return jwtMatch[0];
            }
        }

        // If it has a base64 prefix but contains a JWT, strip the prefix
        if (cookieValue.startsWith('base64-') && cookieValue.includes('eyJ')) {
            const token = cookieValue.replace('base64-', '');
            console.log('Stripped base64 prefix from JWT token');
            return token;
        }

        // Try parsing as JSON directly first
        try {
            const parsedValue = JSON.parse(cookieValue);
            if (parsedValue.access_token) {
                console.log('Found access_token in JSON cookie');
                return parsedValue.access_token;
            }
        } catch (e) {
            // Not JSON, continue to base64 attempt
        }

        // Finally, try base64 decoding if all else fails
        if (cookieValue.startsWith('base64-')) {
            try {
                const base64Value = cookieValue.replace('base64-', '');
                const decodedValue = atob(base64Value);
                const parsedValue = JSON.parse(decodedValue);
                console.log('Successfully decoded base64 and parsed JSON');

                if (parsedValue.access_token) {
                    return parsedValue.access_token;
                }
            } catch (e) {
                console.log('Base64 decode or JSON parse failed:', e.message);
            }
        }

        console.log('Could not extract token from cookie value');
        return null;
    } catch (error) {
        console.error('Failed to extract access token:', error);
        return null;
    }
};

// Helper function to get session cookie
const getSessionFromCookie = async () => {
    try {
        // Use exact cookie names we see in the browser from Supabase
        const cookieNames = [
            'sb-auth-auth-token.0',
            'sb-auth-auth-token.1',
            'sb-auth-auth-token'
        ];

        // Determine domains based on environment
        const domains = ENV === 'development'
            ? ['http://localhost:3000']
            : [
                'https://app.sofer.ai',
                'https://sofer.ai',
                'https://auth.sofer.ai'
            ];

        console.log('[Background] Starting cookie search across domains:', domains);
        console.log('[Background] Looking for cookie names:', cookieNames);
        console.log('[Background] Current environment:', ENV);

        for (const domain of domains) {
            console.log(`[Background] Checking domain: ${domain}`);
            for (const cookieName of cookieNames) {
                try {
                    const cookie = await chrome.cookies.get({
                        url: domain,
                        name: cookieName
                    });

                    if (cookie) {
                        console.log(`[Background] Cookie found on ${domain}:`, {
                            name: cookieName,
                            domain: cookie.domain,
                            path: cookie.path,
                            secure: cookie.secure,
                            httpOnly: cookie.httpOnly,
                            value: cookie.value ? `${cookie.value.substring(0, 20)}...` : 'empty'
                        });

                        if (cookie.value) {
                            const token = extractAccessToken(cookie.value);
                            if (token) {
                                console.log('[Background] Successfully extracted token from cookie');
                                return token;
                            }
                        }
                    } else {
                        console.log(`[Background] No cookie found for ${cookieName} on ${domain}`);
                    }
                } catch (error) {
                    console.error(`[Background] Error getting cookie for ${domain}:`, error.message);
                }
            }
        }

        // If we haven't found a token yet, try getting all cookies for the domains
        console.log('[Background] No valid auth cookie found, checking all cookies...');
        for (const domain of domains) {
            try {
                const cookies = await chrome.cookies.getAll({
                    domain: ENV === 'development' ? 'localhost' : new URL(domain).hostname
                });
                console.log(`[Background] All cookies for ${domain}:`, cookies.map(c => c.name));
            } catch (error) {
                console.error(`[Background] Error listing cookies for ${domain}:`, error.message);
            }
        }

        console.log('[Background] No valid auth cookie found after checking all domains and names');
        return null;
    } catch (error) {
        console.error('[Background] Error getting cookie:', error);
        return null;
    }
};

// Check authentication status
const checkAuth = async () => {
    try {
        const sessionCookie = await getSessionFromCookie();
        console.log('Session cookie found:', sessionCookie ? 'yes (length: ' + sessionCookie.length + ')' : 'no');

        if (!sessionCookie) {
            console.log('No session cookie found');
            return false;
        }

        // If we have a valid JWT token, consider it authenticated
        if (sessionCookie.includes('eyJ')) {
            console.log('Valid JWT token found');
            return true;
        }

        console.log('No valid JWT token found');
        return false;
    } catch (error) {
        console.error('Auth check failed:', error);
        return false;
    }
};

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message.type, 'from tab:', sender.tab.id);

    if (message.type === 'CHECK_AUTH') {
        console.log('[Background] Processing auth check request');
        checkAuth()
            .then(isAuthenticated => {
                console.log('[Background] Auth check result:', isAuthenticated);
                sendResponse({ isAuthenticated });
            })
            .catch(error => {
                console.error('[Background] Auth check failed:', error);
                sendResponse({ isAuthenticated: false, error: error.message });
            });
        return true; // Keep the message channel open for async response
    }

    if (message.type === 'CREATE_TRANSCRIPTION') {
        console.log('[Background] Processing transcription request:', message.metadata);
        handleCreateTranscription(message.metadata, sender.tab.id, sendResponse)
            .catch(error => {
                console.error('[Background] Create transcription failed:', error);
                sendResponse({ error: error.message });
            });
        return true; // Keep the message channel open for async response
    }

    if (message.type === 'CHECK_TRANSCRIPTION_STATUS') {
        console.log('[Background] Processing status check for:', message.transcriptionId);
        handleCheckTranscription(message.transcriptionId, sender.tab.id, sendResponse)
            .catch(error => {
                console.error('[Background] Check status failed:', error);
                sendResponse({ error: error.message });
            });
        return true; // Keep the message channel open for async response
    }
});

// Keep track of active polling intervals
const pollingIntervals = new Map();

// Initialize authentication state
chrome.runtime.onStartup.addListener(async () => {
    try {
        // Check for any pending transcriptions that need to be recovered
        const { pendingTranscription } = await chrome.storage.local.get('pendingTranscription');
        if (pendingTranscription && Date.now() - pendingTranscription.timestamp < 5 * 60 * 1000) {
            console.log('[Background] Found pending transcription, will wait for content script to recover');
        }

        await initializeAuth();
    } catch (error) {
        console.error('[Background] Startup initialization failed:', error);
    }
});

// Create transcription handler
async function handleCreateTranscription(metadata, tabId, sendResponse) {
    try {
        console.log('[Background] Starting transcription creation with metadata:', metadata);
        const accessToken = await getSessionFromCookie();

        if (!accessToken) {
            console.error('[Background] No auth token found');
            sendResponse({ error: 'Not authenticated' });
            return;
        }

        const url = `${BASE_URL}/api/transcribe`;
        console.log('[Background] Making transcription request to:', url);
        console.log('[Background] Using auth token:', accessToken.substring(0, 20) + '...');

        const requestBody = {
            audioUrl: metadata.audioUrl,
            title: metadata.title,
            speaker: metadata.speaker,
            options: {
                primaryLanguage: 'English',
                hebrewWordsTranscription: 'Both',
                sendEmail: true,
                numSpeakers: metadata.num_speakers || 1
            }
        };

        console.log('[Background] Request body:', requestBody);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            credentials: 'include',
            body: JSON.stringify(requestBody),
        });

        console.log('[Background] Response status:', response.status);
        console.log('[Background] Response headers:', Object.fromEntries(response.headers.entries()));

        // First check if we got HTML instead of JSON
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
            const text = await response.text();
            console.error('[Background] Received HTML response instead of JSON:', text.substring(0, 200));
            sendResponse({ error: 'Received HTML response instead of JSON. You may need to log in again.' });
            return;
        }

        if (!response.ok) {
            let errorMessage;
            try {
                const error = await response.json();
                errorMessage = error.error || error.message || `HTTP error! status: ${response.status}`;
            } catch (e) {
                // If we can't parse the error as JSON, try to get the raw text
                const text = await response.text();
                errorMessage = `HTTP error! status: ${response.status}, body: ${text.substring(0, 200)}`;
            }
            console.error('[Background] Transcription request failed:', errorMessage);
            sendResponse({ error: errorMessage });
            return;
        }

        let data;
        try {
            data = await response.json();
        } catch (e) {
            console.error('[Background] Failed to parse response as JSON:', e);
            const text = await response.text();
            console.error('[Background] Raw response:', text.substring(0, 200));
            sendResponse({ error: 'Failed to parse response as JSON' });
            return;
        }

        console.log('[Background] Transcription created successfully:', data);

        // Store the successful transcription
        await chrome.storage.local.set({
            lastTranscription: {
                id: data.sessionId,
                metadata,
                timestamp: Date.now()
            }
        });

        sendResponse({ transcriptionId: data.sessionId });

        // Start polling for status
        startPolling(data.sessionId, metadata.audioUrl, tabId);
    } catch (error) {
        console.error('[Background] Create transcription error:', error);
        sendResponse({ error: error.message || 'Failed to create transcription' });
    }
}

// Check transcription status handler
async function handleCheckTranscription(transcriptionId, tabId, sendResponse) {
    try {
        console.log('[Background] Checking status for transcription:', transcriptionId);
        const accessToken = await getSessionFromCookie();

        if (!accessToken) {
            console.error('[Background] No auth token found');
            sendResponse({ error: 'Not authenticated' });
            return;
        }

        const url = `${BASE_URL}/api/transcription-status`;
        console.log('[Background] Making status check request to:', url);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ sessionId: transcriptionId })
        });

        console.log('[Background] Status check response:', response.status);

        // Read the response body once
        let responseData;
        try {
            responseData = await response.text();
        } catch (e) {
            console.error('[Background] Failed to read response body:', e);
            sendResponse({ error: 'Failed to read response body' });
            return;
        }

        if (!response.ok) {
            let errorMessage;
            try {
                const error = JSON.parse(responseData);
                errorMessage = error.error || error.message || `HTTP error! status: ${response.status}`;
            } catch (e) {
                errorMessage = `HTTP error! status: ${response.status}, body: ${responseData.substring(0, 200)}`;
            }
            console.error('[Background] Status check failed:', errorMessage);
            sendResponse({ error: errorMessage });
            return;
        }

        try {
            const data = JSON.parse(responseData);
            console.log('[Background] Status check successful:', data);

            // Extract status from the response structure
            const status = data.status || data.transcriptionStatus;
            sendResponse({ status });

            // If not already polling and status is not final, start polling
            if (!pollingIntervals.has(transcriptionId) &&
                status !== 'COMPLETED' &&
                status !== 'FAILED') {
                startPolling(transcriptionId, data.audioUrl, tabId);
            }
        } catch (error) {
            console.error('[Background] Failed to parse JSON response:', error);
            sendResponse({ error: 'Failed to parse response as JSON' });
        }
    } catch (error) {
        console.error('[Background] Status check error:', error);
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
            const result = await handleCheckTranscription(transcriptionId, tabId, (response) => {
                if (response.error) {
                    console.error('[Background] Polling error:', response.error);
                    clearInterval(pollInterval);
                    pollingIntervals.delete(transcriptionId);
                    return;
                }

                // Send status update to content script
                chrome.tabs.sendMessage(tabId, {
                    type: 'TRANSCRIPTION_STATUS_UPDATE',
                    audioUrl,
                    status: response.status,
                    transcriptionId,
                });

                // If completed or failed, stop polling
                if (response.status === 'COMPLETED' || response.status === 'FAILED') {
                    clearInterval(pollInterval);
                    pollingIntervals.delete(transcriptionId);
                }
            });
        } catch (error) {
            console.error('[Background] Polling error:', error);
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