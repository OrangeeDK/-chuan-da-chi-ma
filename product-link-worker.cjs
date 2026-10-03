// 商品链接读取器使用独立、临时的浏览器环境，不连接用户浏览器或保存登录信息。
const path = require('node:path');
const dns = require('node:dns').promises;
const {isIP} = require('node:net');
function runtime() {
  try { return require('playwright'); } catch {}
  const bundled = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  try { return require(bundled); } catch { throw new Error('链接测试版需要安装 Playwright 浏览器运行库。'); }
}
const domains = ['douyin.com','jinritemai.com','ecombdapi.com','ecombdimg.com','byteimg.com','bytedance.com','bytegoofy.com','yhgfb-cn-static.com','bytescm.com','bytednsdoc.com'];
const permittedHost = host => domains.some(d => host === d || host.endsWith('.'+d));
function publicIP(ip) {
  if(isIP(ip) === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168||b===0||b===88)) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19||(b===51&&c===100))) || (a===203&&b===0&&c===113));
  }
  return false; // 浏览器请求仅放行已核验的公网 IPv4。
}
async function launch(headless) {
  const {chromium}=runtime();
  try{return await chromium.launch({headless});}
  catch{return await chromium.launch({channel:'chrome',headless});}
}
async function read(url, suppliedContext) {
  const initial = new URL(url);
  if(!['douyin.com','jinritemai.com'].some(d=>initial.hostname===d||initial.hostname.endsWith('.'+d)))throw new Error('商品链接域名不受支持。');
  const browser = suppliedContext ? null : await launch(true);
  const context = suppliedContext || await browser.newContext({viewport:{width:430,height:900},isMobile:true,hasTouch:true});
  const cache = new Map();
  const blockedHosts = new Set();
  async function safe(url) {
    try {
      const u = new URL(url);
      if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!permittedHost(u.hostname))return false;
      if(!cache.has(u.hostname))cache.set(u.hostname,dns.lookup(u.hostname,{all:true}).then(list=>list.length>0&&list.every(a=>publicIP(a.address))).catch(()=>false));
      return await cache.get(u.hostname);
    } catch {return false;}
  }
  const routeHandler=async route => {
    if(['font','media'].includes(route.request().resourceType()))return route.abort();
    if(!await safe(route.request().url())){try{blockedHosts.add(new URL(route.request().url()).hostname);}catch{}return route.abort();}
    return route.continue();
  };
  await context.route('**/*',routeHandler);
  const page = await context.newPage();
  const payloads=[];
  page.on('response',async response=>{
    if(/\/promotion\/pack\//.test(response.url())) {
      try {const data=await response.json();payloads.push(data);}catch {}
    }
  });
  try {
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
    await page.waitForTimeout(2500);
    // 商品页可能在内部容器滚动；不能只滚动 window，也不能只等首屏加载。
    const scrollTrace=[];
    for(let i=0;i<18;i++) {
      const state=await page.evaluate(()=>{
        const candidates=[document.scrollingElement,...document.querySelectorAll('body *')].filter(el=>{
          if(!el)return false;const r=el.getBoundingClientRect(),style=getComputedStyle(el);
          return r.width>250&&r.height>200&&el.scrollHeight>el.clientHeight+40&&(el===document.scrollingElement||/auto|scroll/.test(style.overflowY));
        });
        const el=candidates.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0]||document.scrollingElement;
        el.scrollTop+=Math.max(600,el.clientHeight*.8);
        return {top:el.scrollTop,height:el.scrollHeight,viewport:el.clientHeight,container:el===document.scrollingElement?'document':el.tagName};
      });
      scrollTrace.push(state);await page.waitForTimeout(500);
      // 只点击页面实际出现的详情展开文字，不点击购买、领券或跳转 App。
      const expand=page.getByText(/^(?:查看图文详情|展开图文详情|查看商品详情|展开商品详情|查看更多详情|展开详情)$/).first();
      if(await expand.count()&&await expand.isVisible()) {await expand.click({timeout:2000});await page.waitForTimeout(800);}
      if(i>=5&&scrollTrace.slice(-3).every(s=>s.top+s.viewport>=s.height-5)&&scrollTrace.slice(-3).every(s=>s.height===state.height))break;
    }
    const detailReplies=[];
    for(const data of payloads) {
      if(typeof data.detail_url!=='string')continue;
      const detail=new URL(data.detail_url);
      if(detail.hostname!=='haohuo.jinritemai.com'||detail.pathname!=='/aweme/v2/shop/promotion/product/detail')continue;
      detail.protocol='https:';
      if(!await safe(detail.href))continue;
      try {
        // 通过商品页面自身的 fetch 发出请求，让站点正常脚本和登录环境参与。
        const reply=await page.evaluate(async url=>{
          const response=await fetch(url,{credentials:'include',redirect:'error',signal:AbortSignal.timeout(10000)});
          if(!response.ok)return null;
          const raw=await response.text();if(raw.length>2000000)return null;
          try{return JSON.parse(raw);}catch{return null;}
        },detail.href);
        if(reply)detailReplies.push(reply);
      }catch {}
    }
    const result = await page.evaluate(()=>({
      url:location.href,
      title:document.title,
      text:document.body.innerText.slice(0,50000),
      tables:[...document.querySelectorAll('table')].map(t=>t.innerText),
      images:[...document.images].filter(img=>img.closest('[class*="detail-content"],[class*="graphic-detail"],[class*="detail-info"],[class*="detail-image"]')||/尺码|尺寸|size/i.test(img.alt)).map(img=>({url:img.currentSrc||img.src,alt:img.alt,width:img.naturalWidth,height:img.naturalHeight})).filter(i=>i.width>=300&&i.height>=150).slice(0,12)
    }));
    result.requiresLogin=detailReplies.some(data=>data.code===10002||/未登录|请.*登录/.test(data.message||data.msg||''));
    result.diagnostics={
      reusedLoginContext:!!suppliedContext,
      scrollTrace,
      blockedHosts:[...blockedHosts],
      detailReplies:detailReplies.map(d=>({code:d.code,status_code:d.status_code,hasData:!!d.data})),
      pack:payloads.map(d=>({status_code:d.status_code,detailKeys:Object.keys(d.detail_info||{}),h5DetailKeys:Object.keys(d.promotion_h5?.pack_detail||{}),collapseDetail:d.promotion_h5?.collapse_detail}))
    };
    // 仅在详情字段中查找图片，排除商品主图、评论图和其他商品推荐。
    function imagesIn(value) {
      if(!value||typeof value!=='object')return;
      for(const [key,item] of Object.entries(value)) {
        if(/^(?:url|image_url|img_url|src)$/.test(key)&&typeof item==='string'&&/^https:\/\//.test(item))result.images.push({url:item,alt:'商品详情图片'});
        else if(key==='url_list'&&Array.isArray(item)&&typeof item[0]==='string')result.images.push({url:item[0],alt:'商品详情图片'});
        else if(item&&typeof item==='object')imagesIn(item);
      }
    }
    for(const data of [...payloads,...detailReplies]) {
      for(const root of [data.detail_info,data.data?.detail_info,data.data?.product_detail,data.data?.detail])imagesIn(root);
    }
    result.images = result.images.filter((im,i,all)=>all.findIndex(x=>x.url===im.url)===i).slice(0,8);
    return result;
  } finally {
    if(!suppliedContext)await page.close();
    await context.unroute('**/*',routeHandler);
    if(!suppliedContext){await context.close();await browser.close();}
  }
}
async function session() {
  // 登录由用户在独立窗口完成；登录状态只在这个临时浏览器中保留，不导出 cookie。
  let browser,context,loginPage;
  const lines=require('node:readline').createInterface({input:process.stdin});
  for await (const line of lines) {
    let request;
    try {
      request=JSON.parse(line);
      if(!browser||!browser.isConnected()){
        if(request.action!=='login')throw new Error('Login window closed');
        browser=await launch(false);context=await browser.newContext({viewport:{width:1100,height:850}});loginPage=null;
      }
      let data;
      if(request.action==='login'){
        if(!loginPage||loginPage.isClosed())loginPage=await context.newPage();
        await loginPage.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded',timeout:20000});
        await loginPage.bringToFront();
        data={message:'已打开抖音官方页面。请在新窗口中点击登录并自行完成登录，保持窗口打开，然后回到工具读取商品链接。'};
      } else if(request.action==='read'){
        // 页面读取逻辑可更新，同时保留用户已登录的临时 context。
        delete require.cache[require.resolve(__filename)];
        data=await require(__filename).read(request.url,context);
      }
      else throw new Error('Unknown action');
      process.stdout.write(JSON.stringify({id:request.id,data})+'\n');
    }catch(e){process.stdout.write(JSON.stringify({id:request?.id,error:'浏览器读取未完成，请保持登录窗口打开并重试。'})+'\n');}
  }
  if(browser)await browser.close();
}
if(require.main===module){
  const task=process.argv[2]==='--session'?session():read(process.argv[2]).then(data=>process.stdout.write(JSON.stringify(data)));
  task.catch(err=>{process.stderr.write(err.message);process.exitCode=1;});
}
module.exports={publicIP,permittedHost,read};
