// One WhatsApp connection for one CLI command: connect (linking first if asked), feed every event
// into the store, run the command, save keys, disconnect. Never logs out (that would unlink the device).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from 'baileys'
import pino from 'pino'

const TRANSIENT = new Set([DisconnectReason.restartRequired, DisconnectReason.connectionLost, DisconnectReason.connectionClosed, 503])
const MAX_RECONNECTS = 5

export const logger = pino({ level: process.env.WA_LOG_LEVEL ?? 'error' }, pino.destination(2))

const statusOf = (err) => err?.output?.statusCode ?? err?.data?.statusCode ?? null

// useMultiFileAuthState treats an unreadable creds.json as "no account" and would start a fresh pairing.
function assertCredsReadable(authDir) {
  const file = join(authDir, 'creds.json')
  if (!existsSync(file)) return
  JSON.parse(readFileSync(file, 'utf8')) // throws on corruption: fail loud instead of re-pairing
}

export const isLinked = (home) => existsSync(join(home, 'linked'))

export async function withSession({ home, store, pairPhone = null, openTimeoutSec = 60, onEvent = () => {} }, task) {
  if (!pairPhone && !isLinked(home)) throw new Error('this machine is not linked to WhatsApp; run `wa link <phone>` first')
  const authDir = join(home, 'auth')
  assertCredsReadable(authDir)
  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  // Key saves run one after another. A failed save is fatal for the command (surfaced by the races below).
  let saving = Promise.resolve()
  let failedWith = null
  let resolveFailure
  const failure = new Promise((resolve) => { resolveFailure = resolve })
  const fail = (err) => { failedWith ??= err; resolveFailure(err) }
  const queueSave = () => { saving = saving.then(saveCreds).catch((err) => fail(new Error(`saving WhatsApp keys failed: ${err.message}`))) }
  const drainSaves = async () => {
    for (let seen; seen !== saving;) { seen = saving; await seen } // new saves may queue while we wait
  }
  // Baileys only logs exceptions thrown by event listeners; route them to `failure` so they stop the command.
  const guard = (fn) => (...args) => {
    try { fn(...args) } catch (err) { fail(err) }
  }

  const { version, isLatest, error } = await fetchLatestBaileysVersion()
  if (!isLatest) process.stderr.write(`warning: could not fetch the current WhatsApp Web version (${error?.message ?? 'unknown'}); using the bundled one\n`)

  const ctx = { lastEvent: Date.now(), history: [] }
  const touch = () => { ctx.lastEvent = Date.now(); onEvent() }

  const create = () => {
    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.macOS('Chrome'), // 'Desktop' is refused at registration (428) with rc14, tested 2026-11-11
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
      markOnlineOnConnect: false,
      getMessage: async (key) => store.getMessageContent(key),
    })
    sock.ev.on('creds.update', queueSave)
    sock.ev.on('messaging-history.set', guard(({ chats, contacts, messages, lidPnMappings, syncType, progress }) => {
      for (const m of lidPnMappings ?? []) store.addAlias(m)
      store.upsertContacts(contacts ?? [])
      store.upsertChats(chats ?? [])
      store.ingestMessages(messages ?? [])
      ctx.history.push({ syncType, progress, messages: messages?.length ?? 0 })
      touch()
    }))
    sock.ev.on('messaging-history.status', guard((s) => { ctx.history.push({ status: s.status, syncType: s.syncType }); touch() }))
    sock.ev.on('messages.upsert', guard(({ messages }) => { store.ingestMessages(messages); touch() }))
    sock.ev.on('messages.update', guard((u) => { store.applyUpdates(u); touch() }))
    sock.ev.on('messages.delete', guard((d) => { store.applyDeletes(d); touch() }))
    sock.ev.on('contacts.upsert', guard((c) => { store.upsertContacts(c); touch() }))
    sock.ev.on('contacts.update', guard((c) => { store.upsertContacts(c); touch() }))
    sock.ev.on('chats.upsert', guard((c) => { store.upsertChats(c); touch() }))
    sock.ev.on('chats.update', guard((c) => { store.upsertChats(c); touch() }))
    sock.ev.on('lid-mapping.update', guard((m) => { store.addAlias(m); touch() }))
    return sock
  }

  // Resolves { open: true } or { code, error } for the first open/close of this socket.
  const waitOpenOrClose = (sock, timeoutSec) => new Promise((resolve) => {
    let pairingRequested = false // per socket: a reconnect before the code was typed needs a new code
    failure.then((error) => resolve({ code: 'failed', error }))
    const timer = setTimeout(() => resolve({ code: 'timeout', error: new Error(`no connection after ${timeoutSec}s`) }), timeoutSec * 1000)
    sock.ev.on('connection.update', (u) => {
      if (u.qr) {
        if (!pairPhone) {
          clearTimeout(timer)
          resolve({ code: 'not-linked', error: new Error('this machine is not linked to WhatsApp; run `wa link <phone>` first') })
        } else if (!pairingRequested) {
          pairingRequested = true
          sock.requestPairingCode(pairPhone).then(
            (code) => process.stdout.write(`PAIRING CODE: ${code.slice(0, 4)}-${code.slice(4)}\nOn the phone: WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead → type the code.\n`),
            (err) => { clearTimeout(timer); resolve({ code: 'pairing-failed', error: err }) },
          )
        }
      }
      if (u.connection === 'open') { clearTimeout(timer); resolve({ open: true }) }
      if (u.connection === 'close') { clearTimeout(timer); resolve({ code: statusOf(u.lastDisconnect?.error), error: u.lastDisconnect?.error }) }
    })
  })

  let sock
  for (let attempt = 0; ; attempt++) {
    sock = create()
    const r = await waitOpenOrClose(sock, openTimeoutSec)
    if (r.open) break
    await drainSaves() // keys from pairing must be on disk before the restart
    await sock.end(undefined)
    if (r.code === 'failed') throw r.error
    if (TRANSIENT.has(r.code) && attempt < MAX_RECONNECTS) {
      if (r.code !== DisconnectReason.restartRequired) await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt))
      continue
    }
    if (r.code === DisconnectReason.loggedOut) throw new Error(`WhatsApp logged this device out (401). Delete ${authDir} and ${join(home, 'linked')}, then run \`wa link <phone>\`.`)
    if (r.code === DisconnectReason.connectionReplaced) throw new Error('another connection with these keys took over (440). Is another wa process or machine running?')
    throw new Error(`could not connect to WhatsApp (${r.code}): ${r.error?.message ?? 'no detail'}`)
  }

  writeFileSync(join(home, 'linked'), new Date().toISOString())
  ctx.me = sock.user?.id ?? null
  ctx.lastEvent = Date.now() // the quiet clock starts when the connection is up, not before pairing

  let closed
  const closedDuringTask = new Promise((resolve) => {
    closed = (u) => {
      if (u.connection === 'close') resolve(new Error(`WhatsApp connection closed during the command (${statusOf(u.lastDisconnect?.error)}): ${u.lastDisconnect?.error?.message ?? ''}`))
    }
    sock.ev.on('connection.update', closed)
  })
  try {
    const outcome = await Promise.race([
      task(sock, ctx).then((value) => ({ value })),
      closedDuringTask.then((error) => ({ error })),
      failure.then((error) => ({ error })),
    ])
    if (outcome.error) throw outcome.error
    return outcome.value
  } finally {
    sock.ev.off('connection.update', closed)
    await sock.end(undefined)
    await drainSaves()
    if (failedWith) throw failedWith // e.g. a key save that failed while disconnecting
  }
}

// Waits until no event arrived for quietSec, or maxSec passed. Returns 'idle' or 'deadline'.
export async function waitQuiet(ctx, { quietSec, maxSec }) {
  const start = Date.now()
  for (;;) {
    await new Promise((res) => setTimeout(res, 1000))
    if (Date.now() - ctx.lastEvent >= quietSec * 1000) return 'idle'
    if (Date.now() - start >= maxSec * 1000) return 'deadline'
  }
}
