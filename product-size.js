/* 商品尺寸优先：自动识别并按身体估算比较，通用尺码仅作对照。 */
(function () {
  'use strict';
  function parseChart(text, category) {
    const rows = String(text).normalize('NFKC').replace(/尺\s+码/g,'尺码').replace(/胸\s+围/g,'胸围').replace(/腰\s+围/g,'腰围').replace(/胸\s+宽/g,'胸宽').replace(/腰\s+宽/g,'腰宽').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const wanted = category === 'pants' ? /腰围|腰宽/ : /胸围|胸宽/;
    const columns = line => line.split(/[,，\t|;；:：]+|\s+/).filter(Boolean).filter(s => !/^(?:cm|厘米|inch|英寸|\(cm\)|\(厘米\))$/i.test(s));
    const isSize = size => /^(?:[2-6]?X{0,3}[SML]|\d{2,3}(?:\/\d{2,3}[A-Z]?)?|均码|F|FREE)$/i.test(size);
    function addValue(out, size, token) {
      const match = token.replace(/cm|厘米/gi, '').match(/^(\d+(?:\.\d+)?)(?:[-~～—–至](\d+(?:\.\d+)?))?$/);
      if (!match) throw new Error('尺码 ' + size + ' 的围度无法识别，请校对数字或区间。');
      const low = Number(match[1]), high = match[2] ? Number(match[2]) : low;
      if (low <= 0 || high < low || high > 300) throw new Error('尺码 ' + size + ' 的围度或区间无效。');
      if (out.some(r => r.size === size)) throw new Error('存在重复尺码，请按同一款式整理表格。');
      out.push({size,low,high});
    }
    function addDimensions(target,labels,values){
      for(let i=0;i<labels.length;i++){
        const key=/衣长|裤长/.test(labels[i])?'length':/肩宽/.test(labels[i])?'shoulder':/袖长/.test(labels[i])?'sleeve':/臀围/.test(labels[i])?'hip':/脚口|裤脚/.test(labels[i])?'legOpening':null;
        if(!key)continue;
        const value=Number(String(values[i]||'').replace(/cm|厘米/gi,''));
        if(Number.isFinite(value)&&value>0&&value<=200)target[key]=value;
      }
    }
    // 常见的另一种排版：尺码横向，胸围/腰围等尺寸纵向。
    const matrix = rows.map(columns);
    const sizeHeaders = matrix.filter(cols => /^(尺码(?:信息)?|码数|size)$/i.test(cols[0]) && cols.length > 1 && cols.slice(1).every(s => isSize(s.replace(/码$/,''))));
    if (sizeHeaders.length > 1) throw new Error('发现多组尺码，请只保留同一款式的表格。');
    if (sizeHeaders.length === 1) {
      const metricRows = matrix.filter(cols => wanted.test(cols[0]));
      if (metricRows.length !== 1) throw new Error('未找到唯一的胸围或腰围行，请核对截图中的测量项目。');
      const sizes = sizeHeaders[0].slice(1).map(s => s.replace(/码$/,''));
      const values = metricRows[0].slice(1);
      if (sizes.length !== values.length) throw new Error('尺码数量与围度数量不一致，截图可能漏字或错列，请核对识别结果。');
      const output = [];
      sizes.forEach((size,index) => addValue(output,size,values[index]));
      for(const line of matrix){if(/衣长|裤长|肩宽|袖长/.test(line[0])&&line.length===sizes.length+1)output.forEach((row,index)=>addDimensions(row,[line[0]],[line[index+1]]));}
      return output;
    }
    let headers = null;
    const out = [];
    for (const line of rows) {
      if (out.length && /试穿|洗涤|温馨提示|INSTRUCTIONS|适应身高/i.test(line)) break;
      const cols = columns(line);
      if (/尺码|码数|size/i.test(line) && wanted.test(line)) { headers = cols; continue; }
      if (!headers) continue;
      const sizeCol = headers.findIndex(s => /^(尺码(?:信息)?|码数|size)$/i.test(s));
      const valueCol = headers.findIndex(s => wanted.test(s));
      if (sizeCol < 0 || valueCol < 0) continue;
      const size = (cols[sizeCol] || '').replace(/码$/, '');
      if (!isSize(size)) continue;
      if (cols.length !== headers.length) {
        if (/^\d+$/.test(size)) throw new Error('有一行以数字 ' + size + ' 开头，但列数不匹配，无法确认它是尺码还是衣长等尺寸。请核对原图和识别结果。');
        throw new Error('尺码 ' + size + ' 的列数与表头不一致，请校对这一行。');
      }
      addValue(out,size,cols[valueCol]);
      addDimensions(out[out.length-1],headers,cols);
    }
    if (!out.length) throw new Error('未找到完整尺码行。请把首行整理为“尺码 胸围”或“尺码 腰围”，下方每行对应一个尺码；各列用空格、逗号或 Tab 分隔。');
    return out;
  }
  function chartMetadata(text) {
    text = String(text).normalize('NFKC');
    const category = /腰围|腰宽/.test(text) && !/胸围|胸宽/.test(text) ? 'pants' : 'top';
    // “平铺手工测量”描述测量方法，不能据此将标为胸围的 116 再乘二。
    const mode = /适合.*(?:胸围|腰围)|身体(?:胸围|腰围)/.test(text) ? 'body'
      : /胸宽|腰宽|半胸围|半腰围|单面宽度/.test(text) ? 'flat'
      : /成衣|衣服.*围/.test(text) || (/胸围|腰围/.test(text) && /衣长|裤长|袖长/.test(text)) ? 'garment' : '';
    let unit = /英寸|inch/i.test(text) ? 'inch' : /厘米|cm/i.test(text) ? 'cm' : '';
    let unitInferred=false;
    if(!unit&&['garment','flat'].includes(mode)){
      const ranges={length:category==='pants'?[60,140]:[35,150],shoulder:[25,80],sleeve:[20,110]};
      try{
        const rows=parseChart(text,category);
        const girth=mode==='flat'?(category==='pants'?[25,90]:[35,110]):(category==='pants'?[50,180]:[70,220]);
        const fields=Object.keys(ranges).filter(key=>rows.every(r=>Number.isFinite(r[key])));
        if(rows.length>=2&&fields.some(key=>key==='length'||key==='sleeve')&&rows.every(r=>r.low>=girth[0]&&r.high<=girth[1]&&fields.every(key=>r[key]>=ranges[key][0]&&r[key]<=ranges[key][1]))){unit='cm';unitInferred=true;}
      }catch{}
    }
    return {category,mode,unit,unitInferred,easeMin:category==='pants'?2:8,easeMax:category==='pants'?6:14};
  }
  function matchProduct(rows, body, mode, minEase, maxEase, context={}) {
    if (!Number.isFinite(body) || body <= 0) throw new Error('身体围度需要为正数。');
    if (!['garment','flat','body'].includes(mode)) throw new Error('先确认尺码表的测量含义。');
    if (mode !== 'body' && (!Number.isFinite(minEase) || !Number.isFinite(maxEase) || minEase < 0 || maxEase < minEase)) throw new Error('请检查余量范围：最大值不能小于最小值，且不能为负数。');
    const boxy=context.category!=='pants'&&rows.filter(r=>Number.isFinite(r.length)&&r.length/(r.low*(mode==='flat'?2:1))<.62).length>=Math.ceil(rows.length/2);
    const relaxed=context.fit==='oversize';
    // 宽松上装增加约 8 cm 胸围目标余量；裤装只增加 2 cm 腰围余量。
    const preferredEase=(boxy?body*.22:(minEase+maxEase)/2)+(relaxed?(context.category==='pants'?2:8):0);
    const candidates = rows.map(r => {
      if (mode !== 'body' && r.low !== r.high) throw new Error('成衣尺寸出现区间，请先确认对应款式的单一尺寸；弹性范围暂不自动选码。');
      const circumference = r.low * (mode === 'flat' ? 2 : 1);
      const ease = circumference - body;
      // 余量范围仅作为偏好参考，不再一刀切。成衣小于身体围度时仍不强荐。
      const eligible = mode === 'body' ? body >= r.low && body <= r.high : ease >= 0;
      let distance = mode === 'body' ? Math.abs((r.low + r.high) / 2 - body) : Math.abs(ease-preferredEase)/10;
      let weights=1;
      if(mode!=='body'&&Number.isFinite(r.shoulder)&&Number.isFinite(context.shoulder)){
        distance+=.45*Math.abs(r.shoulder-context.shoulder-(boxy?4:1.5)-(relaxed?2:0))/6;weights+=.45;
        if(r.shoulder<context.shoulder)distance+=(context.shoulder-r.shoulder)/3;
      }
      if(mode!=='body'&&Number.isFinite(r.length)&&Number.isFinite(context.height)){
        const target=boxy?context.height*.36:context.length;
        if(Number.isFinite(target)){distance+=.35*Math.abs(r.length-target)/6;weights+=.35;}
      }
      distance/=weights;
      return {...r, circumference, ease, eligible, distance};
    });
    const ranked=candidates.filter(r => r.eligible).sort((a,b) => a.distance - b.distance);
    return {candidates,best:ranked[0]||null,alternative:ranked[1]||null,boxy,preferredEase};
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = {parseChart, matchProduct,chartMetadata}; return; }

  const $ = id => document.getElementById(id);
  let product = null, busy = false, productActive = false;
  const generalRender = render;
  const section = document.createElement('section');
  section.className = 'product-module'; section.id = 'productModule';
  section.setAttribute('aria-labelledby','productTitle');
  section.innerHTML = `
    <h2 id="productTitle">导入商品</h2>
    <label for="productImage" class="product-upload">上传尺码表截图</label>
    <input id="productImage" type="file" accept="image/png,image/jpeg,image/webp" hidden>
    <div id="productProgress" class="product-progress" hidden><div class="product-progress-heading"><span id="productProgressLabel">正在准备图片……</span><span id="productProgressValue"></span></div><progress id="productProgressBar" max="100" aria-label="尺码表识别进度"></progress></div>
    <p id="productStatus" role="status" aria-live="polite" hidden></p>`;
  document.querySelector('.disclaimer').before(section);
  const style = document.createElement('style');
  style.textContent = `.product-module{margin:24px var(--space-lg);padding:18px 16px;border:1px solid #d6d6d6;border-radius:14px;background:#f6f6f6;color:#333;text-align:left}.product-module h2{font-size:18px;font-weight:500;margin:0 0 16px}.product-module label{display:block;font-size:12px;margin:12px 0 7px}.product-module textarea{box-sizing:border-box;width:100%;border:1px solid #ccc;border-radius:9px;background:#fff;padding:11px;color:#222;font:inherit;font-size:13px;resize:vertical}.product-primary{width:100%;padding:12px;border:0;border-radius:10px;background:#ff9500;color:#222;font-size:13px;margin-top:10px;cursor:pointer}.product-primary:disabled{opacity:.55;cursor:wait}.product-or{text-align:center;font-size:11px;color:#888;margin:15px 0}.product-module .product-upload{padding:14px;border:1px dashed #b5b5b5;border-radius:9px;text-align:center;cursor:pointer}.product-module .product-upload[aria-disabled=true]{opacity:.5;pointer-events:none}.product-module #productStatus{font-size:12px;line-height:1.6;color:#666;margin:12px 0 0;overflow-wrap:anywhere}.product-mode-note{font-size:11px;color:#8b5a00;margin:0 var(--space-lg) 10px;line-height:1.6}.product-back{margin:0 var(--space-lg) 14px;padding:7px 12px;background:transparent;border:1px solid #ccc;border-radius:8px;font-size:11px;cursor:pointer}.product-result{padding:12px 14px;background:#fff;border-left:3px solid #ff9500;border-radius:9px;margin:0 var(--space-lg) 16px;font-size:12px;line-height:1.8;white-space:pre-line;overflow-wrap:anywhere}.product-module [hidden],.product-mode-note[hidden],.product-back[hidden],.product-result[hidden]{display:none!important}.product-module :focus-visible{outline:2px solid #bd6900;outline-offset:2px}`;
  document.head.append(style);
  const output = document.createElement('div'); output.id='productResult'; output.className='product-result'; output.hidden=true;
  output.setAttribute('role','status'); output.setAttribute('aria-live','polite');
  const modeNote = document.createElement('p'); modeNote.className='product-mode-note'; modeNote.hidden=true;
  modeNote.textContent='当前按商品尺码表推荐；可调整男款/女款、体型及版型偏好。';
  const back = document.createElement('button'); back.type='button'; back.className='product-back'; back.textContent='返回通用推荐'; back.hidden=true;
  $('sizeDataHint').after(modeNote,output,back);
  function status(text){$('productStatus').textContent=text;$('productStatus').hidden=!text;}
  function lockOptions(){
    document.querySelectorAll('[data-p]').forEach(btn=>{btn.disabled=productActive;});
    document.querySelectorAll('[data-f]').forEach(btn=>{btn.disabled=false;});
    $('customMode').disabled=productActive;
  }
  function header(size,body,category){
    window.dispatchEvent(new CustomEvent('product-category-change',{detail:{category}}));
    $('sizeChar').textContent=size; $('sizeLabel').textContent='商品推荐'; $('sizeDataHint').hidden=true;
    $('badgeFit').textContent=fit==='oversize'?'商品表·宽松':'商品表·合身'; $('badgeProp').textContent='体型：'+({thin:'偏瘦',normal:'标准',heavy:'健壮',obese:'肥胖'}[bodyType]||'标准'); $('badgeGender').textContent=(gender==='female'?'女款':'男款')+'·'+(category==='pants'?'裤装':'上装');
    ['inner','outer','pants','shoulder','chest'].forEach(k=>{$('mv-'+k).innerHTML='—<span class="unit">cm</span>';});
    if(category==='top'&&Number.isFinite(body))$('mv-chest').innerHTML=body.toFixed(1)+'<span class="unit">cm</span>';
    $('pantsDetail').textContent='商品未提供的尺寸不推算';
    lockOptions();
  }
  function activate(){
    productActive=true;modeNote.hidden=back.hidden=false;lockOptions();
    document.querySelector('.track-sub').textContent='商品尺码表 → 这件商品的推荐';
  }
  function clearProduct(){
    product=null;output.hidden=true;output.textContent='';
    if(productActive)header('—',NaN,'top');
  }
  back.onclick=()=>{
    productActive=false;product=null;modeNote.hidden=back.hidden=true;output.hidden=true;lockOptions();
    document.querySelector('.track-sub').textContent='身体数据与偏好 → 通用尺码参考';generalRender();
  };
  render=function(){generalRender();if(product)recommend(false);else if(productActive)header('—',NaN,'top');};
  function accept(data,source){
    if(!data.text)throw new Error('未读到商品尺码表，请上传商品详情中的尺码表截图。');
    const meta=data.metadata;
    if(!meta||!['cm','inch'].includes(meta.unit)||!['body','flat','garment'].includes(meta.mode)||!['top','pants'].includes(meta.category))throw new Error('暂时无法判断这张表的测量含义，请上传带表头、单位和说明的完整尺码表。');
    let rows;try{rows=parseChart(data.text,meta.category);}catch{throw new Error('尺码表没有完整读出，请上传更清晰、包含全部表头和尺码行的截图。');}
    const factor=meta.unit==='inch'?2.54:1;
    product={source,meta,rows:rows.map(r=>{
      const row={...r,low:r.low*factor,high:r.high*factor};
      for(const key of ['length','shoulder','sleeve','hip','legOpening'])if(Number.isFinite(row[key]))row[key]*=factor;
      return row;
    })};
    status('识别完成，推荐已显示在上方。');recommend(true);
  }
  async function importing(action){
    if(busy)return;busy=true;clearProduct();
    $('productProgress').hidden=false;$('productProgressLabel').textContent='正在准备图片……';$('productProgressValue').textContent='';$('productProgressBar').removeAttribute('value');
    $('productImage').disabled=true;
    section.querySelector('.product-upload').setAttribute('aria-disabled','true');
    try{await action();$('productProgressLabel').textContent='识别处理完成';$('productProgressValue').textContent='100%';$('productProgressBar').value=100;}catch(e){$('productProgress').hidden=true;status(e.name==='TimeoutError'?'识别超时，请稍后重试。':e.message||'读取失败，请重试。');}
    finally{busy=false;$('productImage').disabled=false;section.querySelector('.product-upload').setAttribute('aria-disabled','false');$('productImage').value='';}
  }
  section.querySelector('.product-upload').addEventListener('pointerdown',()=>{if(window.BrowserSizeOCR&&BrowserSizeOCR.prepare)BrowserSizeOCR.prepare();});
  $('productImage').onchange=()=>{
    const file=$('productImage').files[0];if(!file)return;
    return importing(async()=>{
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw new Error('请选择不超过 8 MB 的 PNG、JPG 或 WebP 图片。');
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      const image=new Image();image.src=dataUrl;await image.decode();
      const ratio=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const data=await BrowserSizeOCR.recognize(canvas,(message,detail)=>{status('');$('productProgressLabel').textContent=message.replace(/\s*\d+%……$/,'');const percent=detail&&detail.percent;$('productProgressValue').textContent=percent==null?'':percent+'%';if(percent==null)$('productProgressBar').removeAttribute('value');else $('productProgressBar').value=percent;});data.metadata=chartMetadata(data.text);accept(data,'商品尺码表截图');
    });
  };
  function recommend(scroll){
    if(!product)return;output.hidden=false;
    try{
      const meta=product.meta, dimension=meta.category==='pants'?'waist':'chest', label=dimension==='waist'?'腰围':'胸围';
      const data=readBodyData();if(!data.valid)throw new Error('请先填写有效的身高和体重。');
      const input=$('cf-'+dimension),measured=$('customMode').checked&&input.value!=='';
      const bmi=data.w/((data.h/100)**2);
      const group=gender;
      const inferredBody=TBL[group][bodyType]?bodyType:'normal';
      const generalSize=getSize(data.h,data.w,group,inferredBody);
      let body;
      if(measured)body=input.valueAsNumber;
      else{
        // 身高、体重与用户选择的体型共同估算，版型/比例效果不参与商品选码。
        body=estimateBodyCircumference(data.h,bmi,group,inferredBody,dimension);
      }
      if(!Number.isFinite(body)||body<=0)throw new Error('请检查身体'+label+'，需要有效的正数。');
      const model=TBL[group][inferredBody],delta=bmi-BODY_BMI_CENTER[inferredBody];
      const shoulderInput=$('cf-shoulder');
      const shoulder=$('customMode').checked&&shoulderInput.valueAsNumber>0?shoulderInput.valueAsNumber:model.shoulder.a*data.h+model.shoulder.b+model.shoulder.c*delta;
      // 同一身高、体重的裤长参考保持一致，体型差异由身体腰围表达。
      const lengthModel=meta.category==='pants'?TBL[group].normal.pants:model.inner;
      const lengthDelta=meta.category==='pants'?bmi-BODY_BMI_CENTER.normal:delta;
      const length=lengthModel.a*data.h+lengthModel.b+lengthModel.c*lengthDelta;
      const result=matchProduct(product.rows,body,meta.mode,meta.easeMin,meta.easeMax,{category:meta.category,height:data.h,shoulder,length,fit});
      activate();header(result.best?result.best.size:'—',body,meta.category);
      const basis=(measured?'实测':'估算')+label+' '+body.toFixed(1)+' cm';
      if(result.best){
        status('商品建议已显示在上方。');
        const best=result.best;
        let title='推荐 '+best.size;
        if(result.alternative){
          const alt=result.alternative;
          title+=' · 备选 '+alt.size+(meta.mode==='body'?'':alt.circumference>best.circumference?'（更宽松）':alt.circumference<best.circumference?'（更贴身）':'');
        }
        const comparison=best.size===generalSize?'与通用参考一致':'通用参考 '+generalSize+'（仅对照）';
        output.textContent=title+'\n'+basis+'，'+(meta.mode==='body'?'符合商家适用区间。':'该码余量 '+best.ease.toFixed(1)+' cm。')+'\n'+comparison;
        if(meta.unitInferred)output.textContent+=' · 单位按 cm 推断';
        if(fit==='oversize'&&meta.mode==='body')output.textContent+='\n表中只有适用身体尺寸，宽松程度需向商家确认。';
        else if(fit==='oversize'&&best.ease<result.preferredEase-2)output.textContent+='\n当前可选尺码余量有限，可能达不到预期宽松效果。';
        if(meta.mode!=='body'&&best.ease>Math.max(40,body*.45))output.textContent+='\n提醒：仍明显偏宽，建议核对实测。';
        if(meta.mode!=='body'&&best.ease<2)output.textContent+='\n提醒：余量很小，可能偏紧。';
      }else{
        status('尺码表已识别，匹配结果请看上方。');
        output.textContent='暂无合适尺码\n'+basis+'；'+(meta.mode==='body'?'超出商家适用区间。':'各码成衣围度均小于身体围度。')+'\n请核对实测。通用参考 '+generalSize+' 仅作对照。';
        if(meta.unitInferred)output.textContent+=' 单位按 cm 推断。';
      }
      if(scroll)$('sizeChar').scrollIntoView({behavior:'smooth',block:'center'});
    }catch(e){output.textContent='暂未生成商品推荐：'+e.message;if(productActive)header('—',NaN,product.meta.category);status(e.message);}
  }
})();
