// Local copy of WhatsApp chats, contacts and messages (SQLite, built-in node:sqlite).
// Messages keep their original keys; a person's privacy id (@lid) and phone id (@s.whatsapp.net)
// are joined at query time through the aliases table.
import { DatabaseSync } from 'node:sqlite'
import { BufferJSON, proto } from 'baileys'
import { describeMessage, fold, toSeconds } from './format.mjs'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS chats(jid TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS contacts(jid TEXT PRIMARY KEY, name TEXT, notify TEXT, verified_name TEXT);
CREATE TABLE IF NOT EXISTS aliases(jid TEXT PRIMARY KEY, canonical TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(
  chat_jid TEXT NOT NULL, id TEXT NOT NULL, from_me INTEGER NOT NULL, ts INTEGER,
  sender_jid TEXT, sender_name TEXT, text TEXT, text_lc TEXT, media_type TEXT, reply_to_id TEXT,
  edited_ts INTEGER, deleted INTEGER NOT NULL DEFAULT 0, undecrypted INTEGER NOT NULL DEFAULT 0, raw_json TEXT NOT NULL,
  PRIMARY KEY(chat_jid, id, from_me));
CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_jid, ts);
CREATE TABLE IF NOT EXISTS pending_edits(chat_jid TEXT NOT NULL, id TEXT NOT NULL, text TEXT, edited_ts INTEGER,
  PRIMARY KEY(chat_jid, id));
CREATE TABLE IF NOT EXISTS pending_deletes(chat_jid TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(chat_jid, id));
CREATE TABLE IF NOT EXISTS sync_runs(command TEXT, started_at INTEGER, ended_at INTEGER, end_reason TEXT, messages INTEGER);
`

const isLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid')
const isPn = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')
const isGroup = (jid) => typeof jid === 'string' && jid.endsWith('@g.us')
const n = (v) => (v === undefined ? null : v)

export const serialize = (waMsg) => JSON.stringify(waMsg, BufferJSON.replacer)

// Protobuf toJSON turns bytes into base64 strings; fromObject turns them back into bytes.
export const restore = (raw) => {
  const obj = JSON.parse(raw, BufferJSON.reviver)
  const msg = proto.WebMessageInfo.fromObject(obj)
  msg.key = { ...obj.key } // keep Baileys-only key fields such as remoteJidAlt
  return msg
}

export function openStore(path) {
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)

  const q = (sql) => db.prepare(sql)
  const canonical = (jid) => q('SELECT canonical FROM aliases WHERE jid = ?').get(jid)?.canonical ?? jid
  const members = (jid) => {
    const c = canonical(jid)
    return [c, ...q('SELECT jid FROM aliases WHERE canonical = ?').all(c).map((r) => r.jid)]
  }
  const inList = (jids) => `(${jids.map(() => '?').join(',')})`

  const link = (a, b) => {
    const lid = isLid(a) ? a : isLid(b) ? b : null
    const pn = isPn(a) ? a : isPn(b) ? b : null
    if (lid && pn) q('INSERT INTO aliases(jid, canonical) VALUES(?, ?) ON CONFLICT(jid) DO UPDATE SET canonical = excluded.canonical').run(lid, pn)
  }

  // A delete for a message not stored yet is remembered and applied when the message arrives.
  const tombstone = (chatJid, id) => {
    const jids = members(chatJid)
    const res = q(`UPDATE messages SET deleted = 1, text = NULL, text_lc = NULL WHERE id = ? AND chat_jid IN ${inList(jids)}`).run(id, ...jids)
    if (res.changes === 0) q('INSERT OR IGNORE INTO pending_deletes(chat_jid, id) VALUES(?, ?)').run(canonical(chatJid), id)
  }

  // Only a newer edit wins; an edit for a message not stored yet waits in pending_edits.
  const applyEdit = (chatJid, id, text, editedTs) => {
    const jids = members(chatJid)
    const exists = q(`SELECT 1 FROM messages WHERE id = ? AND chat_jid IN ${inList(jids)}`).get(id, ...jids)
    if (exists) {
      q(`UPDATE messages SET text = ?, text_lc = ?, edited_ts = ?, undecrypted = 0
         WHERE id = ? AND deleted = 0 AND (edited_ts IS NULL OR edited_ts <= ?) AND chat_jid IN ${inList(jids)}`)
        .run(n(text), text == null ? null : fold(text), editedTs, id, editedTs, ...jids)
      return
    }
    q(`INSERT INTO pending_edits(chat_jid, id, text, edited_ts) VALUES(?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET text = excluded.text, edited_ts = excluded.edited_ts WHERE excluded.edited_ts >= pending_edits.edited_ts`)
      .run(canonical(chatJid), id, n(text), editedTs)
  }

  const upsertContent = (m, d) => {
    const chat = m.key.remoteJid
    const fromMe = m.key.fromMe ? 1 : 0
    const sender = fromMe ? null : (m.key.participant || chat)
    // Keep the stored version when it was edited, deleted, or is readable and the new copy is not.
    const keep = 'messages.edited_ts IS NOT NULL OR messages.deleted = 1 OR (excluded.undecrypted = 1 AND messages.undecrypted = 0)'
    q(`INSERT INTO messages(chat_jid, id, from_me, ts, sender_jid, sender_name, text, text_lc, media_type, reply_to_id, undecrypted, raw_json)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_jid, id, from_me) DO UPDATE SET
         sender_name = COALESCE(excluded.sender_name, messages.sender_name),
         text = CASE WHEN ${keep} THEN messages.text ELSE excluded.text END,
         text_lc = CASE WHEN ${keep} THEN messages.text_lc ELSE excluded.text_lc END,
         media_type = CASE WHEN ${keep} THEN messages.media_type ELSE excluded.media_type END,
         reply_to_id = CASE WHEN ${keep} THEN messages.reply_to_id ELSE excluded.reply_to_id END,
         undecrypted = CASE WHEN ${keep} THEN messages.undecrypted ELSE excluded.undecrypted END,
         raw_json = CASE WHEN ${keep} THEN messages.raw_json ELSE excluded.raw_json END`)
      .run(chat, m.key.id, fromMe, toSeconds(m.messageTimestamp), n(sender), n(m.pushName), n(d.text),
        d.text == null ? null : fold(d.text), d.mediaType, d.replyTo, d.undecrypted ? 1 : 0, serialize(m))
    const jids = members(chat)
    const deleted = q(`SELECT 1 FROM pending_deletes WHERE id = ? AND chat_jid IN ${inList(jids)}`).get(m.key.id, ...jids)
    if (deleted) {
      q(`DELETE FROM pending_deletes WHERE id = ? AND chat_jid IN ${inList(jids)}`).run(m.key.id, ...jids)
      tombstone(chat, m.key.id)
    }
    const pending = q(`SELECT text, edited_ts FROM pending_edits WHERE id = ? AND chat_jid IN ${inList(jids)} ORDER BY edited_ts DESC LIMIT 1`).get(m.key.id, ...jids)
    if (pending) {
      q(`DELETE FROM pending_edits WHERE id = ? AND chat_jid IN ${inList(jids)}`).run(m.key.id, ...jids)
      applyEdit(chat, m.key.id, pending.text, pending.edited_ts)
    }
  }

  // One logical message can be stored under a person's privacy id and phone id: keep the latest copy.
  const latestCopies = (jids) => `rowid IN (SELECT MAX(rowid) FROM messages WHERE chat_jid IN ${inList(jids)} GROUP BY id, from_me)`

  const rowOut = (r) => ({
    chatJid: r.chat_jid, id: r.id, fromMe: r.from_me === 1, ts: r.ts, senderJid: r.sender_jid, senderName: r.sender_name,
    text: r.text, mediaType: r.media_type, replyTo: r.reply_to_id, editedTs: r.edited_ts, deleted: r.deleted === 1,
  })
  const COLS = 'chat_jid, id, from_me, ts, sender_jid, sender_name, text, media_type, reply_to_id, edited_ts, deleted'

  const displayName = (jid) => {
    const jids = members(jid)
    const contact = (field) => jids.map((j) => q(`SELECT ${field} AS v FROM contacts WHERE jid = ?`).get(j)?.v).find(Boolean)
    const chatName = jids.map((j) => q('SELECT name FROM chats WHERE jid = ?').get(j)?.name).find(Boolean)
    if (isGroup(jid)) return chatName ?? jid
    const pn = jids.find(isPn)
    return contact('name') ?? chatName ?? contact('verified_name') ?? contact('notify') ?? (pn ? '+' + pn.split('@')[0] : jid)
  }

  const listChats = ({ limit }) =>
    q(`SELECT COALESCE(a.canonical, m.chat_jid) AS jid, MAX(m.ts) AS last_ts, COUNT(*) AS count
       FROM messages m LEFT JOIN aliases a ON a.jid = m.chat_jid
       GROUP BY 1 ORDER BY last_ts DESC LIMIT ?`).all(limit)
      .map((r) => ({ jid: r.jid, name: displayName(r.jid), lastTs: r.last_ts, count: r.count }))

  return {
    canonical,
    displayName,
    listChats,

    ingestMessages(list) {
      for (const m of list) {
        if (!m?.key?.remoteJid || !m.key.id) continue // no key: nothing to store it under
        if (m.key.remoteJidAlt) link(m.key.remoteJid, m.key.remoteJidAlt)
        if (m.key.participant && m.key.participantAlt) link(m.key.participant, m.key.participantAlt)
        const d = describeMessage(m)
        if (d.kind === 'content') upsertContent(m, d)
        else if (d.kind === 'edit' && d.targetId) applyEdit(m.key.remoteJid, d.targetId, d.text, toSeconds(m.messageTimestamp))
        else if (d.kind === 'revoke' && d.targetId) tombstone(m.key.remoteJid, d.targetId)
      }
    },

    applyUpdates(updates) {
      for (const { key, update } of updates) {
        if (!key?.remoteJid || !key.id || !update) continue
        if ('message' in update && update.message === null) {
          tombstone(key.remoteJid, key.id)
        } else if (update.message) {
          const d = describeMessage({ message: update.message })
          if (d.kind === 'edit') applyEdit(key.remoteJid, d.targetId ?? key.id, d.text, toSeconds(update.messageTimestamp) ?? Math.floor(Date.now() / 1000))
          if (d.kind === 'revoke') tombstone(key.remoteJid, d.targetId ?? key.id)
          if (d.kind === 'content') {
            // e.g. a retry that finally decrypted a stored "[could not decrypt]" placeholder
            const jids = members(key.remoteJid)
            for (const row of q(`SELECT raw_json FROM messages WHERE id = ? AND from_me = ? AND chat_jid IN ${inList(jids)}`).all(key.id, key.fromMe ? 1 : 0, ...jids)) {
              const stored = restore(row.raw_json)
              stored.message = proto.Message.fromObject(update.message)
              stored.messageStubType = null
              upsertContent(stored, d)
            }
          }
        }
      }
    },

    applyDeletes(payload) {
      if ('keys' in payload) for (const k of payload.keys) tombstone(k.remoteJid, k.id)
      else {
        const jids = members(payload.jid)
        q(`UPDATE messages SET deleted = 1, text = NULL, text_lc = NULL WHERE chat_jid IN ${inList(jids)}`).run(...jids)
      }
    },

    upsertContacts(list) {
      for (const c of list) {
        if (!c?.id) continue
        q(`INSERT INTO contacts(jid, name, notify, verified_name) VALUES(?, ?, ?, ?)
           ON CONFLICT(jid) DO UPDATE SET name = COALESCE(excluded.name, contacts.name),
             notify = COALESCE(excluded.notify, contacts.notify), verified_name = COALESCE(excluded.verified_name, contacts.verified_name)`)
          .run(c.id, n(c.name), n(c.notify), n(c.verifiedName))
        if (c.lid) link(c.id, c.lid)
        if (c.phoneNumber) link(c.id, c.phoneNumber)
      }
    },

    upsertChats(list) {
      for (const c of list) {
        if (!c?.id) continue
        q('INSERT INTO chats(jid, name) VALUES(?, ?) ON CONFLICT(jid) DO UPDATE SET name = COALESCE(excluded.name, chats.name)').run(c.id, n(c.name))
      }
    },

    addAlias({ lid, pn }) { link(lid, pn) },

    readChat(jid, { limit }) {
      const jids = members(jid)
      return q(`SELECT * FROM (SELECT ${COLS}, rowid FROM messages WHERE chat_jid IN ${inList(jids)} AND ${latestCopies(jids)}
                ORDER BY ts DESC, rowid DESC LIMIT ?) ORDER BY ts ASC, rowid ASC`).all(...jids, ...jids, limit).map(rowOut)
    },

    search(text, { chat, limit }) {
      const needle = fold(text)
      if (chat) {
        const jids = members(chat)
        return q(`SELECT ${COLS} FROM messages WHERE instr(text_lc, ?) > 0 AND chat_jid IN ${inList(jids)} AND ${latestCopies(jids)} ORDER BY ts DESC LIMIT ?`)
          .all(needle, ...jids, ...jids, limit).map(rowOut)
      }
      return q(`SELECT ${COLS} FROM messages WHERE instr(text_lc, ?) > 0 ORDER BY ts DESC LIMIT ?`).all(needle, limit).map(rowOut)
    },

    // strict (used for sending): only an exact JID or an exact, unique name. Never a partial match.
    resolveChat(query, { strict = false } = {}) {
      const raw = query.trim()
      if (raw.includes('@')) {
        if (!/^[\w.:-]+@(s\.whatsapp\.net|lid|g\.us)$/.test(raw)) throw new Error(`"${raw}" is not a WhatsApp JID (…@s.whatsapp.net, …@lid or …@g.us)`)
        return canonical(raw)
      }
      const seen = new Map()
      for (const c of listChats({ limit: 1_000_000 })) seen.set(c.jid, c.name)
      for (const { jid } of q('SELECT jid FROM contacts WHERE name IS NOT NULL').all()) {
        const c = canonical(jid)
        if (!seen.has(c)) seen.set(c, displayName(c))
      }
      const candidates = [...seen].map(([jid, name]) => ({ jid, name }))
      const want = fold(raw)
      const exact = candidates.filter((c) => fold(c.name) === want)
      if (exact.length === 1) return exact[0].jid
      if (strict) {
        throw new Error(`sending needs the exact name or JID; "${raw}" matches ${exact.length ? exact.length + ' chats exactly' : 'no chat name exactly'}. ` +
          'Look it up with `wa chats` / `wa read` and pass the JID.')
      }
      const digits = raw.replace(/\D/g, '')
      const phoneOf = (jid) => members(jid).filter(isPn).map((j) => j.split('@')[0]).join(' ')
      const hits = exact.length > 1 ? exact : candidates.filter((c) =>
        fold(c.name).includes(want) || (digits.length >= 5 && digits === raw.replace(/[\s+]/g, '') && phoneOf(c.jid).includes(digits)))
      if (hits.length === 1) return hits[0].jid
      if (hits.length === 0) throw new Error(`no chat matches "${raw}". Try \`wa chats\` or pass the full JID.`)
      throw new Error(`${hits.length} chats match "${raw}":\n` + hits.map((h) => `  ${h.name}  ${h.jid}`).join('\n') + '\nPass the exact name or JID.')
    },

    findMessage(id, { chat }) {
      let rows = q('SELECT chat_jid, from_me, raw_json FROM messages WHERE id = ? ORDER BY rowid DESC').all(id)
      if (chat) {
        const c = canonical(chat)
        rows = rows.filter((r) => canonical(r.chat_jid) === c)
      }
      // copies of one logical message (same chat via aliases, same direction) count once: newest copy
      const logical = new Map()
      for (const r of rows) {
        const k = `${canonical(r.chat_jid)}|${r.from_me}`
        if (!logical.has(k)) logical.set(k, r)
      }
      const found = [...logical.values()]
      if (found.length === 0) throw new Error(`no stored message has id ${id}${chat ? ` in ${chat}` : ''}`)
      if (found.length > 1) throw new Error(`${found.length} messages have id ${id} (chats: ${found.map((r) => r.chat_jid).join(', ')}); pass --chat`)
      return restore(found[0].raw_json)
    },

    getMessageContent(key) {
      const jids = members(key.remoteJid)
      const direction = key.fromMe == null ? '' : ` AND from_me = ${key.fromMe ? 1 : 0}`
      const row = q(`SELECT raw_json FROM messages WHERE id = ?${direction} AND chat_jid IN ${inList(jids)} ORDER BY rowid DESC`).get(key.id, ...jids)
      return row ? restore(row.raw_json).message ?? undefined : undefined
    },

    recordSyncRun({ command, startedAt, endedAt, endReason, messages }) {
      q('INSERT INTO sync_runs(command, started_at, ended_at, end_reason, messages) VALUES(?, ?, ?, ?, ?)').run(command, startedAt, endedAt, endReason, messages)
    },

    lastSyncRun() {
      const r = q('SELECT command, started_at, ended_at, end_reason, messages FROM sync_runs ORDER BY rowid DESC LIMIT 1').get()
      return r ? { command: r.command, startedAt: r.started_at, endedAt: r.ended_at, endReason: r.end_reason, messages: r.messages } : null
    },

    messageCount() { return q('SELECT COUNT(*) AS c FROM messages').get().c },

    close() { db.close() },
  }
}
