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
    const audioUrl = `https://download.yutorah.org/audio/${shiurId}.mp3`;

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
        const metadata = extractMetadata(container, shiurId);

        // Update button state
        button.textContent = 'Requesting...';
        button.classList.add('processing');

        // Send message to background script to create transcription
        chrome.runtime.sendMessage({
            type: 'CREATE_TRANSCRIPTION',
            metadata: {
                audioUrl: metadata.audioUrl,
                info: {
                    title: metadata.title,
                    primary_language: 'en',
                    lang_for_hebrew_words: ['he'],
                    num_speakers: 1,
                    ...metadata,
                }
            }
        }, (response) => {
            if (response?.error) {
                button.textContent = 'Error';
                button.classList.remove('processing');
                button.classList.add('error');
                console.error('Transcription error:', response.error);
            } else if (response?.transcriptionId) {
                // Start polling for status
                button.textContent = 'Processing...';
                pollTranscriptionStatus(response.transcriptionId, button);
            }
        });
    } catch (error) {
        button.textContent = 'Error';
        button.classList.remove('processing');
        button.classList.add('error');
        console.error('Transcription request failed:', error);
    }
};

// Function to poll transcription status
const pollTranscriptionStatus = (transcriptionId, button) => {
    const checkStatus = () => {
        chrome.runtime.sendMessage({
            type: 'CHECK_TRANSCRIPTION',
            transcriptionId
        }, (response) => {
            if (response?.error) {
                button.textContent = 'Error';
                button.classList.remove('processing');
                button.classList.add('error');
                clearInterval(pollInterval);
            } else if (response?.status === 'completed') {
                button.textContent = 'View';
                button.classList.remove('processing');
                button.classList.add('completed');
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.open(`https://app.sofer.ai/transcript/${transcriptionId}`, '_blank');
                }, { once: true });
                clearInterval(pollInterval);
            } else if (response?.status) {
                button.textContent = `Processing (${response.status})`;
            }
        });
    };

    const pollInterval = setInterval(checkStatus, 10000); // Check every 10 seconds
    checkStatus(); // Check immediately
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

// Start observing
observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Initialize on page load
console.log('Content script loaded, initializing...');
initializePlayers();

// Also try again after a short delay to catch dynamically loaded content
setTimeout(initializePlayers, 1000);

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

// Check authentication and initialize
chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
    if (response && response.isAuthenticated) {
        initObserver();
    } else {
        console.log('User not authenticated. Transcript buttons will not be added.');
    }
}); 