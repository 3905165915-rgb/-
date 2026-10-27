import { afterEach, expect, it, vi } from 'vitest'
import { acceptDemoBatch, demoBatch } from './demo-batch'
function storage(initial: Record<string,string> = {}) {
  const result: Record<string,unknown> = {...initial}
  Object.defineProperties(result, {
    getItem: {value:(key:string)=>result[key] ?? null},
    setItem: {value:(key:string,value:string)=>{result[key]=value}},
    removeItem: {value:(key:string)=>{delete result[key]}},
  })
  return result
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it('first clean login accepts a batch without redirecting or deleting unrelated storage',()=>{
  const local=storage({'unrelated':'keep','hulao:old-draft':'old'})
  const session=storage()
  vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session)
  const dispatch=vi.fn();vi.stubGlobal('window',{dispatchEvent:dispatch})
  acceptDemoBatch('new')
  expect(demoBatch()).toBe('new');expect(local['hulao:old-draft']).toBeUndefined()
  expect(local.unrelated).toBe('keep');expect(dispatch).not.toHaveBeenCalled()
})
it('changed batch removes drafts and current login then requests one reload',()=>{
  vi.useFakeTimers()
  const local=storage({'hulao:demo-batch':'old','hulao:offline':'old'})
  const session=storage({'hulao:session:v2':'old-login'})
  vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session)
  const reload=vi.fn(),dispatch=vi.fn();vi.stubGlobal('window',{dispatchEvent:dispatch,location:{reload}})
  expect(()=>acceptDemoBatch('new')).toThrow('演示资料已更新')
  expect(session['hulao:session:v2']).toBeUndefined();expect(local['hulao:offline']).toBeUndefined()
  vi.runAllTimers();expect(reload).toHaveBeenCalledOnce()
  acceptDemoBatch('new');expect(dispatch).toHaveBeenCalledOnce()
})
it('storage denial gives an actionable message without a reload loop',()=>{
  vi.stubGlobal('localStorage',storage())
  vi.stubGlobal('sessionStorage',{getItem:()=>{throw new Error('denied')}})
  expect(()=>acceptDemoBatch('new')).toThrow('请允许网站存储')
})
