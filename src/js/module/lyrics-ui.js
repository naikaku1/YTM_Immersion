  const resolveDeepLTargetLang = (lang) => {
    switch ((lang || '').toLowerCase()) {
      case 'en': case 'en-us': case 'en-gb': return 'EN';
      case 'ja': return 'JA';
      case 'ko': return 'KO';
      case 'fr': return 'FR';
      case 'de': return 'DE';
      case 'es': return 'ES';
      case 'zh': case 'zh-cn': case 'zh-tw': return 'ZH';
      default: return 'JA';
    }
  };

  const parseLRCInternal = (lrc) => {
    if (!lrc) return { lines: [], hasTs: false };
    const tagTest = /\[\d{2}:\d{2}\.\d{2,3}\]/;

    // タイムスタンプがない場合
    if (!tagTest.test(lrc)) {
      // 空行も保持して、翻訳時に行が詰まらないようにする
      const lines = lrc.split(/\r?\n/).map(line => {
        const text = (line ?? '').replace(/^\s+|\s+$/g, '');
        return { time: null, text };
      });
      return { lines, hasTs: false };
    }

    // タイムスタンプがある場合
    const tagExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
    const result = [];
    let match;
    let lastTime = null;
    let lastIndex = 0;

    while ((match = tagExp.exec(lrc)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const fracStr = match[3];
      const frac = parseInt(fracStr, 10) / (fracStr.length === 2 ? 100 : 1000);
      const time = min * 60 + sec + frac;

      if (lastTime !== null) {
        const rawText = lrc.slice(lastIndex, match.index);
        const cleaned = rawText.replace(/\r?\n/g, ' ');
        const text = cleaned.trim();
        const hasLineBreak = /[\r\n]/.test(rawText);
        if (text || hasLineBreak) {
          result.push({ time: lastTime, text });
        }
      }
      lastTime = time;
      lastIndex = tagExp.lastIndex;
    }

    // 最後の行の処理
    if (lastTime !== null && lastIndex < lrc.length) {
      const rawText = lrc.slice(lastIndex);
      const cleaned = rawText.replace(/\r?\n/g, ' ');
      const text = cleaned.trim();
      // ★修正: 空行(明示的な改行のみ)も保持してタイムスタンプのズレを防ぐ
      const hasLineBreak = /[\r\n]/.test(rawText);
      if (text || hasLineBreak) {
        result.push({ time: lastTime, text });
      }
    }

    result.sort((a, b) => (a.time || 0) - (b.time || 0));
    return { lines: result, hasTs: true };
  };


  const parseBaseLRC = (lrc) => {
    const { lines, hasTs } = parseLRCInternal(lrc);
    hasTimestamp = hasTs;
    return lines;
  };

  // ===== duet helpers =====
  const timeKey = (t) => {
    if (typeof t !== 'number' || Number.isNaN(t)) return 'NaN';
    // milliseconds precision is enough for LRC tags
    return t.toFixed(3);
  };

  // Dynamic.lrc形式のパーサー（sub.txt用）
  const parseDynamicLrcForSub = (text) => {
    const out = [];
    if (!text) return out;

    const rows = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const parseLrcTimeToMsSub = (ts) => {
      const s = String(ts || '').trim();
      const m = s.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
      if (!m) return null;
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      let frac = m[3] || '0';
      if (frac.length === 1) frac = frac + '00';
      else if (frac.length === 2) frac = frac + '0';
      const ms = parseInt(frac.slice(0, 3), 10);
      if (!Number.isFinite(mm) || !Number.isFinite(ss) || !Number.isFinite(ms)) return null;
      return (mm * 60 + ss) * 1000 + ms;
    };

    // 1st pass: parse lines
    const parsed = [];
    for (const raw of rows) {
      const line = raw.trimEnd();
      if (!line) continue;

      const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
      if (!m) continue;

      parsed.push({
        lineMs: parseLrcTimeToMsSub(m[1]),
        rest: m[2] || '',
      });
    }

    const pushDistributed = (chars, chunk, startMs, endMs) => {
      if (!chunk) return;
      const arr = Array.from(chunk);
      const n = arr.length;
      if (!n) return;

      const s = (typeof startMs === 'number') ? startMs : null;
      const e = (typeof endMs === 'number') ? endMs : null;

      if (s == null) {
        for (const ch of arr) chars.push({ t: 0, c: ch });
        return;
      }

      if (e == null || e <= s) {
        for (const ch of arr) chars.push({ t: s, c: ch });
        return;
      }

      const dur = Math.max(1, e - s);
      const step = dur / n;

      for (let i = 0; i < n; i++) {
        const t = s + Math.floor(step * i);
        chars.push({ t, c: arr[i] });
      }
    };

    for (let li = 0; li < parsed.length; li++) {
      const { lineMs, rest } = parsed[li];
      const nextLineMs = (li + 1 < parsed.length && typeof parsed[li + 1].lineMs === 'number')
        ? parsed[li + 1].lineMs
        : null;

      const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;
      const chars = [];

      let prevMs = null;
      let prevEnd = 0;

      while (true) {
        const mm = tagRe.exec(rest);
        if (!mm) break;

        const tagMs = parseLrcTimeToMsSub(mm[1]);

        if (prevMs == null && tagMs != null && mm.index > prevEnd) {
          const chunk0 = rest.slice(prevEnd, mm.index);
          pushDistributed(chars, chunk0, tagMs, tagMs);
        }

        if (prevMs != null) {
          const chunk = rest.slice(prevEnd, mm.index);
          pushDistributed(chars, chunk, prevMs, tagMs);
        }

        prevMs = tagMs;
        prevEnd = mm.index + mm[0].length;
      }

      if (prevMs != null) {
        const chunk = rest.slice(prevEnd);
        let endMs = nextLineMs;
        if (typeof endMs !== 'number') endMs = prevMs + 1500;
        if (endMs <= prevMs) endMs = prevMs + 200;
        pushDistributed(chars, chunk, prevMs, endMs);
      }

      const textLine = chars.map(c => c.c).join('');

      out.push({
        startTimeMs: (typeof lineMs === 'number' ? lineMs : (chars.length ? chars[0].t : 0)),
        text: textLine,
        chars,
      });
    }

    return out;
  };

  // Dynamic.lrc形式かどうかを判定
  const isDynamicLrcFormat = (text) => {
    if (!text) return false;
    // <00:00.00>形式のタグが含まれていればDynamic.lrc形式
    return /<\d+:\d{2}(?:\.\d{1,3})?>/.test(text);
  };

  const parseSubLRC = (lrc) => {
    // Dynamic.lrc形式の場合は専用パーサーを使用
    if (isDynamicLrcFormat(lrc)) {
      const dynLines = parseDynamicLrcForSub(lrc);
      if (dynLines && dynLines.length) {
        // dynamicLinesからLRC形式のlinesに変換
        const lines = dynLines.map(dl => ({
          time: (typeof dl.startTimeMs === 'number') ? dl.startTimeMs / 1000 : null,
          text: dl.text || '',
        }));
        // サブ用のdynamicLinesを保存
        duetSubDynamicLines = dynLines;
        return { lines, hasTs: true, dynamicLines: dynLines };
      }
    }
    
    // 通常のLRC形式
    duetSubDynamicLines = null;
    const { lines, hasTs } = parseLRCInternal(lrc);
    return { lines: Array.isArray(lines) ? lines : [], hasTs: !!hasTs, dynamicLines: null };
  };

  const mergeDuetLines = (mainLines, subLines) => {
    // タイムスタンプの許容誤差 (秒)
    const TIME_TOLERANCE = 0.5;

    const subLinesWithTime = (subLines || []).filter(l => typeof l?.time === 'number');
    
    // サブ歌詞のタイムスタンプセットを作成（高速検索用）
    const subTimeSet = new Set();
    subLinesWithTime.forEach(sub => {
      // 許容誤差を考慮して、0.1秒刻みでキーを追加
      const baseMs = Math.round(sub.time * 10);
      for (let i = -5; i <= 5; i++) {
        subTimeSet.add(baseMs + i);
      }
    });

    // sub歌詞と時間が被るメイン歌詞を除外する
    // また、除外されたメイン歌詞のタイムスタンプを記録
    const excludedMainTimes = new Set();
    const filteredMain = (mainLines || []).filter(l => {
      if (typeof l?.time !== 'number') return true;
      // 時間が近似しているサブ歌詞があるかチェック
      const keyMs = Math.round(l.time * 10);
      const collision = subTimeSet.has(keyMs);
      if (collision) {
        excludedMainTimes.add(Math.round(l.time * 1000)); // ミリ秒精度で記録
      }
      return !collision;
    });
    
    // dynamicLinesからも除外されたメイン行に対応するものを除外
    // （グローバル変数dynamicLinesを直接変更せず、フィルタ用のセットを保存）
    _duetExcludedTimes = excludedMainTimes;

    const merged = [];
    filteredMain.forEach(l => merged.push({ ...l, duetSide: 'left' }));
    (subLines || []).forEach(l => merged.push({ ...l, duetSide: 'right' }));

    merged.sort((a, b) => {
      const at = (typeof a.time === 'number') ? a.time : Number.POSITIVE_INFINITY;
      const bt = (typeof b.time === 'number') ? b.time : Number.POSITIVE_INFINITY;
      
      // 時間がほぼ同じ場合は、Left(メイン) -> Right(サブ) の順に並べる
      if (Math.abs(at - bt) < 0.05) {
        const ap = a.duetSide === 'right' ? 1 : 0;
        const bp = b.duetSide === 'right' ? 1 : 0;
        return ap - bp;
      }
      return at - bt;
    });

    return merged;
  };

  const getDynamicLineForTime = (sec) => {
    if (!dynamicLines || !Array.isArray(dynamicLines) || !dynamicLines.length) return null;
    
    // デュエットモードで除外されたタイムスタンプかチェック
    const isDuetMode = document.body.classList.contains('ytm-duet-mode');
    if (isDuetMode && _duetExcludedTimes && _duetExcludedTimes.size > 0) {
      const secMs = Math.round(sec * 1000);
      // 許容誤差50ms以内で除外されたタイムスタンプをチェック
      for (let offset = -50; offset <= 50; offset += 10) {
        if (_duetExcludedTimes.has(secMs + offset)) {
          return null; // このタイムスタンプはsub.txtで上書きされているので無視
        }
      }
    }

    // マップキャッシュの再構築（参照が変わった時のみ）
    if (_dynMapSrc !== dynamicLines) {
      _dynMapSrc = dynamicLines;
      _dynMap = new Map();

      dynamicLines.forEach(dl => {
        let ms = null;
        if (typeof dl?.startTimeMs === 'number') {
          ms = dl.startTimeMs;
        } else if (typeof dl?.startTimeMs === 'string') {
          const n = Number(dl.startTimeMs);
          if (!Number.isNaN(n)) ms = n;
        } else if (Array.isArray(dl?.chars) && dl.chars.length) {
          const ts = dl.chars.map(c => (typeof c?.t === 'number' ? c.t : null)).filter(v => v != null);
          if (ts.length) ms = Math.min(...ts);
        }

        if (typeof ms === 'number') {
          _dynMap.set(timeKey(ms / 1000), dl);
        }
      });
    }

    // 1. 完全一致トライ
    const exact = _dynMap?.get(timeKey(sec));
    if (exact) return exact;

    // 2. 近似値トライ (前後0.15秒)
    const TOLERANCE = 0.15;
    const found = dynamicLines.find(dl => {
       let startS = 0;
       if (typeof dl.startTimeMs === 'number') startS = dl.startTimeMs / 1000;
       else if (dl.time) startS = dl.time;
       return Math.abs(startS - sec) <= TOLERANCE;
    });

    return found || null;
  };

  // サブボーカル用のdynamicLine取得（sub.txtのDynamic.lrc対応）
  let _subDynMapSrc = null;
  let _subDynMap = null;
  
  const getSubDynamicLineForTime = (sec) => {
    if (!duetSubDynamicLines || !Array.isArray(duetSubDynamicLines) || !duetSubDynamicLines.length) return null;
    
    // マップキャッシュの再構築（参照が変わった時のみ）
    if (_subDynMapSrc !== duetSubDynamicLines) {
      _subDynMapSrc = duetSubDynamicLines;
      _subDynMap = new Map();

      duetSubDynamicLines.forEach(dl => {
        let ms = null;
        if (typeof dl?.startTimeMs === 'number') {
          ms = dl.startTimeMs;
        } else if (typeof dl?.startTimeMs === 'string') {
          const n = Number(dl.startTimeMs);
          if (!Number.isNaN(n)) ms = n;
        } else if (Array.isArray(dl?.chars) && dl.chars.length) {
          const ts = dl.chars.map(c => (typeof c?.t === 'number' ? c.t : null)).filter(v => v != null);
          if (ts.length) ms = Math.min(...ts);
        }

        if (typeof ms === 'number') {
          _subDynMap.set(timeKey(ms / 1000), dl);
        }
      });
    }

    // 1. 完全一致トライ
    const exact = _subDynMap?.get(timeKey(sec));
    if (exact) return exact;

    // 2. 近似値トライ (前後0.15秒)
    const TOLERANCE = 0.15;
    const found = duetSubDynamicLines.find(dl => {
       let startS = 0;
       if (typeof dl.startTimeMs === 'number') startS = dl.startTimeMs / 1000;
       else if (dl.time) startS = dl.time;
       return Math.abs(startS - sec) <= TOLERANCE;
    });

    return found || null;
  };
  function setupMovieMode() {
    const resizeObserver = new ResizeObserver(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const targetWrapper = document.getElementById("ytm-custom-wrapper");
    if (targetWrapper) {
      resizeObserver.observe(targetWrapper);
    } else {
      resizeObserver.observe(document.body);
    }
    
    const check = () => {
      const video = document.querySelector("ytmusic-player#player.style-scope.ytmusic-player-page");
      const target = document.querySelector("#ytm-custom-wrapper");
      const switcher = document.querySelector("ytmusic-av-toggle");
      const switcherTarget = document.querySelector("#ytm-custom-info-area");

      if (!video || !target || !switcher || !switcherTarget) {
        setTimeout(check, 300);
        return;
      }

      movieObserver = observerMovieModeSetup();
    };
    check();
  };
  function bringSwitcherOnly(){
    const switcher = document.querySelector("ytmusic-av-toggle");
    const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
    customSwitcherParent.appendChild(switcher);
  }
  function changeIModeUIWithMovieMode(mode) {
    if (!mode) {
      moviemode = null;
      if (movieObserver) movieObserver.stop();
      movieObserver = null;
      const switcher = document.querySelector("ytmusic-av-toggle");
      const video = document.querySelector("ytmusic-player#player");
      const originParent = document.querySelector("div#main-panel");
      const originSwitcherTarget = originParent.children[1];
      const originTarget = originParent.children[2];
      if (!originParent.contains(video)) {
        originParent.insertBefore(video, originTarget);
      }
      if (!originParent.contains(switcher)) {
        originSwitcherTarget.appendChild(switcher);
      }
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 300);
    }
    else {
      if (movieObserver) movieObserver.stop();
      movieObserver = null;
      movieObserver = observerMovieModeSetup();
    }
  }
  const observerMovieModeSetup = () => {
    const switcher = document.querySelector("ytmusic-av-toggle");
    if (!switcher) return null;

    if (movieObserver) {
      movieObserver.stop();
      movieObserver = null;
    }

    let changed;
    let classTargets = [];

    const handleMutation = () => {
      const mode = switcher.getAttribute("playback-mode");
      const newMoviemode = (mode === "OMV_PREFERRED") ? true : false;

      if (moviemode !== newMoviemode) {
        changed = true;
      } else {
        changed = false;
      }

      moviemode = newMoviemode;

      classTargets = [];
      const wrapper = document.querySelector("#ytm-custom-wrapper");
      if (wrapper instanceof Element) {
        classTargets.push(...wrapper.querySelectorAll("*"));
      }
      const pusher = (element) => {
        if (element instanceof Element) classTargets.push(element);
      };
      const playerBar = document.querySelector("ytmusic-player-bar");
      pusher(playerBar);
      pusher(switcher);
      const video = document.querySelector("ytmusic-player#player");
      pusher(video);
      const navBar = document.querySelector("ytmusic-nav-bar");
      pusher(navBar);

      classTargets.forEach(element => {
        if (moviemode) {
          element.classList.add("moviemode");
        } else {
          element.classList.remove("moviemode");
        }
      });

      changeUIWithMovieMode(changed);
    };

    handleMutation();
    bringSwitcherOnly();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "playback-mode") {
          handleMutation();
        }
      });
    });

    observer.observe(switcher, { attributes: true });

    movieObserver = {
      stop: () => {
        observer.disconnect();
        movieObserver = null;
      }
    };

    return movieObserver;
  };
  function changeUIWithMovieMode(changed) {
    if (!changed || changed === null) return;
    const originParent = document.querySelector("div#main-panel");
    const originTarget = originParent.children[2];
    const customParent = document.querySelector("#ytm-custom-wrapper");
    const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
    const switcher = document.querySelector("ytmusic-av-toggle");
    const video = document.querySelector("ytmusic-player#player.style-scope.ytmusic-player-page");

    if (moviemode) {
      customParent.prepend(video);
      customSwitcherParent.appendChild(switcher);
    }
    else {
      if (!originParent.contains(video)) {
        originParent.insertBefore(video, originTarget);
      }
    }
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
  }
  function isYTMPremiumUser() {
    const switcher = document.querySelector("ytmusic-av-toggle");
    const requireSignIn = !!document.querySelector('ytmusic-guide-signin-promo-renderer');
    const primarySection = document.querySelector('#mini-guide ytmusic-guide-section-renderer[is-primary] div#items');
    const notPremium = primarySection ? primarySection.childNodes.length >= 4 : false;
    if(!requireSignIn && !notPremium){
      if(switcher) switcher.classList.remove('notpremium');
    }
    else {
      if(switcher) switcher.classList.add('notpremium');
    }
    return !requireSignIn || !notPremium;
  }
  const hoverTimeInfoSetup = () => {
    const timeToSeconds = (str) => {
      const [m, s] = str.split(":").map(Number);
      return m * 60 + s;
    };
    const removeHoverTimeInfo = () => {
      const info = document.querySelector('#hover-time-info');
      const interval = setInterval(() => {
        if (info) {
          info.remove();
          clearInterval(interval);
        }
      }, 1000);
    };
    const createHoverTimeInfo = () => {
      let info = document.querySelector('#hover-time-info-new');
      const parent = document.querySelector('ytmusic-player-bar');
      if (!info) {
        info = document.createElement('span');
        info.id = 'hover-time-info-new';
        info.style.display = 'none';
        info.textContent = '0:00';
        document.body.appendChild(info);
      }
    };
    const adjustHoverTimeInfoPosition = () => {
      const progresshandle = document.querySelector('tp-yt-paper-slider#progress-bar #sliderKnob');
      const info = document.querySelector('#hover-time-info-new');
      const slider = document.querySelector(
        'tp-yt-paper-slider#progress-bar tp-yt-paper-progress#sliderBar #primaryProgress'
      ).parentElement.parentElement;
      const playerBar = document.querySelector('ytmusic-player-bar');
      const refresh = () => {
        const onMove = (e) => {
          const marginLeft = (playerBar.parentElement.offsetWidth - playerBar.offsetWidth) / 2;
          const infoLeft = e.clientX;
          const relativeMouseX = e.clientX - marginLeft;
          const timeinfo = document.querySelector('#left-controls > span');
          const songLengthSeconds = timeToSeconds(timeinfo.textContent.replace(/^[^/]+\/\s*/, ""));
          const relativePosition = Math.round((Math.min(1, Math.max(0, (relativeMouseX / slider.offsetWidth)))) * 1000) / 1000;
          const hoverTimeSeconds = Math.floor(songLengthSeconds * relativePosition);
          const hoverTimeString = `${String(Math.floor(hoverTimeSeconds / 60))}:${String(hoverTimeSeconds % 60).padStart(2, '0')}`;
          info.style.display = 'block';
          info.style.left = `${infoLeft}px`;
          info.textContent = hoverTimeString;
        };
        const hide = () => {
          info.style.display = 'none';
        };
        slider.addEventListener('mousemove', onMove);
        slider.addEventListener('mouseout', hide);
        progresshandle.addEventListener('mousemove', onMove);
        progresshandle.addEventListener('mouseout', hide);
      };
      const interval = setInterval(() => {
        if (slider && info && progresshandle) {
          refresh();
          clearInterval(interval);
        }
      }, 1000);
    };
    removeHoverTimeInfo();
    createHoverTimeInfo();
    adjustHoverTimeInfoPosition();
  };

  const parseLRCNoFlag = (lrc) => {
    return parseLRCInternal(lrc).lines;
  };

  const normalizeStr = (s) => (s || '').replace(/\s+/g, '').trim();

  const isMixedLang = (s) => {
    if (!s) return false;
    const hasLatin = /[A-Za-z]/.test(s);
    const hasCJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
    const hasHangul = /[\uAC00-\uD7AF]/.test(s);
    let kinds = 0;
    if (hasLatin) kinds++;
    if (hasCJK) kinds++;
    if (hasHangul) kinds++;
    return kinds >= 2;
  };

  const detectCharScript = (ch) => {
    if (!ch) return 'OTHER';
    if (/[A-Za-z]/.test(ch)) return 'LATIN';
    if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(ch)) return 'CJK';
    if (/[\uAC00-\uD7AF]/.test(ch)) return 'HANGUL';
    return 'OTHER';
  };

  const segmentByScript = (s) => {
    const result = [];
    if (!s) return result;
    let currentScript = null;
    let buf = '';
    for (const ch of s) {
      const script = detectCharScript(ch);
      if (currentScript === null) {
        currentScript = script;
        buf = ch;
      } else if (script === currentScript) {
        buf += ch;
      } else {
        result.push({ script: currentScript, text: buf });
        currentScript = script;
        buf = ch;
      }
    }
    if (buf) {
      result.push({ script: currentScript, text: buf });
    }
    return result;
  };

  const shouldTranslateSegment = (script, langCode) => {
    const lang = (langCode || '').toLowerCase();
    if (script === 'OTHER') return false;
    switch (lang) {
      case 'ja': return script === 'LATIN' || script === 'HANGUL';
      case 'en': return script === 'CJK' || script === 'HANGUL';
      case 'ko': return script === 'LATIN' || script === 'CJK';
      default: return script !== 'LATIN';
    }
  };

  const translateMixedSegments = async (lines, indexes, langCode, targetLang) => {
    try {
      const segmentsToTranslate = [];
      const perLineSegments = {};
      indexes.forEach(idx => {
        const line = lines[idx];
        const text = (line && line.text) || '';
        const segs = segmentByScript(text);
        const segMeta = [];
        segs.forEach(seg => {
          if (shouldTranslateSegment(seg.script, langCode)) {
            const translateIndex = segmentsToTranslate.length;
            segmentsToTranslate.push(seg.text);
            segMeta.push({ original: seg.text, translateIndex });
          } else {
            segMeta.push({ original: seg.text, translateIndex: null });
          }
        });
        perLineSegments[idx] = segMeta;
      });
      if (!segmentsToTranslate.length) return null;
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'TRANSLATE', payload: { text: segmentsToTranslate, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: (config.useSharedTranslateApi && !config.fastMode) } },
          resolve
        );
      });
      if (!res?.success || !Array.isArray(res.translations) || res.translations.length !== segmentsToTranslate.length) {
        return null;
      }
      const segTranslations = res.translations.map(t => t.text || '');
      const result = {};
      Object.keys(perLineSegments).forEach(key => {
        const lineIdx = Number(key);
        const segMeta = perLineSegments[lineIdx];
        let rebuilt = '';
        segMeta.forEach(seg => {
          if (seg.translateIndex == null) {
            rebuilt += seg.original;
          } else {
            rebuilt += segTranslations[seg.translateIndex] ?? seg.original;
          }
        });
        result[lineIdx] = rebuilt;
      });
      return result;
    } catch (e) {
      console.error('DeepL mixed-line fallback failed', e);
      return null;
    }
  };

  const dedupePrimarySecondary = (lines) => {
    if (!Array.isArray(lines)) return lines;
    lines.forEach(l => {
      if (!l.translation) return;
      const src = normalizeStr(l.text);
      const trn = normalizeStr(l.translation);
      if (src === trn && !isMixedLang(l.text)) {
        delete l.translation;
      }
    });
    return lines;
  };

  const translateTo = async (lines, langCode) => {
    if ((!config.deepLKey && !(config.useSharedTranslateApi && !config.fastMode)) || !lines.length) return null;
    const targetLang = resolveDeepLTargetLang(langCode);
    try {
      const baseTexts = lines.map(l => (l && l.text !== undefined && l.text !== null) ? String(l.text) : '');
      // 空行は翻訳APIへ送らず、行数だけ保持してタイムスタンプのズレを防ぐ
      const mapIdx = [];
      const requestTexts = [];
      for (let i = 0; i < baseTexts.length; i++) {
        const t = baseTexts[i];
        if ((t || '').trim()) {
          mapIdx.push(i);
          requestTexts.push(t);
        }
      }

      let translated = new Array(lines.length).fill('');

      if (requestTexts.length) {
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage(
            { type: 'TRANSLATE', payload: { text: requestTexts, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: (config.useSharedTranslateApi && !config.fastMode) } },
            resolve
          );
        });

        if (!res?.success || !Array.isArray(res.translations) || res.translations.length !== requestTexts.length) {
          return null;
        }

        for (let i = 0; i < mapIdx.length; i++) {
          const tr = res.translations[i];
          translated[mapIdx[i]] = (tr && tr.text) ? tr.text : '';
        }
      }
      const fallbackIndexes = [];
      for (let i = 0; i < lines.length; i++) {
        const src = baseTexts[i];
        const trn = translated[i];
        if (!src) continue;
        if (normalizeStr(src) === normalizeStr(trn) && isMixedLang(src)) {
          fallbackIndexes.push(i);
        }
      }
      if (fallbackIndexes.length) {
        const mixedFallback = await translateMixedSegments(lines, fallbackIndexes, langCode, targetLang);
        if (mixedFallback) {
          fallbackIndexes.forEach(i => {
            if (mixedFallback[i]) translated[i] = mixedFallback[i];
          });
        }
      }
      return translated;
    } catch (e) {
      console.error('DeepL failed', e);
    }
    return null;
  };


  const getMetadata = () => {
    // Prefer MediaSession metadata (most accurate)
    if (navigator.mediaSession?.metadata) {
      const { title, artist, album, artwork } = navigator.mediaSession.metadata;
      return {
        title: (title || '').toString(),
        artist: (artist || '').toString(),
        album: (album || '').toString(),
        src: Array.isArray(artwork) && artwork.length ? artwork[artwork.length - 1].src : null
      };
    }

    // Fallback: read from player bar
    const tEl = document.querySelector('yt-formatted-string.title.style-scope.ytmusic-player-bar');
    const aEl = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    if (!(tEl && aEl)) return null;

    const parts = (aEl.textContent || '')
      .split('•')
      .map(s => (s || '').trim())
      .filter(Boolean);

    return {
      title: (tEl.textContent || '').trim(),
      artist: parts[0] || '',
      album: parts[1] || '',
      src: null
    };
  };


  const getCurrentVideoUrl = () => {
    try {
      const url = new URL(location.href);
      const vid = url.searchParams.get('v');
      return vid ? `https://youtu.be/${vid}` : location.href;
    } catch (e) {
      console.warn('Failed to get current video url', e);
      return '';
    }
  };

  const getCurrentVideoId = () => {
    try {
      const url = new URL(location.href);
      return url.searchParams.get('v');
    } catch (e) {
      return null;
    }
  };

  // === BG からの後追いメタ更新（遅い方待ちをやめた時用）===
  // GitHub で先に歌詞だけ返ってきた後に、LRCHub 側の candidates/config/requests が来たら UI を更新する
  chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type !== 'LYRICS_META_UPDATE') return;
      const p = msg.payload || {};
      const curVid = getCurrentVideoId();
      if (p.video_id && curVid && p.video_id !== curVid) return;

      if (Array.isArray(p.candidates)) lyricsCandidates = p.candidates;
      if (p.config !== undefined) lyricsConfig = p.config;
      if (Array.isArray(p.requests)) lyricsRequests = p.requests;

      // duet: sub lyrics can arrive later (GitHub)
      if (typeof p.subLyrics === 'string') {
        duetSubLyricsRaw = p.subLyrics;
        // re-render with same raw lyrics to avoid showing duplicate left+right lines
        if (lastRawLyricsText && typeof lastRawLyricsText === 'string') {
          applyLyricsText(lastRawLyricsText);
        }
      }

      // dynamic: char-timed lines can arrive later (GitHub) even if lyrics came from API
      if (Array.isArray(p.dynamicLines) && p.dynamicLines.length) {
        dynamicLines = p.dynamicLines;
        // re-render to attach per-char spans while keeping current lines/translations
        if (Array.isArray(lyricsData) && lyricsData.length) {
          renderLyrics(lyricsData);
        }
      }

      // candidates/config が更新されたらメニューを再描画
      refreshCandidateMenu();
      refreshLockMenu();
    } catch (e) {
      // ignore
    }
  });

  const createEl = (tag, id, cls, html) => {
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (cls) el.className = cls;
    if (html !== undefined && html !== null) el.innerHTML = html;
    return el;
  };

  const showToast = (text) => {
    if (!text) return;
    let el = document.getElementById('ytm-toast');
    if (!el) {
      el = createEl('div', 'ytm-toast', '', '');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('visible');
    }, 5000);
  };

  function setupAutoHideEvents() {
    if (document.body.dataset.autohideSetup) return;
    ['mousemove', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, handleInteraction));
    document.body.dataset.autohideSetup = 'true';
    handleInteraction();
  }
  

  // ===================== 歌詞＋翻訳適用 =====================

  async function applyTranslations(baseLines, youtubeUrl) {
    if (!config.useTrans || !Array.isArray(baseLines) || !baseLines.length) return baseLines;
    const mainLangStored = await storage.get('ytm_main_lang');
    const subLangStored = await storage.get('ytm_sub_lang');
    if (mainLangStored) config.mainLang = mainLangStored;
    if (subLangStored !== null && subLangStored !== undefined) config.subLang = subLangStored;
    const mainLang = config.mainLang || 'original';
    const subLang = config.subLang || '';
    const langsToFetch = [];
    if (mainLang && mainLang !== 'original') langsToFetch.push(mainLang);
    if (subLang && subLang !== 'original' && subLang !== mainLang && subLang) langsToFetch.push(subLang);
    if (!langsToFetch.length) return baseLines;

    let lrcMap = {};
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'GET_TRANSLATION',
          payload: { youtube_url: youtubeUrl, langs: langsToFetch }
        }, resolve);
      });
      if (res?.success && res.lrcMap) lrcMap = res.lrcMap;
    } catch (e) {
      console.warn('GET_TRANSLATION failed', e);
    }

    const transLinesByLang = {};
    const needDeepL = [];

    langsToFetch.forEach(lang => {
      const lrc = (lrcMap && lrcMap[lang]) || '';
      if (lrc) {
        const parsed = parseLRCNoFlag(lrc);
        transLinesByLang[lang] = parsed;
      } else {
        needDeepL.push(lang);
      }
    });

    if (needDeepL.length &&  (config.deepLKey || (config.useSharedTranslateApi && !config.fastMode)) ) {
      for (const lang of needDeepL) {
        const translatedTexts = await translateTo(baseLines, lang);
        if (translatedTexts && translatedTexts.length === baseLines.length) {
          const lines = baseLines.map((l, i) => ({
            time: l.time,
            text: translatedTexts[i]
          }));
          transLinesByLang[lang] = lines;
          const plain = translatedTexts.join('\n');
          if (plain.trim()) {
            chrome.runtime.sendMessage({
              type: 'REGISTER_TRANSLATION',
              payload: { youtube_url: youtubeUrl, lang, lyrics: plain }
            }, (res) => {
              console.log('[CS] REGISTER_TRANSLATION', lang, res);
            });
          }
        }
      }
    }

    const alignedMap = buildAlignedTranslations(baseLines, transLinesByLang);
    const final = baseLines.map(l => ({ ...l }));
    const getLangTextAt = (langCode, index, baseText) => {
      if (!langCode || langCode === 'original') return baseText;
      const arr = alignedMap[langCode];
      if (!arr) return baseText;
      const v = arr[index];
      return (v === null || v === undefined) ? baseText : v;
    };

    for (let i = 0; i < final.length; i++) {
      const baseText = final[i].text;
      let primary = getLangTextAt(mainLang, i, baseText);
      let secondary = null;
      if (subLang && subLang !== mainLang) {
        secondary = getLangTextAt(subLang, i, baseText);
      } else if (!subLang && mainLang !== 'original') {
        if (normalizeStr(primary) !== normalizeStr(baseText)) {
          secondary = baseText;
        }
      }
      if (secondary && normalizeStr(primary) === normalizeStr(secondary)) {
        if (!isMixedLang(baseText)) secondary = null;
      }
      final[i].text = primary;
      if (secondary) final[i].translation = secondary;
      else delete final[i].translation;
    }
    dedupePrimarySecondary(final);
    return final;
  }

  const buildAlignedTranslations = (baseLines, transLinesByLang) => {
    const alignedMap = {};
    const TOL = 0.15;
    Object.keys(transLinesByLang).forEach(lang => {
      const arr = transLinesByLang[lang];
      const res = new Array(baseLines.length).fill(null);
      if (!Array.isArray(arr) || !arr.length) {
        alignedMap[lang] = res;
        return;
      }
      const hasAnyTime = arr.some(x => x && typeof x.time === 'number');
      if (!hasAnyTime) {
        // タイムスタンプ無しの翻訳は「空行を消費しない」方式で合わせる
        let k = 0;
        for (let i = 0; i < baseLines.length; i++) {
          const baseTextRaw = (baseLines[i]?.text ?? '');
          const isEmptyBaseLine = typeof baseTextRaw === 'string' && baseTextRaw.trim() === '';
          if (isEmptyBaseLine) { res[i] = ''; continue; }
          const cand = arr[k];
          if (cand && typeof cand.text === 'string') {
            const trimmed = cand.text.trim();
            res[i] = trimmed === '' ? '' : trimmed;
          } else {
            res[i] = '';
          }
          k++;
        }
        alignedMap[lang] = res;
        return;
      }
      let j = 0;
      for (let i = 0; i < baseLines.length; i++) {
        const baseLine = baseLines[i] || {};
        const tBase = baseLine.time;
        const baseTextRaw = (baseLine.text ?? '');
        const isEmptyBaseLine = typeof baseTextRaw === 'string' && baseTextRaw.trim() === '';
        if (isEmptyBaseLine) {
          res[i] = '';
          continue;
        }
        if (typeof tBase !== 'number') {
          const cand = arr[i];
          if (cand && typeof cand.text === 'string') {
            const raw = cand.text;
            const trimmed = raw.trim();
            res[i] = trimmed === '' ? '' : trimmed;
          }
          continue;
        }
        while (j < arr.length && typeof arr[j].time === 'number' && arr[j].time < tBase - TOL) {
          j++;
        }
        if (j < arr.length && typeof arr[j].time === 'number' && Math.abs(arr[j].time - tBase) <= TOL) {
          const raw = (arr[j].text ?? '');
          const trimmed = raw.trim();
          res[i] = trimmed === '' ? '' : trimmed;
          j++;
        }
      }
      alignedMap[lang] = res;
    });
    return alignedMap;
  };

  
  // ===================== Dynamic line post-processing =====================
  // Some providers return Dynamic lyrics in "word chunks" (e.g. each char item is a whole word).
  // We normalize them into true character-level timings by distributing each chunk's duration
  // across its characters (1 char at a time).
  function normalizeDynamicLinesToCharLevel(dynLines) {
    if (!Array.isArray(dynLines) || dynLines.length === 0) return dynLines;

    const toMs = (v) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return null;
    };

    const getLineStartMs = (line) => {
      if (!line) return null;
      return toMs(line.startTimeMs) ?? toMs(line.time) ?? null;
    };

    const getCharStartMs = (ch) => {
      if (!ch) return null;
      return toMs(ch.t) ?? toMs(ch.time) ?? toMs(ch.startTimeMs) ?? null;
    };

    const isWordChunk = (s) => {
      if (typeof s !== 'string') return false;
      // Use Array.from to be Unicode-safe (emoji etc.)
      return Array.from(s).length > 1;
    };

    const expandChunk = (chunkText, startMs, endMs) => {
      const arr = Array.from(String(chunkText ?? ''));
      const n = arr.length;
      if (!n) return [];
      const s = (typeof startMs === 'number' && Number.isFinite(startMs)) ? startMs : null;
      const e = (typeof endMs === 'number' && Number.isFinite(endMs)) ? endMs : null;

      // If we can't determine timing, emit all at 0 (will appear immediately when line becomes active)
      if (s == null) return arr.map(c => ({ t: 0, c }));

      if (e == null || e <= s) return arr.map(c => ({ t: s, c }));

      const dur = Math.max(1, e - s);
      const step = dur / n;
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push({ t: s + Math.floor(step * i), c: arr[i] });
      }
      return out;
    };

    for (let li = 0; li < dynLines.length; li++) {
      const line = dynLines[li];
      if (!line || !Array.isArray(line.chars) || line.chars.length === 0) continue;

      // detect if any "char" item is actually a multi-character chunk (word)
      const hasChunk = line.chars.some(ch => isWordChunk(ch?.c));
      if (!hasChunk) continue;

      const nextLineStartMs = (li + 1 < dynLines.length) ? getLineStartMs(dynLines[li + 1]) : null;
      const lineStartMs = getLineStartMs(line) ?? getCharStartMs(line.chars[0]) ?? 0;

      // Build expanded character list
      const expanded = [];
      for (let i = 0; i < line.chars.length; i++) {
        const seg = line.chars[i];
        const segText = (seg && typeof seg.c === 'string') ? seg.c : '';
        const segStart = getCharStartMs(seg) ?? lineStartMs;

        // End bound is next segment's start, else next line, else a small fallback window
        let segEnd = (i + 1 < line.chars.length) ? getCharStartMs(line.chars[i + 1]) : null;
        if (segEnd == null) segEnd = toMs(line.endTimeMs) ?? nextLineStartMs ?? (segStart + 1500);
        if (typeof segEnd === 'number' && segEnd <= segStart) segEnd = segStart + 200;

        // Even if segText is already single "character", keep it as-is
        const segArr = Array.from(String(segText));
        if (segArr.length <= 1) {
          if (segArr.length === 1) expanded.push({ t: segStart, c: segArr[0] });
          continue;
        }

        expanded.push(...expandChunk(segText, segStart, segEnd));
      }

      // Replace with normalized chars
      line.chars = expanded;
      // Update line text if missing or mismatched
      try {
        const rebuilt = expanded.map(x => x.c).join('');
        if (typeof line.text !== 'string' || line.text.length === 0) line.text = rebuilt;
      } catch (e) { }

      // Ensure startTimeMs exists
      if (typeof line.startTimeMs !== 'number' || !Number.isFinite(line.startTimeMs)) {
        const firstT = expanded.length ? expanded[0].t : lineStartMs;
        line.startTimeMs = firstT;
      }
    }

    return dynLines;
  }

async function applyLyricsText(rawLyrics) {
    const keyAtStart = currentKey;
    if (!rawLyrics || typeof rawLyrics !== 'string' || !rawLyrics.trim()) {
      if (keyAtStart !== currentKey) return;
      lyricsData = [];
      hasTimestamp = false;
      renderLyrics([]);
      return;
    }
    lastRawLyricsText = rawLyrics;
    let parsed = parseBaseLRC(rawLyrics);
    const videoUrl = getCurrentVideoUrl();

    // duet: if sub.txt exists, hide (filter) the normal lines that match sub timestamps,
    // and render the sub lines on the right.
    let baseLines = parsed;
    let hasDuetSub = false;
    
    // デュエットモードのリセット（sub.txtがない場合は除外タイムスタンプもクリア）
    _duetExcludedTimes = new Set();
    
    if (typeof duetSubLyricsRaw === 'string' && duetSubLyricsRaw.trim()) {
      const subObj = parseSubLRC(duetSubLyricsRaw);
      const subLines = subObj.lines || [];
      hasDuetSub = !!subObj.hasTs && subLines.some(l => typeof l?.time === 'number');
      if (hasDuetSub) {
        // even if the main lyrics didn't have tags, duet sub implies timestamp mode
        hasTimestamp = true;
        baseLines = mergeDuetLines(parsed, subLines);
      }
    }
    document.body.classList.toggle('ytm-duet-mode', hasDuetSub);

    let finalLines = baseLines;
    if (config.useTrans) {
      const translated = await applyTranslations(baseLines, videoUrl);
      // applyTranslations rebuilds objects, so re-attach duetSide by index
      if (Array.isArray(translated) && Array.isArray(baseLines) && translated.length === baseLines.length) {
        finalLines = translated.map((l, i) => ({ ...l, duetSide: baseLines[i]?.duetSide }));
      } else {
        finalLines = translated;
      }
    }
    if (keyAtStart !== currentKey) return;

    // Normalize Dynamic lyrics: expand "word chunks" into character-level timings
    try {
      if (Array.isArray(dynamicLines) && dynamicLines.length) {
        dynamicLines = normalizeDynamicLinesToCharLevel(dynamicLines);
      }
    } catch (e) { }

    lyricsData = finalLines;
    renderLyrics(finalLines);
  }

  // ===================== 歌詞候補・ロック関連 =====================

  const getCandidateId = (cand, idx = 0) => {
    if (!cand || typeof cand !== 'object') return String(idx);
    return String(cand.id || cand.candidate_id || cand.path || cand.file || cand.filename || cand.name || cand.title || idx);
  };

  const buildCandidateLabel = (cand, idx = 0) => {
    if (!cand || typeof cand !== 'object') return `候補${idx + 1}`;

    const rawName = (
      cand.file ||
      cand.filename ||
      cand.name ||
      cand.path ||
      cand.select ||
      cand.list ||
      cand.candidate_id ||
      cand.id ||
      ''
    );

    const normalized = String(rawName || '').trim().replace(/\\/g, '/');
    const labelText = normalized ? normalized.split('/').pop() : `候補${idx + 1}`;
    return labelText;
  };

  const safeRuntimeSendMessage = (message) => {
    return new Promise((resolve) => {
      try {
        if (!EXT || !EXT.runtime || typeof EXT.runtime.sendMessage !== 'function') {
          resolve(null);
          return;
        }
        EXT.runtime.sendMessage(message, (resp) => {
          const err = EXT.runtime && EXT.runtime.lastError ? EXT.runtime.lastError : null;
          if (err) {
            console.warn('[CS] runtime.sendMessage failed:', err.message || err);
            resolve({ success: false, error: err.message || String(err) });
            return;
          }
          resolve(resp || null);
        });
      } catch (e) {
        console.warn('[CS] runtime.sendMessage exception:', e);
        resolve({ success: false, error: String(e) });
      }
    });
  };

  const formatPreviewTime = (seconds) => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '--:--';
    const total = Math.max(0, Math.floor(seconds));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  const getCurrentPlaybackSeconds = () => {
    try {
      const v = document.querySelector('video');
      if (v && Number.isFinite(v.currentTime)) return v.currentTime;
    } catch (e) { }
    return null;
  };

  const getCurrentRenderedLyricText = () => {
    if (lastActiveIndex >= 0 && Array.isArray(lyricsData) && lyricsData[lastActiveIndex]) {
      const line = lyricsData[lastActiveIndex];
      const txt = String(line.text || line.rawLine || '').trim();
      if (txt) return txt;
    }
    try {
      const activeRow = ui.lyrics ? ui.lyrics.querySelector('.lyric-line.active .lyric-main, .lyric-line.active') : null;
      return activeRow && activeRow.textContent ? activeRow.textContent.trim() : '';
    } catch (e) {
      return '';
    }
  };

  const getCurrentRenderedLyricIndex = () => {
    if (!Array.isArray(lyricsData) || !lyricsData.length) return -1;
    if (Number.isInteger(lastActiveIndex) && lastActiveIndex >= 0) {
      let nonEmptyIndex = -1;
      for (let i = 0; i <= Math.min(lastActiveIndex, lyricsData.length - 1); i++) {
        const txt = String(lyricsData[i]?.text || lyricsData[i]?.rawLine || '').trim();
        if (txt) nonEmptyIndex += 1;
      }
      return nonEmptyIndex;
    }
    return -1;
  };

  const pickPreviewInfoFromLyrics = (rawLyrics) => {
    const txt = typeof rawLyrics === 'string' ? rawLyrics.trim() : '';
    if (!txt) return { line: '', mode: 'empty', lineIndex: -1, total: 0 };

    const parsed = parseLRCNoFlag(txt);
    const nonEmpty = Array.isArray(parsed)
      ? parsed.filter(line => line && typeof line.text === 'string' && line.text.trim())
      : [];

    if (!nonEmpty.length) {
      const plain = txt.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!plain.length) return { line: '', mode: 'empty', lineIndex: -1, total: 0 };
      return { line: plain[0], mode: 'plain-first', lineIndex: 0, total: plain.length };
    }

    const currentSeconds = getCurrentPlaybackSeconds();
    const hasTs = nonEmpty.some(line => typeof line.time === 'number' && Number.isFinite(line.time));

    if (hasTs && typeof currentSeconds === 'number') {
      let foundIndex = 0;
      for (let i = 0; i < nonEmpty.length; i++) {
        const t = nonEmpty[i] && typeof nonEmpty[i].time === 'number' ? nonEmpty[i].time : null;
        if (t == null) continue;
        if (t > currentSeconds) break;
        foundIndex = i;
      }
      return {
        line: String(nonEmpty[foundIndex].text || '').trim(),
        mode: 'timestamp',
        lineIndex: foundIndex,
        total: nonEmpty.length
      };
    }

    const currentLineIndex = getCurrentRenderedLyricIndex();
    if (currentLineIndex >= 0) {
      const idx = Math.max(0, Math.min(currentLineIndex, nonEmpty.length - 1));
      return {
        line: String(nonEmpty[idx].text || '').trim(),
        mode: 'current-line-index',
        lineIndex: idx,
        total: nonEmpty.length
      };
    }

    try {
      const v = document.querySelector('video');
      if (v && Number.isFinite(v.currentTime) && Number.isFinite(v.duration) && v.duration > 0) {
        const ratio = Math.max(0, Math.min(1, v.currentTime / v.duration));
        const idx = Math.max(0, Math.min(nonEmpty.length - 1, Math.round((nonEmpty.length - 1) * ratio)));
        return {
          line: String(nonEmpty[idx].text || '').trim(),
          mode: 'progress-ratio',
          lineIndex: idx,
          total: nonEmpty.length
        };
      }
    } catch (e) { }

    return {
      line: String(nonEmpty[0].text || '').trim(),
      mode: 'plain-first',
      lineIndex: 0,
      total: nonEmpty.length
    };
  };

  async function ensureCandidateLyricsLoaded(candId) {
    if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) return null;
    const idx = lyricsCandidates.findIndex((cand, i) => getCandidateId(cand, i) === String(candId));
    if (idx < 0) return null;
    const cand = lyricsCandidates[idx];
    if (cand && typeof cand.lyrics === 'string' && cand.lyrics.trim()) return cand;

    const payload = {
      youtube_url: getCurrentVideoUrl(),
      video_id: getCurrentVideoId(),
      candidate_id: getCandidateId(cand, idx),
      candidate: cand || null
    };
    console.log('[CS] GET_CANDIDATE_LYRICS request:', payload);
    const res = await safeRuntimeSendMessage({ type: 'GET_CANDIDATE_LYRICS', payload });
    console.log('[CS] GET_CANDIDATE_LYRICS response:', res);
    if (res && res.success && typeof res.lyrics === 'string' && res.lyrics.trim()) {
      const next = {
        ...(cand || {}),
        lyrics: res.lyrics,
        has_synced: typeof res.has_synced === 'boolean' ? res.has_synced : !!/\[\d+:\d{2}(?:\.\d{1,3})?\]/.test(res.lyrics)
      };
      lyricsCandidates[idx] = next;
      return next;
    }
    return cand || null;
  }

  function ensureCandidateHoverPreview() {
    let el = document.getElementById('ytm-candidate-hover-preview');
    const parent = ui.uploadMenu || document.body;
    if (!el) {
      el = document.createElement('div');
      el.id = 'ytm-candidate-hover-preview';
      el.innerHTML = `
        <div class="ytm-candidate-hover-preview-title"></div>
        <div class="ytm-candidate-hover-preview-line"></div>
        <div class="ytm-candidate-hover-preview-meta"></div>
        <div class="ytm-candidate-hover-preview-current"></div>
      `;
      parent.appendChild(el);
    } else if (el.parentElement !== parent) {
      parent.appendChild(el);
    }
    return el;
  }

  function updateCandidateHoverPreviewPosition(clientX, clientY, anchorEl) {
    const el = ensureCandidateHoverPreview();
    if (!el) return;
    if (ui.uploadMenu && el.parentElement === ui.uploadMenu) {
      const menuRect = ui.uploadMenu.getBoundingClientRect();
      const anchorRect = (anchorEl || hoverPreviewAnchorEl || ui.uploadMenu).getBoundingClientRect();
      const height = el.offsetHeight || 180;
      const maxTop = Math.max(8, ui.uploadMenu.offsetHeight - height - 8);
      const desiredTop = Math.max(8, Math.min(maxTop, anchorRect.top - menuRect.top - 8));
      el.style.top = `${desiredTop}px`;
      el.style.left = 'auto';
      el.style.right = `calc(100% + 12px)`;
      return;
    }
    const pad = 18;
    const width = el.offsetWidth || 360;
    const height = el.offsetHeight || 160;
    let left = clientX + pad;
    let top = clientY + pad;
    if (left + width > window.innerWidth - 12) left = Math.max(12, clientX - width - pad);
    if (top + height > window.innerHeight - 12) top = Math.max(12, clientY - height - pad);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function renderCandidateHoverPreview(candId) {
    const el = ensureCandidateHoverPreview();
    if (!el || !candId) return;
    const list = Array.isArray(lyricsCandidates) ? lyricsCandidates : [];
    const idx = list.findIndex((cand, i) => getCandidateId(cand, i) === String(candId));
    if (idx < 0) return;
    const cand = list[idx];
    const titleEl = el.querySelector('.ytm-candidate-hover-preview-title');
    const lineEl = el.querySelector('.ytm-candidate-hover-preview-line');
    const metaEl = el.querySelector('.ytm-candidate-hover-preview-meta');
    const currentEl = el.querySelector('.ytm-candidate-hover-preview-current');
    const info = pickPreviewInfoFromLyrics(cand && cand.lyrics ? cand.lyrics : '');
    const currentLine = getCurrentRenderedLyricText();
    const currentSeconds = getCurrentPlaybackSeconds();

    if (titleEl) titleEl.textContent = buildCandidateLabel(cand, idx);

    if (lineEl) {
      if (info.line) lineEl.textContent = info.line;
      else if (hoverPreviewLoading) lineEl.textContent = '候補の歌詞データを読み込み中...';
      else lineEl.textContent = 'この候補の歌詞データを表示できませんでした';
    }

    if (metaEl) {
      const parts = [];
      if (typeof currentSeconds === 'number') parts.push(`再生位置 ${formatPreviewTime(currentSeconds)}`);
      if (info.total > 0 && info.lineIndex >= 0) parts.push(`行 ${info.lineIndex + 1}/${info.total}`);
      if (info.mode === 'timestamp') parts.push('候補自身の同期位置');
      else if (info.mode === 'current-line-index') parts.push('現在の表示行に追従');
      else if (info.mode === 'progress-ratio') parts.push('再生率から推定');
      else if (info.mode === 'plain-first') parts.push('先頭行を表示');
      metaEl.textContent = parts.join(' / ');
    }

    if (currentEl) {
      currentEl.textContent = currentLine ? `現在表示中: ${currentLine}` : '';
    }

    updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY);
    el.classList.add('visible');
  }

  function startCandidateHoverPreviewLoop() {
    if (hoverPreviewRafId) return;
    const tick = () => {
      if (!hoverPreviewCandidateId) {
        hoverPreviewRafId = null;
        return;
      }
      renderCandidateHoverPreview(hoverPreviewCandidateId);
      hoverPreviewRafId = requestAnimationFrame(tick);
    };
    hoverPreviewRafId = requestAnimationFrame(tick);
  }

  async function showCandidateHoverPreview(candId, ev) {
    if (!candId) return;
    hoverPreviewCandidateId = candId;
    hoverPreviewAnchorEl = ev?.currentTarget || ev?.target?.closest?.('.ytm-upload-menu-item-candidate') || hoverPreviewAnchorEl;
    hoverPreviewMouseX = ev?.clientX ?? hoverPreviewMouseX;
    hoverPreviewMouseY = ev?.clientY ?? hoverPreviewMouseY;
    hoverPreviewLoading = true;
    console.log('[CS] hover preview start:', candId);
    const el = ensureCandidateHoverPreview();
    if (el) {
      renderCandidateHoverPreview(candId);
      updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY, hoverPreviewAnchorEl);
      el.classList.add('visible');
    }
    startCandidateHoverPreviewLoop();
    const cand = await ensureCandidateLyricsLoaded(candId);
    if (hoverPreviewCandidateId !== candId) return;
    hoverPreviewLoading = false;
    renderCandidateHoverPreview(candId);
  }

  function hideCandidateHoverPreview() {
    hoverPreviewCandidateId = null;
    hoverPreviewLoading = false;
    hoverPreviewAnchorEl = null;
    if (hoverPreviewRafId) {
      cancelAnimationFrame(hoverPreviewRafId);
      hoverPreviewRafId = null;
    }
    const el = document.getElementById('ytm-candidate-hover-preview');
    if (el) el.classList.remove('visible');
  }

  async function selectCandidateById(candId) {
    if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) return;
    let cand = lyricsCandidates.find((c, idx) => getCandidateId(c, idx) === String(candId));
    if (!cand) return;
    if (!(typeof cand.lyrics === 'string' && cand.lyrics.trim())) {
      cand = await ensureCandidateLyricsLoaded(candId);
    }
    if (!cand || typeof cand.lyrics !== 'string' || !cand.lyrics.trim()) {
      showToast('この候補の歌詞データを読み込めませんでした');
      return;
    }
    selectedCandidateId = candId;
    dynamicLines = null;
    duetSubDynamicLines = null;
    _duetExcludedTimes = new Set();
    if (currentKey) {
      storage.set(currentKey, {
        lyrics: cand.lyrics,
        dynamicLines: null,
        noLyrics: false,
        candidateId: cand.id || candId || null
      });
    }
    await applyLyricsText(cand.lyrics);
    const youtube_url = getCurrentVideoUrl();
    const video_id = getCurrentVideoId();
    const candidate_id = cand.id || candId;
    try {
      chrome.runtime.sendMessage(
        { type: 'SELECT_LYRICS_CANDIDATE', payload: { youtube_url, video_id, candidate_id } },
        (res) => console.log('[CS] SELECT_LYRICS_CANDIDATE result:', res)
      );
    } catch (e) {
      console.warn('[CS] SELECT_LYRICS_CANDIDATE failed to send', e);
    }
    const reloadKey = currentKey;
    setTimeout(() => {
      const metaNow = getMetadata();
      if (!metaNow) return;
      const keyNow = `${metaNow.title}///${metaNow.artist}`;
      if (keyNow !== reloadKey) return;
      storage.remove(reloadKey);
      loadLyrics(metaNow);
    }, 10000);
  }

  function refreshCandidateMenu() {
    if (!ui.uploadMenu) {
      if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      return;
    }
    const section = ui.uploadMenu.querySelector('.ytm-upload-menu-candidates');
    const list = section ? section.querySelector('.ytm-upload-menu-candidate-list') : null;
    if (!section || !list) return;
    list.innerHTML = '';
    if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) {
      section.style.display = 'none';
      if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      return;
    }
    section.style.display = 'block';
    lyricsCandidates.forEach((cand, idx) => {
      const id = getCandidateId(cand, idx);
      const btn = document.createElement('button');
      btn.className = 'ytm-upload-menu-item ytm-upload-menu-item-candidate';
      btn.dataset.action = 'candidate';
      btn.dataset.candidateId = id;
      btn.textContent = buildCandidateLabel(cand, idx);
      if (String(selectedCandidateId || '') === id) {
        btn.classList.add('is-selected');
      }
      btn.addEventListener('mouseenter', (ev) => {
        showCandidateHoverPreview(id, ev);
      });
      btn.addEventListener('mousemove', (ev) => {
        hoverPreviewMouseX = ev.clientX;
        hoverPreviewMouseY = ev.clientY;
        hoverPreviewAnchorEl = ev.currentTarget || hoverPreviewAnchorEl;
        updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY, hoverPreviewAnchorEl);
      });
      btn.addEventListener('mouseleave', () => {
        hideCandidateHoverPreview();
      });
      list.appendChild(btn);
    });
    if (ui.lyricsBtn) {
      ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      void ui.lyricsBtn.offsetWidth;
      ui.lyricsBtn.classList.add('ytm-lyrics-has-candidates');
    }
  }

  function refreshLockMenu() {
    if (!ui.uploadMenu) return;
    const lockSection = ui.uploadMenu.querySelector('.ytm-upload-menu-locks');
    const lockList = lockSection ? lockSection.querySelector('.ytm-upload-menu-lock-list') : null;
    const addSyncBtn = ui.uploadMenu.querySelector('.ytm-upload-menu-item[data-action="add-sync"]');
    if (!lockSection || !lockList || !addSyncBtn) return;
    lockList.innerHTML = '';
    const mergedRequests = [];
    if (Array.isArray(lyricsRequests)) {
      lyricsRequests.forEach(r => { if (r) mergedRequests.push({ ...r }); });
    }
    const ensureRequest = (id, label, target) => {
      const idLower = String(id).toLowerCase();
      if (mergedRequests.some(r => String(r.request || r.id || '').toLowerCase() === idLower)) return;
      mergedRequests.push({ request: id, label, target });
    };
    ensureRequest('lock_current_sync', '同期歌詞を確定 (Lock sync)', 'sync');
    ensureRequest('lock_current_dynamic', '動く歌詞を確定 (Lock dynamic)', 'dynamic');
    const activeReqs = mergedRequests.filter(r => {
      if (!r) return false;
      if (r.has_lyrics) return true;
      if (r.target === 'sync' || r.target === 'dynamic') return true;
      const key = String(r.request || r.id || '').toLowerCase();
      if (!key) return false;
      return key.startsWith('lock_current_');
    });
    if (!activeReqs.length) {
      lockSection.style.display = 'none';
    } else {
      lockSection.style.display = 'block';
      const syncLocked = !!(lyricsConfig && lyricsConfig.SyncLocked);
      const dynamicLocked = !!(lyricsConfig && lyricsConfig.dynmicLock);
      activeReqs.forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'ytm-upload-menu-item';
        btn.dataset.action = 'lock-request';
        btn.dataset.requestId = r.request || r.id || '';
        btn.textContent = r.label || r.request || r.id || '歌詞を確定';
        const key = String(r.request || r.id || '').toLowerCase();
        const isSync = r.target === 'sync' || key.includes('sync');
        const isDynamic = r.target === 'dynamic' || key.includes('dynamic');
        const locked = r.locked || (isSync && syncLocked) || (isDynamic && dynamicLocked);
        if (locked) {
          btn.classList.add('ytm-upload-menu-item-disabled');
          btn.title = 'すでに確定された歌詞です';
        }
        lockList.appendChild(btn);
      });
    }
    const syncLocked = !!(lyricsConfig && lyricsConfig.SyncLocked);
    const dynamicLocked = !!(lyricsConfig && lyricsConfig.dynmicLock);
    const shouldDisableAddSync = syncLocked && dynamicLocked;
    addSyncBtn.classList.toggle('ytm-upload-menu-item-disabled', shouldDisableAddSync);
    if (shouldDisableAddSync) {
      addSyncBtn.dataset.disabledMessage = 'すでに確定された歌詞です';
      addSyncBtn.title = 'すでに確定された歌詞です';
    } else {
      delete addSyncBtn.dataset.disabledMessage;
      addSyncBtn.title = '';
    }
  }


  function setupUploadMenu(uploadBtn) {
    if (!ui.btnArea || ui.uploadMenu) return;
    ui.btnArea.style.position = 'relative';
    const menu = createEl('div', 'ytm-upload-menu', 'ytm-upload-menu');
    menu.innerHTML = `
      <div class="ytm-upload-menu-title">Lyrics</div>
      <button class="ytm-upload-menu-item" data-action="local">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg></span>
        <span>ローカル歌詞読み込み / ReadLyrics</span>
      </button>
      <button class="ytm-upload-menu-item" data-action="add-sync">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></span>
        <span>歌詞同期を追加 / AddTiming</span>
      </button>
      <div class="ytm-upload-menu-locks" style="display:none;">
        <div class="ytm-upload-menu-subtitle">歌詞を確定 / Confirm</div>
        <div class="ytm-upload-menu-lock-list"></div>
      </div>
      <div class="ytm-upload-menu-separator"></div>
      <button class="ytm-upload-menu-item" data-action="fix">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></span>
        <span>歌詞の間違いを修正 / FixLyrics</span>
      </button>
      <div class="ytm-upload-menu-candidates" style="display:none;">
        <div class="ytm-upload-menu-subtitle">別の歌詞を選択</div>
        <div class="ytm-upload-menu-candidate-list"></div>
      </div>
    `;
    ui.btnArea.appendChild(menu);
    ui.uploadMenu = menu;
    const toggleMenu = (show) => {
      if (!ui.uploadMenu) return;
      const cl = ui.uploadMenu.classList;
      if (show === undefined) cl.toggle('visible');
      else if (show) cl.add('visible');
      else { cl.remove('visible'); hideCandidateHoverPreview(); }
    };
    uploadBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleMenu();
    });
    ui.uploadMenu.addEventListener('click', (ev) => {
      const target = ev.target.closest('.ytm-upload-menu-item');
      if (!target) return;
      if (target.classList.contains('ytm-upload-menu-item-disabled')) {
        const msg = target.dataset.disabledMessage || 'この操作は現在利用できません';
        showToast(msg);
        return;
      }
      const action = target.dataset.action;
      const candId = target.dataset.candidateId || null;
      const reqId = target.dataset.requestId || null;
      toggleMenu(false);
      hideCandidateHoverPreview();
      if (action === 'local') {
        ui.input?.click();
      } else if (action === 'add-sync') {
        const videoUrl = getCurrentVideoUrl();
        const base = 'https://lrchub.coreone.work';
        const lrchubUrl = videoUrl ? `${base}/manual?video_url=${encodeURIComponent(videoUrl)}` : base;
        window.open(lrchubUrl, '_blank');
      } else if (action === 'fix') {
        const vid = getCurrentVideoId();
        if (!vid) {
          alert('動画IDが取得できませんでした。YouTube Music の再生画面で実行してください。');
          return;
        }
        const githubUrl = `https://github.com/LRCHub/${vid}/edit/main/README.md`;
        window.open(githubUrl, '_blank');
      } else if (action === 'candidate' && candId) {
        selectCandidateById(candId);
      } else if (action === 'lock-request' && reqId) {
        sendLockRequest(reqId);
      }
    });

    if (!uploadMenuGlobalSetup) {
      uploadMenuGlobalSetup = true;
      document.addEventListener('click', (ev) => {
        if (!ui.uploadMenu) return;
        if (!ui.uploadMenu.classList.contains('visible')) return;
        if (ui.uploadMenu.contains(ev.target) || uploadBtn.contains(ev.target)) return;
        ui.uploadMenu.classList.remove('visible');
        hideCandidateHoverPreview();
      }, true);
    }
    refreshCandidateMenu();
    refreshLockMenu();
  }

  function setupDeleteDialog(trashBtn) {
    if (!ui.btnArea || ui.deleteDialog) return;
    ui.btnArea.style.position = 'relative';
    const dialog = createEl('div', 'ytm-delete-dialog', 'ytm-confirm-dialog', `
      <div class="ytm-confirm-title">歌詞を削除</div>
      <div class="ytm-confirm-message">
        この曲の保存済み歌詞を削除しますか？<br>
        <span style="font-size:11px;opacity:0.7;">ローカルキャッシュのみ削除されます。</span>
      </div>
      <div class="ytm-confirm-buttons">
        <button class="ytm-confirm-btn cancel">キャンセル</button>
        <button class="ytm-confirm-btn danger">削除</button>
      </div>
    `);
    ui.btnArea.appendChild(dialog);
    ui.deleteDialog = dialog;
    const toggleDialog = (show) => {
      if (!ui.deleteDialog) return;
      const cl = ui.deleteDialog.classList;
      if (show === undefined) cl.toggle('visible');
      else if (show) cl.add('visible');
      else cl.remove('visible');
    };
    trashBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleDialog();
    });
    const cancelBtn = dialog.querySelector('.ytm-confirm-btn.cancel');
    const dangerBtn = dialog.querySelector('.ytm-confirm-btn.danger');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleDialog(false);
      });
    }
    if (dangerBtn) {
      dangerBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (currentKey) {
          storage.remove(currentKey);
          lyricsData = [];
          dynamicLines = null;
          duetSubDynamicLines = null;
          _duetExcludedTimes = new Set();
          lyricsCandidates = null;
          selectedCandidateId = null;
          lyricsRequests = null;
          lyricsConfig = null;
          renderLyrics([]);
          refreshCandidateMenu();
          refreshLockMenu();
        }
        toggleDialog(false);
      });
    }
    if (!deleteDialogGlobalSetup) {
      deleteDialogGlobalSetup = true;
      document.addEventListener('click', (ev) => {
        if (!ui.deleteDialog) return;
        if (!ui.deleteDialog.classList.contains('visible')) return;
        if (ui.deleteDialog.contains(ev.target) || trashBtn.contains(ev.target)) return;
        ui.deleteDialog.classList.remove('visible');
      }, true);
    }
  }

  function setupLangPills(groupId, currentValue, onChange) {
    const group = document.getElementById(groupId);
    if (!group) return;
    const pills = Array.from(group.querySelectorAll('.ytm-lang-pill'));
    const apply = () => {
      pills.forEach(p => {
        p.classList.toggle('active', p.dataset.value === currentValue);
      });
    };
    apply();
    pills.forEach(p => {
      p.onclick = (e) => {
        e.stopPropagation();
        currentValue = p.dataset.value;
        apply();
        onChange(currentValue);
      };
    });
  }

  async function initSettings() {
    if (ui.settings) return;
    ui.settings = createEl('div', 'ytm-settings-panel', '', ``);
    document.body.appendChild(ui.settings);

    await loadRemoteTextsFromGithub();
    if (!config.deepLKey) config.deepLKey = await storage.get('ytm_deepl_key');
    const cachedTrans = await storage.get('ytm_trans_enabled');
    if (cachedTrans !== null && cachedTrans !== undefined) config.useTrans = cachedTrans;
    // 高速モード設定の読み込み
    const cachedFast = await storage.get('ytm_fast_mode');
    if (cachedFast !== null && cachedFast !== undefined) config.fastMode = cachedFast;

    const cachedSharedTrans = await storage.get('ytm_shared_trans_enabled');
    if (cachedSharedTrans !== null && cachedSharedTrans !== undefined) config.useSharedTranslateApi = cachedSharedTrans;

    const mainLangStored = await storage.get('ytm_main_lang');
    if (mainLangStored) config.mainLang = mainLangStored;
    const subLangStored = await storage.get('ytm_sub_lang');
    if (subLangStored !== null) config.subLang = subLangStored;
    const uiLangStored = await storage.get('ytm_ui_lang');
    if (uiLangStored) config.uiLang = uiLangStored;

    const offsetStored = await storage.get('ytm_sync_offset');
    if (offsetStored !== null) config.syncOffset = offsetStored;
    const saveOffsetStored = await storage.get('ytm_save_sync_offset');
    if (saveOffsetStored !== null) config.saveSyncOffset = saveOffsetStored;

    // ★スライダー初期値反映
    const weightStored = await storage.get('ytm_lyric_weight');
    if (weightStored) config.lyricWeight = weightStored;
    const brightStored = await storage.get('ytm_bg_brightness');
    if (brightStored) config.bgBrightness = brightStored;

    renderSettingsPanel();

    if (!settingsOutsideClickSetup) {
      settingsOutsideClickSetup = true;
      document.addEventListener('click', (ev) => {
        if (!ui.settings) return;
        if (!ui.settings.classList.contains('active')) return;
        if (ui.settings.contains(ev.target)) return;
        if (ui.settingsBtn && ui.settingsBtn.contains(ev.target)) return;
        ui.settings.classList.remove('active');
      }, true);
    }
  }


    // ===== 共有翻訳: 残り文字数表示 =====
  const COMMUNITY_REMAINING_TTL_MS = 60 * 1000; // 60s
  let communityRemainingCache = { ts: 0, data: null, error: null };
  let communityRemainingTimer = null;

  // Fast Mode のときに共有翻訳を強制OFFにするための一時退避
  let sharedTransBeforeFast = null;

  function ensureCommunityRemainingTimer() {
    if (communityRemainingTimer) return;
    communityRemainingTimer = setInterval(() => {
      try {
        // 設定パネルが開いているときだけ更新（無駄な通信を減らす）
        if (ui.settings && ui.settings.classList.contains('active')) {
          updateCommunityRemainingUI(false);
        }
      } catch (_) { }
    }, 60 * 1000);
  }

  async function getCommunityRemaining(force = false) {
    const now = Date.now();
    if (!force && communityRemainingCache.data && (now - communityRemainingCache.ts) < COMMUNITY_REMAINING_TTL_MS) {
      return communityRemainingCache.data;
    }

    if (!EXT || !EXT.runtime || typeof EXT.runtime.sendMessage !== 'function') {
      throw new Error('extension runtime is not available');
    }

    const resp = await new Promise((resolve) => {
      try {
        EXT.runtime.sendMessage({ type: 'GET_COMMUNITY_REMAINING' }, (r) => resolve(r));
      } catch (e) {
        resolve(null);
      }
    });

    if (!resp || !resp.ok) {
      const msg = resp && resp.error ? resp.error : 'failed';
      communityRemainingCache = { ts: now, data: null, error: msg };
      throw new Error(msg);
    }

    const data = resp.data || resp.remaining || resp;
    communityRemainingCache = { ts: now, data, error: null };
    return data;
  }

  async function updateCommunityRemainingUI(force = false) {
    const valEl = document.getElementById('community-remaining-val');
        if (!valEl) return;

    // 初回だけ「取得中…」
    if (!valEl.textContent || valEl.textContent === '--') {
      valEl.textContent = '取得中…';
    }

    try {
      const data = await getCommunityRemaining(force);

      const remaining =
        (data && (data.total_remaining ?? data.totalRemaining ?? data.total_remaining_total ?? data.total ?? data.free_remaining_total)) ?? null;

      if (remaining != null && !Number.isNaN(Number(remaining))) {
        valEl.textContent = Number(remaining).toLocaleString();
      } else {
        valEl.textContent = '--';
      }

      // 生データは hover で見れるように
      try {
        valEl.title = JSON.stringify(data, null, 2);
      } catch (_) { }
    } catch (e) {
      valEl.textContent = '--';
      valEl.title = e && e.message ? e.message : String(e);
    }
  }

  function updateSharedTransAvailability() {
    const fastToggle = document.getElementById('fast-mode-toggle');
    const sharedToggle = document.getElementById('shared-trans-toggle');
    const row = document.getElementById('shared-trans-row');
    const note = document.getElementById('shared-trans-note');
    if (!fastToggle || !sharedToggle) return;

    const fastMode = !!fastToggle.checked;

    // note テキスト（翻訳キーが無い場合は日本語フォールバック）
    const disabledText = (typeof t === 'function' ? t('settings_shared_trans_disabled_fast') : '') ||
      "高速読み込みモードが有効な場合、API共有翻訳は使用できません。\\n高速読み込みモードでは翻訳結果の共有が行われないため、API使用量を節約する目的で無効化しています。ご了承ください。";

    if (fastMode) {
      if (sharedTransBeforeFast === null) sharedTransBeforeFast = !!sharedToggle.checked;

      sharedToggle.checked = false;
      sharedToggle.disabled = true;

      if (row) row.style.opacity = '0.55';
      if (note) {
        note.style.display = 'block';
        note.textContent = disabledText;
      }

      // 強制OFFを config / storage に反映
      config.useSharedTranslateApi = false;
      storage.set('ytm_shared_trans_enabled', false);
    } else {
      sharedToggle.disabled = false;
      if (row) row.style.opacity = '1';
      if (note) {
        note.style.display = 'none';
        note.textContent = '';
      }

      // 直前に Fast Mode で潰した分を復元（必要なら）
      if (sharedTransBeforeFast !== null) {
        sharedToggle.checked = !!sharedTransBeforeFast;
        config.useSharedTranslateApi = !!sharedTransBeforeFast;
        storage.set('ytm_shared_trans_enabled', config.useSharedTranslateApi);
        sharedTransBeforeFast = null;
      }
    }
  }

function renderSettingsPanel() {
    if (!ui.settings) return;

    // 現在の曲IDがあるか確認（キャッシュ削除ボタンの制御用）
    const hasCurrentSong = !!currentKey;

    // --- SVG Icons ---
    const ICONS = {
      visuals: `<svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5 11 5.67 11 6.5 10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5S18.33 12 17.5 12z"/></svg>`,
      trans: `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`,
      data: `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
      save: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>`,
      trash: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`
    };

    ui.settings.innerHTML = `
      <div class="settings-tabs">
        <div class="settings-tabs-header">Settings</div>
        <button class="settings-tab-btn active" data-tab="visuals">
          ${ICONS.visuals} Visuals
        </button>
        <button class="settings-tab-btn" data-tab="translation">
          ${ICONS.trans} Translation
        </button>
        <button class="settings-tab-btn" data-tab="data">
          ${ICONS.data} Data & Reset
        </button>
        
        <div style="margin-top: auto; padding-top: 20px;">
           <button id="save-settings-btn" class="settings-action-btn btn-primary" style="padding:14px; font-size:14px; border-radius:12px; box-shadow:0 4px 12px rgba(0, 122, 255, 0.3); display:flex; align-items:center; justify-content:center; gap:8px;">
             ${ICONS.save}
             ${t('settings_save')}
           </button>
        </div>
      </div>

      <div class="settings-panels">
        <div class="settings-panels-header">
          <h3>${t('settings_title')}</h3>
          <button id="ytm-settings-close-btn" title="Close">×</button>
        </div>
        
        <div class="settings-scroll-area">
          
          <div class="settings-panel active" id="panel-visuals">
            <div class="settings-section-title">Visual Customization</div>
            <div class="settings-group-card">
              <div class="setting-row" style="flex-direction:column; align-items:flex-start; gap:12px;">
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-size:13px; font-weight:500;">UI Language</span>
                  <div class="ytm-lang-group" id="ui-lang-group" style="background:transparent; padding:0;"></div>
                </div>
              </div>
              <div class="setting-row">
                <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span>${t('settings_left_align')}</span>
                  <input type="checkbox" id="left-align-toggle">
                </label>
              </div>
              <div class="setting-row">
                <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span>${t('settings_apple_bg') || 'Apple Music風の動的背景'}</span>
                  <input type="checkbox" id="apple-bg-toggle">
                </label>
              </div>
            </div>

            <div class="settings-group-card">
              <div class="setting-row" style="flex-direction:column; align-items:stretch;">
                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:500;">
                  <span>歌詞の太さ (Weight)</span>
                  <span id="weight-val" style="opacity:0.6;">${config.lyricWeight || 800}</span>
                </div>
                <input type="range" id="weight-slider" min="100" max="900" step="100" value="${config.lyricWeight || 800}">
              </div>
              <div class="setting-row" style="flex-direction:column; align-items:stretch;">
                 <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:500;">
                  <span>背景の明るさ (Brightness)</span>
                  <span id="bright-val" style="opacity:0.6;">${Math.round((config.bgBrightness || 0.35) * 100)}%</span>
                </div>
                <input type="range" id="bright-slider" min="0.1" max="1.0" step="0.05" value="${config.bgBrightness || 0.35}">
              </div>
            </div>
          </div>

          <div class="settings-panel" id="panel-translation">
            <div class="settings-section-title">Translation & Features</div>
            <div class="settings-group-card">
              <div class="setting-row">
                <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span>${t('settings_trans')}</span>
                  <input type="checkbox" id="trans-toggle">
                </label>
              </div>
              <div class="setting-row">
                <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span>${t('settings_fast_mode')}</span>
                  <input type="checkbox" id="fast-mode-toggle">
                </label>
              </div>
              <div class="setting-row" id="shared-trans-row" style="flex-direction:column; align-items:stretch; gap:10px;">
                <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span>${t('settings_shared_trans')}</span>
                  <input type="checkbox" id="shared-trans-toggle">
                </label>
                <div id="shared-trans-note" style="font-size:12px; opacity:0.7; line-height:1.4; display:none; white-space:pre-line; background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;"></div>
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
                  <span style="font-size:12px; opacity:0.8;">共有翻訳 残り文字数</span>
                  <span id="community-remaining-val" style="font-size:12px; opacity:0.7; font-weight:600; font-variant-numeric: tabular-nums;">--</span>
                </div>
              </div>
            </div>

            <div class="settings-group-card">
               <div class="setting-row" style="flex-direction:column; align-items:flex-start; gap:8px;">
                  <div class="ytm-lang-label">${t('settings_main_lang')}</div>
                  <div class="ytm-lang-group" id="main-lang-group">
                    <button class="ytm-lang-pill" data-value="original">Original</button>
                    <button class="ytm-lang-pill" data-value="ja">日本語</button>
                    <button class="ytm-lang-pill" data-value="en">English</button>
                    <button class="ytm-lang-pill" data-value="ko">한국어</button>
                  </div>
               </div>
               <div class="setting-row" style="flex-direction:column; align-items:flex-start; gap:8px;">
                  <div class="ytm-lang-label">${t('settings_sub_lang')}</div>
                  <div class="ytm-lang-group" id="sub-lang-group">
                    <button class="ytm-lang-pill" data-value="original">Original</button>
                    <button class="ytm-lang-pill" data-value="ja">日本語</button>
                    <button class="ytm-lang-pill" data-value="en">English</button>
                    <button class="ytm-lang-pill" data-value="ko">한국어</button>
                    <button class="ytm-lang-pill" data-value="zh">中文</button>
                  </div>
               </div>
               <div class="setting-row" style="display:block;">
                 <div style="font-size:12px; margin-bottom:8px; opacity:0.7; font-weight:500;">DeepL API Key (Optional)</div>
                 <input type="password" id="deepl-key-input" class="setting-input-text" placeholder="Paste your API key here">
               </div>
            </div>
            
            <div class="settings-group-card">
               <div class="setting-row" style="flex-direction:column; align-items:stretch; gap:12px;">
                  <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:13px; font-weight:500;">${t('settings_sync_offset')}</span>
                    <input type="number" id="sync-offset-input" placeholder="0" style="width:70px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:8px; padding:6px 8px; text-align:right; outline:none;">
                  </div>
                  <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:12px; opacity:0.7;">${t('settings_sync_offset_save')}</span>
                    <input type="checkbox" id="sync-offset-save-toggle">
                  </label>
              </div>
            </div>
          </div>

          <div class="settings-panel" id="panel-data">
            <div class="settings-section-title">Data Management</div>
            <div class="settings-group-card">
              <div class="setting-row" style="display:block;">
                <button id="delete-current-cache-btn" class="settings-action-btn btn-danger" ${hasCurrentSong ? '' : 'disabled style="opacity:0.5; cursor:not-allowed;"'} style="display:flex; align-items:center; justify-content:center; gap:8px;">
                  ${ICONS.trash} この曲の歌詞データを削除
                </button>
                <div style="font-size:11px; opacity:0.5; margin-top:8px; text-align:center;">
                  現在再生中の曲の歌詞キャッシュのみを削除します
                </div>
              </div>
              <div class="setting-row" style="display:block;">
                 <button id="clear-all-btn" class="settings-action-btn" style="background:rgba(255,255,255,0.1); color:#fff;">
                   設定をリセット (Reset All)
                 </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
    // --- Tab Switching Logic ---
    const tabs = ui.settings.querySelectorAll('.settings-tab-btn');
    const panels = ui.settings.querySelectorAll('.settings-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        
        tab.classList.add('active');
        const tabId = tab.getAttribute('data-tab');
        ui.settings.querySelector(`#panel-${tabId}`).classList.add('active');
      });
    });
    
    
        // 値の反映
    document.getElementById('deepl-key-input').value = config.deepLKey || '';
    document.getElementById('trans-toggle').checked = config.useTrans;
    document.getElementById('fast-mode-toggle').checked = !!config.fastMode;
    document.getElementById('shared-trans-toggle').checked = !!config.useSharedTranslateApi;
    document.getElementById('left-align-toggle').checked = !!config.leftAlignInfo;
    document.getElementById('apple-bg-toggle').checked = !!config.appleBg;
    // Fast Mode のときは共有翻訳を強制OFF（トグルは表示したまま無効化）
    const fastToggleEl = document.getElementById('fast-mode-toggle');
    if (fastToggleEl) {
      fastToggleEl.addEventListener('change', () => {
        updateSharedTransAvailability();
      });
    }
    updateSharedTransAvailability();

    // 共有翻訳の残り文字数（保存済み値を表示）
    updateCommunityRemainingUI(true);
    ensureCommunityRemainingTimer();
    document.getElementById('sync-offset-input').valueAsNumber = config.syncOffset || 0;
    document.getElementById('sync-offset-save-toggle').checked = config.saveSyncOffset;

    // スライダーイベント設定
    const wSlider = document.getElementById('weight-slider');
    const bSlider = document.getElementById('bright-slider');
    if (wSlider) {
      wSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('weight-val').textContent = val;
        config.lyricWeight = val;
        document.documentElement.style.setProperty('--ytm-lyric-weight', val);
      });
    }
    if (bSlider) {
      bSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('bright-val').textContent = Math.round(val * 100) + '%';
        document.documentElement.style.setProperty('--ytm-bg-brightness', val);
      });
    }

    // 言語ピル設定
    setupLangPills('main-lang-group', config.mainLang, v => { config.mainLang = v; });
    setupLangPills('sub-lang-group', config.subLang, v => { config.subLang = v; });
    refreshUiLangGroup();

    // 閉じるボタン
    const closeBtn = document.getElementById('ytm-settings-close-btn');
    if (closeBtn) {
      closeBtn.onclick = (ev) => {
        ev.stopPropagation();
        ui.settings.classList.remove('active');
      };
    }

    // 保存ボタンの処理
    document.getElementById('save-settings-btn').onclick = async () => {
      const savedMainLang = await storage.get('ytm_main_lang');
      const savedSubLang = await storage.get('ytm_sub_lang');
      const savedUseTrans = await storage.get('ytm_trans_enabled');
      const savedSharedTrans = await storage.get('ytm_shared_trans_enabled');
      const savedUiLang = await storage.get('ytm_ui_lang');

      const prevMainLang = savedMainLang || 'original';
      const prevSubLang = savedSubLang !== null ? savedSubLang : 'en';
      const prevUseTrans = savedUseTrans !== null ? savedUseTrans : true;
      const prevUseSharedTrans = savedSharedTrans !== null ? savedSharedTrans : false;
      const prevUiLang = savedUiLang || (config.uiLang || 'ja');

      // 画面から値を取得
      config.deepLKey = document.getElementById('deepl-key-input').value.trim();
      config.useTrans = document.getElementById('trans-toggle').checked;
      config.useSharedTranslateApi = document.getElementById('shared-trans-toggle').checked;
      config.fastMode = document.getElementById('fast-mode-toggle').checked;
      config.leftAlignInfo = document.getElementById('left-align-toggle').checked;
      config.appleBg = document.getElementById('apple-bg-toggle').checked;
      config.lyricWeight = document.getElementById('weight-slider').value;
      config.bgBrightness = document.getElementById('bright-slider').value;
      
      const offsetVal = document.getElementById('sync-offset-input').valueAsNumber;
      config.syncOffset = isNaN(offsetVal) ? 0 : offsetVal;
      config.saveSyncOffset = document.getElementById('sync-offset-save-toggle').checked;

      // ストレージに保存
      storage.set('ytm_deepl_key', config.deepLKey);
      storage.set('ytm_trans_enabled', config.useTrans);
      storage.set('ytm_shared_trans_enabled', config.useSharedTranslateApi);
      storage.set('ytm_fast_mode', config.fastMode);
      storage.set('ytm_left_align', config.leftAlignInfo);
      document.body.classList.toggle('ytm-align-left', !!config.leftAlignInfo);
      
      storage.set('ytm_apple_bg', config.appleBg);
      document.body.classList.toggle('ytm-apple-bg', !!config.appleBg);
      storage.set('ytm_main_lang', config.mainLang);
      storage.set('ytm_sub_lang', config.subLang);
      storage.set('ytm_ui_lang', config.uiLang);
      storage.set('ytm_lyric_weight', config.lyricWeight);
      storage.set('ytm_bg_brightness', config.bgBrightness);
      storage.set('ytm_sync_offset', config.syncOffset);
      storage.set('ytm_save_sync_offset', config.saveSyncOffset);

      const needReload = (
        prevMainLang !== config.mainLang ||
        prevSubLang !== config.subLang ||
        prevUseTrans !== config.useTrans ||
        prevUseSharedTrans !== config.useSharedTranslateApi ||
        prevUiLang !== config.uiLang
      );

      if (needReload) {
        alert(t('settings_saved'));
        location.reload();
      } else {
        showToast(t('settings_saved'));
        ui.settings.classList.remove('active');
      }
    };

    // リセットボタン
    document.getElementById('clear-all-btn').onclick = storage.clear;

    // キャッシュ削除ボタンの処理
    const delBtn = document.getElementById('delete-current-cache-btn');
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!currentKey) return;
        if (confirm('現在の曲の歌詞キャッシュを削除しますか？\n（歌詞データ、同期情報などがリセットされます）')) {
          await storage.remove(currentKey);
          
          lyricsData = [];
          dynamicLines = null;
          duetSubDynamicLines = null;
          _duetExcludedTimes = new Set();
          lyricsCandidates = null;
          selectedCandidateId = null;
          lyricsRequests = null;
          lyricsConfig = null;
          
          renderLyrics([]);
          refreshCandidateMenu();
          refreshLockMenu();
          
          showToast('歌詞キャッシュを削除しました');
        }
      };
    }
  }

  function createReplayPanel() {
    ui.replayPanel = createEl('div', 'ytm-replay-panel', '', `
      <button class="replay-close-btn">×</button>
      <h3>Daily Replay</h3>
      
      <div class="ytm-lang-group" style="margin-bottom: 20px;">
        <button class="ytm-lang-pill active" data-range="day">${t('replay_today')}</button>
        <button class="ytm-lang-pill" data-range="week">${t('replay_week')}</button>
        <button class="ytm-lang-pill" data-range="all">${t('replay_all')}</button>
      </div>

      <div class="ytm-replay-content">
        <div class="lyric-loading">Calculating...</div>
      </div>

      <button id="replay-reset-action" class="replay-footer-btn">${t('settings_reset')} History</button>
    `);

    document.body.appendChild(ui.replayPanel);

    ui.replayPanel.querySelector('.replay-close-btn').onclick = () => {
      ui.replayPanel.classList.remove('active');
    };

    const pills = ui.replayPanel.querySelectorAll('.ytm-lang-pill');
    pills.forEach(p => {
      p.onclick = (e) => {
        pills.forEach(x => x.classList.remove('active'));
        e.target.classList.add('active');
        ui.replayPanel.dataset.range = e.target.dataset.range;
        ReplayManager.renderUI();
      };
    });

    document.getElementById('replay-reset-action').onclick = async () => {
      if (confirm(t('replay_reset_confirm'))) {
        await storage.remove(ReplayManager.HISTORY_KEY);
        ReplayManager.renderUI();
      }
    };
  }

  // ===================== Artist Seamless Switch =====================
  const SWITCH_NOISE_KEYWORDS = [
    '歌ってみた', '弾いてみた', '弾いてみたけど', '踊ってみた', '叩いてみた',
    '歌われてみた', '演奏してみた', '演奏動画',
    'cover', 'covered', 'karaoke', 'カラオケ',
    'acoustic', 'live', 'remix', 'piano',
    'arrange', 'off vocal', 'instrumental', 'full chorus', 'short ver'
  ];

  function _switchQueryForMeta(meta) {
    // Search title only — not title+artist, so we get all versions
    return (meta?.title || '').trim();
  }

  function _filterSwitchResults(items, meta) {
    const titleLower = (meta?.title || '').toLowerCase();
    return items.filter(item => {
      const t = (item.title || '').toLowerCase();
      const ch = (item.channel || '').toLowerCase();
      // Keep items whose title shares words with the song title (looser check)
      const titleWords = titleLower.split(/\s+/).filter(w => w.length > 1);
      const hasTitle = titleWords.some(w => t.includes(w));
      if (!hasTitle) return false;
      // Exclude noise keywords
      for (const kw of SWITCH_NOISE_KEYWORDS) {
        if (t.includes(kw) || ch.includes(kw)) return false;
      }
      return true;
    });
  }

  async function searchYTMAlternatives(meta) {
    const q = _switchQueryForMeta(meta);
    if (!q) return [];
    // Use YouTube Music's InnerTube API — same endpoint the web app itself uses
    try {
      const resp = await fetch('https://music.youtube.com/youtubei/v1/search?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '67', 'X-YouTube-Client-Version': '1.20240101.01.00' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'ja',
              gl: 'JP',
            }
          },
          query: q
          // No params = search all types (songs, videos, albums, etc.)
        })
      });
      if (!resp.ok) { console.warn('[Switch] InnerTube API error:', resp.status); return []; }
      const data = await resp.json();

      const results = [];
      const walk = (obj, depth = 0) => {
        if (!obj || typeof obj !== 'object' || depth > 30) return;
        if (obj.musicResponsiveListItemRenderer) {
          const r = obj.musicResponsiveListItemRenderer;
          const videoId =
            r.playlistItemData?.videoId ||
            r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
            r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.find(x => x.navigationEndpoint?.watchEndpoint)?.navigationEndpoint?.watchEndpoint?.videoId;
          const title    = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
          const subtitle = (r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map(x => x.text).join('');
          const thumbs   = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          const thumb    = thumbs.length ? thumbs[thumbs.length - 1].url : '';
          if (videoId && title) results.push({ videoId, title, channel: subtitle, thumb });
          return; // don't descend into an item we already parsed
        }
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (Array.isArray(val)) val.forEach(v => walk(v, depth + 1));
          else if (val && typeof val === 'object') walk(val, depth + 1);
        }
      };
      walk(data);
      const seen = new Set();
      return results.filter(r => { if (seen.has(r.videoId)) return false; seen.add(r.videoId); return true; });
    } catch (e) {
      console.error('[Switch] Search failed:', e);
      return [];
    }
  }


  function setupSwitchPanel(triggerBtn) {
    // Toggle: close if already open
    const existing = document.getElementById('ytm-switch-panel');
    if (existing) { existing.remove(); return; }

    const meta = getMetadata();
    if (!meta || !meta.title) { showToast('曲名情報を取得できませんでした'); return; }

    const panel = document.createElement('div');
    panel.id = 'ytm-switch-panel';
    panel.className = 'ytm-switch-panel';
    panel.innerHTML = `
      <div class="ytm-switch-header">
        <span>🔄 代替バージョンを検索: ${escHtml(meta.title)}</span>
        <button class="ytm-switch-close" id="ytm-switch-close">✕</button>
      </div>
      <div class="ytm-switch-list" id="ytm-switch-list">
        <div class="ytm-switch-loading">検索中…</div>
      </div>
    `;
    document.body.appendChild(panel);

    // Position panel ABOVE the trigger button
    if (triggerBtn) {
      const rect = triggerBtn.getBoundingClientRect();
      const panelWidth = 360;
      const isMoviemode = triggerBtn.classList.contains("moviemode");
      let left = rect.left + rect.width / 2 - panelWidth / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
      panel.style.position = 'fixed';
      panel.style.left = `${left}px`;
      panel.style.bottom = isMoviemode ?  'auto' : `${(window.innerHeight - rect.top + 10)}px`;
      panel.style.top = isMoviemode ? `${rect.top - 10 + 65}px` : 'auto';// 65pxはちょうどいい高さオフセット
      panel.style.right = 'auto';
    }

    document.getElementById('ytm-switch-close').onclick = () => panel.remove();
    setTimeout(() => {
      document.addEventListener('click', function outsideClick(ev) {
        if (!panel.contains(ev.target) && !ev.target.closest('#ytm-switch-btn')) {
          panel.remove();
          document.removeEventListener('click', outsideClick, true);
        }
      }, true);
    }, 100);

    searchYTMAlternatives(meta).then(rawResults => {
      const results = _filterSwitchResults(rawResults, meta);
      const listEl = document.getElementById('ytm-switch-list');
      if (!listEl) return;

      if (!results.length) {
        // Show all unfiltered results if filter removed everything
        const fallback = rawResults.slice(0, 10);
        if (!fallback.length) {
          listEl.innerHTML = '<div class="ytm-switch-loading">候補が見つかりませんでした</div>';
          return;
        }
        listEl.innerHTML = '<div class="ytm-switch-loading" style="font-size:10px;opacity:0.6;padding:6px 10px">フィルターを緩めて表示しています</div>';
        renderSwitchItems(listEl, fallback, false);
        return;
      }
      listEl.innerHTML = '';
      renderSwitchItems(listEl, results, true);
    });
  }

  function renderSwitchItems(listEl, items, clearFirst) {
    if (clearFirst) listEl.innerHTML = '';
    const video = document.querySelector('video');
    const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;

    items.forEach(item => {
      const row = document.createElement('button');
      row.className = 'ytm-switch-item';
      row.innerHTML = `
        ${item.thumb ? `<img class="ytm-switch-thumb" src="${escHtml(item.thumb)}" alt="">` : '<div class="ytm-switch-thumb"></div>'}
        <div class="ytm-switch-info">
          <div class="ytm-switch-title">${escHtml(item.title)}</div>
          <div class="ytm-switch-channel">${escHtml(item.channel)}</div>
        </div>
      `;
      row.onclick = () => {
        document.getElementById('ytm-switch-panel')?.remove();
        const t = Math.floor(currentTime);
        const url = `https://music.youtube.com/watch?v=${item.videoId}&t=${t}s`;
        location.href = url;
      };
      listEl.appendChild(row);
    });
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

    const btns = [];
    const lyricsBtnConfig = { txt: 'Lyrics', cls: 'lyrics-btn', click: () => { } };
    const shareBtnConfig = { txt: 'Share', cls: 'share-btn', click: onShareButtonClick };

    //  PiPボタン
    const pipBtnConfig = {
      txt: 'PIP',
      cls: 'icon-btn',
      click: () => PipManager.toggle()
    };

    const replayBtnConfig = {
      txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/></svg>',
      cls: 'icon-btn',
      click: () => {
        if (!ui.replayPanel) {
          createReplayPanel();
        }
        ui.replayPanel.classList.add('active');
        ReplayManager.renderUI();
      }
    };

    
    const settingsBtnConfig = {
      txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .43-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.49-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
      cls: 'icon-btn',
      click: async () => {
        initSettings();
        await loadRemoteTextsFromGithub();
        refreshUiLangGroup();
        ui.settings.classList.toggle('active');
      }
    };

    const switchBtnConfig = {
      txt: '',
      cls: 'icon-btn ytm-switch-icon-btn',
      click: (ev) => setupSwitchPanel(ev.currentTarget)
    };

    // ボタン配列に追加
    btns.push(lyricsBtnConfig, shareBtnConfig, pipBtnConfig, replayBtnConfig, switchBtnConfig, settingsBtnConfig);

    btns.forEach(b => {
      const btn = createEl('button', '', `ytm-glass-btn ${b.cls || ''}`, b.txt);
      btn.onclick = b.click;
      ui.btnArea.appendChild(btn);
      if (b === lyricsBtnConfig) {
        ui.lyricsBtn = btn;
        setupUploadMenu(btn);
      }
      if (b === shareBtnConfig) {
        ui.shareBtn = btn;
      }
      if (b === switchBtnConfig) {
        btn.id = 'ytm-switch-btn';
        // Use the custom icon image
        try {
          const iconUrl = chrome.runtime.getURL('src/assets/icons/ArtistChange.png');
          btn.innerHTML = `<img src="${iconUrl}" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;" alt="ArtistChange">`;
        } catch(_) { btn.textContent = '🔄'; }
      }
      if (b === settingsBtnConfig) ui.settingsBtn = btn;
    });

    ui.input = createEl('input');
    ui.input.type = 'file';
    ui.input.accept = '.lrc,.txt';
    ui.input.style.display = 'none';
    ui.input.onchange = handleUpload;
    document.body.appendChild(ui.input);
    info.append(ui.title, ui.artist, ui.btnArea);
    leftCol.append(ui.artwork, info);
    ui.lyrics = createEl('div', 'my-lyrics-container');
    ui.wrapper.append(leftCol, ui.lyrics);
    document.body.appendChild(ui.wrapper);
    setupAutoHideEvents();
    if(isYTMPremiumUser()) setupMovieMode(); //moviemode setup
  }

  async function loadLyrics(meta) {
    if (!config.deepLKey) config.deepLKey = await storage.get('ytm_deepl_key');
    const cachedTrans = await storage.get('ytm_trans_enabled');
    if (cachedTrans !== null && cachedTrans !== undefined) config.useTrans = cachedTrans;

    const cachedSharedTrans = await storage.get('ytm_shared_trans_enabled');
    if (cachedSharedTrans !== null && cachedSharedTrans !== undefined) config.useSharedTranslateApi = cachedSharedTrans;
    const mainLangStored = await storage.get('ytm_main_lang');
    const subLangStored = await storage.get('ytm_sub_lang');
    if (mainLangStored) config.mainLang = mainLangStored;
    if (subLangStored !== null && subLangStored !== undefined) config.subLang = subLangStored;
    const uiLangStored = await storage.get('ytm_ui_lang');
    if (uiLangStored) config.uiLang = uiLangStored;

    const thisKey = `${meta.title}///${meta.artist}`;
    if (thisKey !== currentKey) return;
    let cached = await storage.get(thisKey);
    isFallbackLyrics = false;
    dynamicLines = null;
    duetSubDynamicLines = null;
    _duetExcludedTimes = new Set();
    duetSubLyricsRaw = '';
    lyricsCandidates = null;
    selectedCandidateId = null;
    lyricsRequests = null;
    lyricsConfig = null;
    let data = null;
    let noLyricsCached = false;
    if (cached !== null && cached !== undefined) {
      if (cached === NO_LYRICS_SENTINEL) {
        noLyricsCached = true;
      } else if (typeof cached === 'string') {
        data = cached;
      } else if (typeof cached === 'object') {
        if (typeof cached.lyrics === 'string') data = cached.lyrics;
        if (Array.isArray(cached.dynamicLines)) dynamicLines = cached.dynamicLines;
        if (typeof cached.subLyrics === 'string') duetSubLyricsRaw = cached.subLyrics;
        if (cached.noLyrics) noLyricsCached = true;
        if (cached.githubFallback) isFallbackLyrics = true;
        if (Array.isArray(cached.candidates)) lyricsCandidates = cached.candidates;
        if (Array.isArray(cached.requests)) lyricsRequests = cached.requests;
        if (cached.config) lyricsConfig = cached.config;
      }
    }
    refreshCandidateMenu();
    refreshLockMenu();
    if (!data && noLyricsCached) {
      if (thisKey !== currentKey) return;
      renderLyrics([]);
      return;
    }
    if (!data && !noLyricsCached) {
      let gotLyrics = false;

      if (config.fastMode) {
        console.log('🚀 Fast Mode: Fetching from GitHub for', meta.title);

        const video_id_fast = getCurrentVideoId();
        if (video_id_fast) {
          const GH_BASE = `https://raw.githubusercontent.com/LRCHub/${video_id_fast}/main`;


                  const __cacheBusterFast = (1000 + Math.floor(Math.random() * 9000));


// --- GitHub raw のブラウザキャッシュ対策: 毎回URLを変えて最新を取りに行く ---
const withRandomCacheBusterFast = (url) => {
  const v = String(__cacheBusterFast);
  try {
    const u = new URL(url);
    u.searchParams.set('v', v);
    return u.toString();
  } catch (e) {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'v=' + v;
  }
};

          const safeFetchText = async (url) => {
            try {
              const r = await fetch(withRandomCacheBusterFast(url), { cache: 'no-store' });
              if (!r.ok) return '';
              return (await r.text()) || '';
            } catch (e) {
              return '';
            }
          };

          // duet: try to fetch sub.txt (optional)
          const subTextFast = await safeFetchText(`${GH_BASE}/sub.txt`);
          if (subTextFast && subTextFast.trim()) duetSubLyricsRaw = subTextFast;

          const safeFetchJson = async (url) => {
            try {
              const r = await fetch(withRandomCacheBusterFast(url), { cache: 'no-store' });
              if (!r.ok) return null;
              return await r.json();
            } catch (e) {
              return null;
            }
          };

          const extractLyricsFromReadme = (text) => {
            if (!text) return '';
            // README に ``` が入っている場合は、最初のコードブロックだけを優先
            const m = text.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/);
            let body = m ? m[1] : text;

            return body
              .split('\n')
              .filter(line => !line.trim().startsWith('#'))
              .filter(line => !line.trim().startsWith('>'))
              .filter(line => !line.trim().startsWith('```'))
              .filter(line => !line.includes('歌詞登録ステータス'))
              .join('\n')
              .trim();
          };

          const normalizeDynamicLines = (json) => {
            if (!json) return null;
            if (Array.isArray(json.lines)) return json.lines;
            if (json.dynamic_lyrics && Array.isArray(json.dynamic_lyrics.lines)) return json.dynamic_lyrics.lines;
            if (json.response && json.response.dynamic_lyrics && Array.isArray(json.response.dynamic_lyrics.lines)) return json.response.dynamic_lyrics.lines;
            return null;
          };

          const formatLrcTimeLocal = (sec) => {
            sec = Math.max(0, Number(sec) || 0);
            const m = Math.floor(sec / 60);
            const s = sec - (m * 60);
            const ss = Math.floor(s);
            const xx = Math.floor((s - ss) * 100);
            return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xx).padStart(2, '0')}`;
          };

          const buildLrcFromDynamic = (lines) => {
            if (!Array.isArray(lines) || !lines.length) return '';
            const out = [];
            for (const line of lines) {
              let ms = null;

              if (typeof line.startTimeMs === 'number') {
                ms = line.startTimeMs;
              } else if (typeof line.startTimeMs === 'string') {
                const n = Number(line.startTimeMs);
                if (!Number.isNaN(n)) ms = n;
              } else if (Array.isArray(line.chars) && line.chars.length) {
                const ts = line.chars
                  .map(c => (typeof c.t === 'number' ? c.t : null))
                  .filter(v => v != null);
                if (ts.length) ms = Math.min(...ts);
              }

              if (ms == null) continue;

              let textLine = '';
              if (typeof line.text === 'string' && line.text.length) {
                textLine = line.text;
              } else if (Array.isArray(line.chars)) {
                textLine = line.chars.map(c => c.c || c.text || c.caption || '').join('');
              }

              // Keep original spaces (do not auto-trim)
              textLine = String(textLine ?? '');
              const tag = `[${formatLrcTimeLocal(ms / 1000)}]`;
              out.push(textLine ? `${tag} ${textLine}` : tag);
            }
            return out.join('\n').trimEnd();
          };

          try {
            const parseLrcTimeToMsLocal = (ts) => {
              const s = String(ts || '').trim();
              const mm = s.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
              if (!mm) return null;
              const m = parseInt(mm[1], 10);
              const sec = parseInt(mm[2], 10);
              let frac = mm[3] || '0';
              if (frac.length === 1) frac = frac + '00';
              else if (frac.length === 2) frac = frac + '0';
              const ms = parseInt(frac.slice(0, 3), 10);
              if (!Number.isFinite(m) || !Number.isFinite(sec) || !Number.isFinite(ms)) return null;
              return (m * 60 + sec) * 1000 + ms;
            };

            const parseDynamicLrcLocal = (text) => {
              const out = [];
              if (!text) return out;

              const rows = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

              // 1st pass: parse lines so we can use the next line timestamp as an end bound
              const parsed = [];
              for (const raw of rows) {
                const line = raw.trimEnd();
                if (!line) continue;

                const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
                if (!m) continue;

                parsed.push({
                  lineMs: parseLrcTimeToMsLocal(m[1]),
                  rest: m[2] || '',
                });
              }

              const pushDistributed = (chars, chunk, startMs, endMs) => {
                if (!chunk) return;
                const arr = Array.from(chunk);
                const n = arr.length;
                if (!n) return;

                const s = (typeof startMs === 'number') ? startMs : null;
                const e = (typeof endMs === 'number') ? endMs : null;

                if (s == null) {
                  for (const ch of arr) chars.push({ t: 0, c: ch });
                  return;
                }

                // no duration: show immediately at s
                if (e == null || e <= s) {
                  for (const ch of arr) chars.push({ t: s, c: ch });
                  return;
                }

                const dur = Math.max(1, e - s);
                const step = dur / n;

                for (let i = 0; i < n; i++) {
                  const t = s + Math.floor(step * i);
                  chars.push({ t, c: arr[i] });
                }
              };

              for (let li = 0; li < parsed.length; li++) {
                const { lineMs, rest } = parsed[li];
                const nextLineMs = (li + 1 < parsed.length && typeof parsed[li + 1].lineMs === 'number')
                  ? parsed[li + 1].lineMs
                  : null;

                const chars = [];
                const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;

                let prevMs = null;
                let prevEnd = 0;

                while (true) {
                  const mm = tagRe.exec(rest);
                  if (!mm) break;

                  const tagMs = parseLrcTimeToMsLocal(mm[1]);

                  // chunk before the 1st tag (often a leading space)
                  if (prevMs == null && tagMs != null && mm.index > prevEnd) {
                    const chunk0 = rest.slice(prevEnd, mm.index);
                    pushDistributed(chars, chunk0, tagMs, tagMs);
                  }

                  if (prevMs != null) {
                    const chunk = rest.slice(prevEnd, mm.index);
                    pushDistributed(chars, chunk, prevMs, tagMs);
                  }

                  prevMs = tagMs;
                  prevEnd = mm.index + mm[0].length;
                }

                if (prevMs != null) {
                  const chunk = rest.slice(prevEnd);

                  // For the tail, spread chars until the next line begins (or a fallback window)
                  let endMs = nextLineMs;
                  if (typeof endMs !== 'number') endMs = prevMs + 1500;
                  if (endMs <= prevMs) endMs = prevMs + 200;

                  pushDistributed(chars, chunk, prevMs, endMs);
                }

                const textLine = chars.map(c => c.c).join('');

                out.push({
                  startTimeMs: (typeof lineMs === 'number' ? lineMs : (chars.length ? chars[0].t : 0)),
                  text: textLine,
                  chars,
                });
              }

              return out;
            };

            const dynText = await safeFetchText(`${GH_BASE}/Dynamic.lrc`);
            const dynLines = parseDynamicLrcLocal(dynText);

            if (dynLines && dynLines.length) {
              const built = buildLrcFromDynamic(dynLines);
              if (built) {
                dynamicLines = dynLines;
                await applyLyricsText(built);

                if (thisKey === currentKey) {
                  storage.set(thisKey, {
                    lyrics: built,
                    dynamicLines: dynLines,
                    noLyrics: false,
                    githubFallback: true,
                    subLyrics: (typeof duetSubLyricsRaw === 'string' ? duetSubLyricsRaw : '')
                  });
                }
                return;
              }
            }


            const readme = await safeFetchText(`${GH_BASE}/README.md`);
            const lyricsText = extractLyricsFromReadme(readme);

            if (lyricsText) {
              await applyLyricsText(lyricsText);

              if (thisKey === currentKey) {
                storage.set(thisKey, {
                  lyrics: lyricsText,
                  dynamicLines: null,
                  noLyrics: false,
                  githubFallback: true,
                  subLyrics: (typeof duetSubLyricsRaw === 'string' ? duetSubLyricsRaw : '')
                });
              }
              return;
            }
          } catch (e) {
            console.error('Fast mode GitHub error:', e);
          }
        }
      }

      try {
        const track = meta.title.replace(/\s*[\(-\[].*?[\)-]].*/, '');
        const artist = meta.artist;
        const youtube_url = getCurrentVideoUrl();
        const video_id = getCurrentVideoId();
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage(
            { type: 'GET_LYRICS', payload: { track, artist, youtube_url, video_id } },
            resolve
          );
        });
        console.log('[CS] GET_LYRICS response:', res);
        lyricsRequests = Array.isArray(res?.requests) ? res.requests : null;
        lyricsConfig = res?.config || null;
        lyricsCandidates = Array.isArray(res?.candidates) ? res.candidates : null;
        refreshCandidateMenu();
        refreshLockMenu();
        isFallbackLyrics = !!res?.githubFallback;
        if (typeof res?.subLyrics === 'string' && res.subLyrics.trim()) duetSubLyricsRaw = res.subLyrics;

        if (res?.success && typeof res.lyrics === 'string' && res.lyrics.trim()) {
          data = res.lyrics;
          gotLyrics = true;
          if (Array.isArray(res.dynamicLines) && res.dynamicLines.length) dynamicLines = res.dynamicLines;
          if (thisKey === currentKey) {
            storage.set(thisKey, {
              lyrics: data,
              dynamicLines: dynamicLines || null,
              noLyrics: false,
              githubFallback: isFallbackLyrics,
              subLyrics: (typeof duetSubLyricsRaw === 'string' ? duetSubLyricsRaw : ''),
              candidates: lyricsCandidates || null,
              requests: lyricsRequests || null,
              config: lyricsConfig || null
            });
          }
        } else {

        }
      } catch (e) {
        console.error('GET_LYRICS failed', e);
      }
      if (!gotLyrics && thisKey === currentKey) {
        storage.set(thisKey, NO_LYRICS_SENTINEL);
        noLyricsCached = true;
      }
    }
    if (thisKey !== currentKey) return;
    if (!data) {
      renderLyrics([]);
      refreshCandidateMenu();
      refreshLockMenu();
      return;
    }
    await applyLyricsText(data);
  }

const optimizeLineBreaks = (text) => {
    if (!text) return '';

    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    const segments = Array.from(segmenter.segment(text));

    let html = '';
    let buffer = '';

    const rules = {
      suffixes: new Set([
        'て', 'に', 'を', 'は', 'が', 'の', 'へ', 'と', 'も', 'で', 'や', 'し', 'から', 'より', 'だけ', 'まで', 'こそ', 'さえ', 'でも', 'など', 'なら', 'くらい', 'ぐらい', 'ばかり',
        'ね', 'よ', 'な', 'さ', 'わ', 'ぞ', 'ぜ', 'かしら', 'かな', 'かも', 'だし', 'もん', 'もの',
        'って', 'けど', 'けれど', 'のに', 'ので', 'から', 'ため', 'よう', 'こと', 'もの', 'わけ', 'ほう', 'ところ', 'とおり',
        'た', 'だ', 'ない', 'たい', 'ます', 'ません', 'う', 'よう', 'れる', 'られる', 'せる', 'させる', 'ん', 'ず',
        'てた', 'てる', 'ちゃう', 'じゃん', 'なきゃ', 'なくちゃ', 'く', 'き', 'けれ', 'れば',
        'った', 'たら', 'たり',
        'か', 'かい', 'だい', 'いる', 'ある', 'くる', 'いく', 'みる', 'おく', 'しまう', 'ほしい', 'あげる', 'くれる', 'もらう',
        '、', '。', '，', '．', '…', '・', '！', '？', '!', '?', '~', '～', '“', '”', '‘', '’', ')', ']', '}', '」', '』', '】', '）'
      ]),

      isEnglish: (w) => /^[a-zA-Z0-9'\-\.,!?:;]+$/.test(w),
      isSpace: (w) => /^\s+$/.test(w),
      isOpenParen: (w) => /^[\(\[\{「『（【]$/.test(w),
      hasKanji: (w) => /[\u4E00-\u9FFF]/.test(w),
      isHiragana: (w) => /^[\u3040-\u309F\u30FC]+$/.test(w),
      isKatakana: (w) => /^[\u30A0-\u30FF\u30FC]+$/.test(w),
      startsWithSmallKana: (w) => /^[\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308E\u3095\u3096]/.test(w)
    };

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const word = seg.segment;
      const next = segments[i + 1];

      buffer += word;

      if (!next) {
        html += `<span class="lyric-phrase">${buffer}</span>`;
        break;
      }

      const nextWord = next.segment;
      let shouldMerge = false;

      if (rules.startsWithSmallKana(nextWord)) {
        shouldMerge = true;
      }
      else if (rules.suffixes.has(nextWord)) {
         if (!rules.isOpenParen(nextWord)) {
           shouldMerge = true;
         }
      }

      else if (rules.hasKanji(word) && rules.isHiragana(nextWord)) {
        shouldMerge = true;
      }
      else if (rules.isKatakana(word) && rules.isKatakana(nextWord)) {
        shouldMerge = true;
      }
      else if ((rules.isEnglish(word) || rules.isSpace(word)) && 
               (rules.isEnglish(nextWord) || rules.isSpace(nextWord))) {
        shouldMerge = true;
      }

      if (shouldMerge) {
        continue;
      }

      html += `<span class="lyric-phrase">${buffer}</span>`;
      buffer = '';
    }

    return html;
  };    
  function renderLyrics(data) {
    if (!ui.lyrics) return;
    ui.lyrics.innerHTML = '';
    ui.lyrics.scrollTop = 0;
    const hasData = Array.isArray(data) && data.length > 0;
    document.body.classList.toggle('ytm-no-lyrics', !hasData);
    document.body.classList.toggle('ytm-has-timestamp', hasTimestamp);
    document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);

    const fragment = document.createDocumentFragment();

    data.forEach((line, index) => {
      const row = createEl('div', '', 'lyric-line');

      if (line && line.duetSide === 'right') {
        row.classList.add('sub-vocal');
      } else if (line && line.duetSide === 'left') {
        row.classList.add('main-vocal');
      }

      if (typeof line.time === 'number') {
        row.dataset.startTime = String(line.time);
      }

      const mainSpan = createEl('span', '', 'lyric-main');

      // dynamic lyrics highlighting
      let dyn = null;
      
      // サブボーカル(right)にはduetSubDynamicLinesを使用、メインにはdynamicLinesを使用
      if (line && line.duetSide === 'right') {
        // サブボーカル用のdynamic lines
        if (duetSubDynamicLines && Array.isArray(duetSubDynamicLines) && duetSubDynamicLines.length) {
          if (typeof line.time === 'number') {
             dyn = getSubDynamicLineForTime(line.time);
          }
        }
      } else {
        // メインボーカル用のdynamic lines
        if (dynamicLines && Array.isArray(dynamicLines) && dynamicLines.length) {
          if (typeof line.time === 'number') {
             // 時間で検索
             dyn = getDynamicLineForTime(line.time);
          } else {
             // デュエットモード以外のみインデックスフォールバックを使用
             const isDuetMode = document.body.classList.contains('ytm-duet-mode');
             if (!isDuetMode) {
                dyn = dynamicLines[index];
             }
          }
        }
      }
      
      if (dyn && Array.isArray(dyn.chars) && dyn.chars.length) {
        dyn.chars.forEach((ch, ci) => {
          const chSpan = createEl('span', '', 'lyric-char');
          // Preserve spaces
          const cc = (ch.c === '\t') ? ' ' : ch.c;
          chSpan.textContent = (cc === ' ') ? '\u00A0' : cc;
          chSpan.dataset.charIndex = String(ci);
          if (typeof ch.t === 'number') {
            chSpan.dataset.time = String(ch.t / 1000);
          }
          chSpan.classList.add('char-pending');
          mainSpan.appendChild(chSpan);
        });
      } else {
        const rawText = line ? line.text : '';
        mainSpan.innerHTML = optimizeLineBreaks(rawText);
      }
      row.appendChild(mainSpan);
      
      if (line && line.translation) {
        const subSpan = createEl('span', '', 'lyric-translation', line.translation);
        row.appendChild(subSpan);
        row.classList.add('has-translation');
      }

      row.onclick = () => {
        if (shareMode) {
          handleShareLineClick(index);
          return;
        }
        if (!hasTimestamp || !line || line.time == null) return;
        const v = document.querySelector('video');
        if (v) v.currentTime = line.time + timeOffset;
      };
      fragment.appendChild(row);
    });

    ui.lyrics.appendChild(fragment);

    if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
      PipManager.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
      if (PipManager.pipWindow.document) {
        PipManager.pipWindow.document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);
      }
    }

    updateShareSelectionHighlight();
  }

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !currentKey) return;
    const r = new FileReader();
    r.onload = (ev) => {
      storage.set(currentKey, ev.target.result);
      currentKey = null;
    };
    r.readAsText(file);
    e.target.value = '';
  };


  function startLyricRafLoop() {
    if (lyricRafId) cancelAnimationFrame(lyricRafId);

    const loop = () => {
      const v = document.querySelector('video');

      if (v) {

        if (PipManager.pipWindow) {
          PipManager.updatePlayState(v.paused);
        }

        if (v.readyState > 0 && !v.paused && !v.ended) {
          let t = v.currentTime;
          const duration = v.duration || 1;

          if (timeOffset > 0 && t < timeOffset) timeOffset = 0;
          t = Math.max(0, t - timeOffset);
          t = Math.min(Math.max(0, t + (config.syncOffset / 1000)), v.duration);
          if (lyricsData.length && hasTimestamp) {
            updateLyricHighlight(t);
          }


          if (PipManager.pipWindow && PipManager.progressRing) {
            const radius = 32;
            const circumference = radius * 2 * Math.PI;
            const progress = t / duration;
            const offset = circumference - (progress * circumference);
            PipManager.progressRing.style.strokeDashoffset = offset;
          }
        }
      }

      if (PipManager.pipWindow) {
        lyricRafId = PipManager.pipWindow.requestAnimationFrame(loop);
      } else {
        lyricRafId = requestAnimationFrame(loop);
      }
    };

    lyricRafId = requestAnimationFrame(loop);
  }

  function updateLyricHighlight(currentTime) {
    if (!lyricsData.length) return;
    if (!hasTimestamp) return;

    const t = currentTime;

    let idx = -1;
    const startSearch = Math.max(0, lastActiveIndex);

    for (let i = startSearch; i < lyricsData.length; i++) {
      if (lyricsData[i].time > t) {
        idx = i - 1;
        break;
      }
      if (i === lyricsData.length - 1) idx = i;
    }



    const targets = [];
    if (ui.lyrics) targets.push(ui.lyrics);
    if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
      targets.push(PipManager.pipLyricsContainer);
    }

    // When the next line comes within 1 second, also highlight the previous line together
    const prevIdx = (idx > 0 && idx < lyricsData.length &&
      typeof lyricsData[idx]?.time === 'number' &&
      typeof lyricsData[idx - 1]?.time === 'number' &&
      (lyricsData[idx].time - lyricsData[idx - 1].time) <= 1.0
    ) ? (idx - 1) : -1;

    targets.forEach(container => {
      const rows = container.querySelectorAll('.lyric-line');
      if (rows.length === 0) return;

      rows.forEach((r, i) => {
        const isActive = (i === idx) || (i === prevIdx);
        const isPrimary = (i === idx);

        if (isActive) {
          if (!r.classList.contains('active')) {
            r.classList.add('active');

// Only the primary line should scroll / count replay
           // Only the primary line should scroll / count replay
// Only the primary line should scroll / count replay
           // Only the primary line should scroll / count replay
            if (isPrimary) {
              // 画面の種類（通常画面かPIPか）でスクロール位置を分ける
              if (container === ui.lyrics) {
                // 【通常再生画面】 ブラウザの標準機能で「物理的な中央」に強制配置
                r.scrollIntoView({ behavior: 'smooth', block: 'center' });
                ReplayManager.incrementLyricCount();
              } else {
                // 【PIP（小窓）】 引き続き Apple Music風に「二行上 (35%の位置)」をキープ
                const offsetTop = r.offsetTop;
                const containerHeight = container.clientHeight;
                const targetScroll = offsetTop - (containerHeight * 0.35) + (r.offsetHeight / 2);
                container.scrollTo({ top: targetScroll, behavior: 'smooth' });
              }
            }            
                      }

          if (r.classList.contains('has-translation')) {
            r.classList.add('show-translation');
          }

          const charSpans = r.querySelectorAll('.lyric-char');
          if (charSpans.length > 0) {
            charSpans.forEach(sp => {
              const tt = parseFloat(sp.dataset.time || '0');
              if (Number.isFinite(tt) && tt <= t) {
                sp.classList.add('char-active');
                sp.classList.remove('char-pending');
              } else {
                sp.classList.remove('char-active');
                sp.classList.add('char-pending');
              }
            });
          }
        } else {
          r.classList.remove('active');
          r.classList.remove('show-translation');

          const charSpans = r.querySelectorAll('.lyric-char');
          if (charSpans.length > 0) {
            charSpans.forEach(sp => {
              sp.classList.remove('char-active');
              sp.classList.add('char-pending');
            });
          }
        }
      });
    });

    lastActiveIndex = idx;
  }

  // ===================== Share 機能 =====================

  function onShareButtonClick() {
    if (!lyricsData.length) {
      showToast('共有できる歌詞がありません');
      return;
    }
    shareMode = !shareMode;
    shareStartIndex = null;
    shareEndIndex = null;
    if (shareMode) {
      document.body.classList.add('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.add('share-active');
      showToast('共有したい歌詞の開始行と終了行をクリックしてください');
    } else {
      document.body.classList.remove('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.remove('share-active');
    }
    updateShareSelectionHighlight();
  }

  function handleShareLineClick(index) {
    if (!shareMode) return;
    if (!lyricsData.length) return;
    if (shareStartIndex == null) {
      shareStartIndex = index;
      shareEndIndex = null;
      updateShareSelectionHighlight();
      return;
    }
    if (shareEndIndex == null) {
      shareEndIndex = index;
      updateShareSelectionHighlight();
      finalizeShareSelection();
      return;
    }
    shareStartIndex = index;
    shareEndIndex = null;
    updateShareSelectionHighlight();
  }

  function updateShareSelectionHighlight() {
    if (!ui.lyrics) return;
    const rows = ui.lyrics.querySelectorAll('.lyric-line');
    rows.forEach(r => {
      r.classList.remove('share-select');
      r.classList.remove('share-select-range');
      r.classList.remove('share-select-start');
      r.classList.remove('share-select-end');
    });
    if (!shareMode || shareStartIndex == null || !lyricsData.length) return;
    const max = lyricsData.length ? lyricsData.length - 1 : 0;
    let s, e;
    if (shareEndIndex == null) {
      const idx = Math.max(0, Math.min(shareStartIndex, max));
      s = idx;
      e = idx;
    } else {
      const minIdx = Math.min(shareStartIndex, shareEndIndex);
      const maxIdx = Math.max(shareStartIndex, shareEndIndex);
      s = Math.max(0, Math.min(minIdx, max));
      e = Math.max(0, Math.min(maxIdx, max));
    }
    for (let i = s; i <= e && i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      row.classList.add('share-select-range');
      if (i === s) row.classList.add('share-select-start');
      if (i === e) row.classList.add('share-select-end');
    }
  }

  function getShareSelectionInfo() {
    if (!lyricsData.length || shareStartIndex == null) return null;
    const max = lyricsData.length - 1;
    let s, e;
    if (shareEndIndex == null) {
      const idx = Math.max(0, Math.min(shareStartIndex, max));
      s = idx;
      e = idx;
    } else {
      const minIdx = Math.min(shareStartIndex, shareEndIndex);
      const maxIdx = Math.max(shareStartIndex, shareEndIndex);
      s = Math.max(0, Math.min(minIdx, max));
      e = Math.max(0, Math.min(maxIdx, max));
    }
    const parts = [];
    for (let i = s; i <= e; i++) {
      if (!lyricsData[i]) continue;
      let t = (lyricsData[i].text || '').trim();
      if (!t && lyricsData[i].translation) {
        t = String(lyricsData[i].translation).trim();
      }
      if (t) parts.push(t);
    }
    const phrase = parts.join('\n');
    let timeMs = 0;
    if (hasTimestamp && lyricsData[s] && typeof lyricsData[s].time === 'number') {
      timeMs = Math.round(lyricsData[s].time * 1000);
    } else {
      const v = document.querySelector('video');
      if (v && typeof v.currentTime === 'number') {
        timeMs = Math.round(v.currentTime * 1000);
      }
    }
    return { phrase, timeMs };
  }

  function normalizeToHttps(url) {
    if (!url) return url;
    try {
      const u = new URL(url, 'https://lrchub.coreone.work');
      u.protocol = 'https:';
      return u.toString();
    } catch (e) {
      if (url.startsWith('http://')) {
        return 'https://' + url.slice(7);
      }
      return url;
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve();
    }
  }

  async function finalizeShareSelection() {
    const info = getShareSelectionInfo();
    if (!info || !info.phrase) {
      showToast('選択された歌詞が空です');
      return;
    }
    const youtube_url = getCurrentVideoUrl();
    const video_id = getCurrentVideoId();
    const lang = (config.mainLang && config.mainLang !== 'original') ? config.mainLang : 'ja';
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'SHARE_REGISTER', payload: { youtube_url, video_id, phrase: info.phrase, lang, time_ms: info.timeMs } },
          resolve
        );
      });
      if (!res || !res.success) {
        console.error('Share register failed:', res && res.error);
        showToast('共有に失敗しました');
        return;
      }
      let shareUrl = (res.data && res.data.share_url) || '';
      shareUrl = normalizeToHttps(shareUrl);
      if (!shareUrl && video_id) {
        const sec = Math.round((info.timeMs || 0) / 1000);
        shareUrl = `https://lrchub.coreone.work/s/${video_id}/${sec}`;
      }
      if (shareUrl) {
        await copyToClipboard(shareUrl);
        showToast('共有リンクをコピーしました');
      } else {
        showToast('共有リンクの取得に失敗しました');
      }
    } catch (e) {
      console.error('Share register error', e);
      showToast('共有に失敗しました');
    } finally {
      shareMode = false;
      shareStartIndex = null;
      shareEndIndex = null;
      document.body.classList.remove('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.remove('share-active');
      updateShareSelectionHighlight();
    }
  }

  async function sendLockRequest(requestId) {
    const youtube_url = getCurrentVideoUrl();
    const video_id = getCurrentVideoId();
    const reqInfo = Array.isArray(lyricsRequests)
      ? lyricsRequests.find(r => r.id === requestId || r.request === requestId || (r.aliases || []).includes(requestId))
      : null;
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'SELECT_LYRICS_CANDIDATE', payload: { youtube_url, video_id, request: requestId } },
          resolve
        );
      });
      if (res?.success) {
        showToast('歌詞を確定しました');
        if (reqInfo) {
          reqInfo.locked = true;
          reqInfo.available = false;
          if (!lyricsConfig) lyricsConfig = {};
          if (reqInfo.target === 'sync') lyricsConfig.SyncLocked = true;
          else if (reqInfo.target === 'dynamic') lyricsConfig.dynmicLock = true;
        }
        refreshLockMenu();
      } else {
        const msg = res?.error || (res?.raw && (res.raw.message || res.raw.code)) || '歌詞の確定に失敗しました';
        showToast(msg);
      }
    } catch (e) {
      console.error('lock request error', e);
      showToast('歌詞の確定に失敗しました');
    }
  }



  function setupPlayerBarBlankClickGuard() {
    const bar = document.querySelector('ytmusic-player-bar');
    if (!bar || bar.dataset.ytmBlankClickGuard === '1') return;
    bar.dataset.ytmBlankClickGuard = '1';

    // 余白クリックがプレイヤーの開閉に繋がるのを防ぐ（ボタン/スライダー等は通常通り動かす）
    bar.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;

      // インタラクティブ要素は通す（閉じるボタンの逆三角もここに含まれる想定）
      if (
        t.closest('button, a, input, textarea, select, tp-yt-paper-icon-button, tp-yt-paper-button, tp-yt-paper-slider, ytmusic-like-button-renderer, ytmusic-toggle-button-renderer')
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  const tick = async () => {
  if (document.querySelector('.ad-interrupting') || document.querySelector('.ad-showing')) return;

    let toggleBtn = document.getElementById('my-mode-toggle');


    if (!toggleBtn) {
      const rc = document.querySelector('.right-controls-buttons');
      if (rc) {
        toggleBtn = createEl('button', 'my-mode-toggle', '', 'IMMERSION');


        if (config.mode) toggleBtn.classList.add('active');

        toggleBtn.onclick = () => {
          config.mode = !config.mode;
          document.body.classList.toggle('ytm-custom-layout', config.mode);
          if(isYTMPremiumUser()) changeIModeUIWithMovieMode(config.mode);

          toggleBtn.classList.toggle('active', config.mode);
        };
        rc.prepend(toggleBtn);
      }
    } else {

      const isActive = toggleBtn.classList.contains('active');
      if (config.mode && !isActive) toggleBtn.classList.add('active');
      else if (!config.mode && isActive) toggleBtn.classList.remove('active');
    }


    const layout = document.querySelector('ytmusic-app-layout');
    const isPlayerOpen = layout?.hasAttribute('player-page-open');
    if (!config.mode || !isPlayerOpen) {
      document.body.classList.remove('ytm-custom-layout');
      return;
    }
    document.body.classList.add('ytm-custom-layout');
    initLayout();


    setupPlayerBarBlankClickGuard();
    (function patchSliders() {
      const sliders = document.querySelectorAll('ytmusic-player-bar .middle-controls tp-yt-paper-slider');
      sliders.forEach(s => {
        try {
          s.style.boxSizing = 'border-box';
          s.style.paddingLeft = '20px';
          s.style.paddingRight = '20px';
          s.style.minWidth = '0';
          s.style.cursor = 'pointer';
        } catch (e) { }
      });
    })();

    const meta = getMetadata();
    if (!meta) return;
    const key = `${meta.title}///${meta.artist}`;

    if (currentKey !== key) {
      // クラウド同期
      if (currentKey !== null && CloudSync && typeof CloudSync.syncNow === 'function') {
        CloudSync.syncNow();
      }

      const v = document.querySelector('video');
      const currentTime = v ? v.currentTime : 0;
      const duration = v ? v.duration : 0;


      if (currentTime < 5 || (duration > 0 && Math.abs(duration - currentTime) < 5)) {
        timeOffset = 0;
      } else {
        timeOffset = currentTime;
      }

      if (!config.saveSyncOffset) {
        if (isFirstSongDetected) {
          isFirstSongDetected = false;
        } else {
          const offsetInput = document.getElementById('sync-offset-input');
          if (offsetInput) {
            offsetInput.value = 0;
          }
          config.syncOffset = 0;
          storage.set('ytm_sync_offset', 0);
        }
      } else {
        isFirstSongDetected = false;
      }


      currentKey = key;
      lyricsData = [];
      dynamicLines = null;
      duetSubDynamicLines = null;
      _duetExcludedTimes = new Set();
      lyricsCandidates = null;
      selectedCandidateId = null;
      lyricsRequests = null;
      lyricsConfig = null;
      shareMode = false;
      shareStartIndex = null;
      shareEndIndex = null;
      document.body.classList.remove('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.remove('share-active');
      lastActiveIndex = -1;
      lastTimeForChars = -1;

      if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
        QueueManager.onSongChanged();
      }

      updateMetaUI(meta);

      // PIPウィンドウのメタデータと歌詞表示をリセット
      if (PipManager) {
        PipManager.updateMeta(meta.title, meta.artist);
        PipManager.resetLyrics(); // ここで歌詞を一旦消す
      }

      refreshCandidateMenu();
      refreshLockMenu();
      if (ui.lyrics) ui.lyrics.scrollTop = 0;
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
  ui.lyrics.innerHTML = '<div class="lyric-loading" style="opacity:0.5; padding:20px;">Loading...</div>';

  // アーティストページのURLを取得
  let retryCount = 0;
  const maxRetries = 5;
  const trySetArtistLink = () => {
    const bylineWrapper = document.querySelector('ytmusic-player-bar yt-formatted-string.byline.complex-string');
    if (!bylineWrapper) {
      retryCount++;
      if (retryCount < maxRetries) {
        setTimeout(trySetArtistLink, 300);
      } else {
        ui.artist.innerText = meta.artist; // フォールバック
      }
      return;
    }

    const artistLinks = Array.from(
      bylineWrapper.querySelectorAll('a.yt-simple-endpoint')
    ).filter(a => {
      const href = a.href || '';
      return href.includes('channel/') || href.includes('/channel/');
    });

    if (artistLinks.length > 0) {
      let artistHTML = '';

      artistLinks.forEach((link, index) => {
        const name = link.textContent.trim();
        const url = link.href;

        artistHTML += `<a href="${url}" 
          style="color:inherit; text-decoration:none;"
          target="_blank">
          ${name}
        </a>`;
        if (index < artistLinks.length - 1) {
          artistHTML += ' • ';
        }
      });
      ui.artist.innerHTML = artistHTML;
      return;
    }

    retryCount++;
    if (retryCount < maxRetries) {
      setTimeout(trySetArtistLink, 300);
    } else {
      ui.artist.innerText = meta.artist;
    }
  };

trySetArtistLink();
}

  (async function applySavedVisualSettings() {
    // 1. 歌詞の太さ
    const savedWeight = await storage.get('ytm_lyric_weight');
    if (savedWeight) {
      config.lyricWeight = savedWeight;
      document.documentElement.style.setProperty('--ytm-lyric-weight', savedWeight);
    }

    // 2. 背景の明るさ
    const savedBright = await storage.get('ytm_bg_brightness');
    if (savedBright) {
      config.bgBrightness = savedBright;
      document.documentElement.style.setProperty('--ytm-bg-brightness', savedBright);
    }

    // 3. 左揃えオプション
    const leftAlignStored = await storage.get('ytm_left_align');
    if (leftAlignStored !== null) config.leftAlignInfo = leftAlignStored;
    document.body.classList.toggle('ytm-align-left', !!config.leftAlignInfo);

    // 4. Apple Music風背景オプション
    const appleBgStored = await storage.get('ytm_apple_bg');
    if (appleBgStored !== null) config.appleBg = appleBgStored;
    document.body.classList.toggle('ytm-apple-bg', !!config.appleBg);
  })();
  
  
  // ===================== 初期化 =====================

  ReplayManager.init();
  QueueManager.init();
  CloudSync.init();

  loadRemoteTextsFromGithub();

  console.log('YTM Immersion loaded.');


  const setupObserver = () => {

    const targetNode = document.querySelector('ytmusic-player-bar');


    if (!targetNode) {
      setTimeout(setupObserver, 500);
      return;
    }


    const observer = new MutationObserver(() => {

      tick();
    });



    observer.observe(targetNode, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log('YTM Immersion: Zero-delay observer started.');

    tick();
  };

