// The Booth's rules (features/booth.clan; features/script-freeform.clan, owner 2026-11-16): its width for
// what is open, where it may hide, what a room starts as, and whose remembered state it is.

import { describe, expect, it } from 'vitest'
import { boothCanHide, boothEarned, boothGutter, boothKey, boothWidth, edgeLabel, rememberedOpen, shownOpen, startsOpen } from './state'

describe('the Booth', () => {
  it('is 420 for the whole script, 440 on a part or a selection, 420 in the Storyboard, 380 in the rooms; 320 in a narrow window', () => {
    expect(boothWidth('script', false, 1600)).toBe(420)
    expect(boothWidth('script', true, 1600)).toBe(440)
    expect(boothWidth('storyboard', false, 1600)).toBe(420)
    expect(boothWidth('storyboard', true, 1600)).toBe(420)
    expect(boothWidth('room', false, 1600)).toBe(380)
    expect(boothWidth('script', true, 1100)).toBe(320)
    expect(boothWidth('room', false, 1024)).toBe(320)
  })

  it('stays a column at 1100 px and below in the Script editor and the Storyboard; a room may hide at any width', () => {
    expect(boothCanHide('script', 1101)).toBe(true)
    expect(boothCanHide('script', 1100)).toBe(false)
    expect(boothCanHide('storyboard', 1024)).toBe(false)
    expect(boothCanHide('room', 1024)).toBe(true)
    expect(shownOpen('script', 1024, false)).toBe(true)
    expect(shownOpen('script', 1600, false)).toBe(false)
  })

  it('a room below 1280 px starts hidden; elsewhere it starts as the person left it', () => {
    expect(startsOpen('room', 1279, true)).toBe(false)
    expect(startsOpen('room', 1280, true)).toBe(true)
    expect(startsOpen('room', 1600, false)).toBe(false)
    expect(startsOpen('script', 1024, true)).toBe(true)
    expect(startsOpen('storyboard', 1200, false)).toBe(false)
  })

  it('keeps a 44 px gutter when hidden in the Storyboard and the rooms, none in the Script editor', () => {
    expect(boothGutter('script')).toBe(0)
    expect(boothGutter('storyboard')).toBe(44)
    expect(boothGutter('room')).toBe(44)
  })

  it('is remembered per person: shown unless this person hid it', () => {
    const memory = { [boothKey('p_maya')]: 'hidden' as const }
    expect(boothKey('p_maya')).toBe('human:p_maya')
    expect(boothKey(undefined)).toBe('local')
    expect(rememberedOpen(memory, boothKey('p_maya'))).toBe(false)
    expect(rememberedOpen(memory, boothKey('p_jo'))).toBe(true)
    expect(rememberedOpen(undefined, 'local')).toBe(true)
  })

  it('names what waits on its edge tab', () => {
    expect(edgeLabel(0)).toBe('Open the Booth')
    expect(edgeLabel(1)).toBe('Open the Booth, 1 thing waiting for you')
    expect(edgeLabel(2)).toBe('Open the Booth, 2 things waiting for you')
  })
  it('earns its place only for a selection, a library or the agent asked on purpose, or something waiting', () => {
    expect(boothEarned({})).toBe(false)
    expect(boothEarned({ waiting: 0 })).toBe(false)
    expect(boothEarned({ selection: true })).toBe(true)
    expect(boothEarned({ library: true })).toBe(true)
    expect(boothEarned({ asked: true })).toBe(true)
    expect(boothEarned({ waiting: 1 })).toBe(true)
  })
})
