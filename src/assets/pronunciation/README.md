# Offline pronunciation data

All runtime assets are shipped with the extension. No remote code, CDN,
pronunciation API, or extra host permission is used. Dictionaries load lazily
in the extension service worker; the playback document receives only readings.

- English: [CMUdict](https://github.com/cmusphinx/cmudict), revision
  `74790861f652b15e4ac49015a90074ad62a27690`. `en.json.gz` contains the first
  pronunciation of 124,101 alphabetic words and contractions. Alternate
  pronunciations, entries containing digits, and comments are excluded.
  See [CMU license](LICENSE-cmudict.txt).
- Japanese: [Kuromoji.js](https://github.com/takuyaa/kuromoji.js) 0.1.2,
  Apache 2.0, with its packaged IPADIC 2.7.0 dictionary. The small ESM bundle
  contains Tokenizer and DynamicDictionaries; dictionary loading uses native
  fetch and DecompressionStream. See [Kuromoji license](LICENSE-kuromoji.txt)
  and [IPADIC notices and license](NOTICE-ipadic.txt).
- Kuromoji's doublearray 0.0.2 dependency uses the [MIT license](LICENSE-doublearray.txt).

The Hangul conversion rules are project code, separate from the original data.
They provide approximate readings, not translations or guaranteed linguistic
transcriptions. The display language selects Hangul, Japanese kana, or romanized
readings for supported Korean, Japanese, and English lyrics. The Chinese UI
does not display readings. A song containing only Han characters is not
automatically assigned to Japanese. Unknown words may remain unchanged.

- Japanese romanization uses WanaKana 5.3.1 (MIT); see
  [its license](../../js/vendor/wanakana-LICENSE.txt).
- Reading subtitles use Pretendard (SIL OFL 1.1); see
  [its license](../fonts/Pretendard-LICENSE.txt).

Rebuild with `node scripts/vendor-pronunciation.mjs` from the repository root.
This development command downloads the pinned dependencies into a temporary
directory, bundles them with esbuild 0.25.12, then removes that directory.
No npm installation is needed to load the unpacked extension.
[sources.json](sources.json) records revisions and SHA-256 asset checksums.
