'use strict';
const semantic=require('./semantic-design');
const queries={whoosh:'a fast smooth air whoosh sound',pop:'a short soft rounded pop sound',click:'a single short dry click sound',impact:'a short soft low thump sound',riser:'a rising cinematic swell sound',glitch:'a short digital electronic glitch sound',notification:'a short clear notification chime sound',typing:'a mechanical keyboard typing sound'};
function emphasizeLikeReferences(plan,style,design,rules){return semantic.applyHighlights(plan,design,rules);}
function family(text){text=String(text).toLowerCase();return /charg|riser|rising|swell/.test(text)?'riser':/whoosh|swoosh|swish|sweep|transition/.test(text)?'whoosh':/glitch/.test(text)?'glitch':/keyboard|typing/.test(text)?'typing':/pop|bubble/.test(text)?'pop':/click|shutter|snap/.test(text)?'click':/chime|ding|notification|bell|beep|shine|shining|collect|money|coin/.test(text)?'notification':/impact|thump|hit|boom/.test(text)?'impact':'whoosh';}
function planCues(captions,design,analysis,style,existing=[],policy={}){return semantic.planStoryCues(captions,design,style,existing,policy);}
function laneFor(sounds,start,duration,base,count=3){for(let i=0;i<count;i++)if(!sounds.some(s=>s.track===base+i&&start<s.start+s.duration-.0001&&start+duration>s.start+.0001))return base+i;return null;}
function preferredScore(row,style){const name=row.relativePath.replaceAll('\\','/').split('/').at(-1).toLowerCase();return row.referenceMatch?15+Math.log2((row.referenceUses||1)+1): (row.z||0)+Math.min(1,(style.preferredSounds?.[name]||0)*.06);}
module.exports={queries,family,planCues,laneFor,preferredScore,emphasizeLikeReferences};
