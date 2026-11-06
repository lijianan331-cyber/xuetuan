(function(){
  'use strict';
  document.getElementById('contact-back').addEventListener('click',function(e){
    try{if(document.referrer && new URL(document.referrer).origin===location.origin){e.preventDefault();history.back();}}catch(ignore){}
  });
  document.querySelectorAll('[data-copy]').forEach(function(button){button.addEventListener('click',function(){
    var value=button.dataset.copy,status=document.getElementById('contact-status');
    function fallback(){var input=document.createElement('textarea');input.value=value;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();var ok=false;try{ok=document.execCommand('copy');}catch(ignore){}input.remove();status.textContent=ok?'已复制 / Copied':'请长按上方号码或邮箱复制 / Please copy the contact above';button.focus();}
    try{if(navigator.clipboard && navigator.clipboard.writeText){navigator.clipboard.writeText(value).then(function(){status.textContent='已复制 / Copied';},fallback);}else fallback();}catch(ignore){fallback();}
  });});
})();
