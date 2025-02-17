// Environment configuration
let ENV = 'development'; // Default to development
const getBaseUrl = () => ENV === 'development' ? 'http://localhost:3000' : 'https://app.sofer.ai';
let BASE_URL = getBaseUrl();
const SUPABASE_URL = 'https://auth.sofer.ai';
const AUTH_COOKIE_NAME = 'sb-auth-auth-token';

// Initialize environment from storage
chrome.storage.local.get('environment', ({ environment }) => {
    if (environment) {
        ENV = environment;
        BASE_URL = getBaseUrl();
        console.log('Environment set to:', ENV);
        console.log('Base URL:', BASE_URL);
    }
});

// Function to set environment
const setEnvironment = async (env) => {
    ENV = env;
    BASE_URL = getBaseUrl();
    await chrome.storage.local.set({ environment: env });
    console.log('Environment updated to:', env);
    console.log('Base URL updated to:', BASE_URL);
    return { env, baseUrl: BASE_URL };
};

// Helper function to get session cookie
const getSessionFromCookie = async () => {
    try {
        const cookieNames = [
            'sb-auth-auth-token.0',
            'sb-auth-auth-token.1',
            'sb-auth-auth-token',
            'supabase-auth-token'
        ];

        const url = ENV === 'development' ? 'http://localhost:3000' : 'https://app.sofer.ai';
        console.log('Looking for cookies at:', url);

        for (const cookieName of cookieNames) {
            const cookie = await chrome.cookies.get({
                url,
                name: cookieName
            });

            if (cookie && cookie.value) {
                console.log(`Found cookie ${cookieName}:`, cookie.value.substring(0, 50) + '...');

                // Handle base64 encoded cookie
                if (cookie.value.startsWith('base64-')) {
                    try {
                        const base64Value = cookie.value.replace('base64-', '');
                        const decodedValue = atob(base64Value);
                        const parsedValue = JSON.parse(decodedValue);
                        console.log('Decoded cookie contains:', Object.keys(parsedValue));

                        // For Supabase session cookie
                        if (parsedValue.currentSession?.access_token) {
                            console.log('Found access_token in currentSession');
                            return parsedValue.currentSession.access_token;
                        }
                        // For direct access token
                        if (parsedValue.access_token) {
                            console.log('Found access_token in cookie');
                            return parsedValue.access_token;
                        }
                    } catch (e) {
                        console.error('Failed to decode base64 cookie:', e);
                    }
                }

                // Handle direct JWT token
                if (cookie.value.includes('eyJ')) {
                    console.log('Found JWT token directly in cookie');
                    return cookie.value;
                }

                // Try parsing as JSON directly
                try {
                    const parsedValue = JSON.parse(cookie.value);
                    if (parsedValue.currentSession?.access_token) {
                        console.log('Found access_token in currentSession');
                        return parsedValue.currentSession.access_token;
                    }
                    if (parsedValue.access_token) {
                        console.log('Found access_token in cookie');
                        return parsedValue.access_token;
                    }
                } catch (e) {
                    // Not JSON, continue to next cookie
                }
            }
        }

        console.log('No valid auth cookie found');
        return null;
    } catch (error) {
        console.error('Error getting cookie:', error);
        return null;
    }
};

// Initialize auth state from storage
const initializeAuth = async () => {
    try {
        const sessionCookie = await getSessionFromCookie();
        console.log('Session cookie found:', sessionCookie ? 'yes' : 'no');
        return !!sessionCookie;
    } catch (error) {
        console.error('Auth initialization failed:', error);
        return false;
    }
};

// Authentication functions
const login = async () => {
    chrome.tabs.create({ url: `${BASE_URL}/sign-in` });
    throw new Error('Please sign in through the web app');
};

const logout = async () => {
    chrome.tabs.create({ url: `${BASE_URL}/sign-out` });
    await chrome.storage.local.remove(['auth', 'user']);
};

// Create a new transcription
const createTranscription = async (audioUrl, metadata) => {
    const token = await getSessionFromCookie();
    if (!token) {
        throw new Error('Not authenticated');
    }

    console.log('Making transcription request to:', `${BASE_URL}/api/transcribe`);
    console.log('Using token:', token.substring(0, 20) + '...');

    const response = await fetch(`${BASE_URL}/api/transcribe`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
            'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'include',
        body: JSON.stringify({
            audioUrl,
            title: metadata.title,
            speaker: metadata.speaker,
            options: {
                primaryLanguage: 'English',
                hebrewWordsTranscription: 'Both',
                sendEmail: true,
                numSpeakers: metadata.num_speakers || 1
            }
        })
    });

    if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            throw new Error(error.message || `HTTP error! status: ${response.status}`);
        } else {
            const text = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${text.substring(0, 200)}`);
        }
    }

    try {
        const data = await response.json();
        console.log('Transcription created:', data);

        // Store transcription data
        const { transcriptions = {} } = await chrome.storage.local.get('transcriptions');
        transcriptions[audioUrl] = {
            id: data.id || data.sessionId,
            status: 'pending',
            created: Date.now(),
            title: metadata.title
        };
        await chrome.storage.local.set({ transcriptions });

        return data;
    } catch (error) {
        console.error('Failed to parse response:', error);
        throw new Error('Failed to parse server response');
    }
};

// Check transcription status
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

// Helper function to handle API responses
const handleResponse = async (response) => {
    if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            throw new Error(error.message || `HTTP error! status: ${response.status}`);
        } else {
            const text = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${text.substring(0, 200)}`);
        }
    }
    return response.json();
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

// Export the API interface
window.soferApi = {
    login,
    logout,
    initializeAuth,
    createTranscription,
    checkTranscriptionStatus,
    handleApiError,
    setEnvironment,
    getEnvironment: () => ENV
};