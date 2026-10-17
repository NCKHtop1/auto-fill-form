'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function files(directory){
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())return ['api','lib','scripts','tests'].includes(entry.name)||directory!==root?files(file):[];
  return entry.name.endsWith('.js')?[file]:[];
 });
}
const selected=files(root);
for(const file of selected){
 const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
console.log(`Syntax checked ${selected.length} JavaScript files.`);
