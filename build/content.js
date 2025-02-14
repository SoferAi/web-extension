// Utility function to create transcript button
const createTranscriptButton = () => {
    const button = document.createElement('button');
    button.className = 'sofer-transcript-btn';
    button.innerHTML = `
    <img src="${chrome.runtime.getURL('icon.png')}" alt="Transcript" />
    Get Transcript
  `;
    return button;
};

// Function to extract metadata from the audio element's container
const extractMetadata = (audioElement) => {
    const container = audioElement.closest('.shiur-container') || audioElement.parentElement;
    return {
        title: container.querySelector('.shiur-title')?.textContent?.trim() || 'Untitled Shiur',
        speaker: container.querySelector('.speaker-title')?.textContent?.trim() || 'Unknown Speaker',
        audioUrl: audioElement.getAttribute('data-mp3'),
    };
};

// Function to handle transcript button click
const handleTranscriptClick = async (audioElement, button) => {
    try {
        const metadata = extractMetadata(audioElement);

        // Check if we already have a transcription for this audio
        const { transcriptions = {} } = await chrome.storage.local.get('transcriptions');
        const existingTranscription = transcriptions[metadata.audioUrl];

        if (existingTranscription) {
            button.textContent = 'Checking status...';
            // Send message to background script to check status
            chrome.runtime.sendMessage({
                type: 'CHECK_TRANSCRIPTION',
                transcriptionId: existingTranscription.id,
            });
            return;
        }

        // Send message to background script to create new transcription
        button.textContent = 'Requesting transcript...';
        chrome.runtime.sendMessage({
            type: 'CREATE_TRANSCRIPTION',
            metadata,
        });
    } catch (error) {
        button.textContent = 'Error - Try again';
        console.error('Transcription request failed:', error);
    }
};

// Function to add transcript button to an audio element
const addTranscriptButton = (audioElement) => {
    if (audioElement.hasAttribute('data-transcript-button-added')) {
        return;
    }

    const button = createTranscriptButton();
    button.addEventListener('click', () => handleTranscriptClick(audioElement, button));

    // Insert button after the audio element
    audioElement.parentNode.insertBefore(button, audioElement.nextSibling);
    audioElement.setAttribute('data-transcript-button-added', 'true');
};

// Function to initialize the observer
const initObserver = () => {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check for audio elements in the added node
                    const audioElements = node.querySelectorAll('audio.jp-jplayer');
                    audioElements.forEach(addTranscriptButton);

                    // Check if the node itself is an audio element
                    if (node.matches('audio.jp-jplayer')) {
                        addTranscriptButton(node);
                    }
                }
            });
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    // Process existing audio elements
    document.querySelectorAll('audio.jp-jplayer').forEach(addTranscriptButton);
};

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRANSCRIPTION_STATUS_UPDATE') {
        const { audioUrl, status, error } = message;
        const audioElement = document.querySelector(`audio[data-mp3="${audioUrl}"]`);
        if (audioElement) {
            const button = audioElement.nextElementSibling;
            if (button?.classList.contains('sofer-transcript-btn')) {
                if (error) {
                    button.textContent = `Error: ${error}`;
                } else if (status === 'completed') {
                    button.textContent = 'View Transcript';
                    button.addEventListener('click', () => {
                        window.open(`https://sofer.ai/transcripts/${message.transcriptionId}`, '_blank');
                    }, { once: true });
                } else {
                    button.textContent = `Transcribing... ${status}`;
                }
            }
        }
    }
});

// Check authentication status and initialize
chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
    if (response && response.isAuthenticated) {
        initObserver();
    } else {
        console.log('User not authenticated. Transcript buttons will not be added.');
    }
}); 