
const $=(s,ctx=document)=>ctx.querySelector(s);
const $$=(s,ctx=document)=>[...ctx.querySelectorAll(s)];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

const glow=$('#cursorGlow');
if(glow){
  addEventListener('pointermove',e=>{glow.style.left=e.clientX+'px';glow.style.top=e.clientY+'px';});
}
const prog=$('#topProgress');
addEventListener('scroll',()=>{
  const max=document.documentElement.scrollHeight-innerHeight;
  if(prog) prog.style.width=(max?scrollY/max*100:0)+'%';
},{passive:true});

const io=new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}
  })
},{threshold:.13});
$$('.reveal-on-scroll').forEach(el=>io.observe(el));

const storySteps=$$('.story-step');
if(storySteps.length){
  const sio=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        storySteps.forEach(x=>x.classList.remove('active'));
        e.target.classList.add('active');
        const label=e.target.dataset.label;
        const dyn=$('#storyDynamic');
        if(dyn && label) dyn.textContent=label;
      }
    })
  },{rootMargin:'-34% 0px -42% 0px',threshold:.05});
  storySteps.forEach(el=>sio.observe(el));
}

const words=$$('.highlight-text .word');
if(words.length){
  addEventListener('scroll',()=>{
    const el=$('.highlight-text'); if(!el)return;
    const r=el.getBoundingClientRect();
    const p=clamp((innerHeight-r.top)/(innerHeight+r.height*.55),0,1);
    const active=Math.floor(p*words.length);
    words.forEach((w,i)=>w.classList.toggle('hot',i<=active));
  },{passive:true});
}

$$('.parallax').forEach(el=>{
  addEventListener('scroll',()=>{
    const r=el.getBoundingClientRect();
    if(r.bottom>0&&r.top<innerHeight){
      const p=(innerHeight-r.top)/(innerHeight+r.height);
      el.style.transform=`translateY(${(p-.5)*-24}px)`;
    }
  },{passive:true});
});

$$('.hero-frame').forEach(frame=>{
  frame.addEventListener('pointermove',e=>{
    const r=frame.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width-.5;
    const y=(e.clientY-r.top)/r.height-.5;
    frame.style.transform=`perspective(1500px) rotateX(${y*-1.2}deg) rotateY(${x*1.6}deg)`;
  });
  frame.addEventListener('pointerleave',()=>frame.style.transform='');
});

$$('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',e=>{
    const t=$(a.getAttribute('href'));
    if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'})}
  })
});

// Active navigation based on current page
const page=location.pathname.split('/').pop()||'index.html';
$$('.nav nav a').forEach(a=>{
  const href=a.getAttribute('href')||'';
  if(href===page) a.classList.add('active');
});


// =========================
// RIFTGRID V3 interactions
// =========================
const scrollSystem=document.querySelector('.scroll-system');
if(scrollSystem){
  const phaseTitles=['Declare','Schedule','Run','Recover'];
  const phaseDesc=[
    'Define the world you want — game, version, resources, storage and capabilities.',
    'RIFTGRID evaluates healthy nodes and places the workload where it fits best.',
    'Storage mounts, ports reserve, the workload starts and the game adapter takes over.',
    'If reality changes, RIFTGRID reconciles actual state back toward the desired state.'
  ];
  const phaseState=['DESIRED','SCHEDULING','RUNNING','RECOVERING'];
  const phaseNode=['survival-01','fra-04 selected','Paper 1.21.8','reconcile → RUNNING'];

  const updateScrollSystem=()=>{
    const r=scrollSystem.getBoundingClientRect();
    const total=scrollSystem.offsetHeight-innerHeight;
    const travelled=clamp(-r.top,0,total);
    const p=total?travelled/total:0;
    const phase=Math.min(3,Math.floor(p*4));
    scrollSystem.dataset.phase=String(phase+1);
    const h=document.querySelector('#phaseTitle');
    const d=document.querySelector('#phaseDesc');
    const st=document.querySelector('#phaseState');
    const node=document.querySelector('#phaseNode');
    if(h)h.textContent=phaseTitles[phase];
    if(d)d.textContent=phaseDesc[phase];
    if(st)st.textContent=phaseState[phase];
    if(node)node.textContent=phaseNode[phase];
    document.querySelectorAll('.phase-indicator i').forEach((el,i)=>el.classList.toggle('active',i===phase));
  };
  addEventListener('scroll',updateScrollSystem,{passive:true});
  updateScrollSystem();
}

const chapters=[...document.querySelectorAll('.text-chapter')];
if(chapters.length){
  const cio=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        chapters.forEach(x=>x.classList.remove('active'));
        e.target.classList.add('active');
        const title=e.target.dataset.visualTitle;
        const state=e.target.dataset.visualState;
        const core=document.querySelector('#stickyVisualTitle');
        const s=document.querySelector('#stickyVisualState');
        if(core && title) core.textContent=title;
        if(s && state) s.textContent=state;
      }
    });
  },{rootMargin:'-30% 0px -48% 0px',threshold:.08});
  chapters.forEach(c=>cio.observe(c));
}


// =========================
// RIFTGRID V4 — PUBLIC FIVEM INTERACTIVE CONSOLE DEMO
// =========================
(() => {
  const commands = [
    'restart custom_hud',
    'players',
    'resources',
    'status',
    'help'
  ];

  const resourceNames = [
    'custom_hud',
    'qbx_core',
    'ox_inventory',
    'ox_target',
    'pma-voice',
    'vehicles'
  ];

  const demoPlayers = [
    ['MaxMustermann', '74 ms', '12'],
    ['Lena_RP', '31 ms', '44'],
    ['JohnDoe', '48 ms', '77'],
    ['Kaan', '29 ms', '101']
  ];

  function escapeHtml(value){
    return value.replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    })[ch]);
  }

  function now(){
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(v => String(v).padStart(2,'0')).join(':');
  }

  function line(container, html, cls=''){
    if(!container) return;
    const el = document.createElement('div');
    el.className = `demo-line ${cls}`.trim();
    el.innerHTML = html;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function setResourceState(state){
    const pill = document.getElementById('demoStatePill');
    if(!pill) return;
    pill.textContent = state;
    pill.className = 'demo-state-pill ' + (
      state === 'RUNNING' ? 'running' :
      state === 'RESTARTING' ? 'restarting' : 'stopped'
    );
  }

  function setFeedback(title, text){
    const t = document.getElementById('demoFeedbackTitle');
    const p = document.getElementById('demoFeedbackText');
    if(t) t.textContent = title;
    if(p) p.textContent = text;
  }

  function runCommand(raw, container){
    const input = (raw || '').trim();
    if(!input) return;

    line(container, `› ${escapeHtml(input)}`, 'command');

    const lower = input.toLowerCase();

    if(lower === 'help'){
      line(container, `${now()} available demo commands:`, 'success');
      line(container, `restart custom_hud  ·  players  ·  resources  ·  status  ·  help`);
      setFeedback('Command help opened', 'RIFTGRID can layer structured hints and autocomplete on top of the real console.');
      return;
    }

    if(lower === 'status'){
      line(container, `${now()} FXServer: <span class="green">ONLINE</span>`);
      line(container, `${now()} players: 93 / 128 · resources: 184 · txAdmin: connected`);
      line(container, `${now()} node: fra-04 · health: <span class="green">HEALTHY</span>`);
      setFeedback('Server health recognized', 'The console response can be paired with the same live health state used across the dashboard.');
      return;
    }

    if(lower === 'players'){
      line(container, `${now()} players online: <span class="green">93 / 128</span>`, 'success');
      const wrap = document.createElement('div');
      wrap.className = 'demo-player-list';
      wrap.innerHTML = demoPlayers.map(p => `
        <div class="demo-player-item">
          <span>${escapeHtml(p[0])}</span>
          <span class="ping">${escapeHtml(p[1])}</span>
          <span>#${escapeHtml(p[2])}</span>
        </div>`).join('');
      container.appendChild(wrap);
      container.scrollTop = container.scrollHeight;
      setFeedback('Player-aware response', 'On the real product, this could connect console context directly to player actions and details.');
      return;
    }

    if(lower === 'resources'){
      line(container, `${now()} resource registry:`, 'success');
      const states = [
        ['qbx_core','started'],
        ['ox_inventory','started'],
        ['pma-voice','started'],
        ['custom_hud','started']
      ];
      const wrap = document.createElement('div');
      wrap.className = 'demo-resource-list';
      wrap.innerHTML = states.map(r => `
        <div class="demo-resource-item">
          <span>${escapeHtml(r[0])}</span>
          <span class="res-state">${escapeHtml(r[1])}</span>
          <span>↗</span>
        </div>`).join('');
      container.appendChild(wrap);
      container.scrollTop = container.scrollHeight;
      setFeedback('Resource registry surfaced', 'RIFTGRID understands that this output represents game resources, not just lines of text.');
      return;
    }

    const restartMatch = lower.match(/^restart\s+([a-z0-9_\-.\[\]]+)$/i);
    if(restartMatch){
      const resource = restartMatch[1];
      if(!resourceNames.includes(resource)){
        line(container, `${now()} resource <b>${escapeHtml(resource)}</b> not found`, 'error');
        setFeedback('Unknown resource', 'Autocomplete would normally prevent most mistyped resource names.');
        return;
      }

      setFeedback(`Restarting ${resource}`, 'The public demo is simulating the same structured resource operation RIFTGRID could track in production.');
      if(resource === 'custom_hud') setResourceState('RESTARTING');

      line(container, `${now()} stopping resource ${escapeHtml(resource)}...`, 'warning');

      setTimeout(() => {
        line(container, `${now()} [resources] stopped ${escapeHtml(resource)}`);
      }, 420);

      setTimeout(() => {
        line(container, `${now()} starting resource ${escapeHtml(resource)}...`, 'warning');
      }, 850);

      setTimeout(() => {
        line(container, `${now()} <span class="green">✓ ${escapeHtml(resource)} restarted successfully</span>`, 'success');
        if(resource === 'custom_hud') setResourceState('RUNNING');
        setFeedback(`${resource} is running again`, 'Console command + visual state + structured resource context — all in one interface.');
      }, 1450);
      return;
    }

    if(lower.startsWith('restart ')){
      line(container, `${now()} invalid resource name`, 'error');
      return;
    }

    line(container, `${now()} unknown demo command. Type <b>help</b>.`, 'error');
    setFeedback('Command not recognized', 'The public demo intentionally supports only a safe, fixed set of commands.');
  }

  function bindConsole(inputId, buttonId, consoleId, suggestionsId){
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    const container = document.getElementById(consoleId);
    const suggestions = document.getElementById(suggestionsId);
    if(!input || !button || !container) return;

    let activeIndex = -1;

    const renderSuggestions = () => {
      if(!suggestions) return;
      const value = input.value.trim().toLowerCase();
      let options = [];

      if(value.startsWith('restart ')){
        const partial = value.slice(8);
        options = resourceNames
          .filter(r => r.startsWith(partial))
          .map(r => `restart ${r}`);
      } else if(value){
        options = commands.filter(c => c.startsWith(value));
      }

      if(!options.length || commands.includes(value)){
        suggestions.hidden = true;
        suggestions.innerHTML = '';
        activeIndex = -1;
        return;
      }

      suggestions.hidden = false;
      suggestions.innerHTML = options.map((opt,i) =>
        `<button type="button" data-value="${escapeHtml(opt)}" class="${i===activeIndex?'active':''}">${escapeHtml(opt)}</button>`
      ).join('');

      suggestions.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('mousedown', e => {
          e.preventDefault();
          input.value = btn.dataset.value;
          suggestions.hidden = true;
          input.focus();
        });
      });
    };

    const execute = () => {
      const val = input.value;
      if(!val.trim()){
        input.classList.remove('shake');
        void input.offsetWidth;
        input.classList.add('shake');
        return;
      }
      runCommand(val, container);
      input.value = '';
      if(suggestions) suggestions.hidden = true;
      activeIndex = -1;
      input.focus();
    };

    input.addEventListener('input', renderSuggestions);
    input.addEventListener('keydown', e => {
      const visible = suggestions && !suggestions.hidden;
      const items = visible ? [...suggestions.querySelectorAll('button')] : [];

      if(e.key === 'Tab'){
        const value = input.value.trim().toLowerCase();
        if(value.startsWith('restart ')){
          const partial = value.slice(8);
          const match = resourceNames.find(r => r.startsWith(partial));
          if(match){
            e.preventDefault();
            input.value = `restart ${match}`;
            renderSuggestions();
          }
        }
      }

      if(visible && e.key === 'ArrowDown'){
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        renderSuggestions();
      } else if(visible && e.key === 'ArrowUp'){
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        renderSuggestions();
      } else if(visible && e.key === 'Enter' && activeIndex >= 0){
        e.preventDefault();
        input.value = items[activeIndex].dataset.value;
        suggestions.hidden = true;
        activeIndex = -1;
      } else if(e.key === 'Enter'){
        e.preventDefault();
        execute();
      } else if(e.key === 'Escape' && suggestions){
        suggestions.hidden = true;
      }
    });

    button.addEventListener('click', execute);
  }

  bindConsole('demoCommandInput','demoRunButton','demoConsole','demoSuggestions');
  bindConsole('demoCommandInputLarge','demoRunButtonLarge','demoConsoleLarge','demoSuggestionsLarge');

  document.querySelectorAll('[data-demo-command]').forEach(btn => {
    btn.addEventListener('click', () => {
      const command = btn.dataset.demoCommand;
      const large = document.getElementById('demoCommandInputLarge');
      const small = document.getElementById('demoCommandInput');

      if(large){
        large.value = command;
        large.focus();
        const section = document.getElementById('try-console');
        if(section && btn.closest('.demo-command-guide')){
          section.scrollIntoView({behavior:'smooth',block:'center'});
        }
      } else if(small){
        small.value = command;
        small.focus();
      }
    });
  });
})();


// =========================
// RIFTGRID V6 — Universal deployment scroll
// =========================
(() => {
  const section = document.querySelector('.universal-scroll');
  if (!section) return;

  const phases = [
    {title:'Choose',desc:'Pick an official installer, a community package or define your own Docker workload.',state:'DECLARED',dep:'custom-web-01',source:'Custom Docker',node:'evaluating',storage:'5 GiB persistent',network:'port pending'},
    {title:'Resolve',desc:'The Installer Engine validates the versioned manifest and turns configuration into an execution plan.',state:'RESOLVING',dep:'custom-web-01',source:'custom/docker@v1',node:'requirements loaded',storage:'persistent /data',network:'TCP 80 required'},
    {title:'Schedule',desc:'The core evaluates existing healthy nodes. Installers describe requirements; the scheduler chooses placement.',state:'SCHEDULING',dep:'custom-web-01',source:'custom/docker@v1',node:'node-01 / best fit',storage:'5 GiB persistent',network:'TCP 80 required'},
    {title:'Persist',desc:'Storage and networking are allocated by the same generic RIFTGRID core used for game servers.',state:'PREPARING',dep:'custom-web-01',source:'nginx:alpine',node:'node-01',storage:'PVC / BOUND',network:'NodePort allocated'},
    {title:'Run',desc:'Kubernetes starts the workload and RIFTGRID waits for real health — not a fake timer.',state:'STARTING',dep:'custom-web-01',source:'nginx:alpine',node:'node-01',storage:'PVC / BOUND',network:'HTTP probe'},
    {title:'Understand',desc:'The deployment is RUNNING. If a game adapter exists, richer game-native controls appear on top of the same core.',state:'RUNNING',dep:'custom-web-01',source:'Custom Docker',node:'node-01 / healthy',storage:'5 GiB persistent',network:'HTTP 200'}
  ];

  const map = id => document.getElementById(id);
  const els = {title:map('uPhaseTitle'),desc:map('uPhaseDesc'),index:map('uPhaseIndex'),state:map('uState'),dep:map('uDeployment'),source:map('uSource'),node:map('uNode'),storage:map('uStorage'),network:map('uNetwork')};

  function update(){
    const r=section.getBoundingClientRect();
    const total=section.offsetHeight-innerHeight;
    const travelled=Math.max(0,Math.min(total,-r.top));
    const progress=total?travelled/total:0;
    const idx=Math.min(phases.length-1,Math.floor(progress*phases.length));
    const p=phases[idx];
    section.dataset.uPhase=String(idx+1);
    if(els.title)els.title.textContent=p.title;
    if(els.desc)els.desc.textContent=p.desc;
    if(els.index)els.index.textContent=String(idx+1).padStart(2,'0');
    if(els.state)els.state.textContent=p.state;
    if(els.dep)els.dep.textContent=p.dep;
    if(els.source)els.source.textContent=p.source;
    if(els.node)els.node.textContent=p.node;
    if(els.storage)els.storage.textContent=p.storage;
    if(els.network)els.network.textContent=p.network;
    document.querySelectorAll('.u-phase-indicator i').forEach((x,i)=>x.classList.toggle('active',i===idx));
  }
  addEventListener('scroll',update,{passive:true});update();
})();

// Pricing billing toggle — deliberately does not persist anything in cookies/localStorage.
(() => {
  const buttons=[...document.querySelectorAll('[data-billing]')];
  if(!buttons.length)return;
  buttons.forEach(btn=>btn.addEventListener('click',()=>{
    buttons.forEach(x=>x.classList.toggle('active',x===btn));
    const annual=btn.dataset.billing==='annual';
    document.querySelectorAll('.price strong[data-monthly]').forEach(el=>el.textContent=annual?el.dataset.annual:el.dataset.monthly);
    document.querySelectorAll('.price em').forEach(el=>el.textContent=annual?'/month · billed yearly':'/month');
  }));
})();

// Interactive public simulation of Custom Deployment.
(() => {
  const button=document.getElementById('customDemoButton');
  const progress=document.getElementById('customDemoProgress');
  if(!button||!progress)return;
  let running=false;
  button.addEventListener('click',async()=>{
    if(running)return;
    running=true;button.textContent='Deploying…';
    const steps=[...progress.querySelectorAll('.cp-step')];
    steps.forEach((s,i)=>{s.classList.remove('done','active');s.querySelector('b').textContent=i===0?'running':'waiting';});
    for(let i=0;i<steps.length;i++){
      if(i>0){steps[i-1].classList.remove('active');steps[i-1].classList.add('done');steps[i-1].querySelector('b').textContent='done';}
      steps[i].classList.add('active');
      steps[i].querySelector('b').textContent=i===1?'node-01':i===5?'HTTP 200':'running';
      await new Promise(r=>setTimeout(r,i===6?350:520));
    }
    steps.at(-1).classList.remove('active');steps.at(-1).classList.add('done');steps.at(-1).querySelector('b').textContent='RUNNING';
    button.textContent='Run again ↻';running=false;
  });
})();
