(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const login = document.getElementById("login");
  const gameUI = document.getElementById("gameUI");
  const usernameInput = document.getElementById("username");
  const joinButton = document.getElementById("join");
  const onlineCount = document.getElementById("onlineCount");
  const you = document.getElementById("you");
  const joystick = document.getElementById("joystick");
  const stick = document.getElementById("stick");

  let client = null;
  let channel = null;
  let myId = crypto.randomUUID();
  let name = "";
  let last = performance.now();

  const world = { width: 2400, height: 1600 };
  const player = { x: 1200, y: 800, speed: 230, radius: 16 };
  const others = new Map();
  const keys = {};
  const joystickState = { x: 0, y: 0, active: false };

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener("resize", resize);
  resize();

  function colorFor(id) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 75% 62%)`;
  }

  function camera() {
    return {
      x: Math.max(0, Math.min(world.width - innerWidth, player.x - innerWidth / 2)),
      y: Math.max(0, Math.min(world.height - innerHeight, player.y - innerHeight / 2))
    };
  }

  function drawWorld(cam) {
    ctx.fillStyle = "#78a85b";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    const grid = 64;
    ctx.strokeStyle = "#ffffff12";
    ctx.lineWidth = 1;
    for (let x = -cam.x % grid; x < innerWidth; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, innerHeight); ctx.stroke();
    }
    for (let y = -cam.y % grid; y < innerHeight; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(innerWidth, y); ctx.stroke();
    }

    // Simple decorative ground dots — no buildings.
    ctx.fillStyle = "#ffffff18";
    for (let x = 32 - cam.x % 96; x < innerWidth; x += 96)
      for (let y = 32 - cam.y % 96; y < innerHeight; y += 96)
        ctx.fillRect(x, y, 2, 2);
  }

  function drawPlayer(p, cam, label, color) {
    const x = p.x - cam.x, y = p.y - cam.y;
    ctx.beginPath();
    ctx.ellipse(x, y + 15, 18, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#0004"; ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();

    ctx.beginPath();
    ctx.arc(x - 5, y - 4, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();

    ctx.font = "700 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x, y - 26);
  }

  function render() {
    const cam = camera();
    drawWorld(cam);
    for (const p of others.values()) drawPlayer(p, cam, p.name, p.color);
    drawPlayer(player, cam, name, colorFor(myId));
  }

  function movement(dt) {
    let x = 0, y = 0;
    if (keys.w || keys.ArrowUp) y -= 1;
    if (keys.s || keys.ArrowDown) y += 1;
    if (keys.a || keys.ArrowLeft) x -= 1;
    if (keys.d || keys.ArrowRight) x += 1;

    if (joystickState.active) { x = joystickState.x; y = joystickState.y; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }

    player.x = Math.max(player.radius, Math.min(world.width - player.radius, player.x + x * player.speed * dt));
    player.y = Math.max(player.radius, Math.min(world.height - player.radius, player.y + y * player.speed * dt));
  }

  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    movement(dt);
    render();
    requestAnimationFrame(loop);
  }

  addEventListener("keydown", e => {
    keys[e.key] = true;
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
  });
  addEventListener("keyup", e => keys[e.key] = false);

  function joystickMove(e) {
    const r = joystick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const max = 40, d = Math.hypot(dx, dy);
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    stick.style.transform = `translate(${dx}px,${dy}px)`;
    joystickState.x = dx / max;
    joystickState.y = dy / max;
  }
  joystick.addEventListener("pointerdown", e => {
    joystickState.active = true;
    joystick.setPointerCapture(e.pointerId);
    joystickMove(e);
  });
  joystick.addEventListener("pointermove", e => { if (joystickState.active) joystickMove(e); });
  joystick.addEventListener("pointerup", () => {
    joystickState.active = false;
    joystickState.x = joystickState.y = 0;
    stick.style.transform = "";
  });

  async function joinWorld() {
    name = usernameInput.value.trim().replace(/[^a-zA-Z0-9_ .-]/g, "").slice(0, 18);
    if (!name) return usernameInput.focus();

    if (!window.SUPABASE_URL.startsWith("http") || window.SUPABASE_ANON_KEY.includes("YOUR_")) {
      alert("Please add your Supabase URL and anon key in src/config.js.");
      return;
    }

    client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

    login.hidden = true;
    gameUI.hidden = false;
    you.textContent = `You: ${name}`;

    channel = client.channel("letout-world", {
      config: { presence: { key: myId } }
    });

    channel
      .on("presence", { event: "sync" }, updatePresence)
      .on("presence", { event: "join" }, updatePresence)
      .on("presence", { event: "leave" }, updatePresence);

    await channel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          id: myId,
          name,
          x: player.x,
          y: player.y,
          color: colorFor(myId)
        });
      }
    });
  }

  function updatePresence() {
    const state = channel.presenceState();
    others.clear();

    for (const [key, entries] of Object.entries(state)) {
      if (key === myId) continue;
      const latest = entries[entries.length - 1];
      if (!latest) continue;
      others.set(key, {
        x: latest.x ?? world.width / 2,
        y: latest.y ?? world.height / 2,
        name: latest.name || "Player",
        color: latest.color || colorFor(key)
      });
    }
    onlineCount.textContent = Object.keys(state).length;
  }

  // Presence payload is intentionally not sent every frame.
  // This prototype focuses on joining/online display. A production
  // multiplayer layer should add a proper tick/network interpolation system.
  setInterval(async () => {
    if (!channel) return;
    await channel.track({ id: myId, name, x: player.x, y: player.y, color: colorFor(myId) });
  }, 100);

  joinButton.addEventListener("click", joinWorld);
  usernameInput.addEventListener("keydown", e => {
    if (e.key === "Enter") joinWorld();
  });

  requestAnimationFrame(loop);
})();