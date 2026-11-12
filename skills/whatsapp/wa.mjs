#!/usr/bin/env -S node --no-warnings
// wa — read and (on explicit request) send personal WhatsApp messages. See SKILL.md and SPEC.md.
import { mkdirSync, chmodSync, existsSync, writeFileSync, linkSync, unlinkSync, appendFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { downloadMediaMessage, extractMessageContent, getContentType, proto } from 'baileys'
import { openStore } from './lib/store.mjs'
import { acquireLock } from './lib/lock.mjs'
import { withSession, waitQuiet, isLinked } from './lib/session.mjs'
import { sanitize } from './lib/format.mjs'

const HOME = process.env.WA_HOME ?? join(homedir(), '.whatsapp')

const USAGE = `usage: wa <command>
  status                                  linked?, store size, last sync
  link <phone>                            link this machine (international number, e.g. 43660...)
  sync [--quiet-sec 30] [--max-sec 300]   fetch new messages into the local store
  chats [--limit 30]                      chats, newest first
  read <chat> [--limit 50]                messages of one chat
  search <text> [--chat <chat>] [--limit 50]
  download <message-id> [--chat <chat>] [--out <dir>]
  send <chat> <text>                      only after Almir approved the exact text and recipient`

const fmtTime = (ts) => {
  if (!ts) return '????-??-?? ??:??'
  const d = new Date(ts * 1000)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function prepareHome() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 })
  chmodSync(HOME, 0o700)
}

const openHomeStore = () => { prepareHome(); return openStore(join(HOME, 'store.db')) }

function printMessages(store, rows, { withChat = false } = {}) {
  for (const r of rows) {
    const who = r.fromMe ? 'me' : sanitize(store.displayName(store.canonical(r.senderJid ?? r.chatJid)) ?? r.senderName ?? '?')
    const where = withChat ? `[${sanitize(store.displayName(store.canonical(r.chatJid)))}] ` : ''
    const body = r.deleted ? '[deleted]'
      : r.mediaType ? `[${r.mediaType}${r.text ? ': ' + sanitize(r.text) : ''}]`
      : sanitize(r.text ?? '')
    const extra = [r.mediaType ? `id=${r.id}` : null, r.replyTo ? `reply-to=${r.replyTo}` : null, r.editedTs ? 'edited' : null].filter(Boolean)
    console.log(`${fmtTime(r.ts)}  ${where}${who}: ${body}${extra.length ? '  (' + extra.join(', ') + ')' : ''}`)
  }
}

// Every command that connects holds the machine-wide lock for its whole lifetime.
async function connected(store, opts, task) {
  const release = acquireLock(join(HOME, 'lock'))
  try {
    return await withSession({ home: HOME, store, ...opts }, task)
  } finally {
    release()
  }
}

async function syncInto(store, command, { quietSec, maxSec, pairPhone = null, openTimeoutSec = 60 }) {
  const startedAt = Math.floor(Date.now() / 1000)
  const before = store.messageCount()
  const { endReason, history } = await connected(store, { pairPhone, openTimeoutSec }, async (sock, ctx) => {
    const endReason = await waitQuiet(ctx, { quietSec, maxSec })
    return { endReason, history: ctx.history }
  })
  const added = store.messageCount() - before
  store.recordSyncRun({ command, startedAt, endedAt: Math.floor(Date.now() / 1000), endReason, messages: added })
  const chunks = history.filter((h) => h.messages !== undefined).length
  console.log(`${command}: +${added} messages (${store.messageCount()} stored), ${chunks} history chunks, ended: ${endReason === 'idle' ? `no new events for ${quietSec}s` : `deadline of ${maxSec}s reached — more may still be coming, run sync again`}`)
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'application/pdf': 'pdf' }

const safeName = (s) => basename(String(s)).replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '')

// Writes data under a name that doesn't exist yet; never overwrites (link fails if the name is taken).
function saveMedia(msg, outDir, data) {
  const content = extractMessageContent(msg.message)
  const media = content?.[getContentType(content)]
  const ext = EXT[String(media?.mimetype ?? '').split(';')[0]] ?? 'bin'
  const name = (media?.fileName && safeName(media.fileName)) || `${safeName(msg.key.id)}.${ext}`
  mkdirSync(outDir, { recursive: true })
  const tmp = join(outDir, `.${name}.${process.pid}.part`)
  writeFileSync(tmp, data, { flag: 'wx' })
  try {
    for (let i = 0; ; i++) {
      const path = join(outDir, i === 0 ? name : name.replace(/(\.[^.]*)?$/, `-${i}$1`))
      try {
        linkSync(tmp, path)
        return path
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
      }
    }
  } finally {
    unlinkSync(tmp)
  }
}

const httpStatus = (err) => err?.output?.statusCode ?? err?.status
const ACK = proto.WebMessageInfo.Status

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      limit: { type: 'string' }, chat: { type: 'string' }, out: { type: 'string' },
      'quiet-sec': { type: 'string' }, 'max-sec': { type: 'string' },
    },
  })
  const int = (v, d) => {
    if (v === undefined) return d
    const x = Number(v)
    if (!Number.isSafeInteger(x) || x <= 0) throw new Error(`expected a positive whole number, got "${v}"`)
    return x
  }

  switch (command) {
    case 'status': {
      const store = openHomeStore()
      const credsFile = join(HOME, 'auth', 'creds.json')
      const me = existsSync(credsFile) ? JSON.parse(readFileSync(credsFile, 'utf8')).me?.id : null
      const last = store.lastSyncRun()
      const lockFile = join(HOME, 'lock')
      console.log(`linked: ${isLinked(HOME) ? `yes (${me ?? 'unknown id'})` : 'no — run `wa link <phone>`'}`)
      console.log(`stored messages: ${store.messageCount()}`)
      console.log(`last sync: ${last ? `${fmtTime(last.endedAt)} (${last.command}, +${last.messages}, ended ${last.endReason})` : 'never'}`)
      if (existsSync(lockFile)) console.log(`lock: held by pid ${readFileSync(lockFile, 'utf8')}`)
      return
    }
    case 'link': {
      const phone = (positionals[0] ?? '').replace(/[\s()-]/g, '').replace(/^\+/, '').replace(/^00/, '')
      if (!/^\d{8,15}$/.test(phone)) throw new Error('give the phone number in international form, digits only, e.g. 436601234567')
      if (isLinked(HOME)) throw new Error(`already linked. To relink, unlink it on the phone, then delete ${join(HOME, 'auth')} and ${join(HOME, 'linked')}.`)
      const store = openHomeStore()
      // First link: history arrives right after pairing, so stay connected and store it.
      await syncInto(store, 'link', { pairPhone: phone, openTimeoutSec: 300, quietSec: 60, maxSec: 900 })
      return
    }
    case 'sync': {
      const store = openHomeStore()
      await syncInto(store, 'sync', { quietSec: int(values['quiet-sec'], 30), maxSec: int(values['max-sec'], 300) })
      return
    }
    case 'chats': {
      const store = openHomeStore()
      for (const c of store.listChats({ limit: int(values.limit, 30) })) {
        console.log(`${fmtTime(c.lastTs)}  ${sanitize(c.name)}  ${c.jid}  (${c.count} msgs)`)
      }
      return
    }
    case 'read': {
      if (!positionals[0]) throw new Error('read needs a chat')
      const store = openHomeStore()
      const jid = store.resolveChat(positionals[0])
      console.log(`# ${sanitize(store.displayName(jid))}  ${jid}`)
      printMessages(store, store.readChat(jid, { limit: int(values.limit, 50) }))
      return
    }
    case 'search': {
      if (!positionals[0]) throw new Error('search needs text')
      const store = openHomeStore()
      const chat = values.chat ? store.resolveChat(values.chat) : null
      printMessages(store, store.search(positionals.join(' '), { chat, limit: int(values.limit, 50) }), { withChat: !chat })
      return
    }
    case 'download': {
      if (!positionals[0]) throw new Error('download needs a message id')
      const store = openHomeStore()
      const chat = values.chat ? store.resolveChat(values.chat) : null
      const msg = store.findMessage(positionals[0], { chat })
      const outDir = resolve(values.out ?? '.')
      let data
      try {
        data = await downloadMediaMessage(msg, 'buffer', {}) // offline first: no connection needed while the media URL is valid
      } catch (err) {
        if (![404, 410].includes(httpStatus(err))) throw err
        // Expired media URL: ask the sender's phone to re-upload (needs a live connection), then download the fresh copy.
        data = await connected(store, {}, async (sock) => {
          const refreshed = await sock.updateMediaMessage(msg)
          store.ingestMessages([refreshed])
          return downloadMediaMessage(refreshed, 'buffer', {})
        })
      }
      console.log(saveMedia(msg, outDir, data))
      return
    }
    case 'send': {
      const [chatArg, ...words] = positionals
      const text = words.join(' ')
      if (!chatArg || !text) throw new Error('send needs a chat and a text')
      const store = openHomeStore()
      const jid = store.resolveChat(chatArg, { strict: true })
      const logFile = join(HOME, 'sent.log')
      const logLine = (o) => appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), to: jid, ...o }) + '\n', { mode: 0o600 })
      logLine({ status: 'sending', text })
      let result
      try {
        result = await connected(store, {}, async (sock) => {
          // sendMessage resolves once the stanza is written; the server's verdict comes later as a status update.
          const statuses = new Map()
          sock.ev.on('messages.update', (updates) => {
            for (const { key, update } of updates) if (update?.status != null) statuses.set(key.id, update.status)
          })
          const m = await sock.sendMessage(jid, { text })
          store.ingestMessages([m])
          logLine({ status: 'written', id: m.key.id })
          for (let waited = 0; waited < 15_000; waited += 250) {
            const st = statuses.get(m.key.id)
            if (st === ACK.ERROR) return { m, outcome: 'rejected' }
            if (st >= ACK.SERVER_ACK) {
              await new Promise((res) => setTimeout(res, 2000)) // stay for retry requests from the recipient's devices
              return { m, outcome: 'accepted' }
            }
            await new Promise((res) => setTimeout(res, 250))
          }
          return { m, outcome: 'no-ack' }
        })
      } catch (err) {
        logLine({ status: 'uncertain', error: err.message })
        throw new Error(`${err.message}\nThe message MAY have been sent. Check the chat on the phone before retrying — do not resend blindly.`)
      }
      const { m, outcome } = result
      logLine({ status: outcome, id: m.key.id })
      if (outcome === 'rejected') throw new Error(`WhatsApp rejected the message to ${jid} (id ${m.key.id}). It was not delivered.`)
      if (outcome === 'no-ack') throw new Error(`no server confirmation within 15 s for the message to ${jid} (id ${m.key.id}). It MAY have been sent — check the chat on the phone, do not resend blindly.`)
      console.log(`sent to ${sanitize(store.displayName(jid))} (${jid}), id=${m.key.id}, accepted by the server`)
      return
    }
    default:
      console.log(USAGE)
      process.exitCode = command ? 1 : 0
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0), // Baileys keeps timers alive; exit explicitly once work and key saves are done
  (err) => {
    process.stderr.write(`wa: ${err.message}\n`)
    process.exit(1)
  },
)
