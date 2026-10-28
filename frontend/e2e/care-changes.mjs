import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base=process.env.PROFILE_WORKFLOW_URL || 'http://127.0.0.1:5180'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Synthetic loopback environment required')
const output='test-results/care-changes'
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const errors=[]
async function login(role){
 const response=await fetch(base+'/api/v1/auth/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})})
 assert.equal(response.status,200)
 return response.json()
}
const admin=await login('admin')
async function api(path,method='GET',body){
 const response=await fetch(base+'/api/v1'+path,{method,headers:{Authorization:'Bearer '+admin.access_token,'Content-Type':'application/json','Idempotency-Key':'care-changes-'+crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{})})
 assert.ok(response.ok,path+' returned '+response.status)
 return response.json()
}
async function pageFor(login,width){
 const context=await browser.newContext({viewport:{width,height:900}})
 await context.addInitScript(login=>sessionStorage.setItem('hulao:session:v2',JSON.stringify({mode:'api',accountKey:'care-changes-'+login.role,userId:login.user_id,role:login.role,accessToken:login.access_token})),login)
 const page=await context.newPage();page.setDefaultTimeout(30000)
 page.on('pageerror',error=>errors.push(error.message))
 return page
}
try{
 const elders=await api('/elders')
 assert.deepEqual(elders.map(row=>row.name),['王爷爷'])
 let cases=await api('/change-reviews')
 if (!cases.length) {
 const memories=await api('/elders/'+elders[0].id+'/understanding')
 const memory=memories.confirmed.find(row=>row.scenes.includes('activity'))
 assert.ok(memory)
 const tasks=await api('/tasks')
 const task=tasks.find(row=>row.status==='pending')
 assert.ok(task)
 await api('/tasks/'+task.id+'/memory-references','POST',{expected_task_revision:task.revision,memory_id:memory.id,expected_memory_revision:memory.revision,scene:'activity',reason:'本机验收核对老人活动意愿'})
 const source=await api('/records/'+memory.source.record_id)
 await api('/records/'+source.id+'/corrections','POST',{expected_revision:source.revision,reason:'本机隔离资料核对偏好变化',observations:['本人表示今天想在房间休息，参加活动前先询问意愿。']})
 cases=await api('/change-reviews')
 }
 const item=cases.find(row=>row.status==='pending')
 assert.ok(item)
 const page=await pageFor(admin,1440)
 await page.goto(base+'/changes')
 const centre=page.getByRole('region',{name:'照护变化',exact:true})
 await centre.getByRole('heading',{name:'照护变化',exact:true}).waitFor()
 await centre.getByRole('button',{name:'查看并处理',exact:true}).first().waitFor()
 assert.equal(await centre.getByRole('button',{name:'读取当前数据',exact:true}).isVisible().catch(()=>false),false)
 assert.equal((await centre.innerText()).includes('新增、更正和重要遗留'),false)
 await page.screenshot({path:output+'/overview.png',fullPage:true})
 console.log('PASS 照护变化自动加载，默认显示事项卡片，没有多组后台表单')
 await centre.locator('.change-card').filter({hasText:'待安排'}).first().getByRole('button',{name:'查看并处理',exact:true}).click()
 const detail=centre.getByRole('region',{name:'核对这次变化',exact:true})
 await detail.getByRole('button',{name:'安排核对',exact:true}).waitFor()
 const link=detail.getByRole('link',{name:'打开相关任务',exact:true})
 assert.ok((await link.getAttribute('href')).startsWith('/tasks?task='))
 await detail.getByRole('button',{name:'安排核对',exact:true}).click()
 const form=detail.locator('form').first()
 const staff=form.locator('[data-field$="assigned_to"] select')
 await staff.locator('option[value="'+admin.user_id+'"]').waitFor({state:'attached'})
 await staff.selectOption(admin.user_id)
 await form.locator('[data-field$="reason"] input, [data-field$="reason"] textarea').fill('请核对本次活动安排')
 await form.getByRole('button',{name:'核对并继续',exact:true}).click()
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/assign'))
 await form.getByRole('button',{name:'确认提交',exact:true}).click()
 assert.equal((await response).status(),200)
 await detail.getByRole('button',{name:'填写处理结果',exact:true}).waitFor()
 assert.equal(await detail.locator('input[readonly]').count(),0)
 await page.screenshot({path:output+'/next-step.png',fullPage:true})
 console.log('PASS 已选事项自动带入，仅展示当前下一步，指派使用真实接口成功')
 await page.goto(base+'/changes')
 await page.setViewportSize({width:390,height:844})
 await centre.getByRole('button',{name:/需要处理/}).waitFor()
 await centre.getByRole('button',{name:'查看并处理',exact:true}).first().waitFor()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
 await page.screenshot({path:output+'/mobile.png',fullPage:true})
 await centre.getByRole('button',{name:'最近变化',exact:true}).click()
 await centre.getByRole('region',{name:'最近变化',exact:true}).getByRole('article').first().waitFor()
 assert.equal((await centre.innerText()).includes('T00:'),false)
 console.log('PASS 手机布局无横向溢出，最近变化自动读取并显示中文说明')
 assert.deepEqual(errors,[])
}catch(error){
 for(const context of browser.contexts())for(const page of context.pages()){
  console.error((await page.locator('body').innerText()).slice(-2200))
  await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{})
 }
 throw error
}finally{await browser.close()}
