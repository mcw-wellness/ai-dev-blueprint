import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { proto } from 'baileys'
import { openStore } from '../lib/store.mjs'

const SAMIR = '436601234567@s.whatsapp.net'
const SAMIR_LID = '99887766@lid'
const GROUP = '120363000000@g.us'

const freshStore = () => openStore(join(mkdtempSync(join(tmpdir(), 'wa-test-')), 'store.db'))

const msg = ({ chat = SAMIR, id = 'M1', fromMe = false, ts = 1762900000, text = 'Hallo', message, pushName = 'Samir', participant, remoteJidAlt } = {}) =>
  proto.WebMessageInfo.fromObject({
    key: { remoteJid: chat, id, fromMe, participant },
    messageTimestamp: ts,
    pushName,
    message: message ?? { conversation: text },
  })

const withAlt = (m, remoteJidAlt) => { m.key.remoteJidAlt = remoteJidAlt; return m }

test('ingesting the same message twice keeps one row with the newer content', () => {
  const store = freshStore()
  store.ingestMessages([msg({ text: 'alt' })])
  store.ingestMessages([msg({ text: 'neu' })])
  const rows = store.readChat(SAMIR, { limit: 50 })
  assert.deepEqual(rows.map(r => r.text), ['neu'])
})

test('chats are listed newest first with the address-book name over the push name', () => {
  const store = freshStore()
  store.ingestMessages([msg({ chat: SAMIR, id: 'A', ts: 100 }), msg({ chat: GROUP, id: 'B', ts: 200, participant: SAMIR })])
  store.upsertChats([{ id: GROUP, name: 'Späti Team' }])
  store.upsertContacts([{ id: SAMIR, name: 'Samir Späti', notify: 'Sam' }])
  const chats = store.listChats({ limit: 10 })
  assert.deepEqual(chats.map(c => [c.jid, c.name]), [[GROUP, 'Späti Team'], [SAMIR, 'Samir Späti']])
})

test('a partial contact update with only a push name keeps the saved address-book name', () => {
  const store = freshStore()
  store.ingestMessages([msg()])
  store.upsertContacts([{ id: SAMIR, name: 'Samir Späti' }])
  store.upsertContacts([{ id: SAMIR, notify: 'Sam' }])
  assert.equal(store.listChats({ limit: 10 })[0].name, 'Samir Späti')
})

test('reading a chat returns the newest N messages in chronological order', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'A', ts: 1, text: 'eins' }), msg({ id: 'B', ts: 2, text: 'zwei' }), msg({ id: 'C', ts: 3, text: 'drei' })])
  assert.deepEqual(store.readChat(SAMIR, { limit: 2 }).map(r => r.text), ['zwei', 'drei'])
})

test('messages under a privacy id and a phone id of the same person read as one chat', () => {
  const store = freshStore()
  store.ingestMessages([withAlt(msg({ chat: SAMIR_LID, id: 'A', ts: 1, text: 'über lid' }), SAMIR)])
  store.ingestMessages([msg({ chat: SAMIR, id: 'B', ts: 2, text: 'über nummer' })])
  assert.deepEqual(store.readChat(SAMIR, { limit: 10 }).map(r => r.text), ['über lid', 'über nummer'])
  assert.equal(store.listChats({ limit: 10 }).length, 1)
})

test('an edit replaces the text of the original message and keeps its time', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'A', ts: 100, text: 'Tippfehlr' })])
  store.ingestMessages([msg({ id: 'E1', ts: 150, message: { protocolMessage: { type: 14, key: { id: 'A' }, editedMessage: { conversation: 'Tippfehler' } } } })])
  const rows = store.readChat(SAMIR, { limit: 10 })
  assert.deepEqual(rows.map(r => [r.id, r.ts, r.text, r.editedTs]), [['A', 100, 'Tippfehler', 150]])
})

test('an edit that arrives before its original is applied when the original arrives', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'E1', ts: 150, message: { protocolMessage: { type: 14, key: { id: 'A' }, editedMessage: { conversation: 'neu' } } } })])
  store.ingestMessages([msg({ id: 'A', ts: 100, text: 'alt' })])
  assert.deepEqual(store.readChat(SAMIR, { limit: 10 }).map(r => r.text), ['neu'])
})

test('old history arriving after an edit does not restore the old text', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'A', text: 'alt' })])
  store.ingestMessages([msg({ id: 'E1', ts: 150, message: { protocolMessage: { type: 14, key: { id: 'A' }, editedMessage: { conversation: 'neu' } } } })])
  store.ingestMessages([msg({ id: 'A', text: 'alt' })])
  assert.deepEqual(store.readChat(SAMIR, { limit: 10 }).map(r => r.text), ['neu'])
})

test('a revoked message stays as a deleted marker and drops out of search', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'A', text: 'geheim' })])
  store.ingestMessages([msg({ id: 'R1', message: { protocolMessage: { type: 0, key: { id: 'A' } } } })])
  assert.deepEqual(store.readChat(SAMIR, { limit: 10 }).map(r => [r.text, r.deleted]), [[null, true]])
  assert.equal(store.search('geheim', { limit: 10 }).length, 0)
})

test('a status-only update does not erase message content', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'A', text: 'bleibt' })])
  store.applyUpdates([{ key: { remoteJid: SAMIR, id: 'A', fromMe: false }, update: { status: 4 } }])
  assert.deepEqual(store.readChat(SAMIR, { limit: 10 }).map(r => r.text), ['bleibt'])
})

test('an update with a null message marks the message deleted', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'A', text: 'weg' })])
  store.applyUpdates([{ key: { remoteJid: SAMIR, id: 'A', fromMe: false }, update: { message: null } }])
  assert.equal(store.readChat(SAMIR, { limit: 10 })[0].deleted, true)
})

test('search is case- and accent-insensitive and can be scoped to one chat', () => {
  const store = freshStore()
  store.ingestMessages([msg({ chat: SAMIR, id: 'A', text: 'Foto vom ÄUTOMAT' }), msg({ chat: GROUP, id: 'B', text: 'automat kaputt', participant: SAMIR })])
  assert.equal(store.search('automat', { limit: 10 }).length, 2)
  assert.deepEqual(store.search('automat', { chat: SAMIR, limit: 10 }).map(r => r.id), ['A'])
})

test('search treats % and _ literally', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'A', text: '100% sicher' }), msg({ id: 'B', text: '100 sicher' })])
  assert.deepEqual(store.search('100%', { limit: 10 }).map(r => r.id), ['A'])
})

test('a chat resolves by exact jid, exact name, or unique name or phone substring', () => {
  const store = freshStore()
  store.ingestMessages([msg({ chat: SAMIR, id: 'A' }), msg({ chat: GROUP, id: 'B', participant: SAMIR })])
  store.upsertContacts([{ id: SAMIR, name: 'Samir Späti' }])
  store.upsertChats([{ id: GROUP, name: 'Späti Team' }])
  assert.equal(store.resolveChat(SAMIR), SAMIR)
  assert.equal(store.resolveChat('späti team'), GROUP)
  assert.equal(store.resolveChat('samir'), SAMIR)
  assert.equal(store.resolveChat('1234567'), SAMIR)
})

test('an ambiguous or unknown chat fails and lists the candidates', () => {
  const store = freshStore()
  store.ingestMessages([msg({ chat: SAMIR, id: 'A' }), msg({ chat: GROUP, id: 'B', participant: SAMIR })])
  store.upsertContacts([{ id: SAMIR, name: 'Samir Späti' }])
  store.upsertChats([{ id: GROUP, name: 'Späti Team' }])
  assert.throws(() => store.resolveChat('späti'), /2 chats match.*Samir Späti.*Späti Team/s)
  assert.throws(() => store.resolveChat('nobody'), /no chat matches/)
})

test('a stored media message restores to a real message with the original media key bytes', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'IMG', message: { imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.from([1, 2, 3]), directPath: '/v/t62/x' } } })])
  const restored = store.findMessage('IMG', {})
  assert.deepEqual([...restored.message.imageMessage.mediaKey], [1, 2, 3])
  assert.equal(restored.key.id, 'IMG')
})

test('finding a message id that exists in two chats fails unless the chat is given', () => {
  const store = freshStore()
  store.ingestMessages([msg({ chat: SAMIR, id: 'X', text: 'a' }), msg({ chat: GROUP, id: 'X', text: 'b', participant: SAMIR })])
  assert.throws(() => store.findMessage('X', {}), /2 messages have id X/)
  assert.equal(store.findMessage('X', { chat: GROUP }).message.conversation, 'b')
})

test('getMessageContent returns the inner message for a retry request', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'S1', fromMe: true, text: 'gesendet' })])
  assert.equal(store.getMessageContent({ remoteJid: SAMIR, id: 'S1', fromMe: true }).conversation, 'gesendet')
})

test('sync runs are recorded and the last one is reported', () => {
  const store = freshStore()
  store.recordSyncRun({ command: 'sync', startedAt: 1, endedAt: 2, endReason: 'idle', messages: 5 })
  store.recordSyncRun({ command: 'sync', startedAt: 3, endedAt: 4, endReason: 'deadline', messages: 7 })
  assert.deepEqual(store.lastSyncRun(), { command: 'sync', startedAt: 3, endedAt: 4, endReason: 'deadline', messages: 7 })
})

test('a later undecryptable copy of a message does not replace its decrypted text', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'A', text: 'lesbar' })])
  store.ingestMessages([proto.WebMessageInfo.fromObject({ key: { remoteJid: SAMIR, id: 'A', fromMe: false }, messageTimestamp: 1762900000, messageStubType: 2 })])
  assert.deepEqual(store.readChat(SAMIR, { limit: 10 }).map(r => r.text), ['lesbar'])
})

test('a retry that decrypts a stored placeholder fills in the text', () => {
  const store = freshStore()
  store.ingestMessages([proto.WebMessageInfo.fromObject({ key: { remoteJid: SAMIR, id: 'A', fromMe: false }, messageTimestamp: 1762900000, messageStubType: 2 })])
  store.applyUpdates([{ key: { remoteJid: SAMIR, id: 'A', fromMe: false }, update: { message: { conversation: 'jetzt lesbar' } } }])
  assert.deepEqual(store.readChat(SAMIR, { limit: 10 }).map(r => r.text), ['jetzt lesbar'])
})

test('an older edit arriving after a newer one does not win', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'A', ts: 100, text: 'v1' })])
  store.ingestMessages([msg({ id: 'E2', ts: 300, message: { protocolMessage: { type: 14, key: { id: 'A' }, editedMessage: { conversation: 'v3' } } } })])
  store.ingestMessages([msg({ id: 'E1', ts: 200, message: { protocolMessage: { type: 14, key: { id: 'A' }, editedMessage: { conversation: 'v2' } } } })])
  assert.deepEqual(store.readChat(SAMIR, { limit: 10 }).map(r => [r.text, r.editedTs]), [['v3', 300]])
})

test('a delete that arrives before its message keeps the message deleted', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'R1', message: { protocolMessage: { type: 0, key: { id: 'A' } } } })])
  store.ingestMessages([msg({ id: 'A', text: 'geheim' })])
  assert.deepEqual(store.readChat(SAMIR, { limit: 10 }).map(r => [r.text, r.deleted]), [[null, true]])
})

test('the same message stored under the privacy id and the phone id is shown once and found once', () => {
  const store = freshStore()
  store.ingestMessages([withAlt(msg({ chat: SAMIR_LID, id: 'IMG', message: { imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.from([1]) } } }), SAMIR)])
  store.ingestMessages([msg({ chat: SAMIR, id: 'IMG', message: { imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.from([1]) } } })])
  assert.equal(store.readChat(SAMIR, { limit: 10 }).length, 1)
  assert.equal(store.findMessage('IMG', { chat: SAMIR }).key.id, 'IMG')
})

test('a retry request for my own message gets my text, not an incoming message with the same id', () => {
  const store = freshStore()
  store.ingestMessages([msg({ id: 'S1', fromMe: false, text: 'von Samir' }), msg({ id: 'S1', fromMe: true, text: 'von mir' })])
  assert.equal(store.getMessageContent({ remoteJid: SAMIR, id: 'S1', fromMe: true }).conversation, 'von mir')
})

test('strict resolution for sending accepts only an exact name or JID', () => {
  const store = freshStore()
  store.ingestMessages([msg({ chat: SAMIR, id: 'A' })])
  store.upsertContacts([{ id: SAMIR, name: 'Samir Späti' }])
  assert.equal(store.resolveChat('samir späti', { strict: true }), SAMIR)
  assert.throws(() => store.resolveChat('samir', { strict: true }), /exact name or JID/)
})
