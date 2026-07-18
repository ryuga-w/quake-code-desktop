// Simple JS for nav toggle and year
document.addEventListener('DOMContentLoaded', function(){
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('navToggle');
  if(toggle){
    toggle.addEventListener('click', ()=>{
      if(nav.style.display === 'block'){
        nav.style.display = '';
      } else {
        nav.style.display = 'block';
      }
    });
  }

  // set year in footer
  const y = new Date().getFullYear();
  const yearEl = document.getElementById('year');
  if(yearEl) yearEl.textContent = y;

  // smooth scrolling for in-page links
  document.querySelectorAll('a[href^="#"]').forEach(a=>{
    a.addEventListener('click', function(e){
      const href = this.getAttribute('href');
      if(href.length>1){
        const target = document.querySelector(href);
        if(target){
          e.preventDefault();
          target.scrollIntoView({behavior:'smooth',block:'start'});
          // close nav on small screens
          if(window.innerWidth<=800 && nav) nav.style.display='';
        }
      }
    });
  });
});

