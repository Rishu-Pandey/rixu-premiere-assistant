/* Premiere ExtendScript adapter. Only named, parameter-validated operations are dispatched. */
$.global.RIXU = (function () {
  var TICKS = 254016000000;
  function requireSequence() { var s=app.project.activeSequence; if(!s)throw Error('Open a sequence in Premiere first.');return s; }
  function seconds(t){ return Number(t.seconds); }
  function clipInfo(c,track,index,type){
    var media='';try{media=c.projectItem.getMediaPath();}catch(e){}
    return {id:String(c.nodeId),name:c.name,track:track,index:index,mediaType:type,mediaPath:media,
      start:seconds(c.start),end:seconds(c.end),inPoint:seconds(c.inPoint),outPoint:seconds(c.outPoint),
      selected:!!c.isSelected(),disabled:!!c.disabled,speed:Number(c.getSpeed()),reversed:!!c.isSpeedReversed()};
  }
  function snapshot(){
    var s=requireSequence(),settings=s.getSettings(),v=[],a=[],marks=[],i,j,m;
    for(i=0;i<s.videoTracks.numTracks;i++)for(j=0;j<s.videoTracks[i].clips.numItems;j++)v.push(clipInfo(s.videoTracks[i].clips[j],i,j,'video'));
    for(i=0;i<s.audioTracks.numTracks;i++)for(j=0;j<s.audioTracks[i].clips.numItems;j++)a.push(clipInfo(s.audioTracks[i].clips[j],i,j,'audio'));
    m=s.markers.getFirstMarker();while(m){marks.push({name:m.name,comments:m.comments,start:seconds(m.start),end:seconds(m.end)});m=s.markers.getNextMarker(m);}
    return {version:app.version,sequenceId:String(s.sequenceID),sequenceName:s.name,projectPath:app.project.path,
      width:settings.videoFrameWidth,height:settings.videoFrameHeight,fps:TICKS/Number(s.timebase),timebase:String(s.timebase),
      playhead:seconds(s.getPlayerPosition()),videoTracks:s.videoTracks.numTracks,audioTracks:s.audioTracks.numTracks,video:v,audio:a,markers:marks};
  }
  function allClips(s){var out=[],i,j;for(i=0;i<s.videoTracks.numTracks;i++)for(j=0;j<s.videoTracks[i].clips.numItems;j++)out.push(s.videoTracks[i].clips[j]);for(i=0;i<s.audioTracks.numTracks;i++)for(j=0;j<s.audioTracks[i].clips.numItems;j++)out.push(s.audioTracks[i].clips[j]);return out;}
  function selected(s){var all=allClips(s),out=[],i;for(i=0;i<all.length;i++)if(all[i].isSelected())out.push(all[i]);if(!out.length)throw Error('Select timeline clips first.');return out;}
  function time(sec){var t=new Time();t.seconds=sec;return t;}
  function cloneSequence(s){
    var prior={},old=snapshot(),i,id,newSeq=null;
    for(i=0;i<app.project.sequences.numSequences;i++)prior[String(app.project.sequences[i].sequenceID)]=true;
    if(!s.clone())throw Error('Premiere could not duplicate the sequence.');
    for(i=0;i<app.project.sequences.numSequences;i++){id=String(app.project.sequences[i].sequenceID);if(!prior[id])newSeq=app.project.sequences[i];}
    if(!newSeq)throw Error('Duplicated sequence was not found. Inspect Premiere.');
    app.project.openSequence(newSeq.sequenceID);newSeq.name=s.name+' - SUPERMODE';
    var rows=old.video.concat(old.audio),row,tr;
    for(i=0;i<rows.length;i++){row=rows[i];tr=row.mediaType==='video'?newSeq.videoTracks[row.track]:newSeq.audioTracks[row.track];if(tr&&tr.clips[row.index])tr.clips[row.index].setSelected(row.selected?1:0,1);}
    return newSeq;
  }
  function findProjectItem(item,target){var i,child,found;try{if(item.getMediaPath&&String(item.getMediaPath()).toLowerCase()===target.toLowerCase())return item;}catch(e){}if(item.children)for(i=0;i<item.children.numItems;i++){child=item.children[i];found=findProjectItem(child,target);if(found)return found;}return null;}
  function importItem(file){var f=new File(file);if(!f.exists)throw Error('Media file is missing: '+file);var item=findProjectItem(app.project.rootItem,file);if(item)return item;if(!app.project.importFiles([file],true,app.project.rootItem,false))throw Error('Premiere import failed: '+file);item=findProjectItem(app.project.rootItem,file);if(!item)throw Error('Imported media could not be resolved by path: '+file);return item;}
  function property(c,name,match){var i,j,comp,p;for(i=0;i<c.components.numItems;i++){comp=c.components[i];if(match&&comp.matchName!==match)continue;for(j=0;j<comp.properties.numItems;j++){p=comp.properties[j];if(p.displayName===name)return p;}}return null;}
  function scale(c,value){var p=property(c,'Scale','AE.ADBE Motion')||property(c,'Scale');if(!p)throw Error('Motion Scale is unavailable in this host language/version.');p.setValue(value,true);}
  function volume(c,db){var p=property(c,'Level','AE.ADBE Volume')||property(c,'Level','AE.ADBE Audio')||property(c,'Level');if(!p)throw Error('Clip volume is unavailable in this host language/version.');var value=Math.pow(10,(db-15)/20);p.setValue(value,true);if(Math.abs(Number(p.getValue())-value)>.00001)throw Error('Premiere did not accept the requested clip volume. Inspect the sequence.');}
  function generatedCaption(c,root){
    if(!/^RIXU Caption /.test(c.name))return false;
    if(/\[(Normal|Highlight)\]$/.test(c.name))return !!property(c,'Source Text','AE.ADBE Text');
    var p='';try{p=String(c.projectItem.getMediaPath()).replace(/\\/g,'/').toLowerCase();}catch(e){}
    root=String(root||'').replace(/\\/g,'/').toLowerCase();return root&&p.indexOf(root+'/')===0&&/\/graphics\/[^\/]+\.png$/.test(p);
  }
  function appendTextTracks(s){
    var count=s.videoTracks.numTracks,audioCount=s.audioTracks.numTracks,rows=snapshot().video,oldTracks={},i;
    for(i=0;i<rows.length;i++)oldTracks[rows[i].id]=rows[i].track;
    app.enableQE();var qs=qe.project.getActiveSequence();if(!qs||!qs.addTracks)throw Error('This host cannot allocate topmost text tracks.');qs.addTracks(2,count,0);
    if(s.videoTracks.numTracks!==count+2||s.audioTracks.numTracks!==audioCount)throw Error('Premiere did not append the two text tracks as requested. Inspect the sequence copy.');
    rows=snapshot().video;for(i=0;i<rows.length;i++)if(oldTracks[rows[i].id]!==rows[i].track)throw Error('Track allocation shifted existing graphics; application stopped on the copy.');
    try{s.videoTracks[count].name='RIXU Captions - Normal';s.videoTracks[count+1].name='RIXU Captions - Highlight';}catch(e){}
    return {normal:count,highlight:count+1};
  }
  function placeNativeText(s,row,track){
    var c=s.importMGT((new File(row.path)).fsName,String(Math.round(row.start*TICKS)),track,0),i,found=false;
    if(!c||!property(c,'Source Text','AE.ADBE Text'))throw Error('Premiere did not create editable native text. No PNG fallback was used.');
    for(i=0;i<s.videoTracks[track].clips.numItems;i++)if(String(s.videoTracks[track].clips[i].nodeId)===String(c.nodeId))found=true;
    if(!found)throw Error('Premiere put a text clip on an unexpected track. Inspect the copy.');
    c.name='RIXU Caption '+row.id+(row.role==='highlight'?' [Highlight]':' [Normal]');c.end=time(row.end);
    var fontScale=property(c,'Scale','AE.ADBE Text'),point=property(c,'Position','AE.ADBE Text');
    fontScale.setValue(100,true);point.setValue([row.x/row.canvasWidth,(row.y+row.baselineOffset)/row.canvasHeight],true);
    if(Math.abs(seconds(c.start)-row.start)>.5/(TICKS/Number(s.timebase))||Math.abs(seconds(c.end)-row.end)>.5/(TICKS/Number(s.timebase)))throw Error('Native text timing differs from its layout-split interval.');
    var opacity=property(c,'Opacity','AE.ADBE Opacity');if(opacity){opacity.setTimeVarying(false);opacity.setValue(100,true);}
    return {type:'native_text',id:row.id,role:row.role,track:track,start:seconds(c.start),end:seconds(c.end),editable:true};
  }
  function appendSfxTracks(s,count){
    var before=s.audioTracks.numTracks,videoCount=s.videoTracks.numTracks,old=snapshot().audio,ids={},i;
    for(i=0;i<old.length;i++)ids[old[i].id]=old[i].track;
    app.enableQE();qe.project.getActiveSequence().addTracks(0,0,count,1,before);
    if(s.audioTracks.numTracks!==before+count||s.videoTracks.numTracks!==videoCount)throw Error('Premiere could not append the SFX lanes. Inspect the sequence copy.');
    var now=snapshot().audio;for(i=0;i<now.length;i++)if(ids[now[i].id]!==now[i].track)throw Error('SFX allocation shifted existing audio.');
    for(i=0;i<count;i++)try{s.audioTracks[before+i].name='RIXU SFX '+(i+1);}catch(e){}
    return {start:before,count:count};
  }
  function place(s,data,isAudio){
    var track=isAudio?s.audioTracks[data.track]:s.videoTracks[data.track];
    if(!track)throw Error('Destination '+(isAudio?'audio':'video')+' track '+(data.track+1)+' does not exist. Add it in Premiere first.');
    if(track.isLocked&&track.isLocked())throw Error('Destination track is locked.');
    var item=importItem(data.path),oldIn=item.getInPoint?item.getInPoint(4):null,oldOut=item.getOutPoint?item.getOutPoint(4):null;
    var sourceIn=Number(data.sourceIn||0),i,c=null,mt=isAudio?2:1;
    try {
      item.setInPoint(sourceIn,mt);item.setOutPoint(sourceIn+data.duration,mt);
      track.overwriteClip(item,Number(data.start));
      for(i=0;i<track.clips.numItems;i++){var x=track.clips[i];if(Math.abs(seconds(x.start)-data.start)<.03&&x.projectItem&&String(x.projectItem.nodeId)===String(item.nodeId))c=x;}
      if(!c)throw Error('Placed clip was not found at its intended time.');
      c.end=time(data.start+data.duration);
      if(Math.abs(seconds(c.start)-data.start)>1/(TICKS/Number(s.timebase))+.001||Math.abs(seconds(c.end)-(data.start+data.duration))>1/(TICKS/Number(s.timebase))+.001)throw Error('Premiere placement timing differs from the plan. Inspect the sequence copy.');
      c.name=data.name||('RIXU '+(isAudio?'SFX':'Caption'));
      if(isAudio&&typeof data.gainDb==='number')volume(c,data.gainDb);
      return {name:c.name,start:seconds(c.start),end:seconds(c.end),track:data.track,path:data.path};
    } finally {try{if(oldIn)item.setInPoint(oldIn.seconds,4);else item.clearInPoint();if(oldOut)item.setOutPoint(oldOut.seconds,4);else item.clearOutPoint();}catch(restoreError){}}
  }
  function apply(data){
    var s=requireSequence();if(String(s.sequenceID)!==String(data.sequenceId))throw Error('Active sequence changed. Rebuild the plan.');
    var runName='RIXU RUN:'+data.runId,m=s.markers.getFirstMarker();while(m){if(m.name===runName)throw Error('This run is already applied.');m=s.markers.getNextMarker(m);}
    if(data.appendAudioTracks&&(!data.duplicate||typeof data.appendAudioTracks!=='number'||Math.floor(data.appendAudioTracks)!==data.appendAudioTracks||data.appendAudioTracks<1||data.appendAudioTracks>4))throw Error('SFX lane allocation requires a sequence copy.');
    var i,j,actions=data.actions||[],action,clips,c,results=[],old,dt;
    // Preflight destinations before duplicating or modifying anything. Never overwrite existing media.
    var reservations=[];
    function reserve(row,audio){
      var tracks=audio?s.audioTracks:s.videoTracks,tr=tracks[row.track],k,x,start=Number(row.start),end=start+Number(row.duration);
      var appended=audio&&data.appendAudioTracks&&row.track>=s.audioTracks.numTracks&&row.track<s.audioTracks.numTracks+data.appendAudioTracks;
      if(!tr&&!appended)throw Error('Add destination '+(audio?'A':'V')+(Number(row.track)+1)+' in Premiere first.');
      if(tr&&tr.isLocked&&tr.isLocked())throw Error('Destination track is locked.');
      if(tr&&tr.clips.numItems)throw Error('Choose an entirely empty destination '+(audio?'audio':'video')+' track. This protects neighbouring media from host import-duration quirks.');
      if(!new File(row.path).exists)throw Error('Missing media: '+row.path);
      for(k=0;tr&&k<tr.clips.numItems;k++){x=tr.clips[k];if(start<seconds(x.end)-.0001&&end>seconds(x.start)+.0001)throw Error('Destination '+(audio?'A':'V')+(row.track+1)+' contains media in the planned range. Choose an empty track.');}
      for(k=0;k<reservations.length;k++){x=reservations[k];if(x.audio===audio&&x.track===row.track&&start<x.end-.0001&&end>x.start+.0001)throw Error('Planned clips overlap on '+(audio?'A':'V')+(row.track+1)+'. Shorten sounds or choose a lower density.');}
      reservations.push({audio:audio,track:row.track,start:start,end:end});
    }
    for(i=0;i<(data.graphics||[]).length;i++){c=data.graphics[i];reserve({path:c.path,start:c.start,duration:c.end-c.start,track:data.captionTrack},false);}
    var texts=data.textLayers||[],textRanges={normal:[],highlight:[]};
    if(texts.length&&!data.duplicate)throw Error('Editable caption replacement requires a sequence copy.');
    for(i=0;i<texts.length;i++){
      c=texts[i];if(!/\.mogrt$/i.test(c.path)||!new File(c.path).exists||!textRanges[c.role]||!(c.end>c.start)||c.start<0)throw Error('Invalid native text layer.');
      for(j=0;j<textRanges[c.role].length;j++){var prior=textRanges[c.role][j];if(c.start<prior.end-.0001&&c.end>prior.start+.0001)throw Error('Native text clips overlap on their destination layer.');}
      textRanges[c.role].push(c);
    }
    for(i=0;i<(data.sounds||[]).length;i++)reserve(data.sounds[i],true);
    for(i=0;i<actions.length;i++)if(actions[i].type==='place_media')reserve(actions[i],actions[i].mediaType==='audio');
    if(data.duplicate&&!(actions.length===1&&actions[0].type==='clone_sequence'))s=cloneSequence(s);
    if(data.batchMode){m=s.markers.createMarker(0);m.name='RIXU RUN PENDING:'+data.runId;m.comments='Preparing editable captions.';}
    if(data.appendAudioTracks)appendSfxTracks(s,data.appendAudioTracks);
    if(data.replaceGeneratedSounds){var oldSounds=allClips(s);for(i=oldSounds.length-1;i>=0;i--)if(/^RIXU SFX /.test(oldSounds[i].name))oldSounds[i].remove(false,true);}
    var textTracks=null,removedCaptions=0;
    if(texts.length){
      s.name=s.name.replace(/(?: - SUPERMODE)+$/,'')+' - SUPERMODE '+String(data.runId).substr(0,6);
      textTracks=appendTextTracks(s);
      if(data.replaceGeneratedCaptions)for(i=0;i<s.videoTracks.numTracks;i++)for(j=s.videoTracks[i].clips.numItems-1;j>=0;j--){c=s.videoTracks[i].clips[j];if(generatedCaption(c,data.generatedRoot)){c.remove(false,true);removedCaptions++;}}
      if(!data.batchMode)for(i=0;i<texts.length;i++)results.push(placeNativeText(s,texts[i],textTracks[texts[i].role]));
    }
    if(data.batchMode){
      var context={sequenceId:String(s.sequenceID),sequenceName:s.name,runId:data.runId,textTracks:textTracks,originalPreserved:!!data.duplicate,replacedGeneratedCaptions:removedCaptions};
      m.comments=JSON.stringify(context);return context;
    }
    for(i=0;i<actions.length;i++){
      action=actions[i];
      if(action.type==='clone_sequence'){s=cloneSequence(s);results.push({type:action.type,sequenceId:String(s.sequenceID)});continue;}
      if(action.type==='add_marker'){m=s.markers.createMarker(action.time);m.name=action.name;results.push({type:action.type,time:action.time});continue;}
      if(action.type==='place_media'){results.push(place(s,action,action.mediaType==='audio'));continue;}
      clips=selected(s);
      // Validate the whole selection before the first mutation.
      for(j=0;j<clips.length;j++){c=clips[j];if(action.type==='trim_selected'&&Number(action.seconds)>=seconds(c.duration))throw Error('Trim would remove an entire selected clip.');if(action.type==='move_selected'&&seconds(c.start)+action.seconds<0)throw Error('Move would put a clip before sequence start.');}
      for(j=clips.length-1;j>=0;j--){c=clips[j];
        if(action.type==='trim_selected'){
          dt=Number(action.seconds);old={start:seconds(c.start),end:seconds(c.end),inPoint:seconds(c.inPoint),outPoint:seconds(c.outPoint)};if(action.edge==='start'){c.inPoint=time(old.inPoint+dt);c.start=time(old.start+dt);}else{c.outPoint=time(old.outPoint-dt);c.end=time(old.end-dt);}
        } else if(action.type==='move_selected'){c.move(time(action.seconds));}
        else if(action.type==='disable_selected')c.disabled=action.disabled;
        else if(action.type==='rename_selected')c.name=action.name;
        else if(action.type==='remove_selected')c.remove(action.ripple?1:0,1);
        else if(action.type==='set_scale_selected'&&String(c.mediaType).toLowerCase()==='video')scale(c,action.percent);
        else if(action.type==='set_volume_selected'&&String(c.mediaType).toLowerCase()==='audio')volume(c,action.db);
        else if(action.type!=='set_scale_selected'&&action.type!=='set_volume_selected')throw Error('Unsupported host action: '+action.type);
      }
      results.push({type:action.type,clips:clips.length});
    }
    var graphics=data.graphics||[],sounds=data.sounds||[];
    if(graphics.length&&!s.videoTracks[data.captionTrack])throw Error('Add a video track for captions first (requested V'+(data.captionTrack+1)+').');
    for(i=0;i<graphics.length;i++){c=graphics[i];results.push(place(s,{path:c.path,start:c.start,duration:c.end-c.start,track:data.captionTrack,name:'RIXU Caption '+c.id,style:c.style,animationSeconds:data.animationSeconds},false));}
    for(i=0;i<sounds.length;i++){c=sounds[i];results.push(place(s,{path:c.path,start:c.start,sourceIn:c.sourceIn,duration:c.duration,track:c.track,gainDb:c.gainDb,name:'RIXU SFX '+c.reason},true));}
    m=s.markers.createMarker(0);m.name=runName;m.comments='Applied by RIXU Assistant; retain to prevent accidental duplicate application.';
    var captionIds={};for(i=0;i<texts.length;i++)captionIds[texts[i].id]=true;var nativeCount=0;for(var captionId in captionIds)if(captionIds.hasOwnProperty(captionId))nativeCount++;
    return {sequenceId:String(s.sequenceID),sequenceName:s.name,operations:results,captionCount:texts.length?nativeCount:graphics.length,textTracks:textTracks,replacedGeneratedCaptions:removedCaptions,sfxCount:sounds.length,originalPreserved:!!data.duplicate,
      recovery:data.duplicate?'Return to the original sequence; generated copy contains this run.':'Use Premiere Undo as appropriate; inspect partial changes before retrying.'};
  }
  function applicationSequence(d){
    var s=null,i,m;for(i=0;i<app.project.sequences.numSequences;i++)if(String(app.project.sequences[i].sequenceID)===String(d.sequenceId))s=app.project.sequences[i];
    if(!s)throw Error('The generated sequence copy is missing. Resume from the original sequence.');
    m=s.markers.getFirstMarker();while(m){if(m.name==='RIXU RUN PENDING:'+d.runId){app.project.openSequence(s.sequenceID);return {sequence:s,marker:m,context:JSON.parse(m.comments)};}m=s.markers.getNextMarker(m);}
    throw Error('This sequence is not the pending copy owned by this run.');
  }
  function batchApplication(d){
    var owned=applicationSequence(d),s=owned.sequence,ctx=owned.context,rows=d.textLayers||[],sounds=d.sounds||[],i,j,c,row,name,existing,results=[];
    if(rows.length+sounds.length>4)throw Error('Application batches are limited to four clips.');
    for(i=0;i<rows.length;i++){
      row=rows[i];if(!/\.mogrt$/i.test(row.path)||!new File(row.path).exists||!ctx.textTracks||ctx.textTracks[row.role]===undefined||!(row.end>row.start))throw Error('Invalid batch text layer.');
      name='RIXU Caption '+row.id+(row.role==='highlight'?' [Highlight]':' [Normal]');existing=null;
      for(j=0;j<s.videoTracks[ctx.textTracks[row.role]].clips.numItems;j++){c=s.videoTracks[ctx.textTracks[row.role]].clips[j];if(c.name===name)existing=c;}
      if(existing){if(Math.abs(seconds(existing.start)-row.start)>.001||Math.abs(seconds(existing.end)-row.end)>.001)throw Error('A recovered caption was edited. Inspect the copy before resuming.');}
      else results.push(placeNativeText(s,row,ctx.textTracks[row.role]));
    }
    for(i=0;i<sounds.length;i++){
      row=sounds[i];name='RIXU SFX ['+d.runId+':'+row.applicationIndex+'] '+row.reason;existing=null;
      if(!s.audioTracks[row.track]||!new File(row.path).exists||!(row.duration>0))throw Error('Invalid batch sound.');
      for(j=0;j<s.audioTracks[row.track].clips.numItems;j++){c=s.audioTracks[row.track].clips[j];if(c.name===name)existing=c;}
      if(existing){var audioTolerance=1/(TICKS/Number(s.timebase))+.001;if(Math.abs(seconds(existing.start)-row.start)>audioTolerance||Math.abs(seconds(existing.end)-(row.start+row.duration))>audioTolerance)throw Error('A recovered sound was edited. Inspect the copy before resuming.');}
      else results.push(place(s,{path:row.path,start:row.start,sourceIn:row.sourceIn,duration:row.duration,track:row.track,gainDb:row.gainDb,name:name},true));
    }
    return {sequenceId:ctx.sequenceId,placed:results.length};
  }
  function dispatch(raw){try{var job=JSON.parse(raw),d=job.data||{},s,m;
    if(job.command==='save_completed_application'){
      s=requireSequence();if(String(s.sequenceID)!==String(d.sequenceId)||String(app.project.path).replace(/\\/g,'/').toLowerCase()!==String(d.projectPath).replace(/\\/g,'/').toLowerCase())throw Error('The completed project or sequence changed before saving.');
      m=s.markers.getFirstMarker();var savedOwner=false;while(m){if(m.name==='RIXU RUN:'+d.runId)savedOwner=true;m=s.markers.getNextMarker(m);}if(!savedOwner)throw Error('Only the completed owned run can be saved through this operation.');app.project.save();return JSON.stringify({projectPath:app.project.path,sequenceId:String(s.sequenceID),saved:true});
    }
    if(job.command==='set_sfx_levels'){
      s=requireSequence();if(String(s.sequenceID)!==String(d.sequenceId))throw Error('The active sound-review copy changed.');m=s.markers.getFirstMarker();var ownsMix=false;while(m){if(m.name==='RIXU RUN:'+d.runId)ownsMix=true;m=s.markers.getNextMarker(m);}if(!ownsMix)throw Error('Sound-level changes require the completed owned copy.');
      var changes=[],li,lj,lc,lr,ln,lf;
      for(li=0;li<d.sounds.length;li++){lr=d.sounds[li];ln='RIXU SFX ['+d.runId+':'+li+'] '+lr.reason;lf=null;if(!s.audioTracks[lr.track]||typeof lr.gainDb!=='number'||lr.gainDb< -60||lr.gainDb>15)throw Error('Invalid reviewed sound level.');for(lj=0;lj<s.audioTracks[lr.track].clips.numItems;lj++){lc=s.audioTracks[lr.track].clips[lj];if(lc.name===ln)lf=lc;}if(!lf||Math.abs(seconds(lf.start)-lr.start)>.001)throw Error('A sound changed before level review.');changes.push({clip:lf,db:lr.gainDb});}
      for(li=0;li<changes.length;li++)volume(changes[li].clip,changes[li].db);return JSON.stringify({updated:changes.length,sequenceId:String(s.sequenceID)});
    }
    if(job.command==='open_completed_application'){
      if(String(app.project.path).replace(/\\/g,'/').toLowerCase()!==String(d.projectPath).replace(/\\/g,'/').toLowerCase())throw Error('Open the project that owns this sound revision.');
      var completedSource=null,cs,cm;for(var ci=0;ci<app.project.sequences.numSequences;ci++){cs=app.project.sequences[ci];if(String(cs.sequenceID)!==String(d.sequenceId))continue;cm=cs.markers.getFirstMarker();while(cm){if(cm.name==='RIXU RUN:'+d.runId)completedSource=cs;cm=cs.markers.getNextMarker(cm);}}
      if(!completedSource)throw Error('The completed source run was not found.');app.project.openSequence(completedSource.sequenceID);return JSON.stringify(snapshot());
    }
    if(job.command==='prepare_sfx_revision'){
      s=requireSequence();if(String(s.sequenceID)!==String(d.sequenceId))throw Error('The sound revision source changed.');
      var sourceMarker=null,sm=s.markers.getFirstMarker(),ti,tj,tc;
      while(sm){if(sm.name==='RIXU RUN:'+d.sourceRunId)sourceMarker=sm;sm=s.markers.getNextMarker(sm);}
      if(!sourceMarker)throw Error('Sound-only revision requires a completed RIXU source copy.');
      var sourceContext=JSON.parse(sourceMarker.comments);if(!sourceContext.textTracks)throw Error('Source caption tracks are unavailable.');
      var lanes={},sr=d.sounds||[];for(ti=0;ti<sr.length;ti++){if(!new File(sr[ti].path).exists||!(sr[ti].duration>0))throw Error('Missing or invalid sound revision asset.');lanes[sr[ti].track]=true;}
      for(ti=0;ti<sr.length;ti++)for(tj=0;tj<ti;tj++)if(sr[ti].track===sr[tj].track&&sr[ti].start<sr[tj].start+sr[tj].duration-.0001&&sr[ti].start+sr[ti].duration>sr[tj].start+.0001)throw Error('Planned revision sounds overlap on one lane.');
      for(var lane in lanes)if(lanes.hasOwnProperty(lane)){var st=s.audioTracks[Number(lane)];if(!st||(st.isLocked&&st.isLocked()))throw Error('A sound revision destination is missing or locked.');for(ti=0;ti<st.clips.numItems;ti++)if(!/^RIXU SFX /.test(st.clips[ti].name))throw Error('A sound lane contains user media. The sound revision stopped before cloning.');}
      s=cloneSequence(s);s.name=s.name.replace(/ - SUPERMODE.*$/,'')+' - SUPERMODE '+String(d.runId).substr(0,6)+' SFX';var removedSounds=0;
      for(ti=0;ti<s.audioTracks.numTracks;ti++)for(tj=s.audioTracks[ti].clips.numItems-1;tj>=0;tj--){tc=s.audioTracks[ti].clips[tj];if(/^RIXU SFX /.test(tc.name)){tc.remove(false,true);removedSounds++;}}
      sm=s.markers.getFirstMarker();while(sm){if(/^RIXU RUN(?::| PENDING:)/.test(sm.name))sm.name='RIXU SOURCE '+sm.name;sm=s.markers.getNextMarker(sm);}
      var soundContext={sequenceId:String(s.sequenceID),sequenceName:s.name,runId:d.runId,textTracks:sourceContext.textTracks,originalPreserved:true,replacedGeneratedCaptions:0,replacedGeneratedSounds:removedSounds,captionsReused:true};
      sm=s.markers.createMarker(0);sm.name='RIXU RUN PENDING:'+d.runId;sm.comments=JSON.stringify(soundContext);return JSON.stringify(soundContext);
    }
    if(job.command==='open_analysis_source'){
      if(String(app.project.path).replace(/\\/g,'/').toLowerCase()!==String(d.projectPath).replace(/\\/g,'/').toLowerCase())throw Error('Open the project that owns the saved analysis before applying this revision.');
      var source=null;for(var si=0;si<app.project.sequences.numSequences;si++)if(String(app.project.sequences[si].sequenceID)===String(d.sequenceId))source=app.project.sequences[si];
      if(!source)throw Error('The original analysed sequence is missing from this project.');app.project.openSequence(source.sequenceID);return JSON.stringify(snapshot());
    }
    if(job.command==='inspect_application'){
      var matches=[],ai,am,as;
      for(ai=0;ai<app.project.sequences.numSequences;ai++){as=app.project.sequences[ai];am=as.markers.getFirstMarker();while(am){
        if(am.name==='RIXU RUN PENDING:'+d.runId||am.name==='RIXU RUN:'+d.runId){var ac=null;try{ac=JSON.parse(am.comments);}catch(e){}matches.push({sequenceId:String(as.sequenceID),sequenceName:as.name,complete:am.name==='RIXU RUN:'+d.runId,context:ac});}am=as.markers.getNextMarker(am);
      }}return JSON.stringify({matches:matches});
    }
    if(job.command==='apply_batch')return JSON.stringify(batchApplication(d));
    if(job.command==='open_application'){applicationSequence(d);return JSON.stringify(snapshot());}
    if(job.command==='apply_complete'){
      var owned=applicationSequence(d),ids={},ci,cc=0,expected,expectedName,ct,cj,ok;
      for(ci=0;ci<(d.textLayers||[]).length;ci++){
        expected=d.textLayers[ci];expectedName='RIXU Caption '+expected.id+(expected.role==='highlight'?' [Highlight]':' [Normal]');ct=owned.sequence.videoTracks[owned.context.textTracks[expected.role]];ok=false;
        for(cj=0;cj<ct.clips.numItems;cj++)if(ct.clips[cj].name===expectedName&&Math.abs(seconds(ct.clips[cj].start)-expected.start)<.001&&Math.abs(seconds(ct.clips[cj].end)-expected.end)<.001)ok=true;
        if(!ok)throw Error('A planned caption is missing or changed. Resume the saved batch before completing.');ids[expected.id]=true;
      }
      var soundTotal=0;for(ci=0;ci<owned.sequence.audioTracks.numTracks;ci++)for(cj=0;cj<owned.sequence.audioTracks[ci].clips.numItems;cj++)if(owned.sequence.audioTracks[ci].clips[cj].name.indexOf('RIXU SFX ['+d.runId+':')===0)soundTotal++;
      if(soundTotal!==Number(d.sfxCount))throw Error('The SFX count differs from the saved plan. Inspect the copy.');
      for(var key in ids)if(ids.hasOwnProperty(key))cc++;
      var completed={sequenceId:owned.context.sequenceId,sequenceName:owned.sequence.name,captionCount:cc,sfxCount:Number(d.sfxCount),textTracks:owned.context.textTracks,originalPreserved:true,replacedGeneratedCaptions:owned.context.replacedGeneratedCaptions,captionsReused:!!owned.context.captionsReused};
      owned.marker.name='RIXU RUN:'+d.runId;owned.marker.comments=JSON.stringify(completed);return JSON.stringify(completed);
    }
    if(job.command.indexOf('test_')===0){
      var projectFile=String(app.project.path).replace(/\\/g,'/');
      if(!/\/output\/demo\/RIXU SUPERMODE TEST\.prproj$/i.test(projectFile))throw Error('Live smoke commands require the isolated RIXU test project.');
      if(job.command==='test_fixture'){
        if(app.project.sequences.numSequences)throw Error('Test fixture needs an empty test project.');
        var item=importItem(d.path);app.project.createNewSequenceFromClips('RIXU Live Smoke',[item],app.project.rootItem);s=requireSequence();
        m=s.markers.createMarker(2);m.name='SUPERMODE:SPLIT';m=s.markers.createMarker(4);m.name='SUPERMODE:FULL';
        app.project.save();return JSON.stringify(snapshot());
      }
      if(job.command==='test_native_fixture'){
        for(var q=0;q<app.project.sequences.numSequences;q++)if(app.project.sequences[q].name==='RIXU Native English'){app.project.openSequence(app.project.sequences[q].sequenceID);return JSON.stringify(snapshot());}
        var englishItem=importItem(d.path);app.project.createNewSequenceFromClips('RIXU Native English',[englishItem],app.project.rootItem);s=requireSequence();
        m=s.markers.createMarker(2);m.name='SUPERMODE:SPLIT';m=s.markers.createMarker(4);m.name='SUPERMODE:FULL';app.project.save();return JSON.stringify(snapshot());
      }
      if(job.command==='test_seek'){s=requireSequence();s.setPlayerPosition(String(Math.round(d.seconds*TICKS)));return JSON.stringify({playhead:seconds(s.getPlayerPosition())});}
      if(job.command==='test_open'){app.project.openSequence(d.sequenceId);return JSON.stringify(snapshot());}
      if(job.command==='test_select'){s=requireSequence();var all=allClips(s),z;for(z=0;z<all.length;z++)all[z].setSelected(0,1);var tr=d.mediaType==='audio'?s.audioTracks[d.track]:s.videoTracks[d.track];tr.clips[d.index].setSelected(1,1);return JSON.stringify(snapshot());}
      if(job.command==='test_inspect'){
        s=requireSequence();var result=snapshot(),details=[],all=allClips(s),i,j,k,comp,p,props,components,val,keys;
        for(i=0;i<all.length;i++){components=[];for(j=0;j<all[i].components.numItems;j++){comp=all[i].components[j];props=[];for(k=0;k<comp.properties.numItems;k++){p=comp.properties[k];try{val=p.getValue();}catch(e){val=null;}try{keys=p.getKeys();}catch(e){keys=null;}props.push({name:p.displayName,value:val,keys:keys});}components.push({name:comp.displayName,matchName:comp.matchName,properties:props});}details.push({id:String(all[i].nodeId),name:all[i].name,mediaType:all[i].mediaType,components:components});}
        var animations=[],points,z;
        for(i=0;i<all.length;i++){p=property(all[i],'Scale','AE.ADBE Motion')||property(all[i],'Scale');if(p){try{keys=p.getKeys();points=[];for(z=0;keys&&z<keys.length;z++)points.push({seconds:seconds(keys[z]),value:p.getValueAtKey(keys[z])});if(points.length)animations.push({id:String(all[i].nodeId),name:all[i].name,keyframes:points});}catch(e){}}}
        result.animations=animations;result.details=details;app.project.save();return JSON.stringify(result);
      }
      throw Error('Unknown smoke command.');
    }
    if(job.command==='snapshot')return JSON.stringify(snapshot());
    if(job.command==='remove_caption_animation'){
      s=requireSequence();if(String(s.sequenceID)!==String(d.sequenceId))throw Error('Active sequence changed.');
      var changed=0,items=allClips(s),ca,op;
      for(var ai=0;ai<items.length;ai++){ca=items[ai];if(!generatedCaption(ca,d.generatedRoot))continue;op=property(ca,'Opacity','AE.ADBE Opacity');if(op){op.setTimeVarying(false);op.setValue(100,true);changed++;}}
      return JSON.stringify({sequenceId:String(s.sequenceID),sequenceName:s.name,captionClips:changed,animation:'none'});
    }
    if(job.command==='cleanup_native_validation'){
      var active=requireSequence(),owned=[],removed=[],ci,candidate;
      for(ci=0;ci<app.project.sequences.numSequences;ci++){
        candidate=app.project.sequences[ci];
        if(candidate.name!=='RIXU Native Text Validation'||String(candidate.sequenceID)===String(active.sequenceID))continue;
        for(var oi=0;oi<d.ids.length;oi++)if(String(candidate.sequenceID)===String(d.ids[oi])){owned.push(candidate);break;}
      }
      for(ci=0;ci<owned.length;ci++){var ownedId=String(owned[ci].sequenceID);if(app.project.deleteSequence(owned[ci]))removed.push(ownedId);}
      return JSON.stringify({removed:removed,activeSequenceId:String(active.sequenceID)});
    }
    if(job.command==='render_text_probe'){
      var restore=requireSequence(),target=null,si;
      for(si=0;si<app.project.sequences.numSequences;si++)if(String(app.project.sequences[si].sequenceID)===String(d.sequenceId)&&app.project.sequences[si].name==='RIXU Native Text Validation')target=app.project.sequences[si];
      if(!target)throw Error('Owned native text validation sequence not found in this project.');
      try{
        app.project.openSequence(target.sequenceID);target.setPlayerPosition(String(Math.round(75*TICKS)));target.setInPoint(75);target.setOutPoint(75.5);
        var renderPath=(new File(d.folder+'/native-text-deferred.mp4')).fsName;
        var rr=target.exportAsMediaDirect(renderPath,(new File(d.preset)).fsName,1);
        return JSON.stringify({renderResult:String(rr),preview:renderPath,inPoint:target.getInPointAsTime().seconds,outPoint:target.getOutPointAsTime().seconds,snapshot:snapshot()});
      }finally{app.project.openSequence(restore.sequenceID);}
    }
    if(job.command==='probe_native_text'){
      var original=requireSequence(),probe=null,out={originalSequenceId:String(original.sequenceID)};
      try{
        if(d.fixture){var fixtureItem=importItem(d.fixture);app.project.createNewSequenceFromClips('RIXU Native Text Validation',[fixtureItem],app.project.rootItem);probe=requireSequence();}
        else{probe=cloneSequence(original);probe.name='RIXU Native Text Validation';}
        if(d.audioTracks)out.audioTracks=appendSfxTracks(probe,Number(d.audioTracks));
        if(d.layers&&d.layers.length){
          var nativeTracks=appendTextTracks(probe),placed=[];
          for(var ni=0;ni<d.layers.length;ni++)placed.push(placeNativeText(probe,d.layers[ni],nativeTracks[d.layers[ni].role]));
          out.probeSequenceId=String(probe.sequenceID);out.textTracks=nativeTracks;out.placements=placed;
          out.sounds=[];for(var pi=0;pi<(d.sounds||[]).length;pi++)out.sounds.push(place(probe,d.sounds[pi],true));
          if(d.folder&&d.preset){
            var folder=new Folder(d.folder),draft=(new File(folder.fsName+'/native-text-preview.mp4')).fsName;
            probe.setInPoint(Number(d.layers[0].start));probe.setOutPoint(Number(d.layers[0].start)+Math.min(6,Number(d.duration||.5)));
            out.renderResult=String(probe.exportAsMediaDirect(draft,(new File(d.preset)).fsName,1));out.preview=draft;
            probe.exportAsFinalCutProXML((new File(folder.fsName+'/native-text-export.xml')).fsName,1);
          }
          return JSON.stringify(out);
        }
        if(d.addTracks){
          var originalRows=snapshot().video,trackCount=probe.videoTracks.numTracks;app.enableQE();var qeSeq=qe.project.getActiveSequence();
          qeSeq.addTracks(2,trackCount,0);
          out.trackAdd={before:trackCount,after:probe.videoTracks.numTracks,unchanged:true};
          var addedRows=snapshot().video,oldMap={},ti;
          for(ti=0;ti<originalRows.length;ti++)oldMap[originalRows[ti].id]=originalRows[ti].track;
          for(ti=0;ti<addedRows.length;ti++)if(oldMap[addedRows[ti].id]!==addedRows[ti].track)out.trackAdd.unchanged=false;
          if(probe.videoTracks.numTracks!==trackCount+2||!out.trackAdd.unchanged)throw Error('Track allocation did not append cleanly.');
        }
        var beforeTracks=probe.videoTracks.numTracks,at=Math.max(0,Number(d.seconds||0));
        var title=probe.importMGT((new File(d.path)).fsName,String(Math.round(at*TICKS)),beforeTracks,0);
        if(!title)throw Error('Premiere did not import the installed native title template.');
        var components=[],ci,cp,pj,pv;
        for(ci=0;ci<title.components.numItems;ci++){
          cp=title.components[ci];var pr=[];
          for(pj=0;pj<cp.properties.numItems;pj++){try{pv=cp.properties[pj].getValue();}catch(e){pv=null;}pr.push({name:cp.properties[pj].displayName,value:pv});}
          components.push({name:cp.displayName,matchName:cp.matchName,properties:pr});
        }
        out.probeSequenceId=String(probe.sequenceID);out.beforeTracks=beforeTracks;out.afterTracks=probe.videoTracks.numTracks;out.components=components;out.clipName=title.name;
        try{var mg=title.getMGTComponent();out.mgtAvailable=!!mg;}catch(e){out.mgtAvailable=false;}
      }finally{app.project.openSequence(original.sequenceID);}
      return JSON.stringify(out);
    }
    if(job.command==='import_transcription_proxy'){var proxyItem=importItem(d.path);return JSON.stringify({imported:!!proxyItem,path:d.path});}
    if(job.command==='export_analysis'){
      s=requireSequence();if(String(s.sequenceID)!==String(d.sequenceId))throw Error('Active sequence changed before analysis export.');
      var analysisDir=new Folder(d.folder);if(!analysisDir.exists)throw Error('Analysis folder is missing.');
      var xmlPath=(new File(analysisDir.fsName+'/sequence.xml')).fsName,proxyPath=(new File(analysisDir.fsName+'/preview.mp4')).fsName;
      if(!(new File(d.preset)).exists)throw Error('Analysis render preset is missing.');
      var oldIn=s.getInPointAsTime(),oldOut=s.getOutPointAsTime(),oldPosition=s.getPlayerPosition(),exportResult,hidden=[];
      try{
        if(d.hideGeneratedCaptions){var existing=allClips(s),hi;for(hi=0;hi<existing.length;hi++)if(generatedCaption(existing[hi],d.generatedRoot)){hidden.push({clip:existing[hi],disabled:existing[hi].disabled});existing[hi].disabled=true;}}
        if(!s.exportAsFinalCutProXML(xmlPath,1))throw Error('Premiere could not export the current sequence XML.');
        s.setInPoint(0);s.setOutPoint(Number(d.duration));exportResult=s.exportAsMediaDirect(proxyPath,(new File(d.preset)).fsName,1);
      }
      finally{for(var hr=0;hr<hidden.length;hr++)hidden[hr].clip.disabled=hidden[hr].disabled;s.setInPoint(oldIn.seconds);s.setOutPoint(oldOut.seconds);s.setPlayerPosition(oldPosition.ticks);}
      return JSON.stringify({xmlPath:xmlPath,proxyPath:proxyPath,result:String(exportResult),exists:(new File(proxyPath)).exists,snapshot:snapshot()});
    }
    if(job.command==='inspect_sequence'){
      s=requireSequence();var scan=snapshot(),vDetails=[],vi,vj,vk,vc,vp,vProps,vComponents,vVal,vKeys,vPoints,vz;
      for(vi=0;vi<s.videoTracks.numTracks;vi++)for(vj=0;vj<s.videoTracks[vi].clips.numItems;vj++){
        vc=s.videoTracks[vi].clips[vj];vComponents=[];
        for(vk=0;vk<vc.components.numItems;vk++){
          var component=vc.components[vk];vProps=[];
          for(var pi=0;pi<component.properties.numItems;pi++){
            vp=component.properties[pi];try{vVal=vp.getValue();}catch(e){vVal=null;}
            vPoints=[];try{vKeys=vp.getKeys();for(vz=0;vKeys&&vz<vKeys.length&&vz<300;vz++)vPoints.push({time:seconds(vKeys[vz]),value:vp.getValueAtKey(vKeys[vz])});}catch(e){}
            vProps.push({name:vp.displayName,value:vVal,keys:vPoints});
          }
          vComponents.push({name:component.displayName,matchName:component.matchName,properties:vProps});
        }
        vDetails.push({id:String(vc.nodeId),track:vi,index:vj,name:vc.name,components:vComponents});
      }
      scan.details=vDetails;scan.sequenceGuid=String(s.guid||'');
      return JSON.stringify(scan);
    }
    if(job.command==='layout_marker'){s=requireSequence();m=s.markers.createMarker(seconds(s.getPlayerPosition()));m.name=d.layout==='split'?'SUPERMODE:SPLIT:'+Math.round(d.divider*100)+'%':'SUPERMODE:FULL';return JSON.stringify({name:m.name,time:seconds(m.start)});}
    if(job.command==='apply')return JSON.stringify(apply(d));
    throw Error('Unknown bridge command: '+job.command);
  }catch(e){return JSON.stringify({error:String(e.message||e),line:e.line||null});}}
  return {dispatch:dispatch};
}());
