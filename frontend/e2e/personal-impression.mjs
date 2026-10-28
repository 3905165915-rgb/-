import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Write tests may only run against isolated, synthetic data on loopback.
const base=process.env.PROFILE_WORKFLOW_URL || 'http://127.0.0.1:5180'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname))
const browser=await chromium.launch({headless:true,channel:'msedge'})
const output='test-results/personal-impression'
await mkdir(output,{recursive:true})
const errors=[]
async function open(role,width){
  const response=await fetch(base+'/api/v1/auth/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})})
  assert.equal(response.status,200)
  const login=await response.json()
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.addInitScript(login=>sessionStorage.setItem('hulao:session:v2',JSON.stringify({mode:'api',accountKey:'personal-impression-'+login.role,userId:login.user_id,role:login.role,accessToken:login.access_token})),login)
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror',error=>errors.push(error.message))
  return {context,page,login}
}
try{
  const admin=await open('admin',1440)
  const elders=await(await fetch(base+'/api/v1/elders',{headers:{Authorization:'Bearer '+admin.login.access_token}})).json()
  assert.deepEqual(elders.map(e=>e.name),['王爷爷'])
  const eid=elders[0].id
  await admin.page.goto(base+'/elders/'+eid+'?section=records')
  await admin.page.getByLabel('本次记录',{exact:true}).fill('喜欢喝茶，喜欢打太极拳，喜欢和张阿姨散步。')
  await admin.page.getByRole('button',{name:'保存记录',exact:true}).click()
  const decisions=admin.page.getByLabel(/^核对决定/)
  await decisions.first().waitFor()
  assert.equal(await decisions.count(),3)
  assert.equal(await admin.page.getByText('长期偏好建议',{exact:true}).count(),0)
  assert.equal(await admin.page.getByText('频率不明确',{exact:true}).count(),0)
  for(const select of await decisions.all()){
    assert.equal(await select.locator('option[value="adopt"]').isDisabled(),false)
    await select.selectOption('adopt')
  }
  const confirming=admin.page.waitForResponse(r=>r.request().method()==='POST'&&/\/analysis\/[^/]+\/confirm$/.test(new URL(r.url()).pathname))
  await admin.page.getByRole('button',{name:'保存本次核对',exact:true}).click()
  const response=await confirming
  assert.equal(response.status(),200)
  assert.equal((await response.json()).memories.length,3)
  console.log('PASS 无频率词的三个喜好逐项提取，可人工加入个人印象')
  await admin.page.goto(base+'/elders/'+eid+'?section=understanding')
  const features=admin.page.getByRole('region',{name:'照护要点',exact:true})
  await features.getByText('喜欢喝茶',{exact:true}).waitFor()
  await features.getByText('喜欢打太极拳',{exact:true}).waitFor()
  await features.getByText('喜欢和张阿姨散步',{exact:true}).waitFor()
  assert.equal((await features.innerText()).includes('王爷爷说'),false)
  assert.equal((await features.innerText()).includes('“'),false)
  const review=admin.page.locator('details').filter({has:admin.page.locator('summary').getByText('原文核实与个人印象管理',{exact:true})}).first()
  assert.equal(await review.getAttribute('open'),null)
  await review.locator('summary').first().click()
  const originalCard=review.locator('article.confirmed').filter({has:admin.page.locator('blockquote').filter({hasText:'王爷爷说'})}).first()
  await originalCard.getByText('原文核实',{exact:true}).click()
  await originalCard.locator('blockquote').first().waitFor()
  await admin.page.screenshot({path:output+'/admin-evidence.png',fullPage:true})
  console.log('PASS 个人特性默认显示简短摘要，原句仅在原文核实中展开')
  const caregiver=await open('caregiver',390)
  await caregiver.page.goto(base+'/mobile/elders/'+eid+'?section=understanding')
  const mobile=caregiver.page.getByRole('region',{name:'照护要点',exact:true})
  await mobile.getByText('喜欢喝茶',{exact:true}).waitFor()
  assert.equal(await caregiver.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await caregiver.page.screenshot({path:output+'/mobile-personality.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log('PASS 护理员手机端同步显示个人特性，无横向溢出或未捕获异常')
}finally{await browser.close()}
