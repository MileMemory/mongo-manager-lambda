// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Gokhan OZGEZER
// Lambda handler: starts the Mongo Manager server once per container, then proxies each
// function URL / API Gateway (HTTP API v2) event to it over loopback. No layer is needed.
// WebSockets and streaming responses are not supported.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { request } from 'node:http'

const PORT = Number(process.env.MM_WEB_PORT ?? 8080)
const DATA_DIR = process.env.MM_DATA_DIR ?? '/tmp/mongo-manager'
const ROOT = process.env.LAMBDA_TASK_ROOT ?? import.meta.dirname

let ready

function startServer() {
  mkdirSync(DATA_DIR, { recursive: true })
  const child = spawn(process.execPath, [`${ROOT}/dist/cli.cjs`, 'start'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      MM_AUTH: process.env.MM_AUTH ?? '1',
      MM_HOST: '127.0.0.1',
      MM_WEB_PORT: String(PORT),
      MM_OPEN: '0',
      MM_DATA_DIR: DATA_DIR,
    },
  })
  const exited = new Promise((_, reject) => child.on('exit', (code) => reject(new Error(`server exited (${code})`))))
  const up = (async () => {
    for (let i = 0; i < 200; i++) {
      if (await probe()) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('server did not start in time')
  })()
  return Promise.race([up, exited])
}

function probe() {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: PORT, path: '/healthz', timeout: 500 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false)).on('timeout', () => req.destroy())
    req.end()
  })
}

export async function handler(event) {
  ready ??= startServer().catch((e) => {
    ready = undefined
    throw e
  })
  await ready

  const http = event.requestContext?.http
  const path = (event.rawPath ?? '/') + (event.rawQueryString ? `?${event.rawQueryString}` : '')
  const headers = { ...event.headers }
  if (event.cookies?.length) headers.cookie = event.cookies.join('; ')
  const body = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : undefined

  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: PORT, method: http?.method ?? 'GET', path, headers },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const out = { ...res.headers }
          const cookies = out['set-cookie']
          delete out['set-cookie']
          delete out['content-length']
          delete out['transfer-encoding']
          resolve({
            statusCode: res.statusCode,
            headers: out,
            cookies,
            body: Buffer.concat(chunks).toString('base64'),
            isBase64Encoded: true,
          })
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}
