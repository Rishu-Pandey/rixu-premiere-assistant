'use strict';
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},num={type:'number'},bool={type:'boolean'};
const action=(type,props={})=>object({type:{type:'string',enum:[type]},...props});
const edit=object({
  actions:{type:'array',items:{anyOf:[action('clone_sequence'),action('trim_selected',{edge:{type:'string',enum:['start','end']},seconds:num}),action('move_selected',{seconds:num}),action('disable_selected',{disabled:bool}),action('rename_selected',{name:str}),action('remove_selected',{ripple:bool}),action('set_scale_selected',{percent:num}),action('set_volume_selected',{db:num}),action('add_marker',{time:num,name:str}),action('place_media',{path:str,mediaType:{type:'string',enum:['audio','video']},start:num,track:{type:'integer'},duration:num})]}},
  sound:object({requested:bool,query:str,start:num}),error:str
});
const design=object({keywords:{type:'array',items:str},sfx:{type:'array',items:object({time:num,query:str,anchor:{type:'string',enum:['onset','peak']},reason:str})},warnings:{type:'array',items:str}});
const storyDesign=object({highlights:{type:'array',items:object({id:str,words:{type:'array',items:{type:'integer'}},reason:str})},sfx:{type:'array',items:object({time:num,query:str,anchor:{type:'string',enum:['onset','peak']},reason:str,role:{type:'string',enum:['hook','build','payoff','support']},energy:{type:'string',enum:['low','medium','high']},group:str})},quiet:{type:'array',items:object({start:num,end:num,reason:str})},warnings:{type:'array',items:str}});
module.exports={edit,design,storyDesign};
