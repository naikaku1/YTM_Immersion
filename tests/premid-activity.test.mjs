import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { inflateRawSync } from 'node:zlib'

const packagePath = new URL('../premid/YTM-Immersion-PreMiD.zip', import.meta.url)

function readZipEntries(path) {
  const archive = fs.readFileSync(path)
  let endOfCentralDirectory = -1

  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054B50) {
      endOfCentralDirectory = offset
      break
    }
  }

  assert.notEqual(endOfCentralDirectory, -1, 'ZIP end-of-central-directory record is missing')

  const entryCount = archive.readUInt16LE(endOfCentralDirectory + 10)
  let centralOffset = archive.readUInt32LE(endOfCentralDirectory + 16)
  const entries = new Map()

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(centralOffset), 0x02014B50)

    const compressionMethod = archive.readUInt16LE(centralOffset + 10)
    const compressedSize = archive.readUInt32LE(centralOffset + 20)
    const uncompressedSize = archive.readUInt32LE(centralOffset + 24)
    const fileNameLength = archive.readUInt16LE(centralOffset + 28)
    const extraLength = archive.readUInt16LE(centralOffset + 30)
    const commentLength = archive.readUInt16LE(centralOffset + 32)
    const localHeaderOffset = archive.readUInt32LE(centralOffset + 42)
    const fileName = archive
      .subarray(centralOffset + 46, centralOffset + 46 + fileNameLength)
      .toString('utf8')

    assert.equal(archive.readUInt32LE(localHeaderOffset), 0x04034B50)
    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28)
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize)
    const contents = compressionMethod === 0
      ? compressed
      : compressionMethod === 8
        ? inflateRawSync(compressed)
        : assert.fail(`Unsupported ZIP compression method: ${compressionMethod}`)

    assert.equal(contents.length, uncompressedSize)
    entries.set(fileName, contents)
    centralOffset += 46 + fileNameLength + extraLength + commentLength
  }

  return entries
}

const packagedEntries = readZipEntries(packagePath)
const presenceSource = packagedEntries.get('presence.js')?.toString('utf8')
const metadata = JSON.parse(packagedEntries.get('metadata.json')?.toString('utf8') || 'null')

function createActivityHarness() {
  const settings = {
    browsing: true,
    buttons: true,
    cover: true,
    displayType: 1,
    hidePaused: false,
    links: true,
    privacy: false,
    showLyrics: true,
    textLayout: 0,
    timestamps: true,
  }
  const mediaSession = {
    metadata: null,
    playbackState: 'none',
  }
  const videoListeners = new Map()
  const video = {
    currentTime: 42,
    duration: 180,
    paused: false,
    addEventListener(name, listener) {
      videoListeners.set(name, listener)
    },
  }
  const artistLink = { href: 'https://music.youtube.com/channel/test-artist' }
  const albumLink = { href: 'https://music.youtube.com/playlist?list=test-album' }
  let bridgeEnabled = true
  let repeatMode = 'NONE'
  let snapshot = {
    schema: 1,
    source: 'ytm-immersion',
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    artwork: 'https://i.ytimg.com/vi/test-video-id/maxresdefault.jpg',
    lyric: 'Current lyric line',
    url: 'https://music.youtube.com/watch?v=test-video-id',
    playbackState: 'playing',
    currentTime: 42,
    duration: 180,
    startedAt: Date.now() - 42_000,
    endsAt: Date.now() + 138_000,
    isAdvertisement: false,
  }
  const location = new URL('https://music.youtube.com/watch?v=test-video-id')
  const document = {
    location,
    getElementById(id) {
      return bridgeEnabled && id === 'ytm-immersion-discord-presence'
        ? { textContent: JSON.stringify(snapshot) }
        : null
    },
    querySelector(selector) {
      if (selector === '.video-stream')
        return video
      if (selector === '#left-controls > span')
        return { textContent: '0:42 / 3:00' }
      if (selector === 'ytmusic-player-bar[slot="player-bar"]') {
        return {
          getAttribute(name) {
            return name === 'repeat-mode' ? repeatMode : null
          },
        }
      }
      if (selector === '.byline a')
        return artistLink
      return null
    },
    querySelectorAll(selector) {
      return selector === '.byline a' ? [artistLink, albumLink] : []
    },
  }

  let activity = null
  let clearCount = 0
  let updateData = null

  class MockPresence {
    on(eventName, listener) {
      if (eventName === 'UpdateData')
        updateData = listener
    }

    getSetting(id) {
      return settings[id]
    }

    getStrings(stringMap) {
      const strings = {
        browsing: 'Browsing',
        listeningToSong: 'Listening to a song',
        listenAlong: 'Listen Along',
        onLoop: 'On loop',
        paused: 'Paused',
        playing: 'Playing',
        playlistOnLoop: 'Playlist on loop',
        viewAlbum: 'View Album',
        viewArtist: 'View Artist',
      }
      return Object.fromEntries(
        Object.keys(stringMap).map(key => [key, strings[key] || key]),
      )
    }

    setActivity(nextActivity) {
      activity = nextActivity
    }

    clearActivity() {
      clearCount += 1
      activity = null
    }
  }

  vm.runInNewContext(presenceSource, {
    console,
    document,
    navigator: { mediaSession },
    Presence: MockPresence,
    URL,
  }, {
    filename: 'packaged-presence.js',
  })

  assert.equal(typeof updateData, 'function')

  return {
    get activity() {
      return activity
    },
    get clearCount() {
      return clearCount
    },
    mediaSession,
    settings,
    setBridgeEnabled(value) {
      bridgeEnabled = value
    },
    setRepeatMode(value) {
      repeatMode = value
    },
    setSnapshot(patch) {
      snapshot = { ...snapshot, ...patch }
      video.paused = snapshot.playbackState === 'paused'
    },
    update() {
      return updateData()
    },
    videoListeners,
  }
}

test('package keeps the official YouTube Music settings and localization', () => {
  assert.ok(presenceSource)
  assert.ok(packagedEntries.has('YouTube Music.json'))

  const settingIds = metadata.settings.map(setting => setting.id)
  assert.deepEqual(settingIds, [
    'lang',
    'privacy',
    'displayType',
    'cover',
    'showLyrics',
    'textLayout',
    'timestamps',
    'buttons',
    'browsing',
    'hidePaused',
    'links',
  ])
  assert.equal(metadata.service, 'YouTube Music')
  assert.equal(metadata.version, '3.4.4')
  assert.equal(metadata.settings.find(setting => setting.id === 'textLayout').values.length, 6)
})

test('packaged Activity maps song, artist, artwork lyric, and play state', async () => {
  const harness = createActivityHarness()
  await harness.update()

  assert.equal(harness.activity.details, 'Test Song')
  assert.equal(harness.activity.state, 'Test Artist')
  assert.equal(harness.activity.largeImageText, 'Current lyric line')
  assert.equal(
    harness.activity.largeImageKey,
    'https://i.ytimg.com/vi/test-video-id/maxresdefault.jpg',
  )
  assert.equal(
    harness.activity.smallImageKey,
    'https://cdn.rcd.gg/PreMiD/resources/play.png',
  )
  assert.equal(harness.activity.smallImageText, 'Playing')
  assert.equal(harness.activity.detailsUrl, 'https://music.youtube.com/watch?v=test-video-id')
  assert.equal(typeof harness.activity.startTimestamp, 'number')
  assert.equal(typeof harness.activity.endTimestamp, 'number')
})

test('packaged Activity switches pause icon and respects lyric/privacy settings', async () => {
  const harness = createActivityHarness()
  harness.setSnapshot({ playbackState: 'paused' })
  await harness.update()

  assert.equal(
    harness.activity.smallImageKey,
    'https://cdn.rcd.gg/PreMiD/resources/pause.png',
  )
  assert.equal(harness.activity.smallImageText, 'Paused')
  assert.equal(harness.activity.startTimestamp, undefined)
  assert.equal(harness.activity.endTimestamp, undefined)

  harness.settings.showLyrics = false
  await harness.update()
  assert.equal(harness.activity.state, 'Test Artist / Test Album')
  assert.equal(harness.activity.largeImageText, 'Test Album')

  harness.settings.privacy = true
  await harness.update()
  assert.equal(harness.activity.details, 'Listening to a song')
  assert.equal(harness.activity.state, undefined)
  assert.equal(harness.activity.largeImageKey.includes('logo.png'), true)
})

test('packaged Activity supports all six text layouts and matching row links', async () => {
  const expectedLayouts = [
    ['Test Song', 'Test Artist', 'Current lyric line', 'song', 'artist'],
    ['Test Song', 'Current lyric line', 'Test Artist', 'song', 'song'],
    ['Test Artist', 'Test Song', 'Current lyric line', 'artist', 'song'],
    ['Test Artist', 'Current lyric line', 'Test Song', 'artist', 'song'],
    ['Current lyric line', 'Test Song', 'Test Artist', 'song', 'song'],
    ['Current lyric line', 'Test Artist', 'Test Song', 'song', 'artist'],
  ]
  const songUrl = 'https://music.youtube.com/watch?v=test-video-id'
  const artistUrl = 'https://music.youtube.com/channel/test-artist'

  for (let textLayout = 0; textLayout < expectedLayouts.length; textLayout++) {
    const harness = createActivityHarness()
    harness.settings.textLayout = textLayout
    await harness.update()

    const [details, state, artworkText, detailsLink, stateLink] = expectedLayouts[textLayout]
    assert.equal(harness.activity.details, details)
    assert.equal(harness.activity.state, state)
    assert.equal(harness.activity.largeImageText, artworkText)
    assert.equal(harness.activity.detailsUrl, detailsLink === 'artist' ? artistUrl : songUrl)
    assert.equal(harness.activity.stateUrl, stateLink === 'artist' ? artistUrl : songUrl)
  }
})

test('packaged Activity defaults an invalid text layout and falls back to album without lyrics', async () => {
  const harness = createActivityHarness()
  harness.settings.textLayout = 99
  harness.setSnapshot({ lyric: '' })
  await harness.update()

  assert.equal(harness.activity.details, 'Test Song')
  assert.equal(harness.activity.state, 'Test Artist')
  assert.equal(harness.activity.largeImageText, 'Test Album')
})

test('packaged Activity keeps repeat information while using the play icon', async () => {
  const harness = createActivityHarness()
  harness.setRepeatMode('ONE')
  await harness.update()

  assert.equal(
    harness.activity.smallImageKey,
    'https://cdn.rcd.gg/PreMiD/resources/play.png',
  )
  assert.equal(harness.activity.smallImageText, 'Playing • On loop')
})

test('packaged Activity falls back to the official Media Session path', async () => {
  const harness = createActivityHarness()
  harness.setBridgeEnabled(false)
  harness.mediaSession.playbackState = 'playing'
  harness.mediaSession.metadata = {
    title: 'Media Session Song',
    artist: 'Fallback Artist',
    album: 'Fallback Album',
    artwork: [{ src: 'https://example.com/fallback-art.jpg' }],
  }

  await harness.update()

  assert.equal(harness.activity.details, 'Media Session Song')
  assert.equal(harness.activity.state, 'Fallback Artist')
  assert.equal(harness.activity.largeImageText, 'Fallback Album')
  assert.equal(harness.activity.largeImageKey, 'https://example.com/fallback-art.jpg')
})
