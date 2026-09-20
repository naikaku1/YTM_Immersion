// manifest の権限。
//
// コードが使っていない権限を並べていると、審査で説明できないうえに
// 指紋(拡張機能の識別)にもなる。実態に合わせて絞る。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import path from 'node:path'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'))

const sourceText = (() => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const next = path.posix.join(dir, entry.name)
      if (entry.isDirectory()) walk(next)
      else if (entry.name.endsWith('.js')) files.push(next)
    }
  }
  walk('src/js')
  return files.map(f => fs.readFileSync(new URL(f, root), 'utf8')).join('\n')
})()

test('平文 HTTP とローカルの待ち受けは残っていない', () => {
  manifest.host_permissions.forEach(p => {
    assert.ok(p.startsWith('https://'), `平文 HTTP が残っている: ${p}`)
  })
  assert.ok(!manifest.host_permissions.some(p => /localhost|127\.0\.0\.1/.test(p)))
})

// 必須と任意の両方。任意(optional_host_permissions)は、更新のたびに
// 「権限が増えたので無効化しました」を出さないために使っている。
// 宣言の仕方が違うだけで、叩くなら宣言が要る点は同じ。
const declaredHosts = [
  ...manifest.host_permissions,
  ...(manifest.optional_host_permissions || []),
]

test('使っていないホストを並べていない', () => {
  declaredHosts.forEach(p => {
    const host = new URL(p.replace('/*', '/')).hostname
    assert.ok(sourceText.includes(host), `コードが使っていないホスト: ${host}`)
  })
})

test('任意の権限も平文 HTTP を混ぜない', () => {
  (manifest.optional_host_permissions || []).forEach(p => {
    assert.ok(p.startsWith('https://'), `平文 HTTP が残っている: ${p}`)
  })
})

test('コードが叩くホストは権限に入っている', () => {
  const hosts = new Set(
    (sourceText.match(/https:\/\/[a-z0-9.-]+/g) || [])
      .map(u => new URL(u + '/').hostname)
      // 遷移先・表示用のリンクで、fetch はしない
      .filter(h => !['discord.gg', 'github.com', 'i.ytimg.com', 'youtu.be', 'www.youtube.com'].includes(h)),
  )
  const allowed = declaredHosts.map(p => new URL(p.replace('/*', '/')).hostname)
  hosts.forEach(h => {
    assert.ok(allowed.includes(h), `権限に無いホストを叩いている: ${h}`)
  })
})

test('web_accessible_resources は YouTube Music だけに出す', () => {
  manifest.web_accessible_resources.forEach(entry => {
    assert.deepEqual(entry.matches, ['https://music.youtube.com/*'])
  })
})

test('content script の読み込み順は namespace.js が先頭', () => {
  const js = manifest.content_scripts[0].js
  assert.equal(js[0], 'src/js/module/namespace.js')
  js.forEach(f => {
    assert.ok(fs.existsSync(new URL(f, root)), `manifest が無いファイルを指している: ${f}`)
  })
})

// content script どうしはトップレベルのスコープを共有する。
// 別のファイルで同じ名前を const 宣言すると、読み込んだ時点で
// SyntaxError になり拡張がまるごと起動しない(名前の衝突は
// 共通ユーティリティを namespace.js に寄せるときに起こりやすい)。
test('content script の間で名前がぶつかっていない', () => {
  const bundle = manifest.content_scripts[0].js
    .map(f => fs.readFileSync(new URL(f, root), 'utf8'))
    .join('\n')
  assert.doesNotThrow(() => new Function(`if (false) {\n${bundle}\n}`))
})
