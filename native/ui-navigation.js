/* PandaStudy page tabs. Only changes visibility; app, blog and QA state remain mounted. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const views=['home','app','blog','how','faq','about'];
 function currentHash(){
  try{return decodeURIComponent(location.hash.slice(1)).trim();}
  catch{return location.hash.slice(1);}
 }
 function screenFor(hash){
  if(hash==='blog'||hash==='blog-viet-bai'||hash.startsWith('blog/'))return 'blog';
  if(hash==='how'||hash==='faq'||hash==='about')return hash;
  if(!hash||hash==='home'||hash==='top')return 'home';
  const el=$(hash);
  if(hash==='qaRunStep'||hash==='app'||el?.closest('#app'))return 'app';
  return 'home';
 }
 function route(){
  const hash=currentHash(),screen=screenFor(hash);
  $('home')?.classList.toggle('hidden',screen!=='home');
  document.querySelector('.steps-strip')?.classList.toggle('hidden',screen!=='home');
  for(const id of views.filter(x=>x!=='home')){
   $(id)?.classList.toggle('hidden',id!==screen&&!(id==='app'&&screen==='home'));
  }
  document.body.dataset.pandaPage=screen;
  document.querySelectorAll('#mainNav a').forEach(link=>{
   const href=link.getAttribute('href');
   const chosen=screen==='home'?'#home':screen==='app'?'#app':'#'+screen;
   if(href===chosen)link.setAttribute('aria-current','page');
   else link.removeAttribute('aria-current');
  });
  // A hash target may have been hidden at the instant the browser navigated.
  // Reveal it first, then scroll. Blog article scrolling is owned by blog.js.
  if(screen==='blog')return;
  requestAnimationFrame(()=>{
   if(screen==='home'){if(hash==='home'||hash==='top')window.scrollTo({top:0,behavior:'instant'});return;}
   const target=$(hash)||$(screen);
   if(target&&!target.classList.contains('hidden'))
    target.scrollIntoView({block:'start',behavior:'instant'});
  });
 }
 function init(){
  addEventListener('hashchange',route);
  route();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();
