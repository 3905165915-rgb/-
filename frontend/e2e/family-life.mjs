import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const base = process.env.FAMILY_API_URL || 'http://127.0.0.1:5177'
const output = 'test-results/family-life'
await mkdir(output, { recursive: true })
const image = await readFile('apps/mobile/src/assets/care-field.jpg')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const results = [], errors = []
const at = '2026-10-26T15:00:00+08:00'
const members = [ ['a','张阿姨'], ['b','李爷爷'] ].map(([key,name]) => ({ id:`binding-${key}`, elder_id:`elder-${key}`, elder_name:name, admission_id:`stay-${key}`, scopes:['summary','feedback'], expires_at:'2030-01-01T00:00:00Z' }))
const content = { a:'张阿姨在活动时选择听京剧，工作人员调低音量后继续陪伴。', b:'李爷爷上午在工作人员陪同下到院内散步，随后在窗边休息。' }
function feed(key) { const member = members.find(row => row.id === `binding-${key}`); return { elder_id:member.elder_id, elder_name:member.elder_name, total:1, items:[{id:`story-${key}`,elder_id:member.elder_id,kind:'published_summary',title:key==='a'?'一段喜欢的旋律':'窗边的小歇',text:content[key],happened_at:at,period_start:'2026-10-26T14:00:00+08:00',period_end:at,published_at:at,photos:key==='a'?[{id:'photo-a',caption:'虚构测试配图',occurred_at:at,content_path:'/family/me/bindings/binding-a/photos/photo-a/content'}]:[]}] } }
function insights(key) { return { elder_id:`elder-${key}`, model_status:'available', points:[{text:key==='a'?'最近的近况里记下了张阿姨喜欢的京剧。':'最近的近况里记下了李爷爷的院内散步。',citations:[{source_id:`story-${key}`,quote:content[key]}]}] } }
async function setup(options={}) {
 const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
 await context.addInitScript(() => { sessionStorage.setItem('hulao:session:v2',JSON.stringify({mode:'api',accountKey:'synthetic-family',userId:'family-a',role:'family',accessToken:'synthetic-test-token'})) })
 const page = await context.newPage(); page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
 const state = { revoked:false, messages:[], keys:new Map(), submissions:0, attempts:[], slow:false }
 await page.route('**/api/v1/**', async route => {
  const req=route.request(), url=new URL(req.url()), path=url.pathname.replace('/api/v1','')
  const respond = (body,status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  if(path==='/family/me/bindings') return respond(members)
  const key=path.includes('binding-b')?'b':'a'
  if(state.revoked && path.includes('/bindings/')) return respond({detail:'family_access_not_authorized'},403)
  if(path.endsWith('/timeline')) return respond(feed(key))
  if(path.endsWith('/insights')) {
   if(options.slowA && key==='a') await new Promise(resolve=>setTimeout(resolve,900))
   if(options.aiFailure) return respond({detail:'暂不可用'},503)
   return respond(insights(key))
  }
  if(path.endsWith('/photos/photo-a/content')) return route.fulfill({status:200,contentType:'image/jpeg',body:image})
  if(path.endsWith('/feedback') && req.method()==='GET') return respond(state.messages.filter(row=>row.binding_id===`binding-${key}`))
  if(path==='/family/me/feedback' && req.method()==='POST') {
   state.attempts.push(req.headers()['idempotency-key']); const id=req.headers()['idempotency-key'],body=req.postDataJSON()
   if(!state.keys.has(id)) { state.submissions++; const row={id:'message-'+state.submissions,binding_id:body.binding_id,elder_id:body.binding_id.replace('binding','elder'),text:body.text,status:'open',created_at:at,reply:null,replied_at:null};state.keys.set(id,row);state.messages.push(row) }
   if(options.failFirstSend && state.attempts.length===1) return route.abort('failed')
   return respond(state.keys.get(id),201)
  }
  errors.push('未预期接口：'+path);return respond({detail:'missing fixture'},404)
 })
 await page.goto(base+'/mobile/family'); await page.getByRole('heading',{name:'今天想看看谁？'}).waitFor();await page.locator('.family-member').first().waitFor()
 return {page,context,state}
}
async function choose(page, name='张阿姨') { await page.locator('.family-member').filter({hasText:name}).click(); await page.getByRole('button',{name:'看看家人的近况'}).click();await page.locator('.story-card').first().waitFor() }
async function check(name, run) { try { await run();results.push({name,passed:true});console.log('PASS '+name) }catch(e){results.push({name,passed:false,error:String(e.stack)});console.error('FAIL '+name+': '+e.message)} }
try {
 await check('先选家人、树状图文、来源回看、照片放大与手机电脑布局',async()=>{
  const {page,context}=await setup()
  try {
   assert.equal(await page.locator('.story-card').count(),0)
   assert.equal(await page.getByText('我的授权').count(),0)
   await page.screenshot({path:output+'/api-selection-390.png',fullPage:true})
   await choose(page)
   await page.locator('.digest-points').waitFor();await page.locator('.story-photo img').waitFor()
   for(const width of [320,390,768,1440]) {await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`${output}/api-feed-${width}.png`,fullPage:true})}
   await page.setViewportSize({width:390,height:844})
   await page.getByText('看看这段话的依据').click();await page.locator('.source-link').click()
   assert.equal(await page.locator('#family-moment-story-a').evaluate(node=>node===document.activeElement),true)
   await page.getByRole('button',{name:'放大照片：虚构测试配图'}).click();await page.getByRole('button',{name:'关闭照片'}).waitFor();await page.keyboard.press('Escape');await page.getByRole('button',{name:'关闭照片'}).waitFor({state:'hidden'})
   await page.getByLabel('给照护团队的留言').fill('下次探望想带张阿姨喜欢的戏曲。');await page.getByRole('button',{name:'把心意送达'}).click();await page.getByText('心意已经送达，工作人员回复后会显示在这里。').waitFor()
   await page.getByRole('button',{name:'切换家人'}).click();await choose(page,'李爷爷');await page.locator('.digest-points').waitFor()
   assert.equal(await page.locator('.story-card').filter({hasText:'张阿姨'}).count(),0)
   assert.equal(await page.locator('.letter-history').count(),0)
   await page.screenshot({path:output+'/api-li-390.png',fullPage:true})
  }finally{await context.close()}
 })
 await check('慢速模型不阻塞动态，切换家人丢弃旧小结',async()=>{
  const {page,context}=await setup({slowA:true})
  try{await choose(page);await page.getByText('正在整理小日子，下面的动态可以先看。').waitFor();await page.getByRole('button',{name:'切换家人'}).click();await choose(page,'李爷爷');await page.locator('.digest-points').waitFor();await page.waitForTimeout(1100);assert.equal(await page.locator('.digest-points').filter({hasText:'张阿姨'}).count(),0);assert.match(await page.locator('.digest-points').textContent(),/李爷爷/)}finally{await context.close()}
 })
 await check('模型失败仍可看图文和留言',async()=>{
  const {page,context}=await setup({aiFailure:true})
  try{await choose(page);await page.getByText('近况小结暂时没整理好，生活动态仍可正常阅读。').waitFor();assert.equal(await page.locator('.story-card').count(),1);await page.getByLabel('给照护团队的留言').fill('请帮忙转达问候。');await page.getByRole('button',{name:'把心意送达'}).click();await page.getByText('心意已经送达，工作人员回复后会显示在这里。').waitFor()}finally{await context.close()}
 })
 await check('留言结果不明、刷新恢复、原请求重试且不重复保存',async()=>{
  const {page,context,state}=await setup({failFirstSend:true})
  try{await choose(page);await page.getByLabel('给照护团队的留言').fill('周末来看张阿姨。');await page.getByRole('button',{name:'把心意送达'}).click();await page.getByRole('button',{name:'核对并重试',exact:true}).waitFor();assert.equal(await page.getByLabel('给照护团队的留言').isDisabled(),true);await page.reload();await page.locator('.family-member').first().waitFor();await choose(page);await page.getByRole('button',{name:'核对并重试',exact:true}).click();await page.getByText('心意已经送达，工作人员回复后会显示在这里。').waitFor();assert.equal(state.submissions,1);assert.equal(state.attempts[0],state.attempts[1])}finally{await context.close()}
 })
 await check('查看范围撤回后刷新立即清除旧图文和小结',async()=>{
  const {page,context,state}=await setup()
  try{await choose(page);await page.locator('.digest-points').waitFor();state.revoked=true;await page.getByRole('button',{name:'刷新生活动态'}).click();await page.getByText('这位家人的动态暂时无法查看，请联系工作人员核对。').waitFor();assert.equal(await page.locator('.story-card').count(),0);assert.equal(await page.locator('.digest-points').count(),0);assert.equal(await page.locator('.story-photo').count(),0)}finally{await context.close()}
 })
 assert.deepEqual(errors,[])
}finally{await browser.close();await writeFile(output+'/api-results.json',JSON.stringify({results,errors},null,2))}
if(results.some(row=>!row.passed)||errors.length)process.exit(1)
