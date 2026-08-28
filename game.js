const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const WORLD = { width: 1600, height: 1100, cx: 800, cy: 550, rx: 620, ry: 410 };
const FLOWER_TIMES = [0, 4500, 9500, 15000];
const STORAGE_KEY = 'cozy-island-save-v1';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const onIsland = (x, y, margin = 0) => {
  const nx = (x - WORLD.cx) / (WORLD.rx - margin);
  const ny = (y - WORLD.cy) / (WORLD.ry - margin);
  return nx * nx + ny * ny < 1;
};

class SaveStore {
  load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  }
  save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      player: state.player, seeds: state.seeds, pickups: state.pickups,
      plants: state.plants, welcomed: state.welcomed, savedAt: Date.now()
    }));
  }
}

class IslandState {
  constructor(saved) {
    this.player = saved?.player || { x: 750, y: 590, facing: 'down' };
    this.seeds = saved?.seeds ?? 0;
    this.pickups = saved?.pickups || [{ x: 700, y: 625, taken: false }, { x: 910, y: 430, taken: false }];
    this.plants = saved?.plants || [];
    this.welcomed = saved?.welcomed || false;
    this.butterflies = [];
  }
}

class Input {
  constructor() {
    this.keys = new Set(); this.actionQueued = false;
    addEventListener('keydown', e => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','e','E'].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'e' || e.key === ' ') this.actionQueued = true;
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    document.querySelectorAll('[data-key]').forEach(button => {
      const key = button.dataset.key.toLowerCase();
      const down = e => { e.preventDefault(); this.keys.add(key); };
      const up = e => { e.preventDefault(); this.keys.delete(key); };
      button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up); button.addEventListener('pointerleave', up);
    });
    document.querySelector('#action').addEventListener('pointerdown', e => { e.preventDefault(); this.actionQueued = true; });
  }
  axis() {
    return {
      x: Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft')),
      y: Number(this.keys.has('s') || this.keys.has('arrowdown')) - Number(this.keys.has('w') || this.keys.has('arrowup'))
    };
  }
  consumeAction() { const queued = this.actionQueued; this.actionQueued = false; return queued; }
}

class Game {
  constructor() {
    this.store = new SaveStore(); this.state = new IslandState(this.store.load()); this.input = new Input();
    this.camera = { x: 0, y: 0 }; this.last = performance.now(); this.elapsed = 0; this.saveClock = 0;
    this.toastEl = document.querySelector('#toast'); this.seedEl = document.querySelector('#seed-count');
    this.bindUI(); this.resize(); addEventListener('resize', () => this.resize());
    this.seedEl.textContent = this.state.seeds;
  }
  bindUI() {
    const welcome = document.querySelector('#welcome');
    if (this.state.welcomed) welcome.classList.add('hidden');
    document.querySelector('#begin').addEventListener('click', () => {
      this.state.welcomed = true; welcome.classList.add('hidden'); this.toast('반짝이는 씨앗을 찾아보세요 ✦');
    });
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    this.scale = dpr; ctx.imageSmoothingEnabled = false;
  }
  toast(text) {
    clearTimeout(this.toastTimer); this.toastEl.textContent = text; this.toastEl.classList.add('show');
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2400);
  }
  update(dt, now) {
    const axis = this.input.axis(); let mag = Math.hypot(axis.x, axis.y);
    if (mag) {
      const run = this.input.keys.has('shift'), speed = run ? 205 : 128;
      axis.x /= mag; axis.y /= mag;
      const nx = this.state.player.x + axis.x * speed * dt, ny = this.state.player.y + axis.y * speed * dt;
      if (onIsland(nx, this.state.player.y, 28)) this.state.player.x = nx;
      if (onIsland(this.state.player.x, ny, 28)) this.state.player.y = ny;
      this.state.player.facing = Math.abs(axis.x) > Math.abs(axis.y) ? (axis.x > 0 ? 'right' : 'left') : (axis.y > 0 ? 'down' : 'up');
    }
    for (const seed of this.state.pickups) {
      if (!seed.taken && distance(seed, this.state.player) < 34) {
        seed.taken = true; this.state.seeds++; this.seedEl.textContent = this.state.seeds;
        this.toast('데이지 씨앗을 주웠어요. 빈 땅에서 E로 심어보세요!');
      }
    }
    if (this.input.consumeAction()) this.act();
    const worldNow = Date.now();
    const blooms = this.state.plants.filter(p => worldNow - p.plantedAt >= FLOWER_TIMES[3]);
    while (this.state.butterflies.length < Math.min(4, blooms.length)) {
      const home = blooms[this.state.butterflies.length];
      this.state.butterflies.push({ x: home.x, y: home.y - 18, phase: Math.random() * 6, home });
      if (this.state.butterflies.length === 1) this.toast('첫 꽃 향기를 따라 나비가 찾아왔어요 🦋');
    }
    this.state.butterflies.forEach((b, i) => {
      b.phase += dt * (1.7 + i * .08); b.x = b.home.x + Math.cos(b.phase) * 36; b.y = b.home.y - 28 + Math.sin(b.phase * 1.6) * 18;
    });
    this.camera.x += (this.state.player.x - canvas.width / this.scale / 2 - this.camera.x) * Math.min(1, dt * 4);
    this.camera.y += (this.state.player.y - canvas.height / this.scale / 2 - this.camera.y) * Math.min(1, dt * 4);
    this.camera.x = clamp(this.camera.x, 0, Math.max(0, WORLD.width - canvas.width / this.scale));
    this.camera.y = clamp(this.camera.y, 0, Math.max(0, WORLD.height - canvas.height / this.scale));
    this.saveClock += dt; if (this.saveClock > 3) { this.store.save(this.state); this.saveClock = 0; }
  }
  act() {
    if (!this.state.seeds) return this.toast('먼저 반짝이는 씨앗을 찾아보세요.');
    const p = this.state.player;
    if (!onIsland(p.x, p.y, 80)) return this.toast('조금 더 안쪽의 부드러운 땅에 심어주세요.');
    if (this.state.plants.some(plant => distance(plant, p) < 55)) return this.toast('꽃들이 자랄 공간을 조금 남겨주세요.');
    this.state.seeds--; this.seedEl.textContent = this.state.seeds;
    this.state.plants.push({ x: Math.round(p.x / 8) * 8, y: Math.round((p.y + 22) / 8) * 8, plantedAt: Date.now() });
    this.toast('씨앗을 심었어요. 곁에서 천천히 자라는 모습을 지켜보세요.');
    this.store.save(this.state);
  }
  draw(now) {
    const w = canvas.width / this.scale, h = canvas.height / this.scale;
    ctx.setTransform(this.scale,0,0,this.scale,0,0); ctx.clearRect(0,0,w,h);
    ctx.save(); ctx.translate(-this.camera.x, -this.camera.y);
    this.drawSea(); this.drawIsland(); this.drawDecor(now); this.drawPlants(now); this.drawPickups(now); this.drawHouse();
    this.drawButterflies(); this.drawPlayer(now); ctx.restore();
    const minutes = Math.floor((now / 1000) % 60); document.querySelector('#time').textContent = `오전 8:${String(20 + minutes % 40).padStart(2,'0')}`;
  }
  drawSea() {
    ctx.fillStyle = '#65bfc7'; ctx.fillRect(0,0,WORLD.width,WORLD.height);
    ctx.strokeStyle = 'rgba(224,250,238,.28)'; ctx.lineWidth = 3;
    for (let y=25;y<WORLD.height;y+=44) for (let x=((y/44)%2)*24;x<WORLD.width;x+=80) {
      ctx.beginPath(); ctx.moveTo(x,y); ctx.quadraticCurveTo(x+15,y-5,x+30,y); ctx.stroke();
    }
  }
  drawIsland() {
    ctx.fillStyle = '#e6cd87'; ctx.beginPath(); ctx.ellipse(WORLD.cx,WORLD.cy,WORLD.rx+24,WORLD.ry+24,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#91b86b'; ctx.beginPath(); ctx.ellipse(WORLD.cx,WORLD.cy,WORLD.rx-20,WORLD.ry-30,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#b7d183'; ctx.lineWidth = 9; ctx.stroke();
  }
  drawDecor(now) {
    const trees = [[470,380],[520,310],[1040,350],[1110,440],[420,680],[1130,690],[550,780],[1010,770]];
    trees.forEach(([x,y],i) => this.drawTree(x,y,Math.sin(now/900+i)*2));
    ctx.fillStyle='#9cc276';
    for(let i=0;i<70;i++){const a=i*2.399,r=80+(i*47)%500,x=WORLD.cx+Math.cos(a)*r,y=WORLD.cy+Math.sin(a)*r*.62;if(onIsland(x,y,60)){ctx.fillRect(x,y,3,8);ctx.fillStyle=i%3?'#9cc276':'#e4dd8a';}}
    ctx.fillStyle='#8a7055';ctx.fillRect(620,490,96,12);ctx.fillRect(632,502,10,22);ctx.fillRect(694,502,10,22);
  }
  drawTree(x,y,sway) {
    ctx.fillStyle='#785a42';ctx.fillRect(x-8,y,16,45);ctx.fillStyle='#567e55';ctx.beginPath();ctx.arc(x+sway,y-14,38,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#6c9961';ctx.beginPath();ctx.arc(x-15+sway,y-23,25,0,Math.PI*2);ctx.arc(x+18+sway,y-20,27,0,Math.PI*2);ctx.fill();
  }
  drawHouse() {
    const x=790,y=330;ctx.fillStyle='#f0d9a8';ctx.fillRect(x-62,y-40,124,92);ctx.fillStyle='#bf6f5f';ctx.beginPath();ctx.moveTo(x-76,y-37);ctx.lineTo(x,y-92);ctx.lineTo(x+76,y-37);ctx.closePath();ctx.fill();
    ctx.fillStyle='#7d5946';ctx.fillRect(x-17,y+8,34,44);ctx.fillStyle='#f6c768';ctx.fillRect(x+30,y-8,20,25);ctx.fillStyle='#fff2bd';ctx.fillRect(x+34,y-4,12,17);
    ctx.fillStyle='rgba(255,255,255,.55)';ctx.fillRect(x-58,y-35,5,84);
  }
  drawPickups(now) {
    this.state.pickups.filter(s=>!s.taken).forEach((s,i)=>{const bob=Math.sin(now/330+i)*4;ctx.fillStyle='rgba(255,242,160,.24)';ctx.beginPath();ctx.arc(s.x,s.y+bob,19,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff0a0';ctx.fillRect(s.x-3,s.y-4+bob,6,9);ctx.fillStyle='#6e8d5e';ctx.fillRect(s.x+2,s.y-8+bob,7,5);});
  }
  drawPlants(now) {
    const worldNow = Date.now();
    this.state.plants.forEach(p=>{const age=worldNow-p.plantedAt;let stage=FLOWER_TIMES.findIndex(t=>age<t)-1;if(stage<0)stage=3;
      ctx.fillStyle='#604b38';ctx.fillRect(p.x-8,p.y+3,16,5);
      if(stage===0){ctx.fillStyle='#6d4d32';ctx.fillRect(p.x-2,p.y-2,4,5);}
      if(stage>=1){ctx.fillStyle='#4f8b50';ctx.fillRect(p.x-2,p.y-15,4,18);ctx.fillRect(p.x-8,p.y-9,7,4);}
      if(stage>=2){ctx.fillStyle='#5a9a58';ctx.fillRect(p.x+1,p.y-13,8,4);}
      if(stage>=3){const sway=Math.sin(now/500+p.x)*2;ctx.fillStyle='#fff8db';for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.beginPath();ctx.arc(p.x+sway+Math.cos(a)*7,p.y-21+Math.sin(a)*7,5,0,Math.PI*2);ctx.fill();}ctx.fillStyle='#efbd45';ctx.beginPath();ctx.arc(p.x+sway,p.y-21,5,0,Math.PI*2);ctx.fill();}
    });
  }
  drawButterflies() { this.state.butterflies.forEach((b,i)=>{ctx.fillStyle=i%2?'#f2a6b5':'#f4d261';ctx.fillRect(b.x-7,b.y-5,6,7);ctx.fillRect(b.x+1,b.y-5,6,7);ctx.fillStyle='#5c5145';ctx.fillRect(b.x-1,b.y-2,2,8);}); }
  drawPlayer(now) {
    const p=this.state.player,bob=this.input.axis().x||this.input.axis().y?Math.sin(now/90)*2:0;
    ctx.fillStyle='rgba(40,66,54,.2)';ctx.beginPath();ctx.ellipse(p.x,p.y+18,17,7,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#6b4b38';ctx.fillRect(p.x-10,p.y-24+bob,20,12);ctx.fillStyle='#f2c69e';ctx.fillRect(p.x-9,p.y-13+bob,18,17);
    ctx.fillStyle='#507e71';ctx.fillRect(p.x-11,p.y+4+bob,22,22);ctx.fillStyle='#384d4c';ctx.fillRect(p.x-9,p.y+26+bob,7,10);ctx.fillRect(p.x+2,p.y+26+bob,7,10);
    ctx.fillStyle='#403832';const eyeX=p.facing==='left'?-5:p.facing==='right'?5:0;ctx.fillRect(p.x-5+eyeX,p.y-8+bob,3,3);ctx.fillRect(p.x+3+eyeX,p.y-8+bob,3,3);
  }
  frame = now => {
    const dt=Math.min(.033,(now-this.last)/1000);this.last=now;this.elapsed+=dt;this.update(dt,now);this.draw(now);requestAnimationFrame(this.frame);
  };
  start() { requestAnimationFrame(this.frame); }
}

new Game().start();
