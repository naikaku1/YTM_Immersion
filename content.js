(function() {
   
    let config = { deepLKey: null, useTrans: true, mode: true };
    let currentKey = null;
    let lyricsData = [];
    
   
    const ui = {
        container: null, bg: null, wrapper: null, 
        title: null, artist: null, artwork: null, 
        lyrics: null, input: null, settings: null,
        btnArea: null
    };

    let hideTimer = null;

    
    const handleInteraction = () => {
        if (!ui.btnArea) return; 

        ui.btnArea.classList.remove('inactive');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!ui.settings?.classList.contains('active') && !ui.btnArea.matches(':hover')) {
                ui.btnArea.classList.add('inactive');
            }
        }, 3000);
    };
    
    const storage = {
        _api: chrome?.storage?.local,
        get: (k) => new Promise(r => {
            if (!storage._api) return r(null);
            storage._api.get([k], res => r(res[k] || null));
        }),
        set: (k, v) => {
            if (!storage._api) return;
            storage._api.set({ [k]: v });
        },
        remove: (k) => {
            if (!storage._api) return;
            storage._api.remove(k);
        },
        clear: () => confirm('全データを削除しますか？') && storage._api?.clear(() => location.reload())
    };


    const parseLRC = (lrc) => {
        if (!lrc) return [];
        const timeExp = /\[(\d{2})\:(\d{2})\.(\d{2,3})\]/;
        return lrc.split('\n').reduce((acc, line) => {
            const m = line.match(timeExp);
            if (!m) return acc;
            const time = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / 100;
            const text = line.replace(timeExp, '').trim();
            if (text) acc.push({ time, text });
            return acc;
        }, []);
    };


    const translate = async (lines) => {
        if (!config.deepLKey || !config.useTrans || !lines.length || lines[0].translation) return lines;
        try {
            const res = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    type: 'TRANSLATE',
                    payload: { text: lines.map(l => l.text), apiKey: config.deepLKey }
                }, resolve);
            });
            if (res?.success && res.translations?.length === lines.length) {
                lines.forEach((l, i) => l.translation = res.translations[i].text);
            }
        } catch (e) { console.error('DeepL failed', e); }
        return lines;
    };

    const getMetadata = () => {
        if (navigator.mediaSession?.metadata) {
            const { title, artist, artwork } = navigator.mediaSession.metadata;
            return { title, artist, src: artwork.length ? artwork[artwork.length - 1].src : null };
        }
        const t = document.querySelector('yt-formatted-string.title.style-scope.ytmusic-player-bar');
        const a = document.querySelector('.byline.style-scope.ytmusic-player-bar');
        return (t && a) ? { title: t.textContent, artist: a.textContent.split('•')[0].trim(), src: null } : null;
    };

  
    const createEl = (tag, id, cls, html) => {
        const el = document.createElement(tag);
        if (id) el.id = id;
        if (cls) el.className = cls;
        if (html) el.innerHTML = html;
        return el;
    };

    function setupAutoHideEvents() {

        if (document.body.dataset.autohideSetup) return;
        
        ['mousemove', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, handleInteraction));
        document.body.dataset.autohideSetup = "true";

 
        handleInteraction();
    }
    
    function initSettings() {
        if (ui.settings) return;
        ui.settings = createEl('div', 'ytm-settings-panel', '', `
            <h3>Settings</h3>
            <div class="setting-item">
                <label class="toggle-label"><span>Translation</span><input type="checkbox" id="trans-toggle"></label>
            </div>
            <div class="setting-item" style="margin-top:15px;">
                <input type="password" id="deepl-key-input" placeholder="DeepL API Key">
            </div>
            <div style="display:flex; gap:10px; margin-top:20px;">
                <button id="save-settings-btn" style="flex:1;">Save</button>
                <button id="clear-all-btn" style="background:#ff3b30; color:white;">Reset</button>
            </div>
        `);
        document.body.appendChild(ui.settings);

        document.getElementById('deepl-key-input').value = config.deepLKey || '';
        document.getElementById('trans-toggle').checked = config.useTrans;

        document.getElementById('save-settings-btn').onclick = () => {
            config.deepLKey = document.getElementById('deepl-key-input').value.trim();
            config.useTrans = document.getElementById('trans-toggle').checked;
            storage.set('ytm_deepl_key', config.deepLKey);
            storage.set('ytm_trans_enabled', config.useTrans);
            alert('Saved');
            ui.settings.classList.remove('active');
            currentKey = null; // force refresh
        };
        document.getElementById('clear-all-btn').onclick = storage.clear;
    }

    function initLayout() {
        if (document.getElementById('ytm-custom-wrapper')) {
         
            ui.wrapper = document.getElementById('ytm-custom-wrapper');
            ui.bg = document.getElementById('ytm-custom-bg');
            ui.lyrics = document.getElementById('my-lyrics-container');
            ui.title = document.getElementById('ytm-custom-title');
            ui.artist = document.getElementById('ytm-custom-artist');
            ui.artwork = document.getElementById('ytm-artwork-container');
            ui.btnArea = document.getElementById('ytm-btn-area');
            
            // ★修正: handleInteractionが定義済みなのでここで呼ぶ
            setupAutoHideEvents(); 
            return;
        }

        ui.bg = createEl('div', 'ytm-custom-bg');
        document.body.appendChild(ui.bg);

        ui.wrapper = createEl('div', 'ytm-custom-wrapper');
        const leftCol = createEl('div', 'ytm-custom-left-col');
        
        ui.artwork = createEl('div', 'ytm-artwork-container');
        const info = createEl('div', 'ytm-custom-info-area');
        ui.title = createEl('div', 'ytm-custom-title');
        ui.artist = createEl('div', 'ytm-custom-artist');
        
        ui.btnArea = createEl('div', 'ytm-btn-area');
        const btns = [
            { txt: 'Upload', click: () => ui.input?.click() },
            { txt: '🗑️', cls: 'icon-btn', click: () => currentKey && confirm('歌詞を消しますか？') && storage.remove([currentKey, currentKey+"_TR"]) && (currentKey=null) },
            { txt: '⚙️', cls: 'icon-btn', click: () => { initSettings(); ui.settings.classList.toggle('active'); } }
        ];
        
        btns.forEach(b => {
            const btn = createEl('button', '', `ytm-glass-btn ${b.cls||''}`, b.txt);
            btn.onclick = b.click;
            ui.btnArea.appendChild(btn);
        });

        ui.input = createEl('input');
        ui.input.type = 'file'; ui.input.accept = '.lrc,.txt'; ui.input.style.display = 'none';
        ui.input.onchange = handleUpload;
        document.body.appendChild(ui.input);

        info.append(ui.title, ui.artist, ui.btnArea);
        leftCol.append(ui.artwork, info);
        
        ui.lyrics = createEl('div', 'my-lyrics-container');
        ui.wrapper.append(leftCol, ui.lyrics);
        document.body.appendChild(ui.wrapper);


        setupAutoHideEvents();
    }

  
    const tick = async () => {
  
        if (!document.getElementById('my-mode-toggle')) {
            const rc = document.querySelector('.right-controls-buttons');
            if (rc) {
                const btn = createEl('button', 'my-mode-toggle', '', 'IMMERSION');
                btn.onclick = () => { config.mode = !config.mode; document.body.classList.toggle('ytm-custom-layout', config.mode); };
                rc.prepend(btn);
            }
        }

        const layout = document.querySelector('ytmusic-app-layout');
        const isPlayerOpen = layout?.hasAttribute('player-page-open');
        
        if (!config.mode || !isPlayerOpen) {
            document.body.classList.remove('ytm-custom-layout');
            return;
        }
        
        document.body.classList.add('ytm-custom-layout');
        initLayout(); // Ensure UI exists

        const meta = getMetadata();
        if (!meta) return;

        const key = `${meta.title}///${meta.artist}`;
        if (currentKey !== key) {
            currentKey = key;
            updateMetaUI(meta);
            loadLyrics(meta);
        }
    };

    function updateMetaUI(meta) {
        ui.title.innerText = meta.title;
        ui.artist.innerText = meta.artist;
        if (meta.src) {
            ui.artwork.innerHTML = `<img src="${meta.src}" crossorigin="anonymous">`;
            ui.bg.style.backgroundImage = `url(${meta.src})`;
        }
        ui.lyrics.innerHTML = '<div style="opacity:0.5; padding:20px;">Loading...</div>';
    }

    async function loadLyrics(meta) {
  
        if (!config.deepLKey) config.deepLKey = await storage.get('ytm_deepl_key');
        const cachedTrans = await storage.get('ytm_trans_enabled');
        if (cachedTrans !== undefined) config.useTrans = cachedTrans;

   
        let data = await storage.get(currentKey + "_TR") || await storage.get(currentKey);
        
      
        if (!data) {
            try {
                const q = encodeURIComponent(`${meta.title} ${meta.artist}`.replace(/\s*[\(-\[].*?[\)-]].*/, ""));
                const res = await fetch(`https://lrclib.net/api/search?q=${q}`).then(r => r.json());
                const hit = res.find(i => i.syncedLyrics);
                if (hit) data = hit.syncedLyrics;
            } catch(e) { console.warn('LRCLib fetch failed'); }
        }

        if (!data) {
            renderLyrics([]);
            return;
        }

       
        if (typeof data === 'string') { 
            let parsed = parseLRC(data);
            renderLyrics(parsed); 
            
      
            if (config.useTrans && config.deepLKey) {
                parsed = await translate(parsed);
                storage.set(currentKey + "_TR", parsed); 
            } else {
                storage.set(currentKey, data); 
            }
            lyricsData = parsed;
            renderLyrics(parsed);
        } else {
           
            lyricsData = data;
            renderLyrics(data);
        }
    }

    function renderLyrics(data) {
        if (!ui.lyrics) return;
        ui.lyrics.innerHTML = '';
        document.body.classList.toggle('ytm-no-lyrics', !data.length);
        
        data.forEach(line => {
            const row = createEl('div', '', 'lyric-line', `<span>${line.text}</span>`);
            if (line.translation) row.appendChild(createEl('span', '', 'lyric-translation', line.translation));
            row.onclick = () => document.querySelector('video').currentTime = line.time;
            ui.lyrics.appendChild(row);
        });
    }

    const handleUpload = (e) => {
        const file = e.target.files[0];
        if (!file || !currentKey) return;
        const r = new FileReader();
        r.onload = (ev) => {
            storage.set(currentKey, ev.target.result);
            currentKey = null; // reload
        };
        r.readAsText(file);
        e.target.value = '';
    };

    // Sync Logic
    document.addEventListener('timeupdate', (e) => {
        if (!document.body.classList.contains('ytm-custom-layout') || !lyricsData.length) return;
        if (e.target.tagName !== 'VIDEO') return; 
        
        const t = e.target.currentTime;
        let idx = lyricsData.findIndex(l => l.time > t) - 1;
        if (idx < 0) idx = lyricsData[lyricsData.length - 1].time <= t ? lyricsData.length - 1 : -1;
        
        const current = lyricsData[idx];
        const next = lyricsData[idx + 1];
        const isInterlude = current && next && (next.time - current.time > 10) && (t - current.time > 6);

        const rows = document.querySelectorAll('.lyric-line');
        rows.forEach((r, i) => {
            if (i === idx && !isInterlude) {
                if (!r.classList.contains('active')) {
                    r.classList.add('active');
                    r.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else {
                r.classList.remove('active');
            }
        });
    }, true);

    console.log("YTM Immersion loaded.");
    setInterval(tick, 1000);
})();