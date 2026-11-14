// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The client's links and the round, fed to the brief's Booth (features/align-booth.clan: "The client link and the
// round live in the brief's Booth under 'Record the client's answer'"). The links live on the server's document
// routes (`/d/{doc}/client-link...`), which the page's frame cannot reach, so the shell reads them and posts them to
// the page, and makes or withdraws a link when the page asks. The page draws; the host decides every state.
//
//   page -> shell  {type:'clan:client-links?'}                                   send me the list
//   page -> shell  {type:'clan:client-link', op:'make', people:[{name,email,approver}], code}
//   page -> shell  {type:'clan:client-link', op:'withdraw', id}
//   shell -> page  {type:'clan:client-links', links, round, code}                the list, the round, the code option
//   shell -> page  {type:'clan:client-link-made', links:[{name,email,url}]} or {type:'clan:client-link-made', error}

import { useEffect, useRef } from 'react'
import { host } from '../../host'
import { makeRound, readRound, roundOptions } from '../../host/http'
import { postToApp, isAppFrame } from '../appExport'
import { linksMessage } from './clientLinkWords'

type Ask =
  | { type: 'clan:client-links?' }
  | { type: 'clan:client-link'; op: 'make'; people?: unknown; code?: unknown }
  | { type: 'clan:client-link'; op: 'withdraw'; id?: unknown }

const said = (e: unknown) => String(e instanceof Error ? e.message : e)

/** The people the page named, kept to names and addresses (at most 12, as the round allows). */
function peopleOf(x: unknown): { name: string; email: string; approver: boolean }[] {
  if (!Array.isArray(x)) return []
  return x.slice(0, 12).flatMap(p => {
    const o = p as { name?: unknown; email?: unknown; approver?: unknown }
    const name = typeof o?.name === 'string' ? o.name.trim() : ''
    const email = typeof o?.email === 'string' ? o.email.trim() : ''
    return name && email ? [{ name, email, approver: o.approver === true }] : []
  })
}

/** Feed the open brief's page its client links and round while `on` (a brief, not a template, not client review). */
export function useClientLinkFeed(docPath: string, on: boolean) {
  const asked = useRef(false)
  useEffect(() => {
    if (!on) return
    let live = true
    asked.current = false
    const send = () => {
      void Promise.all([host.listClientLinks().catch(() => []), readRound(), roundOptions()]).then(([rows, round, opts]) => {
        if (live) postToApp(linksMessage(rows, round, opts.code))
      })
    }
    const made = (links: { name: string; email: string; path: string }[]) =>
      postToApp({ type: 'clan:client-link-made', links: links.map(l => ({ name: l.name, email: l.email, url: `${window.location.origin}${l.path}` })) })
    const onMessage = (e: MessageEvent) => {
      if (!isAppFrame(e.source)) return
      const m = e.data as Ask
      if (m?.type === 'clan:client-links?') { asked.current = true; send(); return }
      if (m?.type !== 'clan:client-link') return
      if (m.op === 'withdraw' && typeof m.id === 'string') {
        host.withdrawClientLink(m.id).then(send, err => { postToApp({ type: 'clan:client-link-made', error: said(err) }); send() })
        return
      }
      if (m.op !== 'make') return
      const people = peopleOf(m.people)
      if (!people.length) return
      const run = people.length === 1
        ? host.makeClientLink(people[0].name, people[0].email).then(l => [{ ...people[0], path: l.path }])
        : (people.some(p => p.approver) ? Promise.resolve() : Promise.reject(new Error('Choose who approves.')))
          .then(() => makeRound(people, m.code === true)).then(r => r.links)
      run.then(links => { made(links); send() }, err => postToApp({ type: 'clan:client-link-made', error: said(err) }))
    }
    window.addEventListener('message', onMessage)
    const offs = [host.on('clan-data-changed', () => { if (asked.current) send() })]
    return () => {
      live = false
      window.removeEventListener('message', onMessage)
      for (const off of offs) off.then(f => f()).catch(() => {})
    }
  }, [docPath, on])
}
