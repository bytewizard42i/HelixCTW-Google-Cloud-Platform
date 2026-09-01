/**
 * Lightweight confetti burst — no external dependency.
 * Creates a temporary canvas, spawns ~120 particles with random colors,
 * velocities, and rotation, then animates them with gravity until they
 * fall off-screen. The canvas is removed when all particles are gone.
 */

const CONFETTI_COLORS = [
  "#8cf2bd",
  "#ffd86b",
  "#56e6ff",
  "#9585ff",
  "#ff718c",
  "#ffffff",
] as const;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  color: string;
  shape: number;
}

export function fireConfetti(originX?: number, originY?: number): void {
  if (typeof document === "undefined") return;

  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  const context = ctx;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  context.scale(dpr, dpr);

  const cx = originX ?? window.innerWidth / 2;
  const cy = originY ?? window.innerHeight / 3;

  const particles: Particle[] = [];
  const count = 120;

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const speed = 4 + Math.random() * 8;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      size: 6 + Math.random() * 8,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      shape: Math.random() > 0.5 ? 0 : 1,
    });
  }

  const gravity = 0.18;
  const friction = 0.99;
  let frame = 0;
  const maxFrames = 180;

  function animate() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    for (const p of particles) {
      if (p.y > window.innerHeight + 50) continue;
      alive = true;

      p.vy += gravity;
      p.vx *= friction;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;

      context.save();
      context.translate(p.x, p.y);
      context.rotate(p.rotation);
      context.fillStyle = p.color;
      context.globalAlpha = Math.max(0, 1 - frame / maxFrames);

      if (p.shape === 0) {
        // Rectangular confetti strip
        context.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        // Circular confetti dot
        context.beginPath();
        context.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    frame++;
    if (alive && frame < maxFrames) {
      requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(animate);
}
