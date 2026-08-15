# Privacy Policy for YTM-Immersion

**Last Updated:** August 15, 2026

YTM-Immersion ("we", "our", or "us") is a Chrome Extension developed by Naikaku. We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our extension.

## 1. Information We Collect

YTM-Immersion operates primarily within your web browser. We collect the minimum amount of data necessary to provide our features.

### A. Local Data (Stored on your device)
We use the Chrome Storage API to save the following data locally on your browser:
- **Playback History:** Song titles, artist names, playback counts, and duration (used for the "Daily Replay" feature).
- **User Settings:** Custom preferences such as UI language, lyric font weight, and background brightness.

### B. Data Sent to External Services
To provide specific features, the extension sends limited data to the following third-party APIs. We do not transmit personally identifiable information (PII) like your real name or email address to these services, except for authentication tokens where necessary for Cloud Sync.

- **Lyrics Fetching:**
  - **Services:** LRCLib (lrclib.net), LRCHub (lrchub.coreone.work)
  - **Data Sent:** Song title, artist name, and album name.
  - **Purpose:** To search for and download synchronized lyrics.

- **Lyrics Fetching from YouTube Music:**
  - **Service:** YouTube Music (music.youtube.com)
  - **Data Sent:** The video ID of the track you are playing, and the song title and artist name when we need to locate the corresponding catalog track.
  - **Purpose:** To retrieve the line-synchronized lyrics that YouTube Music provides.
  - **Note:** These requests are made from the music.youtube.com page you are already on. They are same-origin requests and no data is sent to any server other than YouTube Music.

- **Translation:**
  - **Service:** DeepL API (deepl.com)
  - **Data Sent:** Lyric text.
  - **Purpose:** To provide Japanese translations for lyrics upon your request.

- **Cloud Sync (Optional):**
  - **Service:** Immersion Project Server (immersionproject.coreone.work)
  - **Data Sent:** Your encrypted settings and playback statistics.
  - **Purpose:** To backup and sync your data across devices (only if you opt-in).

### C. Use of Your Signed-in YouTube Music Session

Some lyrics are only served by YouTube Music to signed-in requests. To display those lyrics, the extension signs its requests to `music.youtube.com` using the login session your browser already holds — the same mechanism the YouTube Music page itself uses.

- The signature is computed **entirely within your browser**.
- Your credentials (cookie values) are **never stored** by the extension.
- Your credentials are **never sent to any destination other than `music.youtube.com`**.
- This applies only to requests to YouTube Music. Requests to lyrics providers, the translation service, and the sync server are made without any credentials.

If you are not signed in to YouTube Music, the extension simply falls back to anonymous requests and continues to work.

## 2. How We Use Your Information

We use the collected information solely for the following purposes:
- To display synchronized lyrics and translations in real-time.
- To generate personal listening statistics (Daily Replay) for your viewing.
- To maintain your preferred UI settings.
- To synchronize your data across devices (only if Cloud Sync is enabled).

## 3. Data Sharing and Disclosure

**We do not sell, trade, or otherwise transfer your personally identifiable information to outside parties.**
Data is only shared with the third-party services listed in Section 1 solely for the purpose of executing the extension's core functions.

## 4. Your Control and Rights

- **Data Deletion:** You can clear your playback history and settings at any time by clearing your browser's extension data or using the "Reset" button within the extension settings.
- **Opt-out:** You can choose not to use the Cloud Sync or Translation features if you do not wish to send data to the respective servers.

## 5. Changes to This Policy

We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last Updated" date.