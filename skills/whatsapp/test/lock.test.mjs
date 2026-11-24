import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock } from '../lib/lock.mjs'

const lockPath = () => join(mkdtempSync(join(tmpdir(), 'wa-lock-')), 'lock')

test('a free lock is acquired and removed on release', () => {
  const path = lockPath()
  const release = acquireLock(path)
  assert.equal(existsSync(path), true)
  release()
  assert.equal(existsSync(path), false)
})

test('a lock held by a running process is refused with its pid', () => {
  const path = lockPath()
  writeFileSync(path, String(process.ppid))
  assert.throws(() => acquireLock(path), new RegExp(`held by running pid ${process.ppid}`))
})

test('a lock left by a dead process is taken over', () => {
  const path = lockPath()
  writeFileSync(path, '999999')
  const release = acquireLock(path)
  release()
  assert.equal(existsSync(path), false)
})
