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

// Function to check for existing transcript
const checkExistingTranscript = async (shiurId) => {
    try {
        const accessToken = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' }, response => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve(response.token);
            });
        });

        if (!accessToken) {
            console.log('[Content] No auth token found, skipping transcript check');
            return null;
        }

        // Debug token
        console.log('[Content] Token debug:', {
            type: typeof accessToken,
            isString: typeof accessToken === 'string',
            length: accessToken?.length,
            preview: typeof accessToken === 'string' ? accessToken.substring(0, 50) : 'not a string',
            isJSON: (() => {
                try {
                    JSON.parse(accessToken);
                    return true;
                } catch (e) {
                    return false;
                }
            })()
        });

        // Ensure we're using the correct origin for CORS
        if (!window.location.hostname.endsWith('yutorah.org')) {
            console.error('[Content] Invalid hostname:', window.location.hostname);
            return null;
        }

        const response = await fetch(`${BASE_URL}/api/get-transcript`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': accessToken.startsWith('Bearer ') ? accessToken : `Bearer ${accessToken}`,
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'include',
            body: JSON.stringify({
                link: `https://yutorah.org/lectures/${shiurId}`
            })
        });

        if (!response.ok) {
            if (response.status === 404) {
                console.log('[Content] No existing transcript found');
                return null;
            }
            if (response.status === 401) {
                console.log('[Content] Authentication failed, user needs to log in');
                // Try to refresh auth state
                chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
                return null;
            }
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('[Content] Transcript check response:', data);

        if (!data.success) {
            console.log('[Content] Transcript check failed:', data.error);
            return null;
        }

        return data; // Return the entire response data
    } catch (error) {
        console.error('[Content] Failed to check for existing transcript:', error);
        // If it's an auth error, try to refresh auth state
        if (error.message?.includes('401') || error.message?.includes('auth')) {
            chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
        }
        return null;
    }
};

// Function to create transcript display
const createTranscriptDisplay = (response) => {
    const container = document.createElement('div');
    container.className = 'sofer-transcript-container';
    container.innerHTML = `
        <style>
            .sofer-transcript-container {
                margin: 20px 0 !important;
                padding: 20px !important;
                background: #f8f9fa !important;
                border-radius: 8px !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
                width: 100% !important;
                box-sizing: border-box !important;
                position: relative !important;
            }
            .sofer-transcript-wrapper {
                width: 100% !important;
                margin: 20px 0 !important;
                position: relative !important;
                box-sizing: border-box !important;
            }
            .sofer-transcript-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: flex-start !important;
                margin-bottom: 16px !important;
                padding-bottom: 16px !important;
                border-bottom: 1px solid #e2e8f0 !important;
                width: 100% !important;
            }
            .sofer-transcript-title {
                font-size: 1.25rem;
                font-weight: 600;
                color: #2d3748;
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .sofer-transcript-title-text {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .sofer-transcript-title img {
                width: 24px;
                height: 24px;
            }
            .sofer-transcript-content {
                width: 100% !important;
                box-sizing: border-box !important;
                font-size: 1rem !important;
                line-height: 1.6 !important;
                color: #4a5568 !important;
            }
            .sofer-transcript-content p {
                margin-bottom: 1em;
            }
            .sofer-transcript-content[dir="rtl"] {
                text-align: right;
            }
            .sofer-transcript-actions {
                display: flex;
                gap: 8px;
            }
            .sofer-transcript-button {
                padding: 8px 16px;
                border-radius: 4px;
                background: #3182ce;
                color: white;
                font-size: 0.875rem;
                cursor: pointer;
                border: none;
                display: flex;
                align-items: center;
                gap: 6px;
                white-space: nowrap;
            }
            .sofer-transcript-button:hover {
                background: #2c5282;
            }
            .sofer-transcript-button img {
                width: 16px;
                height: 16px;
            }
            @media (max-width: 768px) {
                .sofer-transcript-header {
                    flex-direction: column;
                    align-items: flex-start;
                }
                .sofer-transcript-actions {
                    width: 100%;
                    justify-content: flex-end;
                }
            }
        </style>
        <div class="sofer-transcript-header">
            <div class="sofer-transcript-title">
                <img src="${chrome.runtime.getURL('icon.png')}" alt="Sofer.ai" />
                <div class="sofer-transcript-title-text">
                    Transcript Generated by Sofer.Ai
                    <div style="font-size: 0.75rem; color: #718096; font-weight: normal;">Please verify the transcript for accuracy. Mistakes are possible.</div>
                </div>
            </div>
            <div class="sofer-transcript-actions">
                <button class="sofer-transcript-button view-full" style="background: #000000;">
                    <img src="${chrome.runtime.getURL('icon.png')}" alt="Sofer.ai" />
                    Open in Sofer.Ai
                </button>
            </div>
        </div>
        <div class="sofer-transcript-content" dir="${response.debug?.primaryLanguage === 'he' ? 'rtl' : 'ltr'}">
            ${response.html || 'Transcript text not available'}
        </div>
    `;

    // Add event listeners
    container.querySelector('.view-full').addEventListener('click', () => {
        window.open(`${BASE_URL}/transcripts/${response.id}`, '_blank');
    });

    return container;
};

// Function to add transcript to page
const addTranscriptToPage = async (container, shiurId) => {
    const response = await checkExistingTranscript(shiurId);
    console.log('[Content] Adding transcript to page:', response);

    if (response && response.exists && response.status === 'COMPLETED' && response.html) {
        // Find the lecture page content container
        const lectureContent = document.querySelector('.content.lecture-page.lecture-page-audio');
        if (!lectureContent || lectureContent.querySelector('.sofer-transcript-container')) {
            return;
        }

        // Create a wrapper div if it doesn't exist
        let transcriptWrapper = document.createElement('div');
        transcriptWrapper.className = 'sofer-transcript-wrapper';
        transcriptWrapper.style.cssText = `
            width: 100% !important;
            display: block !important;
            margin: 20px 0 !important;
            position: relative !important;
            box-sizing: border-box !important;
            padding: 0 !important;
        `;

        // Create the transcript display
        const transcriptDisplay = createTranscriptDisplay(response);
        transcriptDisplay.style.cssText = `
            width: 100% !important;
            margin: 20px 0 !important;
            box-sizing: border-box !important;
            position: relative !important;
        `;

        // Insert after the profile-section
        const profileSection = lectureContent.querySelector('.profile-section');
        if (profileSection) {
            profileSection.parentNode.insertBefore(transcriptWrapper, profileSection.nextSibling);
        } else {
            lectureContent.appendChild(transcriptWrapper);
        }

        transcriptWrapper.appendChild(transcriptDisplay);

        // Remove the transcript button if it exists
        const transcriptButton = container.querySelector('.transcript');
        if (transcriptButton) {
            transcriptButton.remove();
        }
    }
};

// Function to add button to player
const addTranscriptButton = async (container) => {
    // Skip if we already added a button or if there's already a transcript displayed
    if (container.querySelector('.transcript') || container.querySelector('.sofer-transcript-container')) {
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

    // Get the shiur ID from the player container
    const playerContainer = container.querySelector('.jp-audio');
    const shiurId = playerContainer?.getAttribute('data-id');

    if (shiurId) {
        // Check for existing transcript
        const response = await checkExistingTranscript(shiurId);
        console.log('[Content] Transcript check in addTranscriptButton:', {
            shiurId,
            response,
            exists: response?.exists,
            status: response?.status,
            hasResponse: !!response,
            conditionMet: response && response.exists && response.status === 'COMPLETED'
        });

        // If transcript exists and is completed, don't add a button - the transcript will be shown
        if (response && response.exists && response.status === 'COMPLETED') {
            console.log('[Content] Transcript exists, not adding button');
            return;
        }

        const button = createTranscriptButton();
        const buttonLink = button.querySelector('a');

        // Regular Get Transcript button behavior
        buttonLink.addEventListener('click', (e) => {
            e.preventDefault();
            handleTranscriptClick(container, buttonLink, shiurId);
        });

        // Remove any existing transcript button before adding the new one
        const existingButton = buttonsList.querySelector('.transcript');
        if (existingButton) {
            existingButton.remove();
        }

        buttonsList.insertBefore(button, playLaterButton.nextSibling);

        // Verify final button state
        console.log('[Content] Final button state:', {
            text: buttonLink.querySelector('span').textContent,
            hasTranscriptClass: buttonLink.classList.contains('has-transcript')
        });
    }
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

// Function to initialize players and check for transcripts
const initializePlayers = () => {
    // Handle single shiur pages (profile section)
    const profileSection = document.querySelector('.profile-section');
    if (profileSection) {
        addTranscriptButton(profileSection);
    }

    // Handle shiur list pages (multiple players)
    const containers = document.querySelectorAll('.jp-audio');
    containers.forEach(container => {
        const shiurId = container.getAttribute('data-id');
        if (shiurId) {
            // Add transcript button
            const parentContainer = container.closest('.shiur-container') || container.closest('.profile-section');
            if (parentContainer) {
                addTranscriptButton(parentContainer);
                // Check for and display existing transcript
                addTranscriptToPage(parentContainer, shiurId);
            }
        }
    });
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

// Function to show transcript popup
const showTranscriptPopup = (transcript) => {
    // Remove any existing popup
    const existingPopup = document.querySelector('.sofer-transcript-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    // Create popup container
    const popup = document.createElement('div');
    popup.className = 'sofer-transcript-popup';
    popup.innerHTML = `
        <style>
            .sofer-transcript-popup {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 80%;
                max-width: 800px;
                max-height: 80vh;
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                z-index: 10000;
                display: flex;
                flex-direction: column;
            }
            .sofer-transcript-popup-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
                padding-bottom: 16px;
                border-bottom: 1px solid #e2e8f0;
            }
            .sofer-transcript-popup-title {
                font-size: 1.25rem;
                font-weight: 600;
                color: #2d3748;
                margin-right: 20px;
            }
            .sofer-transcript-popup-close {
                background: none;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                color: #4a5568;
                padding: 4px;
                line-height: 1;
            }
            .sofer-transcript-popup-content {
                flex: 1;
                overflow-y: auto;
                font-size: 1rem;
                line-height: 1.6;
                color: #4a5568;
                padding: 16px 0;
            }
            .sofer-transcript-popup-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 9999;
            }
            .sofer-transcript-popup-actions {
                margin-top: 16px;
                padding-top: 16px;
                border-top: 1px solid #e2e8f0;
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            .sofer-transcript-popup-button {
                padding: 8px 16px;
                border-radius: 4px;
                background: #3182ce;
                color: white;
                border: none;
                cursor: pointer;
                font-size: 14px;
            }
            .sofer-transcript-popup-button:hover {
                background: #2c5282;
            }
            .sofer-transcript-popup-content p {
                margin-bottom: 1em;
            }
        </style>
        <div class="sofer-transcript-popup-overlay"></div>
        <div class="sofer-transcript-popup-header">
            <div class="sofer-transcript-popup-title">${transcript.title || 'Transcript'}</div>
            <button class="sofer-transcript-popup-close">&times;</button>
        </div>
        <div class="sofer-transcript-popup-content">
            ${transcript.html || transcript.text || 'Transcript text not available'}
        </div>
        <div class="sofer-transcript-popup-actions">
            <button class="sofer-transcript-popup-button view-full">View Full Transcript</button>
        </div>
    `;

    // Add event listeners
    popup.querySelector('.sofer-transcript-popup-close').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        popup.remove();
    });

    popup.querySelector('.sofer-transcript-popup-overlay').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        popup.remove();
    });

    popup.querySelector('.view-full').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(`${BASE_URL}/transcript/${transcript.id}`, '_blank');
    });

    // Add to page
    document.body.appendChild(popup);
}; 