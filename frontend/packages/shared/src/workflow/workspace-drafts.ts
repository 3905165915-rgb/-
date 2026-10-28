import type { FrontendSession } from '../session'
import { demoBatch } from '../demo-batch'
export interface WorkspaceDraft {key:string;raw:string;objectId:string;operation:string;bytes:number;updatedAt:string;protected:boolean;title:string}
const names:Record<string,string>={'arrangement-form':'照护安排编辑','record-text':'记录编辑','record-receipt':'记录提交凭证','care-guidance-text':'生活照护提示编辑','task-result-text':'任务结果编辑','bulk-transfer':'普通任务批量转交'}
export function listWorkspaceDrafts(storage:Pick<Storage,'length'|'key'|'getItem'>,owner:FrontendSession|null):WorkspaceDraft[]{
  if(!owner||owner.mode!=='api')return[]
  const result:WorkspaceDraft[]=[]
  for(let index=0;index<storage.length;index++){
    const key=storage.key(index)
    if(!key?.startsWith('hulao:workspace:'))continue
    try{
      const identity=JSON.parse(key.slice('hulao:workspace:'.length))
      if(!Array.isArray(identity)||identity.length!==7||identity[0]!==owner.mode||identity[1]!==demoBatch()||identity[2]!==owner.accountKey||identity[3]!==owner.userId||identity[4]!==owner.role)continue
      const raw=storage.getItem(key);if(!raw)continue
      const value=JSON.parse(raw)
      if(!value||typeof value!=='object'||Array.isArray(value))continue
      const operation=String(identity[6])
      const editable=['arrangement-form','record-text','care-guidance-text','task-result-text'].includes(operation)
      result.push({key,raw,objectId:String(identity[5]),operation,bytes:new Blob([raw]).size,updatedAt:typeof value.updated_at==='string'?value.updated_at:'',protected:!editable||!!value.path||!!value.key||value.phase==='pending',title:names[operation]||'待核实业务提交'})
    }catch{ /* Unknown or damaged entries remain untouched. */ }
  }
  return result
}
export function deleteWorkspaceDraft(storage:Pick<Storage,'length'|'key'|'getItem'|'removeItem'>,entry:WorkspaceDraft,owner:FrontendSession|null){
  const current=listWorkspaceDrafts(storage,owner).find(row=>row.key===entry.key)
  if(!current||current.protected||current.raw!==entry.raw)throw new Error('内容已变化或属于待核实提交，不能删除。')
  storage.removeItem(entry.key)
}
