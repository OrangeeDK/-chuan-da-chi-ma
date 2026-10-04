/* 仅组织展示节点，所有输入 ID、事件和选码函数沿用原实现。 */
(()=>{
 const app=document.querySelector('.app'),player=app.querySelector('.player');
 const intro=document.createElement('section');intro.className='glass-intro';
 intro.innerHTML='<h1>找到你的<br><em>合适</em>尺码</h1><p>根据你的身材，找到更合适的选择。</p>';
 player.before(intro);
 const info=player.querySelector('.track-info');
 info.querySelector('.track-title').remove();
 info.prepend(document.getElementById('sizeLabel'));
 info.querySelector('.track-sub').textContent='身体数据与偏好 → 通用尺码参考';
 const illustration=document.createElement('div');illustration.className='glass-garment';illustration.setAttribute('aria-hidden','true');
 const garmentImage=document.createElement('img');garmentImage.alt='';garmentImage.width=150;garmentImage.height=170;illustration.append(garmentImage);
 let garmentCategory='top';
 const updateGarment=()=>{const category=garmentCategory==='pants'?'pants':'jacket',key=category+'-unisex';if(garmentImage.dataset.kind!==key){garmentImage.dataset.kind=key;illustration.dataset.category=category;garmentImage.src='assets/'+key+'.png';}};
 window.addEventListener('product-category-change',e=>{garmentCategory=e.detail.category;updateGarment();});
 document.querySelector('.product-back').addEventListener('click',()=>{garmentCategory='top';updateGarment();});
 updateGarment();new MutationObserver(updateGarment).observe(document.getElementById('badgeGender'),{childList:true,subtree:true,characterData:true});
 document.querySelector('.nav-title').textContent='大孔的穿搭尺码推荐';
 document.querySelector('.nav-sub').remove();
 player.append(illustration);
 const measurements=app.querySelector('.measurements');
 const body=document.createElement('section');body.className='glass-body';
 const bodyHeading=document.createElement('div');bodyHeading.className='glass-section-heading';bodyHeading.innerHTML='<h2>身体数据</h2>';
 const gender=document.getElementById('genderSeg'),genderControl=gender.closest('.controls');bodyHeading.append(gender);genderControl.remove();
 const inputs=document.getElementById('height').closest('.controls');
 const fields=inputs.querySelectorAll('.field');
 inputs.querySelectorAll('.slider-field').forEach((slider,i)=>fields[i].append(slider));
 inputs.querySelector('.slider-row').remove();inputs.querySelector('.ctrl-label').remove();
 const bodyControl=document.getElementById('bodyPill').closest('.controls');bodyControl.querySelector('.ctrl-label').remove();
 document.getElementById('bodyPill').prepend(document.querySelector('[data-t="thin"]'));
 measurements.before(body);body.append(bodyHeading,inputs,bodyControl);
 const measureSection=document.createElement('section');measureSection.className='glass-measure-section';
 measureSection.innerHTML='<div class="glass-section-heading"><h2>尺寸参考</h2><span>根据身体数据估算</span></div>';
 measurements.before(measureSection);measureSection.append(measurements);
 // 尺寸参考沿用概念图的细线服装图标，统一轮廓与测量标记。
 const measureIcons=[
  '<path d="M9 4c0 3 6 3 6 0l4 2 3 14-4 1-2-10v11H8V11L6 21l-4-1L5 6Z"/><path d="M9 4c1 1 5 1 6 0M8 20h8M3 18l3 1m12 0 3-1"/>',
  '<path d="m9 4-4 2-3 14 4 1 2-10v11h8V11l2 10 4-1-3-14-4-2"/><path d="m9 4 3 3 3-3M9 4l-1 4 3-1m4-3 1 4-3-1M12 7v15M8 20h8"/>',
  '<path d="M7 3h10l2 19h-5l-2-13-2 13H5Z"/><path d="M7 6h10M12 3v6M9 6 7 9m8-3 2 3M5 20h5m4 0h5"/>',
  '<path d="m8 7-4 2-2 5 4 2 2-4v9h8v-9l2 4 4-2-2-5-4-2M9 7c0 3 6 3 6 0"/><path d="M6 4h12M8 2 6 4l2 2m8-4 2 2-2 2"/>',
  '<path d="m8 4-4 2-2 5 4 2 2-4v13h8V9l2 4 4-2-2-5-4-2M9 4c0 3 6 3 6 0"/><path d="M8 15h8M10 13l-2 2 2 2m4-4 2 2-2 2"/>'
 ];
 measurements.querySelectorAll('.measure-icon').forEach((icon,i)=>{icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">'+measureIcons[i]+'</svg>';});
 const preferences=document.createElement('section');preferences.className='glass-preferences';
 preferences.innerHTML='<div class="glass-section-heading"><h2>穿着偏好</h2></div>';
 const fit=document.getElementById('fitSeg').closest('.controls'),prop=document.getElementById('propPill').closest('.controls');
 fit.before(preferences);preferences.append(fit,prop);
 const upload=document.querySelector('.product-upload');
 const uploadIcon=document.createElement('span');uploadIcon.className='glass-upload-icon';uploadIcon.setAttribute('aria-hidden','true');uploadIcon.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M12 16V3M7 8L12 3L17 8M4 14V20H20V14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 upload.prepend(uploadIcon);
 // 提示文字保持既有要求，不增加商品链接或识别详情控件。
})();
