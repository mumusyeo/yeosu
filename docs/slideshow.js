export function initSlideshow() {
  const region=document.querySelector('.hero-art');if(!region)return;
  const slides=[...region.querySelectorAll('.hero-slide')],dots=[...region.querySelectorAll('[data-slide-index]')],pause=region.querySelector('[data-slide-control="pause"]');
  const motion=matchMedia('(prefers-reduced-motion: reduce)');let index=0,paused=motion.matches,timer;
  const update=()=>{
    slides.forEach((slide,i)=>{slide.classList.toggle('is-active',i===index);slide.setAttribute('aria-hidden',String(i!==index));});
    dots.forEach((dot,i)=>dot.setAttribute('aria-pressed',String(i===index)));
    region.querySelector('.slide-counter').textContent=`${index+1} / ${slides.length}`;
    region.querySelector('.slide-caption').textContent=slides[index].dataset.city;
    pause.textContent=paused?'재생':'일시정지';pause.setAttribute('aria-label',paused?'슬라이드쇼 자동 재생':'슬라이드쇼 일시정지');
  };
  const move=step=>{index=(index+step+slides.length)%slides.length;update();};
  const reset=()=>{clearInterval(timer);if(!paused&&!document.hidden)timer=setInterval(()=>move(1),3000);};
  region.addEventListener('click',event=>{const control=event.target.closest('[data-slide-control],[data-slide-index]');if(!control)return;
    if(control.dataset.slideIndex!==undefined)index=Number(control.dataset.slideIndex);
    else if(control.dataset.slideControl==='pause')paused=!paused;
    else move(control.dataset.slideControl==='next'?1:-1);
    update();reset();
  });
  region.addEventListener('keydown',event=>{if(event.target!==region)return;if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();move(event.key==='ArrowRight'?1:-1);reset();}});
  document.addEventListener('visibilitychange',reset);
  motion.addEventListener('change',event=>{if(event.matches)paused=true;update();reset();});
  window.addEventListener('pagehide',()=>clearInterval(timer));window.addEventListener('pageshow',reset);
  update();reset();
}
