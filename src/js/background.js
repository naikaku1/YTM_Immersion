chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'TRANSLATE') {
        const { text, apiKey, targetLang } = req.payload;
        const endpoint = apiKey.endsWith(':fx')
            ? 'https://api-free.deepl.com/v2/translate'
            : 'https://api.deepl.com/v2/translate';

        const body = {
            text,
            target_lang: targetLang || 'JA'
        };

        fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        })
        .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
        .then(data => sendResponse({ success: true, translations: data.translations }))
        .catch(err => {
            console.error("DeepL API Error:", err);
            sendResponse({ success: false, error: err.toString() });
        });

        return true;
    }

    const normalizeArtist = (s) =>
        (s || '').toLowerCase().replace(/\s+/g, '').trim();

    const pickBestLrcLibHit = (items, artist) => {
        if (!Array.isArray(items) || !items.length) return null;
        const target = normalizeArtist(artist);
        const getArtistName = (it) =>
            it.artistName || it.artist || it.artist_name || '';

        let hit = null;

        if (target) {
            hit = items.find(it => {
                const a = normalizeArtist(getArtistName(it));
                return a && a === target && (it.syncedLyrics || it.synced_lyrics);
            });
            if (hit) return hit;

            hit = items.find(it => {
                const a = normalizeArtist(getArtistName(it));
                return a && a === target && (it.plainLyrics || it.plain_lyrics);
            });
            if (hit) return hit;

            hit = items.find(it => {
                const a = normalizeArtist(getArtistName(it));
                return a && (a.includes(target) || target.includes(a)) && (it.syncedLyrics || it.synced_lyrics);
            });
            if (hit) return hit;

            hit = items.find(it => {
                const a = normalizeArtist(getArtistName(it));
                return a && (a.includes(target) || target.includes(a)) && (it.plainLyrics || it.plain_lyrics);
            });
            if (hit) return hit;
        }

        hit = items.find(it => it.syncedLyrics || it.synced_lyrics);
        if (hit) return hit;

        hit = items.find(it => it.plainLyrics || it.plain_lyrics);
        if (hit) return hit;

        return items[0];
    };

    const fetchFromLrcLib = (track, artist) => {
        if (!track) return Promise.resolve('');
        const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}`;
        console.log('[BG] LrcLib search URL:', url);

        return fetch(url)
            .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
            .then(list => {
                console.log('[BG] LrcLib search result count:', Array.isArray(list) ? list.length : 'N/A');
                const items = Array.isArray(list) ? list : [];
                const hit = pickBestLrcLibHit(items, artist);
                if (!hit) return '';

                const synced =
                    hit.syncedLyrics ||
                    hit.synced_lyrics ||
                    '';
                const plain =
                    hit.plainLyrics ||
                    hit.plain_lyrics ||
                    hit.plain_lyrics_text ||
                    '';

                const lyrics = (synced || plain || '').trim();
                console.log('[BG] LrcLib chosen track:', {
                    trackName: hit.trackName || hit.track || '',
                    artistName: hit.artistName || hit.artist || ''
                });
                return lyrics;
            })
            .catch(err => {
                console.error('[BG] LrcLib error:', err);
                return '';
            });
    };

    // DynamicLyrics.json → LRC のためのヘルパー
    const formatLrcTime = (seconds) => {
        const total = Math.max(0, seconds);
        const min = Math.floor(total / 60);
        const sec = Math.floor(total - min * 60);
        const cs  = Math.floor((total - min * 60 - sec) * 100);
        const mm = String(min).padStart(2, '0');
        const ss = String(sec).padStart(2, '0');
        const cc = String(cs).padStart(2, '0');
        return `${mm}:${ss}.${cc}`;
    };

    // ★ 1. DynamicLyrics.json があれば使う（1文字同期用）
    const fetchFromGithubDynamic = (video_id) => {
        if (!video_id) return Promise.resolve(null);
        const url = `https://raw.githubusercontent.com/LRCHub/${video_id}/main/DynamicLyrics.json`;
        console.log('[BG] DynamicLyrics URL:', url);

        return fetch(url)
            .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
            .then(json => {
                if (!json || !Array.isArray(json.lines)) return null;

                const lrcLines = json.lines.map(line => {
                    let ms = null;
                    if (typeof line.startTimeMs === 'number') {
                        ms = line.startTimeMs;
                    } else if (typeof line.startTimeMs === 'string') {
                        const n = Number(line.startTimeMs);
                        if (!Number.isNaN(n)) ms = n;
                    }
                    if (ms == null) return null;

                    let text = typeof line.text === 'string' && line.text.length
                        ? line.text
                        : (Array.isArray(line.chars) ? line.chars.map(c => c.c).join('') : '');

                    text = (text || '').trim();

                    const timeSec = ms / 1000;
                    const timeTag = `[${formatLrcTime(timeSec)}]`;
                    // ★ 文字がなくても timeTag だけの行として残す
                    return text ? `${timeTag} ${text}` : timeTag;
                }).filter(Boolean);

                const lrc = lrcLines.join('\n');
                console.log('[BG] DynamicLyrics converted LRC length:', lrc.length);
                return {
                    lyrics: lrc,
                    dynamicLines: json.lines || []
                };
            })
            .catch(err => {
                console.warn('[BG] DynamicLyrics error:', err);
                return null;
            });
    };

    // ★ 2. DynamicLyrics.json が無いとき用：README.md から LRC を読む
    const fetchFromGithubReadme = (video_id) => {
        if (!video_id) return Promise.resolve('');
        const url = `https://raw.githubusercontent.com/LRCHub/${video_id}/main/README.md`;
        console.log('[BG] README URL:', url);

        return fetch(url)
            .then(r => r.ok ? r.text() : Promise.reject(r.statusText))
            .then(text => {
                if (!text) return '';

                let candidate = '';
                const fenceMatch = text.match(/```(?:lrc|text)?([\s\S]*?)```/i);
                if (fenceMatch && fenceMatch[1]) {
                    candidate = fenceMatch[1];
                } else {
                    candidate = text;
                }

                if (!/\[\d{2}:\d{2}\.\d{2,3}\]/.test(candidate)) {
                    return '';
                }

                const cleaned = candidate.trim();
                console.log('[BG] README LRC length:', cleaned.length);
                return cleaned;
            })
            .catch(err => {
                console.warn('[BG] README fetch error:', err);
                return '';
            });
    };

    if (req.type === 'GET_LYRICS') {
        const { track, artist, youtube_url, video_id } = req.payload;

        console.log('[BG] GET_LYRICS', { track, artist, youtube_url, video_id });

        const fetchFromLrchub = () => {
            return fetch('https://lrchub.coreone.work/api/lyrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ track, artist, youtube_url })
            })
            .then(r => r.text())
            .then(text => {
                let lyrics = '';
                try {
                    const json = JSON.parse(text);
                    console.log('[BG] Lyrics API JSON:', json);
                    const res = json.response || json;

                    const synced = typeof res.synced_lyrics === 'string' ? res.synced_lyrics.trim() : '';
                    const plain  = typeof res.plain_lyrics  === 'string' ? res.plain_lyrics.trim()  : '';

                    if (synced) lyrics = synced;
                    else if (plain) lyrics = plain;
                } catch (e) {
                    console.warn('[BG] Lyrics API response is not JSON, ignoring for LRCHub');
                }
                if (!lyrics) {
                    console.log('[BG] LRCHub returned no lyrics, will fallback to LrcLib if needed');
                }
                return lyrics;
            });
        };

        const startPromise = video_id
            ? fetchFromGithubDynamic(video_id)
            : Promise.resolve(null);

        startPromise
            .then(githubRes => {
                if (githubRes && githubRes.lyrics) {
                    console.log('[BG] Using GitHub DynamicLyrics');
                    sendResponse({
                        success: true,
                        lyrics: githubRes.lyrics,
                        dynamicLines: githubRes.dynamicLines || null
                    });
                    return null;
                }

                console.log('[BG] No DynamicLyrics, try README.md');

                const readmePromise = video_id
                    ? fetchFromGithubReadme(video_id)
                    : Promise.resolve('');

                return readmePromise.then(readmeLyrics => {
                    if (readmeLyrics && readmeLyrics.trim()) {
                        console.log('[BG] Using README.md lyrics');
                        return { lyrics: readmeLyrics };
                    }

                    console.log('[BG] README empty, try LRCHub');
                    return fetchFromLrchub()
                        .then(lrchubLyrics => {
                            if (lrchubLyrics && lrchubLyrics.trim()) {
                                return { lyrics: lrchubLyrics };
                            }
                            console.log('[BG] LRCHub empty, fallback to LrcLib');
                            return fetchFromLrcLib(track, artist)
                                .then(lrclibLyrics => ({ lyrics: lrclibLyrics || '' }));
                        });
                });
            })
            .then(finalRes => {
                if (!finalRes) return;

                const ok = !!(finalRes.lyrics && finalRes.lyrics.trim());
                sendResponse({
                    success: ok,
                    lyrics: finalRes.lyrics || '',
                    dynamicLines: null
                });
            })
            .catch(err => {
                console.error("Lyrics API Error:", err);
                sendResponse({ success: false, error: err.toString() });
            });

        return true;
    }

    if (req.type === 'GET_TRANSLATION') {
        const { youtube_url, video_id, lang, langs } = req.payload;

        try {
            const url = new URL('https://lrchub.coreone.work/api/translation');
            if (youtube_url) {
                url.searchParams.set('youtube_url', youtube_url);
            } else if (video_id) {
                url.searchParams.set('video_id', video_id);
            }

            const reqLangs = Array.isArray(langs) && langs.length
                ? langs
                : (lang ? [lang] : []);

            reqLangs.forEach(l => url.searchParams.append('lang', l));

            console.log('[BG] GET_TRANSLATION', url.toString());

            fetch(url.toString(), { method: 'GET' })
            .then(r => r.text())
            .then(text => {
                let lrcMap = {};
                let missing = [];
                try {
                    const json = JSON.parse(text);
                    console.log('[BG] Translation API JSON:', json);
                    const translations = json.translations || {};
                    lrcMap = {};
                    reqLangs.forEach(l => {
                        lrcMap[l] = translations[l] || '';
                    });
                    missing = json.missing_langs || [];
                } catch (e) {
                    console.warn('[BG] Translation API response is not JSON');
                    lrcMap = {};
                }
                Object.keys(lrcMap || {}).forEach(k => {
                    console.log(`[BG] Translation[${k}] preview:`, (lrcMap[k] || '').slice(0, 100));
                });
                sendResponse({ success: true, lrcMap, missing });
            })
            .catch(err => {
                console.error('Translation API Error:', err);
                sendResponse({ success: false, error: err.toString() });
            });

        } catch (e) {
            console.error('GET_TRANSLATION build URL error:', e);
            sendResponse({ success: false, error: e.toString() });
        }

        return true;
    }

    if (req.type === 'REGISTER_TRANSLATION') {
        const { youtube_url, video_id, lang, lyrics } = req.payload;

        console.log('[BG] REGISTER_TRANSLATION', { youtube_url, video_id, lang });

        const body = { lang, lyrics };
        if (youtube_url) body.youtube_url = youtube_url;
        else if (video_id) body.video_id = video_id;

        fetch('https://lrchub.coreone.work/api/translation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(r => r.text())
        .then(text => {
            try {
                const json = JSON.parse(text);
                console.log('[BG] REGISTER_TRANSLATION JSON:', json);
                sendResponse({ success: !!json.ok, raw: json });
            } catch (e) {
                console.warn('[BG] REGISTER_TRANSLATION non-JSON response');
                sendResponse({ success: false, error: 'Invalid JSON', raw: text });
            }
        })
        .catch(err => {
            console.error('REGISTER_TRANSLATION Error:', err);
            sendResponse({ success: false, error: err.toString() });
        });

        return true;
    }
});
