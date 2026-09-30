import { describe, expect, it } from 'vitest'
import { parseJsonl } from './parser'
import { normalizeTrace } from './normalize'

describe('normalizeTrace', () => {
  it('never throws on unexpected input', () => {
    const text = [
      '{"foo":"bar"}',
      '42',
      '"just a string"',
      'not json at all',
      '[1,2,3]',
      'null',
      '{"role":"user","content":"hello"}',
    ].join('\n')

    const parsed = parseJsonl(text, 'weird.jsonl')
    let trace!: ReturnType<typeof normalizeTrace>
    expect(() => {
      trace = normalizeTrace(parsed)
    }).not.toThrow()

    expect(trace.fileName).toBe('weird.jsonl')
    // 6 valid JSON lines; 'not json at all' is a parse error
    expect(trace.recordCount).toBe(6)
    expect(trace.errors).toHaveLength(1)
    expect(Array.isArray(trace.orphanRecords)).toBe(true)
    expect(Array.isArray(trace.conversations)).toBe(true)
  })

  it('handles an empty file', () => {
    const trace = normalizeTrace(parseJsonl('', 'empty.jsonl'))
    expect(trace.conversations).toEqual([])
    expect(trace.orphanRecords).toEqual([])
    expect(trace.recordCount).toBe(0)
  })
})
