import { describe, expect, it } from 'vitest'
import { ordinaryTransferIssue, validateTransferReceipt } from './bulk-transfer'
const task={id:'synthetic',status:'pending',revision:3,assigned_to:'old',allowed_actions:['transfer'],shift_id:'shift'}
const shift={status:'open',caregiver_ids:['new']}
describe('普通任务批量转交边界',()=>{
  it('仅开放班次允许的未开始普通任务可转交',()=>{
    expect(ordinaryTransferIssue(task,'new',shift)).toBe('')
    expect(ordinaryTransferIssue({...task,allowed_actions:[]},'new',shift)).toContain('未允许')
    expect(ordinaryTransferIssue({...task,condition:'先核对'},'new',shift)).toContain('逐项')
    expect(ordinaryTransferIssue({...task,status:'in_progress'},'new',shift)).toContain('尚未开始')
    expect(ordinaryTransferIssue(task,'new',{...shift,status:'closed'})).toContain('开放班次')
  })
  it('失败或旧回执不能计为成功',()=>{
    expect(()=>validateTransferReceipt({...task,assigned_to:'new'},task.id,3,'new')).toThrow('不匹配')
    expect(()=>validateTransferReceipt({...task,revision:4},task.id,3,'new')).toThrow('不匹配')
    expect(validateTransferReceipt({...task,revision:4,assigned_to:'new'},task.id,3,'new').revision).toBe(4)
  })
})
