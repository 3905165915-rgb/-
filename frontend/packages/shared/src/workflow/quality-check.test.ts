import { describe, expect, it } from 'vitest'
import { qualityFeedback, qualityModelUnavailable } from './quality-check'
describe('照护检查结果边界', () => {
  it('仅已知的模型失败可重新运行规则，未知503和超时不得清空待核实请求', () => {
    expect(qualityModelUnavailable(503, 'AI unavailable or output invalid; retry with include_ai=false')).toBe(true)
    expect(qualityModelUnavailable(503, 'gateway timeout')).toBe(false)
    expect(qualityModelUnavailable(504)).toBe(false)
  })
  it('区分未运行、演示及真实模型结果', () => {
    expect(qualityFeedback({id:'synthetic', issues:[],provider:null})).toContain('未运行模型')
    expect(qualityFeedback({id:'synthetic', issues:[],provider:'mock'})).toContain('演示数据')
    expect(qualityFeedback({id:'synthetic', issues:[],provider:'model'})).toContain('规则与模型')
    expect(() => qualityFeedback({issues:[]})).toThrow('回执不完整')
  })
  it('真实模型失败仍有提供方标识时，不误报完整成功', () => {
    const partial = {id:'synthetic', issues:[], provider:'deepseek:flash', model_status:'failed', execution_status:'partial', ai_status:'failed'}
    expect(qualityFeedback(partial)).toContain('模型分析未完成')
    expect(qualityFeedback(partial)).not.toContain('规则与模型检查已完成')
    expect(qualityFeedback({...partial, execution_status:'completed', ai_status:'completed'})).toContain('模型分析未完成')
  })
})
