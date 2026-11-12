// Turns a Baileys WAMessage into the few fields the store keeps, and makes untrusted text safe to print.
import { normalizeMessageContent, getContentType, proto } from 'baileys'

const STUB_CIPHERTEXT = proto.WebMessageInfo.StubType.CIPHERTEXT
const PROTOCOL = proto.Message.ProtocolMessage.Type

const MEDIA = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
}

const SKIPPED = new Set([
  'reactionMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'pollUpdateMessage',
  'keepInChatMessage', 'pinInChatMessage', 'encReactionMessage',
])

export const toSeconds = (t) => (t == null ? null : typeof t === 'object' ? t.toNumber() : Number(t))

// Returns one of:
//   { kind: 'content', text, mediaType, replyTo }
//   { kind: 'edit', targetId, text }
//   { kind: 'revoke', targetId }
//   { kind: 'skip' }
export function describeMessage(waMsg) {
  const content = normalizeMessageContent(waMsg.message)
  if (!content) {
    if (waMsg.messageStubType === STUB_CIPHERTEXT) return { ...contentOf('[could not decrypt]'), undecrypted: true }
    return { kind: 'skip' }
  }
  const type = getContentType(content)
  if (!type || SKIPPED.has(type)) return { kind: 'skip' }

  if (type === 'protocolMessage') {
    const pm = content.protocolMessage
    if (pm.type === PROTOCOL.REVOKE) return { kind: 'revoke', targetId: pm.key?.id }
    if (pm.type === PROTOCOL.MESSAGE_EDIT && pm.editedMessage) {
      return { kind: 'edit', targetId: pm.key?.id, text: describeMessage({ message: pm.editedMessage }).text ?? null }
    }
    return { kind: 'skip' }
  }

  const body = content[type]
  const replyTo = body?.contextInfo?.stanzaId ?? null
  if (type === 'conversation') return contentOf(content.conversation, null, null)
  if (type === 'extendedTextMessage') return contentOf(body.text, null, replyTo)
  if (MEDIA[type]) {
    const text = type === 'documentMessage' ? [body.fileName, body.caption].filter(Boolean).join(' — ') : body.caption
    return contentOf(text || null, MEDIA[type], replyTo)
  }
  if (type === 'locationMessage') return contentOf(`[location ${body.degreesLatitude},${body.degreesLongitude}${body.name ? ' ' + body.name : ''}]`)
  if (type === 'contactMessage') return contentOf(`[contact ${body.displayName ?? ''}]`)
  if (type.startsWith('pollCreationMessage')) return contentOf(`[poll: ${body.name ?? ''}]`)
  return contentOf(`[${type}]`)
}

const contentOf = (text, mediaType = null, replyTo = null) => ({ kind: 'content', text, mediaType, replyTo, undecrypted: false })

// Case- and accent-insensitive form used for search: "Kazazić" -> "kazazic".
export const fold = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

// Message text and names come from other people: strip terminal control and bidi override characters
// (which could make a line look like it came from someone else), indent newlines.
export const sanitize = (s) =>
  String(s)
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\n/g, '\n    ')
