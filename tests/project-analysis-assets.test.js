const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
test('Low-quality preview samples preserve XML cut frames and produce aligned visual sheets',{timeout:20000},t=>{
 const base=path.resolve(os.tmpdir()),folder=fs.mkdtempSync(path.join(base,'rixu-analysis-assets-test-'));
 t.after(()=>{if(path.resolve(folder).startsWith(base+path.sep))fs.rmSync(folder,{recursive:true,force:true});});
 const snapshot={projectPath:'',width:1080,height:1920,fps:30,sequenceName:'TEST ONLY',video:[{start:0,end:4}]};
 fs.writeFileSync(path.join(folder,'snapshot.json'),JSON.stringify(snapshot));
 fs.writeFileSync(path.join(folder,'sequence.xml'),'<xmeml><sequence><media><video><track><clipitem><name>Test first half</name><start>0</start><end>60</end></clipitem><clipitem><name>Test second half</name><start>60</start><end>120</end></clipitem></track></video></media></sequence></xmeml>');
 const rendered=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=black:s=270x480:r=30:d=4','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','4','-c:v','libx264','-preset','ultrafast','-c:a','aac',path.join(folder,'preview.mp4')],{windowsHide:true,encoding:'utf8'});
 assert.equal(rendered.status,0,rendered.stderr);
 const r=spawnSync(process.env.RIXU_PYTHON||'python',[path.join(__dirname,'../scripts/project_analysis.py'),'sheets',folder],{windowsHide:true,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 const m=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
 assert.equal(m.render.duration,4);assert.equal(m.render.height,480);
 assert.deepEqual(m.intervals.map(i=>i.startFrame),[0,60]);
 assert.ok(m.probes.some(p=>p.frame===59)&&m.probes.some(p=>p.frame===60));
 assert.equal(fs.readdirSync(path.join(folder,'frames')).length,m.probes.length);
 assert.ok(fs.existsSync(path.join(folder,'dialogue.wav')));assert.ok(m.sheets.length>0);
});
