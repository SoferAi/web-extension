const BASE_URL = 'https://app.sofer.ai';
const AUTH_COOKIE_NAME = 'sb-auth-auth-token.0'; // Supabase auth cookie name

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

// Helper function to get session cookie
const getSessionFromCookie = async () => {
    try {
        const cookie = await chrome.cookies.get({
            url: BASE_URL,
            name: AUTH_COOKIE_NAME
        });

        console.log('Cookie check result:', {
            found: !!cookie,
            name: AUTH_COOKIE_NAME,
            value: cookie ? cookie.value.substring(0, 20) + '...' : 'not found'
        });

        if (cookie?.value) {
            return cookie.value;
        }
    } catch (error) {
        console.error('Error getting cookie:', error);
    }
    return null;
};

// Authentication functions
const login = async () => {
    // Instead of logging in, open the web app in a new tab
    chrome.tabs.create({ url: `${BASE_URL}/sign-in` });
    throw new Error('Please sign in through the web app');
};

// Initialize auth state from storage
const initializeAuth = async () => {
    const sessionCookie = await getSessionFromCookie();
    if (sessionCookie) {
        // Verify the session is valid
        try {
            const response = await fetch(`${BASE_URL}/api/auth/session`, {
                headers: {
                    'Cookie': `${AUTH_COOKIE_NAME}=${sessionCookie}`
                },
                credentials: 'include'
            });

            const data = await response.json();
            if (data.session?.access_token) {
                authToken = data.session.access_token;
                return true;
            }
        } catch (error) {
            console.error('Session verification failed:', error);
        }
    }
    return false;
};

// Clear auth state
const logout = async () => {
    // Instead of logging out, open the web app in a new tab
    chrome.tabs.create({ url: `${BASE_URL}/sign-out` });
    authToken = null;
    await chrome.storage.local.remove(['auth', 'user']);
};

// Transcription functions
const createTranscription = async (audioUrl, metadata) => {
    const sessionCookie = await getSessionFromCookie();
    if (!sessionCookie) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${BASE_URL}/api/transcribe`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': `${AUTH_COOKIE_NAME}=${sessionCookie}`
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
    const sessionCookie = await getSessionFromCookie();
    if (!sessionCookie) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${BASE_URL}/api/transcribe/status/${transcriptionId}`, {
        headers: {
            'Cookie': `${AUTH_COOKIE_NAME}=${sessionCookie}`
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