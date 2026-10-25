// A model draft, an acknowledged write, and a directory refresh are different operations.
export function submissionFeedback(path: string, method: string) {
  const recordDraft = /\/records\/(?:context-extract|extract)$/.test(path) && method !== 'get'
  const handoverDraft = /\/ai-summary$/.test(path) && method !== 'get'
  const qualityCheck = /\/quality\/(?:scan|checks)$/.test(path) && method !== 'get'
  const assisted = recordDraft || handoverDraft || qualityCheck
  return {
    assisted,
    button: method === 'get' ? '正在读取…' : qualityCheck ? '正在检查…' : assisted ? '正在整理内容…' : '正在保存…',
    waiting: qualityCheck ? '正在检查记录与接续情况，请勿重复操作；检查结果仍需主管核对。'
      : handoverDraft ? '正在整理交班草稿，请勿重复操作；完成后还需人工核对并正式提交。'
      : recordDraft ? '正在整理资料，尚未保存正式记录。原文已保留，请勿重复操作；完成后还需人工核对。'
      : method === 'get' ? '正在读取服务器资料。' : '正在保存已核对的内容，此步骤不重新调用模型。请勿重复提交。',
    success: method === 'get' ? '已读取服务器当前数据。'
      : path === '/tasks' && method === 'post' ? '任务已创建，服务器已确认；请在任务列表继续核验执行条件。'
      : qualityCheck ? '检查完成，请由主管核对；未自动判定责任或修改任务。'
      : handoverDraft ? '交班草稿已整理，请核对后再正式提交。'
      : recordDraft ? '整理完成，请核对结果；正式记录尚未保存。' : '已保存，服务器已确认成功。',
  }
}
