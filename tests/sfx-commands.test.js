const test = require('node:test');
const assert = require('node:assert/strict');
const {parseSfxInstruction,namedMatches} = require('../src/sfx-commands');

test('Named SFX opening commands retain the requested name and explicit timing',()=>{
  assert.deepEqual(parseSfxInstruction('start with the vintage charge sound'),{query:'vintage charge',start:0});
  assert.deepEqual(parseSfxInstruction('Begin the video with a vintage charging sound.'),{query:'vintage charging',start:0});
  assert.deepEqual(parseSfxInstruction('add a whoosh sound at 2.5 seconds'),{query:'whoosh',start:2.5});
  assert.equal(parseSfxInstruction('start with a title card'),null);
  assert.equal(parseSfxInstruction('start with a pop sound and then trim the video'),null);
  assert.equal(parseSfxInstruction('add a pop sound'),null,'An unspecified placement must not be invented');
});

test('Name matching searches nested folders and does not confuse charge with every vintage sound',()=>{
  const charge={relative_path:'Analog/Vintage_Cameras/Flash_Charging.aac'};
  const click={relative_path:'Analog/Vintage_Click_03.wav'};
  const unrelated={relative_path:'Power/Charge_01.wav'};
  assert.deepEqual(namedMatches('vintage charge',[click,unrelated,charge]),[charge]);
  assert.equal(namedMatches('vintage',[click,charge]).length,2,'Ambiguous names retain alternatives for preview');
  assert.deepEqual(namedMatches('missing sound',[click,charge]),[]);
});
