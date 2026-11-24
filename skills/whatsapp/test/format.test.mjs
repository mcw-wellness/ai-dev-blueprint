import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proto } from 'baileys'
import { describeMessage, fold, sanitize } from '../lib/format.mjs'

const wa = (message, extra = {}) => proto.WebMessageInfo.fromObject({
  key: { remoteJid: '4366011111@s.whatsapp.net', id: 'M1', fromMe: false },
  messageTimestamp: 1762900000,
  message,
  ...extra,
})

test('a plain text message describes as its text', () => {
  const d = describeMessage(wa({ conversation: 'Hallo Almir' }))
  assert.deepEqual([d.kind, d.text, d.mediaType], ['content', 'Hallo Almir', null])
})

test('an extended text reply describes as its text and the quoted message id', () => {
  const d = describeMessage(wa({ extendedTextMessage: { text: 'Ja, mach das', contextInfo: { stanzaId: 'Q9' } } }))
  assert.deepEqual([d.text, d.replyTo], ['Ja, mach das', 'Q9'])
})

test('an image with caption describes as media type image and the caption', () => {
  const d = describeMessage(wa({ imageMessage: { caption: 'Automat 1040', mimetype: 'image/jpeg', mediaKey: Buffer.from([1, 2, 3]) } }))
  assert.deepEqual([d.kind, d.mediaType, d.text], ['content', 'image', 'Automat 1040'])
})

test('a document describes as media type document with its file name', () => {
  const d = describeMessage(wa({ documentMessage: { fileName: 'Strafverfuegung.pdf', mimetype: 'application/pdf' } }))
  assert.deepEqual([d.mediaType, d.text], ['document', 'Strafverfuegung.pdf'])
})

test('an ephemeral-wrapped text is unwrapped', () => {
  const d = describeMessage(wa({ ephemeralMessage: { message: { conversation: 'verschwindet' } } }))
  assert.equal(d.text, 'verschwindet')
})

test('an edit protocol message describes as an edit of the target id with the new text', () => {
  const d = describeMessage(wa({ protocolMessage: { type: 14, key: { id: 'M0' }, editedMessage: { conversation: 'korrigiert' } } }))
  assert.deepEqual([d.kind, d.targetId, d.text], ['edit', 'M0', 'korrigiert'])
})

test('a revoke protocol message describes as a delete of the target id', () => {
  const d = describeMessage(wa({ protocolMessage: { type: 0, key: { id: 'M0' } } }))
  assert.deepEqual([d.kind, d.targetId], ['revoke', 'M0'])
})

test('a reaction is skipped', () => {
  const d = describeMessage(wa({ reactionMessage: { text: '👍', key: { id: 'M0' } } }))
  assert.equal(d.kind, 'skip')
})

test('a message that could not be decrypted is kept with a visible marker', () => {
  const d = describeMessage(wa(undefined, { messageStubType: 2 }))
  assert.deepEqual([d.kind, d.text], ['content', '[could not decrypt]'])
})

test('a group notification stub is skipped', () => {
  const d = describeMessage(wa(undefined, { messageStubType: 20 }))
  assert.equal(d.kind, 'skip')
})

test('fold lowercases and strips diacritics so Kazazić matches kazazic', () => {
  assert.equal(fold('Kazazić ŠPÄTI'), 'kazazic spati')
})

test('sanitize removes terminal control sequences and indents embedded newlines', () => {
  assert.equal(sanitize('a\u001b[31mred\u0007\nnext'), 'a[31mred\n    next')
})

test('sanitize removes bidirectional override characters that could spoof a sender', () => {
  assert.equal(sanitize('me‮:txet'), 'me:txet')
})
