chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type !== 'TRANSLATE') return;
    
    const { text, apiKey } = req.payload;
    const endpoint = apiKey.endsWith(':fx') 
        ? 'https://api-free.deepl.com/v2/translate' 
        : 'https://api.deepl.com/v2/translate';

    fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text, target_lang: 'JA' })
    })
    .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
    .then(data => sendResponse({ success: true, translations: data.translations }))
    .catch(err => {
        console.error("DeepL API Error:", err);
        sendResponse({ success: false, error: err.toString() });
    });

    return true; // Keep channel open
});