// Environment configuration
const getBaseUrl = () => ENV === 'development' ? 'http://localhost:3000' : 'https://app.sofer.ai';
let ENV = 'production'; // Default to production
let BASE_URL = getBaseUrl();

// Initialize environment from storage
chrome.storage.local.get('environment', ({ environment }) => {
    if (environment) {
        ENV = environment;
        BASE_URL = getBaseUrl();
        console.log('[Content] Environment set to:', ENV);
        console.log('[Content] Base URL:', BASE_URL);
    }
});

// Simple function to create the transcript button
const createTranscriptButton = () => {
    const li = document.createElement('li');
    li.className = 'transcript';

    const button = document.createElement('a');
    button.href = '##';
    button.className = 'sofer-transcript-btn';
    button.innerHTML = `
        <img src="${chrome.runtime.getURL('icon.png')}" alt="Transcript" />
        <span>Get Transcript</span>
    `;

    li.appendChild(button);
    return li;
};

// Function to add button to player
const addTranscriptButton = (container) => {
    // Skip if we already added a button
    if (container.querySelector('.sofer-transcript-btn')) {
        return;
    }

    // Find the buttons list
    const buttonsList = container.querySelector('.lecture-buttons .add');
    if (!buttonsList) {
        return;
    }

    // Find the Play Later button
    const playLaterButton = buttonsList.querySelector('.queue');
    if (!playLaterButton) {
        return;
    }

    const button = createTranscriptButton();
    buttonsList.insertBefore(button, playLaterButton.nextSibling);

    // Get the shiur ID from the player container
    const playerContainer = container.querySelector('.jp-audio');
    const shiurId = playerContainer?.getAttribute('data-id');

    if (shiurId) {
        button.querySelector('a').addEventListener('click', (e) => {
            e.preventDefault();
            handleTranscriptClick(container, button.querySelector('a'), shiurId);
        });
    }

    // Log successful button addition
    console.log('Added transcript button to container');
};

// Function to extract metadata
const extractMetadata = (container, shiurId) => {
    // Get the title
    const titleElement = container.querySelector('h2[itemprop="name"]');
    const title = titleElement ? titleElement.textContent.trim() : 'Untitled Shiur';

    // Get the speaker
    const speakerElement = container.querySelector('.teacher-list-item [itemprop="name"]');
    const speaker = speakerElement ? speakerElement.textContent.trim() : 'Unknown Speaker';

    // Construct the audio URL
    const audioUrl = `https://yutorah.org/lectures/${shiurId}`;

    return {
        title,
        speaker,
        audioUrl,
        primary_language: 'en',
        lang_for_hebrew_words: ['he'],
        num_speakers: 1
    };
};

// Function to handle transcript button click
const handleTranscriptClick = async (container, button, shiurId) => {
    try {
        console.log('[Content] Transcript button clicked for shiur:', shiurId);
        const metadata = extractMetadata(container, shiurId);
        console.log('[Content] Extracted metadata:', metadata);

        // Store the request state before making the request
        await chrome.storage.local.set({
            pendingTranscription: {
                shiurId,
                metadata,
                timestamp: Date.now()
            }
        });

        // Update button state
        button.textContent = 'Requesting...';
        button.classList.add('processing');

        // Send message to background script to create transcription
        console.log('[Content] Sending CREATE_TRANSCRIPTION message to background');

        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type: 'CREATE_TRANSCRIPTION',
                    metadata: metadata
                },
                response => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(response);
                }
            );
        });

        // Clear the pending state since we got a response
        await chrome.storage.local.remove('pendingTranscription');

        console.log('[Content] Received response from background:', response);

        if (!response) {
            throw new Error('No response received from background');
        }

        if (response.error) {
            throw new Error(response.error);
        }

        if (response.transcriptionId) {
            console.log('[Content] Transcription created:', response.transcriptionId);
            // Store the successful transcription
            await chrome.storage.local.set({
                lastTranscription: {
                    id: response.transcriptionId,
                    metadata,
                    timestamp: Date.now()
                }
            });
            button.textContent = 'Processing...';
            pollTranscriptionStatus(response.transcriptionId, button);
        }
    } catch (error) {
        console.error('[Content] Failed to handle transcript click:', error);

        // Store error state
        await chrome.storage.local.set({
            transcriptionError: {
                shiurId,
                error: error.message,
                timestamp: Date.now()
            }
        });

        if (error.message?.includes('Extension context invalidated')) {
            console.log('[Content] Extension context invalidated, page will reload...');
            window.location.reload();
            return;
        }

        button.textContent = 'Error';
        button.classList.remove('processing');
        button.classList.add('error');
    }
};

// Function to recover from extension context invalidation
const recoverFromInvalidation = async () => {
    try {
        // Check for pending transcription
        const { pendingTranscription } = await chrome.storage.local.get('pendingTranscription');
        if (pendingTranscription) {
            console.log('[Content] Found pending transcription, attempting to recover...');

            // Only recover if the request is less than 5 minutes old
            if (Date.now() - pendingTranscription.timestamp < 5 * 60 * 1000) {
                const container = document.querySelector('.profile-section');
                if (container) {
                    const button = container.querySelector('.sofer-transcript-btn');
                    if (button) {
                        console.log('[Content] Retrying transcription request...');
                        await handleTranscriptClick(container, button, pendingTranscription.shiurId);
                        return;
                    }
                }
            }

            // Clean up old pending state
            await chrome.storage.local.remove('pendingTranscription');
        }

        // Check for last error
        const { transcriptionError } = await chrome.storage.local.get('transcriptionError');
        if (transcriptionError) {
            // Only handle errors from the last 5 minutes
            if (Date.now() - transcriptionError.timestamp < 5 * 60 * 1000) {
                console.log('[Content] Found recent error, updating UI...');
                const container = document.querySelector('.profile-section');
                if (container) {
                    const button = container.querySelector('.sofer-transcript-btn');
                    if (button) {
                        button.textContent = 'Error';
                        button.classList.add('error');
                    }
                }
            }
            await chrome.storage.local.remove('transcriptionError');
        }
    } catch (error) {
        console.error('[Content] Failed to recover from invalidation:', error);
    }
};

// Function to poll transcription status
const pollTranscriptionStatus = async (transcriptionId, button) => {
    console.log('[Content] Starting to poll status for:', transcriptionId);

    const sendStatusCheck = async (retryCount = 0) => {
        try {
            return await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    {
                        type: 'CHECK_TRANSCRIPTION_STATUS',
                        transcriptionId: transcriptionId
                    },
                    response => {
                        if (chrome.runtime.lastError) {
                            // Check if it's an invalidated context error
                            if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                                console.log('[Content] Extension context invalidated during status check, reloading page...');
                                window.location.reload();
                                return;
                            }
                            reject(chrome.runtime.lastError);
                            return;
                        }
                        resolve(response);
                    }
                );
            });
        } catch (error) {
            console.error('[Content] Status check request failed:', error);
            if (retryCount < 2) {
                console.log(`[Content] Retrying status check (attempt ${retryCount + 1})...`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
                return sendStatusCheck(retryCount + 1);
            }
            throw error;
        }
    };

    const checkStatus = async () => {
        try {
            const response = await sendStatusCheck();
            console.log('[Content] Status check response:', response);

            if (!response) {
                throw new Error('Empty response received');
            }

            if (response.error) {
                console.error('[Content] Status check failed:', response.error);
                // Only update UI if it's a permanent error
                if (response.error.includes('not found') || response.error.includes('Failed to parse')) {
                    button.textContent = 'Error';
                    button.classList.remove('processing');
                    button.classList.add('error');
                    clearInterval(pollInterval);
                }
                return;
            }

            // Handle different status cases
            switch (response.status) {
                case 'COMPLETED':
                    console.log('[Content] Transcription completed');
                    button.textContent = 'View';
                    button.classList.remove('processing');
                    button.classList.add('completed');
                    button.addEventListener('click', (e) => {
                        e.preventDefault();
                        window.open(`${BASE_URL}/transcript/${transcriptionId}`, '_blank');
                    }, { once: true });
                    clearInterval(pollInterval);
                    break;

                case 'FAILED':
                    console.error('[Content] Transcription failed');
                    button.textContent = 'Failed';
                    button.classList.remove('processing');
                    button.classList.add('error');
                    clearInterval(pollInterval);
                    break;

                default:
                    console.log('[Content] Transcription in progress:', response.status);
                    button.textContent = `Processing (${response.status.toLowerCase()})`;
                    break;
            }
        } catch (error) {
            console.error('[Content] Status check failed:', error);
            if (error.message?.includes('Extension context invalidated')) {
                clearInterval(pollInterval);
                window.location.reload();
                return;
            }
            // For other errors, we'll keep polling but update the UI
            button.textContent = 'Checking...';
        }
    };

    const pollInterval = setInterval(checkStatus, 10000); // Check every 10 seconds
    await checkStatus(); // Check immediately and await the result

    // Clean up interval when page unloads
    window.addEventListener('unload', () => {
        clearInterval(pollInterval);
    });
};

// Initialize and add buttons to existing players
const initializePlayers = () => {
    // Find the profile section that contains the player and buttons
    const profileSection = document.querySelector('.profile-section');
    if (profileSection) {
        addTranscriptButton(profileSection);
    }
};

// Set up observer to watch for new players
const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches('.profile-section')) {
                    addTranscriptButton(node);
                }
                // Also check children
                const section = node.querySelector('.profile-section');
                if (section) {
                    addTranscriptButton(section);
                }
            }
        });
    });
});

// Function to start observing
const startObserving = () => {
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    console.log('[Content] Started observing DOM for new players');
};

// Function to initialize the extension
const initializeExtension = async () => {
    console.log('[Content] Initializing extension...');
    try {
        // First try to recover from any previous invalidation
        await recoverFromInvalidation();

        // Check authentication
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, response => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve(response);
            });
        });

        if (response && response.isAuthenticated) {
            console.log('[Content] User is authenticated, initializing players');
            initializePlayers();
            startObserving();
            // Also try again after a short delay to catch dynamically loaded content
            setTimeout(initializePlayers, 1000);
        } else {
            console.log('[Content] User not authenticated. Transcript buttons will not be added.');
        }
    } catch (error) {
        console.error('[Content] Failed to initialize extension:', error);
        if (error.message?.includes('Extension context invalidated')) {
            window.location.reload();
        }
    }
};

// Initialize on page load
console.log('[Content] Content script loaded, starting initialization...');
initializeExtension();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSCRIPTION_STATUS_UPDATE') {
        const { audioUrl, status, error, transcriptionId } = message;
        // Find all transcript buttons
        document.querySelectorAll('.sofer-transcript-btn').forEach(button => {
            if (error) {
                button.textContent = 'Error';
                button.classList.add('error');
            } else if (status === 'completed') {
                button.textContent = 'View';
                button.classList.add('completed');
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.open(`https://app.sofer.ai/transcript/${transcriptionId}`, '_blank');
                }, { once: true });
            } else {
                button.textContent = status;
                button.classList.add('processing');
            }
        });
    }
}); 