// A jsdom page for the client-link tests (clientLinkShell.test.ts), set up before the modules under test load.
import { JSDOM } from 'jsdom'
export const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><iframe id="a"></iframe></body></html>', { url: 'https://studio.test/' })
const g = globalThis as Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
g.location = dom.window.location
g.MessageEvent = dom.window.MessageEvent
class FakeEvents { addEventListener() {} removeEventListener() {} close() {} }
g.EventSource = FakeEvents
