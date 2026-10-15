/* SwingPath Studio: dependency-free browser video / assisted 2D tracker.
   All data processing stays in the browser. No upload endpoint is used. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const EPS = 0.00001;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = (v, digits = 2) => Number(v).toFixed(digits);
  const fmt = (seconds) => {
    if (!Number.isFinite(seconds)) return '00:00.00';
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
  };
  const state = {
    url: null, name: null, duration: 0, sourceWidth: 0, sourceHeight: 0,
    anchors: [], trace: [], scale: [], guide: [], mode: null, markers: {address: null, top: null, impact: null},
    tracking: false, cancel: false, stream: null, recorder: null, discardRecording: false, chunks: [], maxRecordTimer: null,
    toastTimer: null, currentFPS: 30, lastTrackFrame: null, journal: [], exporting: false
  };
  const video = $('video');
  const canvas = $('overlay');
  const context = canvas.getContext('2d');
  const stage = $('stage');
  const extractor = document.createElement('video');
  extractor.muted = true;
  extractor.playsInline = true;
  extractor.preload = 'auto';
  const workCanvas = document.createElement('canvas');
  const workCtx = workCanvas.getContext('2d', {willReadFrequently: true});

  function toast(message, error = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('error', error);
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
  }
  function setStatus(message, kind = '') {
    const el = $('trackResult');
    el.className = 'track-result' + (kind ? ` ${kind}` : '');
    el.lastElementChild.textContent = message;
  }
  function setMode(mode) {
    state.mode = mode;
    canvas.classList.toggle('interactive', Boolean(mode));
    const labels = {pin:'CLICK THE CLUBHEAD IN THE VIDEO', scale:'CLICK TWO RULER POINTS', guide:'CLICK TWO LINE POINTS'};
    $('stageFlag').classList.toggle('hidden', !mode);
    $('stageFlagText').textContent = labels[mode] || '';
    $('viewerHint').textContent = mode ? 'Click directly on the video to place a point. Use frame-step buttons for precision.' : 'A steady camera, high frame rate and clear view of the clubhead produce the best results.';
  }
  function enableLoaded(on) {
    ['playPause','scrubber','backFrame','nextFrame','markClub','clearPoints','startTime','endTime','markScale','markGuide','setAddress','setTop','setImpact','exportPng','exportVideo'].forEach(id => $(id).disabled = !on);
    updateButtons();
  }
  function updateButtons() {
    const hasAnchor = state.anchors.length > 0;
    $('runTrack').disabled = !hasAnchor || state.tracking;
    $('exportCsv').disabled = !(state.trace.length || state.anchors.length);
  }
  function clearAnalysis(keepVideo = true) {
    state.anchors = [];
    state.trace = [];
    state.scale = [];
    state.guide = [];
    state.markers = {address: null, top: null, impact: null};
    state.lastTrackFrame = null;
    setMode(null);
    $('seedDetail').textContent = 'No clubhead selected';
    $('scaleDetail').textContent = 'Required for rough 2D speed estimation. Place a ruler in the clubhead\'s movement plane.';
    $('guideDetail').textContent = 'Add a direction guide to compare the projected path at impact.';
    ['Address','Top','Impact'].forEach(x => $(`mark${x}Value`).textContent = '—');
    setStatus('Ready when you are');
    if (!keepVideo) {
      state.duration = 0;
      state.name = null;
    }
    updateButtons();
    draw();
    updateMetrics();
  }
  function handleFile(file) {
    if (!file) return;
    if (!(file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|ogg)$/i.test(file.name))) {
      toast('Please choose a video file such as MP4, MOV, or WebM.', true); return;
    }
    if (state.url) URL.revokeObjectURL(state.url);
    video.pause();
    state.url = URL.createObjectURL(file);
    state.name = file.name || 'camera-swing';
    clearAnalysis();
    video.src = state.url;
    extractor.src = state.url;
    video.load();
    extractor.load();
    $('sourceChip').textContent = 'LOADING VIDEO...';
    $('sourceChip').classList.remove('loaded');
    $('sourceChip').title = state.name;
  }
  function onMetadata() {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      toast('This video does not expose a valid duration in your browser.', true); return;
    }
    state.duration = video.duration;
    state.sourceWidth = video.videoWidth;
    state.sourceHeight = video.videoHeight;
    stage.style.aspectRatio = `${state.sourceWidth} / ${state.sourceHeight}`;
    $('placeholder').classList.add('hidden');
    video.classList.remove('hidden');
    canvas.classList.remove('hidden');
    $('stageInfo').classList.remove('hidden');
    $('sourceChip').innerHTML = '<span class="source-light"></span> CLIP READY';
    $('sourceChip').classList.add('loaded');
    $('sourceChip').title = state.name;
    $('timeTotal').textContent = fmt(state.duration);
    $('scrubber').max = state.duration.toString();
    $('startTime').value = '0.00';
    $('endTime').value = round(Math.min(state.duration, 2.5));
    $('startTime').max = round(state.duration);
    $('endTime').max = round(state.duration);
    video.currentTime = 0;
    enableLoaded(true);
    resizeOverlay();
    toast('Video ready. Pause on the clubhead and mark your first point.');
  }
  video.addEventListener('loadedmetadata', onMetadata);
  video.addEventListener('error', () => toast('This video codec could not be opened. Try exporting as H.264 MP4.', true));
  $('fileInput').addEventListener('change', event => {handleFile(event.target.files[0]);event.target.value = '';});
  ['topUpload','uploadMain'].forEach(id => $(id).addEventListener('click', () => $('fileInput').click()));
  for (const eventName of ['dragover','drop']) {
    stage.addEventListener(eventName, ev => {
      ev.preventDefault();
      if (eventName === 'drop' && ev.dataTransfer.files.length) handleFile(ev.dataTransfer.files[0]);
    });
  }

  function timeSync() {
    $('timeCurrent').textContent = fmt(video.currentTime);
    if (state.duration) $('scrubber').value = String(video.currentTime);
    draw();
  }
  video.addEventListener('timeupdate', timeSync);
  video.addEventListener('seeked', timeSync);
  video.addEventListener('pause', () => { $('playIcon').innerHTML = '<path d="m8 5 11 7-11 7Z"/>'; draw(); });
  video.addEventListener('play', () => { $('playIcon').innerHTML = '<path d="M7 5h4v14H7zm7 0h4v14h-4z"/>'; playbackLoop(); });
  let raf = null;
  function playbackLoop() {
    if (video.paused || video.ended) return;
    timeSync();
    raf = requestAnimationFrame(playbackLoop);
  }
  $('playPause').addEventListener('click', async () => {
    if (!state.url) return;
    if (video.paused) { try { await video.play(); } catch { toast('Browser blocked playback. Click the video timeline first.', true); } }
    else video.pause();
  });
  $('scrubber').addEventListener('input', e => {if (state.url) video.currentTime = Number(e.target.value);});
  function stepVideo(direction) {
    if (!state.url) return;
    video.pause();
    video.currentTime = clamp(video.currentTime + direction / Number($('sampleFPS').value), 0, state.duration - EPS);
  }
  $('backFrame').addEventListener('click', () => stepVideo(-1));
  $('nextFrame').addEventListener('click', () => stepVideo(1));
  $('playbackSpeed').addEventListener('change', e => { video.playbackRate = Number(e.target.value); });
  $('sampleFPS').addEventListener('change', e => { state.currentFPS = Number(e.target.value); });

  function overlayDimensions() {
    const bounds = stage.getBoundingClientRect();
    const w = bounds.width || 700, h = bounds.height || 394;
    const naturalRatio = state.sourceWidth / state.sourceHeight || 16/9;
    const boxRatio = w/h;
    let rw, rh, rx, ry;
    if (boxRatio > naturalRatio) {rh=h;rw=rh*naturalRatio;rx=(w-rw)/2;ry=0;}
    else {rw=w;rh=rw/naturalRatio;rx=0;ry=(h-rh)/2;}
    return {x:rx, y:ry, w:rw, h:rh};
  }
  function resizeOverlay() {
    if (!state.url) return;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  window.addEventListener('resize', resizeOverlay);
  if (window.ResizeObserver) new ResizeObserver(resizeOverlay).observe(stage);
  function xy(pt, rect) {return {x:rect.x + pt.x*rect.w, y:rect.y + pt.y*rect.h};}

  function renderGraphics(ctx, rect, currentTime, options = {}) {
    const allTrace = Boolean(options.fullTrace);
    if (!options.forceTrace && !$('showTrace').checked) return;
    ctx.save();
    const scale = Math.max(.45, rect.w / 900);
    if (state.scale.length === 2) {
      const a=xy(state.scale[0],rect), b=xy(state.scale[1],rect);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.setLineDash([7*scale,5*scale]);ctx.lineWidth=2*scale;ctx.strokeStyle='#fcce72';ctx.stroke();ctx.setLineDash([]);
    }
    if (state.guide.length === 2) {
      const a=xy(state.guide[0],rect), b=xy(state.guide[1],rect);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.setLineDash([10*scale,7*scale]);ctx.lineWidth=2*scale;ctx.strokeStyle='#9ee7ff';ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#d1f3ff';ctx.font=`${Math.max(10,12*scale)}px sans-serif`;ctx.fillText('REFERENCE',a.x+8,a.y-9);
    }
    const pts=(state.trace.length ? state.trace : state.anchors).filter(p => allTrace || p.t <= currentTime + 0.001).sort((a,b)=>a.t-b.t);
    if (pts.length > 1) {
      // Draw segments independently so uncertain matches are identifiable and long time gaps do not bridge.
      ctx.lineJoin='round';ctx.lineCap='round';
      for(let i=1;i<pts.length;i++) {
        const a=pts[i-1], b=pts[i];
        if (b.t-a.t > .22 || (b.confidence != null && b.confidence < .25)) continue;
        const s=xy(a,rect),e=xy(b,rect);
        const gradient=ctx.createLinearGradient(s.x,s.y,e.x+EPS,e.y+EPS);
        const fraction=i/pts.length;
        gradient.addColorStop(0,fraction<.48?'#48a9ff':'#8ded91');gradient.addColorStop(1,fraction<.48?'#8ad7ff':'#caff8c');
        ctx.strokeStyle=gradient;ctx.lineWidth=10*scale;ctx.globalAlpha=.18;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(e.x,e.y);ctx.stroke();
        ctx.globalAlpha=1;ctx.lineWidth=3.6*scale;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(e.x,e.y);ctx.stroke();
      }
      const latest=xy(pts[pts.length-1],rect);
      ctx.fillStyle='#cfff9c';ctx.shadowColor='#b5ff8d';ctx.shadowBlur=13*scale;ctx.beginPath();ctx.arc(latest.x,latest.y,5*scale,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    }
    for(const point of state.anchors) {
      const p=xy(point,rect);
      ctx.strokeStyle='#eaffdd';ctx.lineWidth=1.5*scale;ctx.beginPath();ctx.arc(p.x,p.y,6*scale,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(p.x-10*scale,p.y);ctx.lineTo(p.x+10*scale,p.y);ctx.moveTo(p.x,p.y-10*scale);ctx.lineTo(p.x,p.y+10*scale);ctx.stroke();
    }
    if(state.markers.impact != null && pts.length) {
      const nearest=pts.reduce((a,b)=>Math.abs(b.t-state.markers.impact)<Math.abs(a.t-state.markers.impact)?b:a);
      if(Math.abs(nearest.t-state.markers.impact) < .15) {
        const p=xy(nearest,rect);ctx.lineWidth=2*scale;ctx.strokeStyle='#ffffff';ctx.beginPath();ctx.arc(p.x,p.y,12*scale,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff';ctx.font=`${Math.max(10,12*scale)}px sans-serif`;ctx.fillText('IMPACT',p.x+17*scale,p.y-12*scale);
      }
    }
    ctx.restore();
  }
  function draw() {
    if (!state.url || !canvas.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w=canvas.width/dpr,h=canvas.height/dpr;
    context.clearRect(0,0,w,h);
    renderGraphics(context,overlayDimensions(),video.currentTime);
  }
  $('showTrace').addEventListener('change', draw);

  function addPin(t, x, y) {
    const tolerance = 0.6 / Number($('sampleFPS').value);
    const prev=state.anchors.find(p=>Math.abs(p.t-t)<tolerance);
    if(prev) Object.assign(prev,{x,y,t,confidence:1,manual:true});
    else state.anchors.push({t,x,y,confidence:1,manual:true});
    state.anchors.sort((a,b)=>a.t-b.t);
    $('seedDetail').textContent=`${state.anchors.length} manual point${state.anchors.length===1?'':'s'} · first at ${round(state.anchors[0].t)}s`;
    // Keep earlier trace visible, replacing any nearest sample with the corrected anchor.
    if(state.trace.length) {
      const nearest=state.trace.reduce((a,b)=>Math.abs(b.t-t)<Math.abs(a.t-t)?b:a);
      if(Math.abs(nearest.t-t)<tolerance) Object.assign(nearest,{x,y,manual:true,confidence:1});
      else state.trace.push({t,x,y,manual:true,confidence:1});
      state.trace.sort((a,b)=>a.t-b.t);
    }
    setStatus('Manual point saved. Rerun to re-track with corrections.', 'ok');
    updateButtons();updateMetrics();draw();
  }
  canvas.addEventListener('click',ev=>{
    if(!state.url || !state.mode || state.tracking)return;
    const bounds=canvas.getBoundingClientRect(), rect=overlayDimensions();
    const mx=ev.clientX-bounds.left,my=ev.clientY-bounds.top;
    if(mx<rect.x||mx>rect.x+rect.w||my<rect.y||my>rect.y+rect.h) return;
    const pt={x:clamp((mx-rect.x)/rect.w,0,1),y:clamp((my-rect.y)/rect.h,0,1)};
    if(state.mode==='pin'){
      video.pause();addPin(video.currentTime,pt.x,pt.y);setMode(null);
    } else if(state.mode==='scale'){
      state.scale.push(pt);
      if(state.scale.length===2){setMode(null);$('scaleDetail').textContent=`Scale marked · ${$('knownInches').value} in over ${Math.round(Math.hypot((state.scale[1].x-state.scale[0].x)*state.sourceWidth,(state.scale[1].y-state.scale[0].y)*state.sourceHeight))} source pixels.`;updateMetrics();}
    } else if(state.mode==='guide'){
      state.guide.push(pt);
      if(state.guide.length===2){setMode(null);$('guideDetail').textContent='Reference line marked. Set impact position for projected angle.';updateMetrics();}
    }
    draw();
  });
  $('markClub').addEventListener('click',()=>{if(!state.url)return;video.pause();setMode(state.mode==='pin'?null:'pin');});
  $('markScale').addEventListener('click',()=>{if(!state.url)return;video.pause();state.scale=[];setMode('scale');updateMetrics();draw();});
  $('markGuide').addEventListener('click',()=>{if(!state.url)return;video.pause();state.guide=[];setMode('guide');updateMetrics();draw();});
  $('knownInches').addEventListener('input',updateMetrics);
  $('clearPoints').addEventListener('click',()=>clearAnalysis());
  $('resetMarkers').addEventListener('click',()=>{state.markers={address:null,top:null,impact:null};['Address','Top','Impact'].forEach(x=>$(`mark${x}Value`).textContent='—');updateMetrics();draw();});
  for(const [id,key,label] of [['setAddress','address','Address'],['setTop','top','Top'],['setImpact','impact','Impact']]){
    $(id).addEventListener('click',()=>{if(!state.url)return;video.pause();state.markers[key]=video.currentTime;$(`mark${label}Value`).textContent=`${round(video.currentTime)}s`;updateMetrics();draw();});
  }

  function waitForMetadata(el) {
    return new Promise((resolve,reject)=>{
      if(el.readyState>=1 && el.videoWidth){resolve();return;}
      const done=()=>{cleanup();resolve();}, bad=()=>{cleanup();reject(new Error('Cannot decode video metadata.'));};
      const timeout=setTimeout(bad,10000);
      function cleanup(){clearTimeout(timeout);el.removeEventListener('loadedmetadata',done);el.removeEventListener('error',bad);}
      el.addEventListener('loadedmetadata',done,{once:true});el.addEventListener('error',bad,{once:true});
    });
  }
  function seekTo(el,t) {
    return new Promise((resolve,reject)=>{
      const target=clamp(t,0,Math.max(0,(el.duration||t+1)-0.0005));
      if(el.readyState>=2 && Math.abs(el.currentTime-target)<0.0007) {resolve();return;}
      const timeout=setTimeout(()=>{cleanup();reject(new Error(`Timed out decoding frame at ${round(target)}s`));},5000);
      const ok=()=>{cleanup();resolve();};const bad=()=>{cleanup();reject(new Error('Video frame could not be decoded.'));};
      function cleanup(){clearTimeout(timeout);el.removeEventListener('seeked',ok);el.removeEventListener('error',bad);}
      el.addEventListener('seeked',ok,{once:true});el.addEventListener('error',bad,{once:true});
      try{el.currentTime=target;}catch(err){cleanup();reject(err);}
    });
  }
  async function grabFrame(t, w, h) {
    await seekTo(extractor,t);
    workCanvas.width=w;workCanvas.height=h;
    workCtx.drawImage(extractor,0,0,w,h);
    const rgba=workCtx.getImageData(0,0,w,h).data;
    const gray=new Uint8Array(w*h);
    for(let i=0,j=0;i<rgba.length;i+=4,j++) gray[j]=(rgba[i]*77+rgba[i+1]*150+rgba[i+2]*29)>>8;
    return gray;
  }
  function makeTemplate(frame,w,h,cx,cy) {
    // 9x9 point sample around mark; tracking is translational, not true feature/pose estimation.
    const vals=[],offsets=[];
    for(let dy=-10;dy<=10;dy+=2.5)for(let dx=-10;dx<=10;dx+=2.5){
      const x=clamp(Math.round(cx+dx),0,w-1),y=clamp(Math.round(cy+dy),0,h-1);
      vals.push(frame[y*w+x]);offsets.push([dx,dy]);
    }
    return {vals,offsets};
  }
  function templateScore(gray,w,h,template,x,y) {
    let sum=0;
    for(let i=0;i<template.vals.length;i++){
      const dx=template.offsets[i][0],dy=template.offsets[i][1];
      const xx=clamp(Math.round(x+dx),0,w-1),yy=clamp(Math.round(y+dy),0,h-1);
      sum+=Math.abs(gray[yy*w+xx]-template.vals[i]);
    }
    return sum/template.vals.length;
  }
  function locate(gray,w,h,template,predX,predY,radius) {
    const left=clamp(Math.floor(predX-radius),12,w-13),right=clamp(Math.ceil(predX+radius),12,w-13);
    const top=clamp(Math.floor(predY-radius),12,h-13),bottom=clamp(Math.ceil(predY+radius),12,h-13);
    let best={x:clamp(predX,12,w-13),y:clamp(predY,12,h-13),cost:Infinity};
    for(let yy=top;yy<=bottom;yy+=5){for(let xx=left;xx<=right;xx+=5){
      const score=templateScore(gray,w,h,template,xx,yy);
      if(score<best.cost)best={x:xx,y:yy,cost:score};
    }}
    const coarse=best;
    for(let yy=Math.max(12,coarse.y-5);yy<=Math.min(h-13,coarse.y+5);yy++){
      for(let xx=Math.max(12,coarse.x-5);xx<=Math.min(w-13,coarse.x+5);xx++){
        const score=templateScore(gray,w,h,template,xx,yy);
        if(score<best.cost)best={x:xx,y:yy,cost:score};
      }
    }
    // Brightness/background changes are common. Confidence is only a visual template score.
    best.confidence=clamp(1-best.cost/90,0,1);
    return best;
  }
  function updateTemplate(gray,w,h,template,x,y,rate=.13) {
    for(let i=0;i<template.vals.length;i++) {
      const xx=clamp(Math.round(x+template.offsets[i][0]),0,w-1),yy=clamp(Math.round(y+template.offsets[i][1]),0,h-1);
      template.vals[i]=(1-rate)*template.vals[i]+rate*gray[yy*w+xx];
    }
  }
  function progress(percent,message) {
    $('progressCover').classList.remove('hidden');
    $('progressText').textContent=message;
    $('progressSub').textContent=`${Math.round(percent)}%`;
  }
  function finishProgress() {
    $('progressCover').classList.add('hidden');
    state.tracking=false;
    state.cancel=false;
    updateButtons();
  }
  $('cancelTrack').addEventListener('click',()=>{state.cancel=true;});
  async function trackVideo() {
    if(state.tracking || !state.url || !state.anchors.length)return;
    const fps=Number($('sampleFPS').value),radius=Number($('searchSize').value);
    const from=clamp(Number($('startTime').value)||0,0,state.duration-0.01);
    const to=clamp(Number($('endTime').value)||0,from+0.01,state.duration);
    const seed=state.anchors.find(a=>a.t>=from-0.03 && a.t<=to);
    if(!seed){toast('Mark the clubhead on a frame inside your selected FROM / TO window.',true);return;}
    if(to-seed.t < .05){toast('Move the TO time at least 0.1 seconds after the first point.',true);return;}
    const requestedCount=Math.ceil((to-seed.t)*fps);
    if(requestedCount>500){toast('Select a shorter window or lower sample rate (500 samples maximum).',true);return;}
    const maxCount=requestedCount;
    if(maxCount<2){toast('Choose a longer tracking window.',true);return;}
    state.tracking=true;state.cancel=false;updateButtons();video.pause();setMode(null);
    progress(0,'Reading clubhead frames');
    const previousTrace=state.trace;
    try{
      await waitForMetadata(extractor);
      const width=Math.min(720,extractor.videoWidth);
      const height=Math.max(1,Math.round(width*extractor.videoHeight/extractor.videoWidth));
      let frame=await grabFrame(seed.t,width,height);
      let x=seed.x*width,y=seed.y*height;
      let template=makeTemplate(frame,width,height,x,y);
      let vx=0,vy=0;
      const points=[{...seed,confidence:1,manual:true}];
      let weakCount=0;
      for(let i=1;i<=maxCount;i++){
        if(state.cancel)throw new Error('Tracking cancelled');
        const t=Math.min(to,seed.t+i/fps);
        frame=await grabFrame(t,width,height);
        const pin=state.anchors.find(a=>Math.abs(a.t-t)<=0.51/fps);
        let confidence=1,manual=false;
        if(pin){x=pin.x*width;y=pin.y*height;template=makeTemplate(frame,width,height,x,y);vx=vy=0;manual=true;}
        else{
          const oldX=x,oldY=y;
          // Prior-frame velocity is capped to reduce jumps to a similar-looking background patch.
          const predX=clamp(x+vx*.65,12,width-13),predY=clamp(y+vy*.65,12,height-13);
          const found=locate(frame,width,height,template,predX,predY,radius);
          confidence=found.confidence;
          if(confidence>=.29){x=found.x;y=found.y;vx=x-oldX;vy=y-oldY;}
          else {weakCount++;vx*=.45;vy*=.45;}
          if(confidence>.68)updateTemplate(frame,width,height,template,x,y);
        }
        points.push({t,x:x/width,y:y/height,confidence,manual});
        if(i%3===0||i===maxCount){progress(i/maxCount*100,`Tracking ${i} of ${maxCount} frames`);await new Promise(r=>setTimeout(r,0));}
      }
      // Manual annotations after the first mark and outside sampling grid are retained.
      for (const a of state.anchors) if(a.t>=seed.t && a.t<=to && !points.some(p=>Math.abs(p.t-a.t)<0.51/fps))points.push({...a});
      points.sort((a,b)=>a.t-b.t);
      state.trace=points;
      const low=Math.round(points.filter(p=>p.confidence<.45).length/points.length*100);
      setStatus(`${points.length} frames traced · ${low}% uncertain matches`,low>30?'warn':'ok');
      toast(low>30?'Trace created. Review carefully and pin clubhead where it drifts.':'Trace created. Review the path and export your clip.');
    }catch(err){state.trace=previousTrace;setStatus(err.message,true);toast(err.message,true);}
    finally{finishProgress();updateMetrics();draw();}
  }
  $('runTrack').addEventListener('click',trackVideo);

  function getCalibration() {
    const inches=Number($('knownInches').value);
    if(state.scale.length!==2 || !Number.isFinite(inches) || inches<=0)return null;
    const px=Math.hypot((state.scale[1].x-state.scale[0].x)*state.sourceWidth,(state.scale[1].y-state.scale[0].y)*state.sourceHeight);
    return px>3?px/inches:null;
  }
  function segmentSpeed(a,b,pxPerInch) {
    const dt=b.t-a.t;
    if(dt<=.001)return null;
    const pixels=Math.hypot((b.x-a.x)*state.sourceWidth,(b.y-a.y)*state.sourceHeight);
    // inches/sec => mph = 3600 / 63360 = 0.05681818...
    return pixels/dt/pxPerInch*3600/63360;
  }
  function speedEstimates() {
    const calibration=getCalibration();
    if(!calibration || state.trace.length<7)return [];
    const pts=state.trace;
    const speeds=[];
    // 3-point window smooths frame-to-frame jitter. Skip uncertain/manual segments.
    for(let i=2;i<pts.length-2;i++){
      const subset=pts.slice(i-2,i+3);
      if(subset.some(p=>(p.confidence??1)<.66))continue;
      if(subset.some((p,j)=>j>0 && p.t-subset[j-1].t>.065))continue;
      const mph=segmentSpeed(subset[0],subset[4],calibration);
      if(mph!=null && Number.isFinite(mph) && mph<220 && mph>=0)speeds.push(mph);
    }
    return speeds;
  }
  function getPathAngle() {
    if(state.guide.length!==2 || state.markers.impact==null || state.trace.length<3)return null;
    const impact=state.markers.impact;
    const earlier=state.trace.filter(p=>p.t>=impact-.13 && p.t<impact-.035 && (p.confidence??1)>.58);
    const later=state.trace.filter(p=>p.t>=impact-.03 && p.t<=impact+.01 && (p.confidence??1)>.58);
    if(!earlier.length || !later.length)return null;
    const a=earlier[0],b=later[later.length-1];
    let ax=(b.x-a.x)*state.sourceWidth,ay=(b.y-a.y)*state.sourceHeight;
    let bx=(state.guide[1].x-state.guide[0].x)*state.sourceWidth,by=(state.guide[1].y-state.guide[0].y)*state.sourceHeight;
    if(Math.hypot(ax,ay)<3 || Math.hypot(bx,by)<5)return null;
    const angle=Math.atan2(ax*by-ay*bx,ax*bx+ay*by)*180/Math.PI;
    // Undirected reference line. Return angle closest to 0; not a radar club-path measurement.
    return angle>90?angle-180:angle< -90?angle+180:angle;
  }
  function updateMetrics() {
    const pts=state.trace;
    $('metricPoints').textContent=pts.length?String(pts.length):'—';
    $('metricPointsSub').textContent=pts.length?`${round(pts[pts.length-1].t-pts[0].t)} sec of recorded motion`:'Run a trace to begin';
    const speeds=speedEstimates();
    if(speeds.length>=4){const sorted=[...speeds].sort((a,b)=>a-b);const speed=sorted[Math.floor((sorted.length-1)*.90)];$('metricSpeed').textContent=round(speed,1);$('metricSpeedSub').textContent='90th-percentile 2D projection · rough';}
    else{$('metricSpeed').textContent='—';$('metricSpeedSub').textContent=getCalibration()?'Not enough reliable tracked frames':'Calibrate the scene to estimate';}
    const angle=getPathAngle();
    $('metricPath').textContent=angle==null?'—':`${angle>=0?'+':''}${round(angle,1)}°`;
    $('metricPathSub').textContent=angle==null?'Needs impact mark + reference line':'Image-plane angle · NOT real club path';
    const {address,top,impact}=state.markers;
    const tempo=address!=null&&top!=null&&impact!=null&&address<top&&top<impact&&(impact-top)>.015?(top-address)/(impact-top):null;
    $('metricTempo').textContent=tempo!=null?`${round(tempo,2)}:1`:'—';
    $('metricTempoSub').textContent=tempo!=null?`${round(top-address)}s back · ${round(impact-top)}s down`:'Mark start, top and impact';
  }

  function download(blob,name) {
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);
  }
  function safeName(name){return (name||'swing').replace(/\.[^.]+$/,'').replace(/[^a-z0-9-_]/gi,'-').slice(0,70);}
  function makeRenderCanvas(w,h) {
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;return cv;
  }
  function drawVideoFrame(ctx,src,w,h,t) {
    ctx.drawImage(src,0,0,w,h);
    renderGraphics(ctx,{x:0,y:0,w,h},t,{forceTrace:true});
  }
  $('exportPng').addEventListener('click',()=>{
    if(!state.url || video.readyState<2)return;
    const w=Math.min(state.sourceWidth,1920),h=Math.round(w*state.sourceHeight/state.sourceWidth);
    const cv=makeRenderCanvas(w,h),ctx=cv.getContext('2d');
    drawVideoFrame(ctx,video,w,h,video.currentTime);
    cv.toBlob(blob=>{if(blob){download(blob,`${safeName(state.name)}-trace.png`);toast('PNG exported.');}else toast('PNG export failed.',true);},'image/png');
  });
  $('exportCsv').addEventListener('click',()=>{
    const pts=state.trace.length?state.trace:state.anchors;
    if(!pts.length)return;
    const rows=['time_seconds,x_normalized,y_normalized,confidence,manual'];
    for(const p of pts)rows.push(`${round(p.t,5)},${round(p.x,6)},${round(p.y,6)},${round(p.confidence??1,3)},${Boolean(p.manual)}`);
    download(new Blob([rows.join('\n')],{type:'text/csv;charset=utf-8'}),`${safeName(state.name)}-trace.csv`);
  });
  function supportedVideoFormat() {
    if(!window.MediaRecorder)return null;
    for(const [mime,ext] of [
      ['video/webm;codecs=vp9','webm'],['video/webm;codecs=vp8','webm'],['video/webm','webm'],['video/mp4','mp4']
    ])if(MediaRecorder.isTypeSupported(mime))return {mime,ext};
    return null;
  }
  $('exportVideo').addEventListener('click',async()=>{
    if(!state.url || state.exporting)return;
    const fmtObj=supportedVideoFormat();
    if(!fmtObj || !HTMLCanvasElement.prototype.captureStream){toast('Video export is not supported in this browser. Export a PNG or try Chrome/Edge.',true);return;}
    state.exporting=true;$('exportVideo').disabled=true;$('exportVideo').textContent='Rendering...';
    const outputVid=document.createElement('video');outputVid.src=state.url;outputVid.muted=true;outputVid.playsInline=true;outputVid.preload='auto';
    const begin=clamp(Number($('startTime').value)||0,0,state.duration-.05),end=clamp(Number($('endTime').value)||state.duration,begin+.05,state.duration);
    let rec=null, stream=null, tick=null;
    try{
      await waitForMetadata(outputVid);await seekTo(outputVid,begin);
      const w=Math.min(1280,outputVid.videoWidth),h=Math.round(w*outputVid.videoHeight/outputVid.videoWidth);
      const cv=makeRenderCanvas(w,h),ctx=cv.getContext('2d');
      stream=cv.captureStream(30);
      const chunks=[];
      rec=new MediaRecorder(stream,{mimeType:fmtObj.mime,videoBitsPerSecond:5000000});
      const done=new Promise((resolve,reject)=>{rec.onstop=()=>resolve();rec.onerror=()=>reject(new Error('Video encoder error'));});
      let finishing=false;
      function stopOnce(){if(finishing)return;finishing=true;outputVid.pause();if(rec.state!=='inactive')rec.stop();}
      function paint(){
        ctx.drawImage(outputVid,0,0,w,h);
        renderGraphics(ctx,{x:0,y:0,w,h},outputVid.currentTime,{forceTrace:true});
        if(outputVid.currentTime>=end-.012 || outputVid.ended){stopOnce();return;}
        tick=requestAnimationFrame(paint);
      }
      rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      outputVid.addEventListener('ended',stopOnce,{once:true});
      paint();rec.start(200);
      await outputVid.play();
      await done;
      if(!chunks.length)throw new Error('No encoded video received.');
      download(new Blob(chunks,{type:fmtObj.mime}),`${safeName(state.name)}-swing-trace.${fmtObj.ext}`);
      toast('Annotated video exported.');
    }catch(err){toast('Could not render video: '+err.message,true);}
    finally{
      if(tick)cancelAnimationFrame(tick);
      outputVid.pause();outputVid.removeAttribute('src');outputVid.load();
      if(stream)stream.getTracks().forEach(t=>t.stop());
      state.exporting=false;$('exportVideo').disabled=false;$('exportVideo').innerHTML='<span>↧</span> Export trace video';
    }
  });

  async function openCamera() {
    $('cameraModal').classList.remove('hidden');
    $('cameraStatus').textContent='Requesting camera access...';
    $('recordButton').disabled=true;
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Use HTTPS or localhost to access the camera.');
      state.stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:120}},audio:false});
      $('cameraPreview').srcObject=state.stream;
      await $('cameraPreview').play();
      const track=state.stream.getVideoTracks()[0];
      const actual=track.getSettings().frameRate;
      $('cameraStatus').textContent=`Camera ready${actual?` · ${Math.round(actual)} fps`:''}. Keep it steady.`;
      $('recordButton').disabled=false;
    }catch(err){$('cameraStatus').textContent=err.message;toast('Unable to access camera: '+err.message,true);}
  }
  function closeCamera(){
    if(state.recorder?.state==='recording'){state.discardRecording=true;state.recorder.stop();}
    clearTimeout(state.maxRecordTimer);
    state.stream?.getTracks().forEach(t=>t.stop());state.stream=null;
    $('cameraPreview').srcObject=null;$('cameraModal').classList.add('hidden');
  }
  ['cameraMain'].forEach(id=>$(id).addEventListener('click',openCamera));
  $('closeCamera').addEventListener('click',closeCamera);
  $('cameraModal').addEventListener('click',e=>{if(e.target===$('cameraModal'))closeCamera();});
  $('recordButton').addEventListener('click',()=>{
    if(!state.stream)return;
    if(state.recorder?.state==='recording'){state.recorder.stop();return;}
    const format=supportedVideoFormat();
    if(!format){toast('Your browser does not support camera video recording.',true);return;}
    try{
      state.chunks=[];
      const recorder=new MediaRecorder(state.stream,{mimeType:format.mime,videoBitsPerSecond:8000000});
      state.recorder=recorder;
      recorder.ondataavailable=e=>{if(e.data?.size)state.chunks.push(e.data);};
      recorder.onstop=()=>{
        clearTimeout(state.maxRecordTimer);
        $('recordButton').textContent='● Start recording';
        if(state.discardRecording){state.discardRecording=false;state.chunks=[];return;}
        if(!state.chunks.length){toast('Recording was empty.',true);return;}
        const file=new File(state.chunks,`camera-swing-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.${format.ext}`,{type:format.mime});
        closeCamera();handleFile(file);
      };
      recorder.start(200);
      $('recordButton').textContent='■ Stop recording';
      $('cameraStatus').textContent='Recording swing... up to 15 seconds';
      state.maxRecordTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},15000);
    }catch(err){toast('Recording failed: '+err.message,true);}
  });

  function escapeHTML(str) {return String(str).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));}
  const journalKey='swingpath_shots_v1';
  function loadJournal() {
    try {const stored=JSON.parse(localStorage.getItem(journalKey)||'[]');state.journal=Array.isArray(stored)?stored:[];}
    catch{state.journal=[];}
    renderJournal();
  }
  function saveJournal(){try{localStorage.setItem(journalKey,JSON.stringify(state.journal));}catch{toast('Browser storage is unavailable. Export your journal CSV to retain it.',true);}}
  const numOrNull=id=>{const v=$(id).value.trim();return v===''?null:Number(v);};
  $('saveShot').addEventListener('click',()=>{
    const club=$('logClub').value,speed=numOrNull('logSpeed'),path=numOrNull('logPath'),face=numOrNull('logFace'),carry=numOrNull('logCarry');
    if([speed,path,face,carry].every(x=>x===null)){toast('Enter at least one SkyTrak+ number to save a shot.',true);return;}
    if([speed,path,face,carry].some(x=>x!==null&&!Number.isFinite(x))){toast('Check the numeric fields.',true);return;}
    state.journal.unshift({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,date:new Date().toISOString(),club,speed,path,face,carry,notes:$('logNotes').value.trim(),tracePoints:state.trace.length,tempo:state.markers.address!=null&&state.markers.top!=null&&state.markers.impact!=null?(state.markers.top-state.markers.address)/Math.max(.001,state.markers.impact-state.markers.top):null});
    saveJournal();renderJournal();['logSpeed','logPath','logFace','logCarry','logNotes'].forEach(id=>$(id).value='');toast('Swing added to local shot journal.');
  });
  function renderJournal(){
    const tbody=$('historyBody');
    if(!state.journal.length){tbody.innerHTML='<tr><td colspan="6" class="empty-history">Your saved shots will appear here.</td></tr>';return;}
    tbody.innerHTML=state.journal.slice(0,7).map(s=>`<tr><td>${escapeHTML(new Date(s.date).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</td><td>${escapeHTML(s.club)}</td><td>${s.speed==null?'—':round(s.speed,1)}</td><td>${s.path==null?'—':(s.path>=0?'+':'')+round(s.path,1)+'°'}</td><td>${s.carry==null?'—':round(s.carry,0)}</td><td><button type="button" aria-label="Delete saved swing" title="Delete shot" data-delete="${escapeHTML(s.id)}">×</button></td></tr>`).join('');
  }
  $('historyBody').addEventListener('click',e=>{
    const btn=e.target.closest('button[data-delete]');if(!btn)return;
    state.journal=state.journal.filter(s=>s.id!==btn.dataset.delete);saveJournal();renderJournal();toast('Shot deleted.');
  });
  function csvEsc(v){if(v==null)return '';return '"'+String(v).replace(/"/g,'""')+'"';}
  $('downloadJournal').addEventListener('click',()=>{
    if(!state.journal.length){toast('Your journal is empty.',true);return;}
    const rows=['date,club,club_speed_mph,club_path_deg,face_angle_deg,carry_yards,trace_points,tempo_ratio,notes'];
    for(const s of state.journal)rows.push([s.date,s.club,s.speed,s.path,s.face,s.carry,s.tracePoints,s.tempo,s.notes].map(csvEsc).join(','));
    download(new Blob([rows.join('\n')],{type:'text/csv;charset=utf-8'}),'swingpath-practice-journal.csv');
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && !$('cameraModal').classList.contains('hidden'))closeCamera();
    else if(e.key==='Escape')setMode(null);
    else if(e.code==='Space' && state.url && !['INPUT','BUTTON','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){
      e.preventDefault();$('playPause').click();
    }
  });
  window.addEventListener('beforeunload',()=>{if(state.url)URL.revokeObjectURL(state.url);state.stream?.getTracks().forEach(t=>t.stop());});
  loadJournal();enableLoaded(false);updateMetrics();
})();
