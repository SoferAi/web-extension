const BASE_URL = 'https://app.sofer.ai';
const SUPABASE_URL = 'https://auth.sofer.ai';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2a3ZrdnBqd2Jzc2t0bWxwbWJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTg3NjY5ODAsImV4cCI6MjAxNDM0Mjk4MH0.kA-I_e1HxDUV9vxE_7Pz-wZvYhKVVLCvmIRjZsPwDGE';
const AUTH_COOKIE_NAME = 'sb-auth-auth-token';

// Authentication state management
let authToken = null;

// Helper function to handle API responses
const handleResponse = async (response) => {
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }
    return response.json();
};

// Helper function to extract access token from cookie value
const extractAccessToken = (cookieValue) => {
    try {
        // Log the raw cookie value for debugging
        console.log('Raw cookie value:', cookieValue.substring(0, 50) + '...');

        if (cookieValue.startsWith('base64-')) {
            // Remove 'base64-' prefix
            const base64Value = cookieValue.replace('base64-', '');

            // Split into chunks to handle long base64 strings
            const chunks = base64Value.match(/.{1,100}/g) || [];
            console.log('Base64 chunks:', chunks.length);

            try {
                // Try to decode the base64 string
                const decodedValue = atob(base64Value);
                console.log('Successfully decoded base64');

                // Parse the decoded JSON
                const parsedValue = JSON.parse(decodedValue);
                console.log('Parsed JSON structure:', Object.keys(parsedValue));

                if (parsedValue.access_token) {
                    return parsedValue.access_token;
                } else {
                    console.log('No access_token found in parsed value');
                }
            } catch (e) {
                console.log('Base64 decode or JSON parse failed, trying direct parse');
            }
        }

        // If the above fails, try parsing the cookie value directly
        try {
            const parsedValue = JSON.parse(cookieValue);
            if (parsedValue.access_token) {
                return parsedValue.access_token;
            }
        } catch (e) {
            // If both methods fail, try using the cookie value directly
            if (cookieValue.includes('eyJ')) {
                // This looks like a JWT token, use it directly
                console.log('Using cookie value directly as JWT token');
                return cookieValue;
            }
        }

        throw new Error('Could not extract access token from cookie value');
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
            'sb-auth-auth-token.1'
        ];
        const domains = [BASE_URL, 'https://sofer.ai', SUPABASE_URL];

        console.log('Starting cookie search across domains with names:', cookieNames);

        for (const domain of domains) {
            console.log(`Checking domain: ${domain}`);
            for (const cookieName of cookieNames) {
                const cookie = await chrome.cookies.get({
                    url: domain,
                    name: cookieName
                });

                if (cookie) {
                    console.log(`Cookie found on ${new URL(domain).hostname}:`, {
                        name: cookieName,
                        domain: cookie.domain,
                        path: cookie.path,
                        secure: cookie.secure,
                        httpOnly: cookie.httpOnly,
                        value: cookie.value ? cookie.value.substring(0, 20) + '...' : 'empty'
                    });

                    if (cookie.value) {
                        // For base64 encoded cookies
                        if (cookie.value.startsWith('base64-')) {
                            try {
                                const base64Value = cookie.value.replace('base64-', '');
                                console.log('Attempting to decode base64 value...');
                                const decodedValue = atob(base64Value);
                                console.log('Successfully decoded base64, attempting to parse JSON...');
                                const parsedValue = JSON.parse(decodedValue);
                                console.log('Successfully parsed JSON:', Object.keys(parsedValue));

                                // Try various token fields that Supabase might use
                                const token = parsedValue.access_token || parsedValue.token || parsedValue.currentSession?.access_token;
                                if (token) {
                                    console.log('Found token in parsed value');
                                    return token;
                                }
                            } catch (e) {
                                console.log('Failed to process base64 cookie:', e.message);
                            }
                        }

                        // For direct JWT tokens
                        if (cookie.value.includes('eyJ')) {
                            console.log('Using cookie value directly as JWT token');
                            return cookie.value;
                        }

                        // Try parsing as JSON directly
                        try {
                            const parsedValue = JSON.parse(cookie.value);
                            const token = parsedValue.access_token || parsedValue.token || parsedValue.currentSession?.access_token;
                            if (token) {
                                console.log('Found token in JSON cookie');
                                return token;
                            }
                        } catch (e) {
                            // Not JSON, skip
                        }
                    }
                }
            }
        }

        console.log('No valid auth cookie found after checking all domains and names');
        return null;
    } catch (error) {
        console.error('Error getting cookie:', error);
        return null;
    }
};

// Authentication functions
const login = async () => {
    // Instead of logging in, open the web app in a new tab
    chrome.tabs.create({ url: `${BASE_URL}/sign-in` });
    throw new Error('Please sign in through the web app');
};

// Initialize auth state from storage
const initializeAuth = async () => {
    try {
        const sessionCookie = await getSessionFromCookie();
        console.log('Session cookie found:', sessionCookie ? 'yes (length: ' + sessionCookie.length + ')' : 'no');

        if (!sessionCookie) {
            console.log('No session cookie found');
            return false;
        }

        // Verify auth by trying to access a protected endpoint
        console.log('Verifying session by accessing protected endpoint...');
        const response = await fetch(`${BASE_URL}/auth/check`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${sessionCookie}`,
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        console.log('Auth check response:', {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries([...response.headers.entries()])
        });

        if (response.status === 401) {
            console.error('Session invalid - unauthorized');
            return false;
        }

        return true;
    } catch (error) {
        console.error('Auth initialization failed:', {
            error: error.message,
            stack: error.stack
        });
        return false;
    }
};

// Clear auth state
const logout = async () => {
    // Instead of logging out, open the web app in a new tab
    chrome.tabs.create({ url: `${BASE_URL}/sign-out` });
    await chrome.storage.local.remove(['auth', 'user']);
};

// Transcription functions
const createTranscription = async (audioUrl, metadata) => {
    const accessToken = await getSessionFromCookie();
    if (!accessToken) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${BASE_URL}/transcribe`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        credentials: 'include',
        body: JSON.stringify({
            audioUrl,
            info: {
                title: metadata.title,
                primary_language: 'en',
                lang_for_hebrew_words: ['he'],
                num_speakers: 1,
                ...metadata,
            },
        }),
    });

    const data = await handleResponse(response);

    // Store transcription data
    const transcriptions = await chrome.storage.local.get('transcriptions') || {};
    transcriptions[audioUrl] = {
        id: data.id,
        status: 'pending',
        created: Date.now(),
    };
    await chrome.storage.local.set({ transcriptions });

    return data;
};

const checkTranscriptionStatus = async (transcriptionId) => {
    const accessToken = await getSessionFromCookie();
    if (!accessToken) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${BASE_URL}/transcribe/${transcriptionId}/status`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        credentials: 'include'
    });

    return handleResponse(response);
};

// Error handling middleware
const handleApiError = (error) => {
    if (error.message.includes('401')) {
        logout(); // Clear invalid auth state
        return { type: 'auth', message: 'Session expired, please log in again' };
    }
    if (error.message.includes('429')) {
        return { type: 'rate-limit', message: 'Please try again later (rate limit reached)' };
    }
    if (error.message.includes('400')) {
        return { type: 'validation', message: 'Unable to process audio file' };
    }
    return { type: 'server', message: 'An unexpected error occurred' };
};

// Make functions available globally
window.soferApi = {
    login,
    logout,
    initializeAuth,
    createTranscription,
    checkTranscriptionStatus,
    handleApiError
}; 